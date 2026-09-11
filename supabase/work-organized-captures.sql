-- Additive migration after work-memory-v2-hardening.sql. No audio storage.
begin;

create table public.work_captures (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  raw_transcript text not null check(length(raw_transcript) between 1 and 30000),
  raw_origin text not null default 'original' check(raw_origin in ('original','legacy_snapshot')),
  captured_at timestamptz not null,
  time_zone text not null,
  focus_case_id uuid,
  current_version integer not null default 1 check(current_version>=1),
  created_at timestamptz not null default now(),
  unique(id,user_id),
  foreign key(focus_case_id,user_id) references public.work_cases(id,user_id)
);
create table public.work_capture_versions (
  id uuid primary key default gen_random_uuid(),
  capture_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  version integer not null check(version>=1),
  receipt_id uuid not null,
  correction text check(correction is null or length(correction) between 1 and 5000),
  organized jsonb check(organized is null or (jsonb_typeof(organized)='object' and jsonb_typeof(organized->'entries')='array' and jsonb_typeof(organized->'summary')='string')),
  search_text text not null default '',
  state text not null default 'pending' check(state in ('pending','ready','failed')),
  error_stage text check(error_stage in ('organization','reasoning')),
  confirmed_changes jsonb,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(id,user_id),unique(capture_id,user_id,version),unique(receipt_id,user_id),
  foreign key(capture_id,user_id) references public.work_captures(id,user_id),
  foreign key(receipt_id,user_id) references public.items(id,user_id)
);
create function public.toolbox_guard_work_version_insert() returns trigger language plpgsql set search_path='' as $$
begin
  if not exists(select 1 from public.items i join public.work_captures c on c.id=new.capture_id and c.user_id=new.user_id
    where i.id=new.receipt_id and i.user_id=new.user_id and i.type='capture' and i.area='Work' and i.source_text=c.raw_transcript)
    then raise exception 'Work capture source required'; end if;
  return new;
end $$;
create trigger work_capture_version_source before insert on public.work_capture_versions for each row execute function public.toolbox_guard_work_version_insert();
revoke all on function public.toolbox_guard_work_version_insert() from public,anon,authenticated;
create index work_captures_owner_time on public.work_captures(user_id,created_at desc);
create index work_captures_focus on public.work_captures(focus_case_id,user_id);
create index work_capture_versions_owner on public.work_capture_versions(user_id,created_at desc);
create index work_capture_versions_search on public.work_capture_versions using gin(to_tsvector('simple',search_text));

alter table public.work_captures enable row level security;
alter table public.work_capture_versions enable row level security;
revoke all on public.work_captures,public.work_capture_versions from public,anon;
grant select,insert,update on public.work_captures,public.work_capture_versions to authenticated;
create policy "Owner capture access" on public.work_captures for all to authenticated
  using ((select auth.uid())=user_id and (select public.toolbox_can_access()))
  with check ((select auth.uid())=user_id and (select public.toolbox_can_access()));
create policy "Owner capture version access" on public.work_capture_versions for all to authenticated
  using ((select auth.uid())=user_id and (select public.toolbox_can_access()))
  with check ((select auth.uid())=user_id and (select public.toolbox_can_access()));

-- Earlier releases normalized and sometimes appended corrections to source_text.
-- Preserve exactly what survives; never claim it is the original pre-edit speech.
insert into public.work_captures(id,user_id,raw_transcript,raw_origin,captured_at,time_zone,created_at)
select id,user_id,source_text,'legacy_snapshot',created_at,'America/New_York',created_at
from public.items where type='capture' and area='Work' and length(source_text)>0;
do $$ declare legacy record; details jsonb; stamp timestamptz; zone text; begin
  for legacy in select c.id,i.content from public.work_captures c join public.items i on i.id=c.id loop
    begin
      details=legacy.content::jsonb;
      stamp=nullif(details->>'captured_at','')::timestamptz;
      zone=details->>'time_zone';
      update public.work_captures set captured_at=coalesce(stamp,captured_at),
        time_zone=case when exists(select 1 from pg_timezone_names where name=zone) then zone else time_zone end where id=legacy.id;
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then null;
    end;
  end loop;
end $$;
insert into public.work_capture_versions(capture_id,user_id,version,receipt_id,created_at,search_text)
select id,user_id,1,id,created_at,raw_transcript from public.work_captures;

create function public.toolbox_guard_work_capture() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_table_name='work_captures' then
    if (to_jsonb(new)-'current_version') is distinct from (to_jsonb(old)-'current_version') then raise exception 'Raw capture is immutable'; end if;
  elsif tg_table_name='work_capture_versions' then
    if (to_jsonb(new)-array['organized','search_text','state','error_stage','confirmed_changes','confirmed_at']) is distinct from (to_jsonb(old)-array['organized','search_text','state','error_stage','confirmed_changes','confirmed_at'])
      or (old.confirmed_changes is not null and (new.confirmed_changes is distinct from old.confirmed_changes or new.confirmed_at is distinct from old.confirmed_at))
      or (old.organized is not null and (new.organized is distinct from old.organized or new.search_text is distinct from old.search_text)) then raise exception 'Capture interpretation is immutable; create a correction version'; end if;
  elsif old.type='capture' and old.area='Work' and old.source_text<>'' then
    if new.source_text is distinct from old.source_text or new.area is distinct from old.area or new.type is distinct from old.type then raise exception 'Raw capture is immutable'; end if;
  end if;
  return new;
end $$;
create trigger work_capture_immutable before update on public.work_captures for each row execute function public.toolbox_guard_work_capture();
create trigger work_capture_version_immutable before update on public.work_capture_versions for each row execute function public.toolbox_guard_work_capture();
create trigger work_receipt_source_immutable before update on public.items for each row execute function public.toolbox_guard_work_capture();

create function public.toolbox_start_work_capture(capture_uuid uuid,transcript text,capture_time timestamptz,capture_zone text,focus_uuid uuid default null)
returns uuid language plpgsql security invoker set search_path='' as $$
declare owner_id uuid=auth.uid(); existing public.work_captures; receipt public.items;
begin
  if owner_id is null or not public.toolbox_can_access() then raise exception 'Owner access required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(capture_uuid::text,0));
  select * into existing from public.work_captures where id=capture_uuid and user_id=owner_id;
  if found then return existing.id; end if;
  if transcript is null or length(btrim(transcript))=0 or length(transcript)>30000 then raise exception 'Invalid transcript'; end if;
  if not exists(select 1 from pg_timezone_names where name=capture_zone) then raise exception 'Invalid time zone'; end if;
  select * into receipt from public.items where id=capture_uuid and user_id=owner_id;
  if found and (receipt.type<>'capture' or receipt.area<>'Work') then raise exception 'Work capture ID conflict'; end if;
  insert into public.work_captures(id,user_id,raw_transcript,raw_origin,captured_at,time_zone,focus_case_id)
  values(capture_uuid,owner_id,coalesce(nullif(receipt.source_text,''),transcript),case when receipt.id is null then 'original' else 'legacy_snapshot' end,capture_time,capture_zone,focus_uuid);
  insert into public.items(id,user_id,type,title,area,status,source_text,content,importance,urgency)
  values(capture_uuid,owner_id,'capture','Work capture','Work','pending',transcript,
    jsonb_build_object('workspace','work-wizard','captured_at',capture_time,'time_zone',capture_zone,'focus_case_id',focus_uuid)::text,1,1)
  on conflict(id) do update set source_text=case when public.items.source_text='' then excluded.source_text else public.items.source_text end;
  insert into public.work_capture_versions(capture_id,user_id,version,receipt_id) values(capture_uuid,owner_id,1,capture_uuid);
  return capture_uuid;
end $$;

create function public.toolbox_revise_work_capture(receipt_uuid uuid,correction_text text,revision_uuid uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare owner_id uuid=auth.uid(); prior public.work_capture_versions; root public.work_captures; next_version integer; existing_id uuid;
begin
  if owner_id is null or not public.toolbox_can_access() then raise exception 'Owner access required'; end if;
  select capture_id into existing_id from public.work_capture_versions where receipt_id=revision_uuid and user_id=owner_id;
  if found then return existing_id; end if;
  select * into prior from public.work_capture_versions where receipt_id=receipt_uuid and user_id=owner_id;
  if not found then raise exception 'Capture not found'; end if;
  select * into root from public.work_captures where id=prior.capture_id and user_id=owner_id for update;
  select capture_id into existing_id from public.work_capture_versions where receipt_id=revision_uuid and user_id=owner_id;
  if found then return existing_id; end if;
  if root.current_version<>prior.version then raise exception 'CAPTURE_CHANGED'; end if;
  if correction_text is null or length(btrim(correction_text))=0 or length(correction_text)>5000 then raise exception 'Invalid correction'; end if;
  next_version=root.current_version+1;
  -- Supersede only an unconfirmed draft. Confirmed case memory remains untouched.
  update public.items set status='processed',turn_result=coalesce(turn_result,'{}'::jsonb)||jsonb_build_object('kind','work_superseded')
    where id=receipt_uuid and user_id=owner_id and status='pending';
  insert into public.items(id,user_id,type,title,area,status,source_text,content,importance,urgency)
  values(revision_uuid,owner_id,'capture','Work capture correction','Work','pending',root.raw_transcript,
    jsonb_build_object('workspace','work-wizard','capture_id',root.id,'captured_at',root.captured_at,'time_zone',root.time_zone,'focus_case_id',root.focus_case_id)::text,1,1);
  insert into public.work_capture_versions(capture_id,user_id,version,receipt_id,correction)
  values(root.id,owner_id,next_version,revision_uuid,correction_text);
  update public.work_captures set current_version=next_version where id=root.id and user_id=owner_id;
  return root.id;
end $$;

create function public.toolbox_store_work_capture_version(version_uuid uuid,interpretation jsonb default null,searchable_text text default null,preview_result jsonb default null,failed_stage text default null,expected_revision integer default 0)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare owner_id uuid=auth.uid(); v public.work_capture_versions; root public.work_captures; receipt public.items; stored_result jsonb;
begin
  if owner_id is null or not public.toolbox_can_access() then raise exception 'Owner access required'; end if;
  select * into v from public.work_capture_versions where id=version_uuid and user_id=owner_id;
  if not found then raise exception 'Capture not found'; end if;
  select * into root from public.work_captures where id=v.capture_id and user_id=owner_id for update;
  if root.current_version<>v.version then raise exception 'CAPTURE_CHANGED'; end if;
  select * into v from public.work_capture_versions where id=version_uuid and user_id=owner_id for update;
  select * into receipt from public.items where id=v.receipt_id and user_id=owner_id for update;
  if interpretation is not null and v.organized is null then
    update public.work_capture_versions set organized=interpretation,search_text=coalesce(searchable_text,''),state='ready',error_stage=null where id=v.id returning * into v;
  end if;
  if failed_stage is not null and receipt.status='pending' and receipt.turn_result is null then
    update public.work_capture_versions set state=case when organized is null then 'failed' else 'ready' end,error_stage=failed_stage where id=v.id;
  end if;
  if preview_result is not null and receipt.status='pending' then
    if v.organized is null then raise exception 'Organized capture required'; end if;
    if coalesce((receipt.turn_result->>'revision')::integer,0)<>expected_revision then return to_jsonb(receipt); end if;
    if preview_result->>'kind' not in ('work_preview','work_answer') then raise exception 'Invalid capture result'; end if;
    stored_result=preview_result||jsonb_build_object('organized_version_id',v.id,'capture_id',root.id,'revision',expected_revision+1,'turn_id',receipt.id);
    update public.items set turn_result=stored_result,status=case when preview_result->>'kind'='work_answer' then 'processed' else 'pending' end where id=receipt.id returning * into receipt;
    update public.work_capture_versions set error_stage=null where id=v.id;
  end if;
  return to_jsonb(receipt);
end $$;

-- A separate confirmation endpoint binds the click to the revision actually shown.
create function public.toolbox_confirm_work_capture(capture_uuid uuid,expected_revision integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare receipt public.items; root_uuid uuid;
begin
  if auth.uid() is null or not public.toolbox_can_access() then raise exception 'Owner access required'; end if;
  select capture_id into root_uuid from public.work_capture_versions where receipt_id=capture_uuid and user_id=auth.uid();
  perform 1 from public.work_captures where id=root_uuid and user_id=auth.uid() for update;
  select * into receipt from public.items where id=capture_uuid and user_id=auth.uid() and type='capture' and area='Work' for update;
  if not found then raise exception 'Capture not found'; end if;
  if receipt.status='processed' and receipt.turn_result->>'kind'='work_commit' then return receipt.turn_result; end if;
  if coalesce((receipt.turn_result->>'revision')::integer,0)<>expected_revision then raise exception 'CAPTURE_CHANGED'; end if;
  return public.toolbox_apply_work_preview(capture_uuid);
end $$;

revoke all on function public.toolbox_guard_work_capture() from public,anon,authenticated;
revoke all on function public.toolbox_start_work_capture(uuid,text,timestamptz,text,uuid) from public,anon;
revoke all on function public.toolbox_revise_work_capture(uuid,text,uuid) from public,anon;
revoke all on function public.toolbox_store_work_capture_version(uuid,jsonb,text,jsonb,text,integer) from public,anon;
revoke all on function public.toolbox_confirm_work_capture(uuid,integer) from public,anon;
grant execute on function public.toolbox_start_work_capture(uuid,text,timestamptz,text,uuid) to authenticated;
grant execute on function public.toolbox_revise_work_capture(uuid,text,uuid) to authenticated;
grant execute on function public.toolbox_store_work_capture_version(uuid,jsonb,text,jsonb,text,integer) to authenticated;
grant execute on function public.toolbox_confirm_work_capture(uuid,integer) to authenticated;


-- Provenance pointers are owner-bound and do not alter existing case values.
alter table public.work_cases add column source_capture_version_id uuid;
alter table public.work_case_phases add column source_capture_version_id uuid;
alter table public.work_case_facts add column source_capture_version_id uuid;
alter table public.work_events add column source_capture_version_id uuid;
alter table public.work_cases add constraint work_cases_owned_capture_version foreign key(source_capture_version_id,user_id) references public.work_capture_versions(id,user_id);
create index work_cases_capture_version on public.work_cases(source_capture_version_id,user_id);
alter table public.work_case_phases add constraint work_case_phases_owned_capture_version foreign key(source_capture_version_id,user_id) references public.work_capture_versions(id,user_id);
create index work_case_phases_capture_version on public.work_case_phases(source_capture_version_id,user_id);
alter table public.work_case_facts add constraint work_case_facts_owned_capture_version foreign key(source_capture_version_id,user_id) references public.work_capture_versions(id,user_id);
create index work_case_facts_capture_version on public.work_case_facts(source_capture_version_id,user_id);
alter table public.work_events add constraint work_events_owned_capture_version foreign key(source_capture_version_id,user_id) references public.work_capture_versions(id,user_id);
create index work_events_capture_version on public.work_events(source_capture_version_id,user_id);

create view public.work_capture_evidence with (security_invoker=true) as
select c.id as capture_id,c.user_id,c.raw_transcript,c.raw_origin,c.captured_at,c.time_zone,c.current_version,
  v.id as version_id,v.version,v.receipt_id,v.correction,v.organized,v.state,v.error_stage,v.created_at,
  v.confirmed_changes,v.confirmed_at,
  'organized_capture'::text as source_type,
  case when v.version<c.current_version then 'superseded' else 'current' end as truth_status,
  to_tsvector('simple',v.search_text) as search_document,
  i.status as receipt_status,i.turn_result
from public.work_captures c join public.work_capture_versions v on v.capture_id=c.id and v.user_id=c.user_id
join public.items i on i.id=v.receipt_id and i.user_id=v.user_id;
revoke all on public.work_capture_evidence from public,anon;
grant select on public.work_capture_evidence to authenticated;

create or replace function public.toolbox_apply_work_preview(capture_uuid uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  owner_id uuid=auth.uid();
  receipt public.items;
  preview jsonb;
  proposal jsonb;
  fact_change jsonb;
  target public.work_cases;
  case_uuid uuid;
  phase_uuid uuid;
  event_uuid uuid;
  expected timestamptz;
  prior_status text;
  prior_condition text;
  aliases_joined text;
  normalized_fact text;
  case_ids uuid[]='{}';
  cases_json jsonb;
  result jsonb;
  source_version public.work_capture_versions;
  source_root public.work_captures;
begin
  if owner_id is null or not public.toolbox_can_access() then raise exception 'Owner access required'; end if;
  select * into source_version from public.work_capture_versions where receipt_id=capture_uuid and user_id=owner_id;
  perform 1 from public.work_captures where id=source_version.capture_id and user_id=owner_id for update;
  select * into receipt from public.items where id=capture_uuid and user_id=owner_id and type='capture' and area='Work' for update;
  if not found then raise exception 'Capture not found'; end if;
  if receipt.status='processed' then
    if receipt.turn_result->>'kind'='work_commit' then return receipt.turn_result; end if;
    raise exception 'Capture already processed';
  end if;
  if receipt.turn_result->>'kind'<>'work_preview' then raise exception 'Work preview not found'; end if;
  select * into source_version from public.work_capture_versions where receipt_id=capture_uuid and user_id=owner_id;
  if found then
    select * into source_root from public.work_captures where id=source_version.capture_id and user_id=owner_id;
    if source_root.current_version<>source_version.version then raise exception 'CAPTURE_CHANGED'; end if;
    -- Legacy drafts retain their existing confirmation behavior.
    if source_root.raw_origin='original' and (source_version.organized is null or receipt.turn_result->>'organized_version_id' is distinct from source_version.id::text) then raise exception 'Organized capture required'; end if;
  end if;
  preview=receipt.turn_result->'preview';
  if preview->>'kind'<>'changes' or jsonb_typeof(preview->'proposals') is distinct from 'array'
     or jsonb_array_length(preview->'proposals')<1 or jsonb_array_length(preview->'proposals')>20 then raise exception 'Invalid work preview'; end if;

  for proposal in select value from jsonb_array_elements(preview->'proposals') loop
    target=null;phase_uuid=null;event_uuid=null;prior_status=null;prior_condition=null;
    if proposal->>'case_id' is not null then
      case_uuid=(proposal->>'case_id')::uuid;
      select * into target from public.work_cases where id=case_uuid and user_id=owner_id for update;
      if not found then raise exception 'CASE_CHANGED'; end if;
      expected=(proposal->>'expected_updated_at')::timestamptz;
      if expected is null or target.updated_at is distinct from expected then raise exception 'CASE_CHANGED'; end if;
      prior_status=target.status;prior_condition=target.follow_up_condition;
    else
      if proposal->>'case_number' is not null and exists(select 1 from public.work_cases where user_id=owner_id and case_number=proposal->>'case_number') then raise exception 'CASE_CHANGED'; end if;
      case_uuid=gen_random_uuid();
    end if;

    if proposal->>'case_number' is not null and proposal->>'case_number' !~ '^G[0-9]{2}-[0-9]{4}$' then raise exception 'Invalid case number'; end if;
    if proposal->>'status' not in ('active','completed') or proposal->>'workflow_state' not in ('todo','waiting','watching','follow_up')
       or proposal->>'ball_owner' not in ('me','other','watching','none') or proposal->>'event_kind' not in ('request','response','action','status','note','follow_up','completion')
       or proposal->>'match_confidence' not in ('high','medium','low') then raise exception 'Invalid work state'; end if;
    if proposal->>'follow_up_at' is not null and proposal->>'follow_up_date' is not null then raise exception 'Invalid follow-up'; end if;

    if target.id is null then
      insert into public.work_cases(id,user_id,case_number,title,status,workflow_state,ball_owner,ball_with,current_situation,next_action,memory_summary,follow_up_at,follow_up_date,follow_up_condition,follow_up_resolved_at,closing_date,last_event_at)
      values(case_uuid,owner_id,proposal->>'case_number',proposal->>'title',proposal->>'status',proposal->>'workflow_state',proposal->>'ball_owner',proposal->>'ball_with',
        coalesce(proposal->>'current_situation',''),coalesce(proposal->>'next_action',''),coalesce(proposal->>'memory_summary',''),
        (proposal->>'follow_up_at')::timestamptz,(proposal->>'follow_up_date')::date,proposal->>'follow_up_condition',null,(proposal->>'closing_date')::date,now());
      insert into public.work_case_phases(user_id,case_id,phase_number,title,summary,status,started_at,ended_at)
      values(owner_id,case_uuid,1,case when proposal->>'status'='completed' then 'Original matter' else 'Current matter' end,
        coalesce(nullif(proposal->>'memory_summary',''),proposal->>'current_situation',''),proposal->>'status',now(),case when proposal->>'status'='completed' then now() else null end)
      returning id into phase_uuid;
      update public.work_cases set current_phase_id=phase_uuid where id=case_uuid and user_id=owner_id;
    else
      if prior_status='completed' and proposal->>'status'='active' then
        insert into public.work_case_phases(user_id,case_id,phase_number,title,summary,status,started_at)
        select owner_id,case_uuid,coalesce(max(phase_number),0)+1,'Reopened matter',coalesce(nullif(proposal->>'current_situation',''),proposal->>'memory_summary',''),'active',now()
        from public.work_case_phases where user_id=owner_id and case_id=case_uuid
        returning id into phase_uuid;
      else
        phase_uuid=target.current_phase_id;
      end if;

      update public.work_cases set
        case_number=proposal->>'case_number',title=proposal->>'title',status=proposal->>'status',workflow_state=proposal->>'workflow_state',ball_owner=proposal->>'ball_owner',ball_with=proposal->>'ball_with',
        current_situation=coalesce(proposal->>'current_situation',''),next_action=coalesce(proposal->>'next_action',''),memory_summary=coalesce(proposal->>'memory_summary',''),
        follow_up_at=(proposal->>'follow_up_at')::timestamptz,follow_up_date=(proposal->>'follow_up_date')::date,follow_up_condition=proposal->>'follow_up_condition',
        follow_up_resolved_at=case when prior_condition is not null and proposal->>'follow_up_condition' is null and proposal->>'follow_up_at' is null and proposal->>'follow_up_date' is null then now()
                                   when proposal->>'follow_up_condition' is not null then null else follow_up_resolved_at end,
        closing_date=(proposal->>'closing_date')::date,last_event_at=now(),current_phase_id=coalesce(phase_uuid,current_phase_id)
      where id=case_uuid and user_id=owner_id;

      if phase_uuid is not null then
        update public.work_case_phases set summary=coalesce(nullif(proposal->>'current_situation',''),proposal->>'memory_summary',''),
          status=proposal->>'status',ended_at=case when proposal->>'status'='completed' then coalesce(ended_at,now()) else null end
        where id=phase_uuid and user_id=owner_id;
      end if;
    end if;

    if proposal->>'duplicate_event_id' is not null then
      select id into event_uuid from public.work_events where id=(proposal->>'duplicate_event_id')::uuid and user_id=owner_id and case_id=case_uuid;
      if not found then raise exception 'Invalid duplicate event'; end if;
    else
      -- Exact repeats are guarded at the transaction boundary as well as in reasoning.
      select id into event_uuid from public.work_events where user_id=owner_id and case_id=case_uuid and kind=proposal->>'event_kind'
        and lower(regexp_replace(summary,'[^[:alnum:]]+','','g'))=lower(regexp_replace(proposal->>'event_summary','[^[:alnum:]]+','','g'))
        and capture_id=capture_uuid limit 1;
    end if;
    if event_uuid is null then
    insert into public.work_events(user_id,case_id,capture_id,kind,summary,source_text,match_confidence,match_reason,occurred_at)
    values(owner_id,case_uuid,capture_uuid,proposal->>'event_kind',proposal->>'event_summary',coalesce(nullif(proposal->>'evidence_excerpt',''),receipt.source_text),proposal->>'match_confidence',proposal->>'match_reason',now())
    returning id into event_uuid;
    update public.work_events set source_capture_version_id=source_version.id where id=event_uuid and user_id=owner_id;
    end if;
    update public.work_cases set source_capture_version_id=source_version.id where id=case_uuid and user_id=owner_id;
    update public.work_case_phases set source_capture_version_id=source_version.id where id=phase_uuid and user_id=owner_id;

    if jsonb_typeof(proposal->'fact_changes')='array' then
      for fact_change in select value from jsonb_array_elements(proposal->'fact_changes') loop
        normalized_fact=lower(regexp_replace(coalesce(fact_change->>'value',''),'[^[:alnum:]]+','','g'));
        select coalesce(string_agg(value,' | '),'') into aliases_joined from jsonb_array_elements_text(coalesce(fact_change->'aliases','[]'::jsonb));
        if fact_change->>'action'='remove' then
          update public.work_case_facts set active=false,source_capture_version_id=source_version.id,source_capture_id=capture_uuid,source_event_id=event_uuid
          where user_id=owner_id and case_id=case_uuid and active=true and fact_key=fact_change->>'key'
            and (normalized_value=normalized_fact or lower(fact_value)=lower(fact_change->>'value'));
        elsif fact_change->>'action'='upsert' then
          update public.work_case_facts set source_capture_version_id=source_version.id,fact_value=fact_change->>'value',aliases_text=aliases_joined,confidence=coalesce(fact_change->>'confidence','high'),source_capture_id=capture_uuid,source_event_id=event_uuid,active=true
          where user_id=owner_id and case_id=case_uuid and fact_key=fact_change->>'key' and normalized_value=normalized_fact;
          if not found then
            insert into public.work_case_facts(user_id,case_id,fact_key,fact_value,normalized_value,aliases_text,confidence,source_capture_id,source_event_id,active,source_capture_version_id)
            values(owner_id,case_uuid,fact_change->>'key',fact_change->>'value',normalized_fact,aliases_joined,coalesce(fact_change->>'confidence','high'),capture_uuid,event_uuid,true,source_version.id);
          end if;
        end if;
      end loop;
    end if;
    case_ids=array_append(case_ids,case_uuid);
  end loop;

  select coalesce(jsonb_agg(to_jsonb(c) order by c.updated_at desc),'[]'::jsonb) into cases_json from public.work_cases c where c.user_id=owner_id and c.id=any(case_ids);
  result=jsonb_build_object('kind','work_commit','turn_id',capture_uuid,'case_ids',to_jsonb(case_ids),'cases',cases_json,'reply',coalesce(preview->>'commit_reply','Saved your confirmed Work updates.'));
  update public.work_capture_versions set confirmed_changes=preview,confirmed_at=now() where id=source_version.id and user_id=owner_id;
  result=result||jsonb_build_object('organized_version_id',source_version.id,'capture_id',source_version.capture_id);
  update public.items set status='processed',turn_result=result where id=capture_uuid and user_id=owner_id;
  return result;
end $$;


commit;
