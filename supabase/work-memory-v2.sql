begin;

alter table public.work_cases add column if not exists memory_summary text not null default '';
alter table public.work_cases add column if not exists current_phase_id uuid;
alter table public.work_cases add column if not exists follow_up_condition text;
alter table public.work_cases add column if not exists follow_up_resolved_at timestamptz;

alter table public.work_events add column if not exists match_confidence text;
alter table public.work_events add column if not exists match_reason text;

update public.work_cases
set memory_summary=current_situation
where memory_summary='' and current_situation<>'';

create table if not exists public.work_case_phases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  case_id uuid not null,
  phase_number integer not null check (phase_number>=1),
  title text not null check (length(title) between 1 and 180),
  summary text not null default '' check (length(summary)<=5000),
  status text not null default 'active' check (status in ('active','completed')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,user_id),
  unique(user_id,case_id,phase_number),
  constraint work_phase_owned_case foreign key(case_id,user_id) references public.work_cases(id,user_id) on delete cascade
);

create table if not exists public.work_case_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  case_id uuid not null,
  fact_key text not null check (length(fact_key) between 1 and 80),
  fact_value text not null check (length(fact_value) between 1 and 1000),
  normalized_value text not null default '' check (length(normalized_value)<=1000),
  aliases_text text not null default '' check (length(aliases_text)<=3000),
  confidence text not null default 'high' check (confidence in ('high','medium','low')),
  source_capture_id uuid references public.items(id) on delete set null,
  source_event_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,user_id),
  constraint work_fact_owned_case foreign key(case_id,user_id) references public.work_cases(id,user_id) on delete cascade,
  constraint work_fact_source_event foreign key(source_event_id,user_id) references public.work_events(id,user_id) on delete set null
);

create table if not exists public.work_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  rule_key text not null check (length(rule_key) between 1 and 120),
  rule_text text not null check (length(rule_text) between 1 and 2000),
  enabled boolean not null default true,
  source_capture_id uuid references public.items(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,rule_key)
);

create index if not exists work_case_phases_case_time on public.work_case_phases(user_id,case_id,phase_number desc);
create index if not exists work_case_facts_case on public.work_case_facts(user_id,case_id,active,fact_key);
create index if not exists work_case_facts_value on public.work_case_facts(user_id,normalized_value) where active=true;
create index if not exists work_rules_owner_enabled on public.work_rules(user_id,enabled,updated_at desc);

alter table public.work_case_phases enable row level security;
alter table public.work_case_facts enable row level security;
alter table public.work_rules enable row level security;

grant select,insert,update,delete on public.work_case_phases to authenticated;
grant select,insert,update,delete on public.work_case_facts to authenticated;
grant select,insert,update,delete on public.work_rules to authenticated;
revoke all on public.work_case_phases from anon;
revoke all on public.work_case_facts from anon;
revoke all on public.work_rules from anon;

do $$ begin
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='work_case_phases' and policyname='Read own work phases') then
    create policy "Read own work phases" on public.work_case_phases for select to authenticated using ((select auth.uid())=user_id);
    create policy "Insert own work phases" on public.work_case_phases for insert to authenticated with check ((select auth.uid())=user_id);
    create policy "Update own work phases" on public.work_case_phases for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
    create policy "Delete own work phases" on public.work_case_phases for delete to authenticated using ((select auth.uid())=user_id);
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='work_case_facts' and policyname='Read own work facts') then
    create policy "Read own work facts" on public.work_case_facts for select to authenticated using ((select auth.uid())=user_id);
    create policy "Insert own work facts" on public.work_case_facts for insert to authenticated with check ((select auth.uid())=user_id);
    create policy "Update own work facts" on public.work_case_facts for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
    create policy "Delete own work facts" on public.work_case_facts for delete to authenticated using ((select auth.uid())=user_id);
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='work_rules' and policyname='Read own work rules') then
    create policy "Read own work rules" on public.work_rules for select to authenticated using ((select auth.uid())=user_id);
    create policy "Insert own work rules" on public.work_rules for insert to authenticated with check ((select auth.uid())=user_id);
    create policy "Update own work rules" on public.work_rules for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
    create policy "Delete own work rules" on public.work_rules for delete to authenticated using ((select auth.uid())=user_id);
  end if;
end $$;

do $$ begin
  if not exists(select 1 from pg_constraint where conname='work_case_current_phase_owned') then
    alter table public.work_cases add constraint work_case_current_phase_owned
      foreign key(current_phase_id,user_id) references public.work_case_phases(id,user_id) on delete set null;
  end if;
  if not exists(select 1 from pg_constraint where conname='work_event_match_confidence') then
    alter table public.work_events add constraint work_event_match_confidence
      check (match_confidence is null or match_confidence in ('high','medium','low'));
  end if;
  if not exists(select 1 from pg_constraint where conname='work_case_memory_summary_length') then
    alter table public.work_cases add constraint work_case_memory_summary_length check (length(memory_summary)<=5000);
  end if;
  if not exists(select 1 from pg_constraint where conname='work_case_follow_up_condition_length') then
    alter table public.work_cases add constraint work_case_follow_up_condition_length check (follow_up_condition is null or length(follow_up_condition)<=1000);
  end if;
end $$;

insert into public.work_case_phases(user_id,case_id,phase_number,title,summary,status,started_at,ended_at)
select c.user_id,c.id,1,
  case when c.status='completed' then 'Original matter' else 'Current matter' end,
  coalesce(nullif(c.memory_summary,''),c.current_situation,''),
  c.status,c.created_at,case when c.status='completed' then c.last_event_at else null end
from public.work_cases c
where not exists(select 1 from public.work_case_phases p where p.user_id=c.user_id and p.case_id=c.id);

update public.work_cases c
set current_phase_id=(
  select p.id from public.work_case_phases p
  where p.user_id=c.user_id and p.case_id=c.id
  order by p.phase_number desc limit 1
)
where c.current_phase_id is null;

create or replace function public.toolbox_touch_work_memory_row() returns trigger
language plpgsql set search_path='' as $$
begin
  new.updated_at=now();
  return new;
end $$;

drop trigger if exists toolbox_touch_work_phase on public.work_case_phases;
create trigger toolbox_touch_work_phase before update on public.work_case_phases for each row execute function public.toolbox_touch_work_memory_row();
drop trigger if exists toolbox_touch_work_fact on public.work_case_facts;
create trigger toolbox_touch_work_fact before update on public.work_case_facts for each row execute function public.toolbox_touch_work_memory_row();
drop trigger if exists toolbox_touch_work_rule on public.work_rules;
create trigger toolbox_touch_work_rule before update on public.work_rules for each row execute function public.toolbox_touch_work_memory_row();

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
begin
  if owner_id is null or not public.toolbox_can_access() then raise exception 'Owner access required'; end if;
  select * into receipt from public.items where id=capture_uuid and user_id=owner_id and type='capture' for update;
  if not found then raise exception 'Capture not found'; end if;
  if receipt.status='processed' then
    if receipt.turn_result->>'kind'='work_commit' then return receipt.turn_result; end if;
    raise exception 'Capture already processed';
  end if;
  if receipt.turn_result->>'kind'<>'work_preview' then raise exception 'Work preview not found'; end if;
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

    insert into public.work_events(user_id,case_id,capture_id,kind,summary,source_text,match_confidence,match_reason,occurred_at)
    values(owner_id,case_uuid,capture_uuid,proposal->>'event_kind',proposal->>'event_summary',coalesce(nullif(proposal->>'evidence_excerpt',''),receipt.source_text),proposal->>'match_confidence',proposal->>'match_reason',now())
    returning id into event_uuid;

    if jsonb_typeof(proposal->'fact_changes')='array' then
      for fact_change in select value from jsonb_array_elements(proposal->'fact_changes') loop
        normalized_fact=lower(regexp_replace(coalesce(fact_change->>'value',''),'[^[:alnum:]]+','','g'));
        select coalesce(string_agg(value,' | '),'') into aliases_joined from jsonb_array_elements_text(coalesce(fact_change->'aliases','[]'::jsonb));
        if fact_change->>'action'='remove' then
          update public.work_case_facts set active=false,source_capture_id=capture_uuid,source_event_id=event_uuid
          where user_id=owner_id and case_id=case_uuid and active=true and fact_key=fact_change->>'key'
            and (normalized_value=normalized_fact or lower(fact_value)=lower(fact_change->>'value'));
        elsif fact_change->>'action'='upsert' then
          update public.work_case_facts set fact_value=fact_change->>'value',aliases_text=aliases_joined,confidence=coalesce(fact_change->>'confidence','high'),source_capture_id=capture_uuid,source_event_id=event_uuid,active=true
          where user_id=owner_id and case_id=case_uuid and fact_key=fact_change->>'key' and normalized_value=normalized_fact;
          if not found then
            insert into public.work_case_facts(user_id,case_id,fact_key,fact_value,normalized_value,aliases_text,confidence,source_capture_id,source_event_id,active)
            values(owner_id,case_uuid,fact_change->>'key',fact_change->>'value',normalized_fact,aliases_joined,coalesce(fact_change->>'confidence','high'),capture_uuid,event_uuid,true);
          end if;
        end if;
      end loop;
    end if;
    case_ids=array_append(case_ids,case_uuid);
  end loop;

  select coalesce(jsonb_agg(to_jsonb(c) order by c.updated_at desc),'[]'::jsonb) into cases_json from public.work_cases c where c.user_id=owner_id and c.id=any(case_ids);
  result=jsonb_build_object('kind','work_commit','turn_id',capture_uuid,'case_ids',to_jsonb(case_ids),'cases',cases_json,'reply',coalesce(preview->>'commit_reply','Saved your confirmed Work updates.'));
  update public.items set status='processed',turn_result=result where id=capture_uuid and user_id=owner_id;
  return result;
end $$;

create or replace function public.toolbox_mark_work_case_done(case_uuid uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  owner_id uuid=auth.uid();
  target public.work_cases;
begin
  if owner_id is null or not public.toolbox_can_access() then raise exception 'Owner access required'; end if;
  select * into target from public.work_cases where id=case_uuid and user_id=owner_id for update;
  if not found then raise exception 'Work file not found'; end if;
  if target.status='completed' then return to_jsonb(target); end if;
  update public.work_cases set status='completed',ball_owner='none',ball_with=null,next_action='',follow_up_at=null,follow_up_date=null,follow_up_condition=null,
    follow_up_resolved_at=case when follow_up_condition is not null then now() else follow_up_resolved_at end,last_event_at=now()
  where id=case_uuid and user_id=owner_id returning * into target;
  update public.work_case_phases set status='completed',ended_at=coalesce(ended_at,now()),summary=coalesce(nullif(target.memory_summary,''),target.current_situation,summary)
  where id=target.current_phase_id and user_id=owner_id;
  insert into public.work_events(user_id,case_id,capture_id,kind,summary,source_text,match_confidence,match_reason,occurred_at)
  values(owner_id,case_uuid,null,'completion','Marked '||coalesce(target.case_number,target.title)||' done.','Quick completion confirmation','high','Direct user confirmation',now());
  return to_jsonb(target);
end $$;

revoke all on function public.toolbox_touch_work_memory_row() from public,anon,authenticated;
revoke all on function public.toolbox_apply_work_preview(uuid) from public,anon;
revoke all on function public.toolbox_mark_work_case_done(uuid) from public,anon;
grant execute on function public.toolbox_apply_work_preview(uuid) to authenticated;
grant execute on function public.toolbox_mark_work_case_done(uuid) to authenticated;

commit;
