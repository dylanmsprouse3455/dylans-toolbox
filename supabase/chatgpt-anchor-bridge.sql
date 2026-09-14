-- Private admin-only bridge for explicit ChatGPT -> Toolbox saves.
-- This is intentionally NOT exposed through the Data API or to authenticated browser clients.
-- Personal anchors reuse toolbox_apply_turn. Work anchors reuse the immutable Work capture + confirmation transaction.
begin;

create or replace function toolbox_private.chatgpt_anchor_personal(
  anchor_uuid uuid,
  source_text text,
  entry_specs jsonb,
  reply_text text default 'Anchored from ChatGPT.'
)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  owner_id uuid;
  receipt public.items;
  spec jsonb;
  item_uuid uuid;
  item_type text;
  item_area text;
  item_title text;
  item_content text;
  item_importance integer;
  item_urgency integer;
  item_workflow text;
  item_waiting_on text;
  item_follow_up_at text;
  item_follow_up_date text;
  item_due_at text;
  item_due_date text;
  item_highlighted boolean;
  entries jsonb='[]'::jsonb;
begin
  select user_id into owner_id from toolbox_private.owner where singleton=true;
  if owner_id is null then raise exception 'Toolbox owner is not configured'; end if;
  if anchor_uuid is null then raise exception 'Anchor id is required'; end if;
  if source_text is null or length(btrim(source_text))=0 or length(source_text)>30000 then raise exception 'Invalid anchor source'; end if;
  if jsonb_typeof(entry_specs) is distinct from 'array' or jsonb_array_length(entry_specs)<1 or jsonb_array_length(entry_specs)>40 then raise exception 'Invalid Personal entries'; end if;
  if reply_text is null or length(reply_text)>2000 then raise exception 'Invalid reply'; end if;

  -- Existing Toolbox functions are owner-scoped through auth.uid(). This local transaction
  -- claim lets the admin-only bridge reuse those exact validation/transaction paths.
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  if auth.uid() is distinct from owner_id or not public.toolbox_can_access() then raise exception 'Owner context failed'; end if;

  perform pg_advisory_xact_lock(hashtextextended(anchor_uuid::text,0));
  select * into receipt from public.items where id=anchor_uuid;
  if found then
    if receipt.user_id is distinct from owner_id or receipt.type<>'capture' or receipt.area='Work' then raise exception 'Anchor id conflict'; end if;
    if receipt.source_text<>source_text then raise exception 'Anchor source conflict'; end if;
    if receipt.status='processed' then
      return public.toolbox_apply_turn(anchor_uuid,'','[]'::jsonb,'[]'::jsonb,'',false);
    end if;
  else
    insert into public.items(id,user_id,type,title,content,area,status,importance,urgency,source_text)
    values(anchor_uuid,owner_id,'capture','ChatGPT anchor',jsonb_build_object('workspace','personal','channel','chatgpt-anchor')::text,'Inbox','pending',1,1,source_text);
  end if;

  for spec in select value from jsonb_array_elements(entry_specs) loop
    if jsonb_typeof(spec) is distinct from 'object' then raise exception 'Invalid Personal entry'; end if;
    item_type=coalesce(spec->>'type','note');
    item_area=coalesce(spec->>'area','Inbox');
    item_title=btrim(coalesce(spec->>'title',''));
    item_content=coalesce(spec->>'content','');
    item_importance=coalesce((spec->>'importance')::integer,case when item_type in ('note','reference') then 1 else 3 end);
    item_urgency=coalesce((spec->>'urgency')::integer,case when item_type in ('note','reference') then 1 else 3 end);
    item_due_at=nullif(spec->>'due_at','');
    item_due_date=nullif(spec->>'due_date','');
    item_workflow=coalesce(spec->>'workflow_state','active');
    item_waiting_on=nullif(spec->>'waiting_on','');
    item_follow_up_at=nullif(spec->>'follow_up_at','');
    item_follow_up_date=nullif(spec->>'follow_up_date','');
    item_highlighted=coalesce((spec->>'highlighted')::boolean,false);
    item_uuid=coalesce(nullif(spec->>'id','')::uuid,gen_random_uuid());

    if item_type not in ('task','reminder','note','reference') then raise exception 'Invalid Personal item type'; end if;
    if item_area not in ('Home','Money','Personal','People','Projects','Ideas','Inbox') then raise exception 'Work cannot be written through Personal bridge'; end if;
    if length(item_title)<1 or length(item_title)>180 or length(item_content)>12000 then raise exception 'Invalid Personal item text'; end if;
    if item_importance not between 1 and 5 or item_urgency not between 1 and 5 then raise exception 'Invalid Personal priority'; end if;
    if item_due_at is not null and item_due_date is not null then raise exception 'Only one due-date kind is allowed'; end if;
    if item_follow_up_at is not null and item_follow_up_date is not null then raise exception 'Only one follow-up kind is allowed'; end if;
    if item_workflow not in ('active','waiting') then raise exception 'Invalid Personal workflow'; end if;

    if item_type in ('note','reference') then
      item_importance=1; item_urgency=1; item_due_at=null; item_due_date=null; item_workflow='active';
      item_waiting_on=null; item_follow_up_at=null; item_follow_up_date=null; item_highlighted=false;
    elsif item_workflow='active' then
      item_waiting_on=null; item_follow_up_at=null; item_follow_up_date=null;
    end if;

    entries=entries||jsonb_build_array(jsonb_build_object(
      'id',item_uuid,'type',item_type,'title',item_title,'content',item_content,'area',item_area,
      'importance',item_importance,'urgency',item_urgency,'due_at',item_due_at,'due_date',item_due_date,
      'parent_id',null,'depends_on_id',null,'workflow_state',item_workflow,'waiting_on',item_waiting_on,
      'follow_up_at',item_follow_up_at,'follow_up_date',item_follow_up_date,'highlighted',item_highlighted
    ));
  end loop;

  return public.toolbox_apply_turn(anchor_uuid,source_text,entries,'[]'::jsonb,reply_text,false)
    ||jsonb_build_object('anchor_source','chatgpt','workspace','personal');
end $$;

create or replace function toolbox_private.chatgpt_anchor_work(
  anchor_uuid uuid,
  source_text text,
  case_number text,
  patch jsonb,
  captured_at timestamptz default now(),
  capture_zone text default 'America/New_York'
)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  owner_id uuid;
  target public.work_cases;
  receipt public.items;
  version_row public.work_capture_versions;
  desired_title text;
  desired_status text;
  desired_workflow text;
  desired_ball_owner text;
  desired_ball_with text;
  desired_current text;
  desired_next text;
  desired_memory text;
  desired_follow_at timestamptz;
  desired_follow_date date;
  desired_follow_condition text;
  desired_closing date;
  event_kind text;
  event_summary text;
  evidence_excerpt text;
  fact_changes jsonb;
  duplicate_event_id text;
  organized jsonb;
  proposal jsonb;
  preview jsonb;
  stored jsonb;
  revision integer;
  result jsonb;
  invalid_key text;
begin
  select user_id into owner_id from toolbox_private.owner where singleton=true;
  if owner_id is null then raise exception 'Toolbox owner is not configured'; end if;
  if anchor_uuid is null then raise exception 'Anchor id is required'; end if;
  if source_text is null or length(btrim(source_text))=0 or length(source_text)>30000 then raise exception 'Invalid anchor source'; end if;
  if patch is null or jsonb_typeof(patch) is distinct from 'object' then raise exception 'Invalid Work patch'; end if;
  if case_number is not null and case_number !~ '^G[0-9]{2}-[0-9]{4}$' then raise exception 'Invalid case number'; end if;
  if not exists(select 1 from pg_timezone_names where name=capture_zone) then raise exception 'Invalid time zone'; end if;

  select key into invalid_key from jsonb_object_keys(patch) key
  where key not in ('title','status','workflow_state','ball_with','current_situation','next_action','memory_summary',
    'follow_up_at','follow_up_date','follow_up_condition','closing_date','event_kind','event_summary','evidence_excerpt',
    'fact_changes','duplicate_event_id') limit 1;
  if invalid_key is not null then raise exception 'Unsupported Work patch key: %',invalid_key; end if;

  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  if auth.uid() is distinct from owner_id or not public.toolbox_can_access() then raise exception 'Owner context failed'; end if;

  perform pg_advisory_xact_lock(hashtextextended(anchor_uuid::text,0));
  if case_number is not null then
    select * into target from public.work_cases where user_id=owner_id and work_cases.case_number=chatgpt_anchor_work.case_number for update;
  end if;

  perform public.toolbox_start_work_capture(anchor_uuid,source_text,captured_at,capture_zone,target.id);
  select * into receipt from public.items where id=anchor_uuid and user_id=owner_id and type='capture' and area='Work' for update;
  if receipt.source_text<>source_text then raise exception 'Anchor source conflict'; end if;
  if receipt.status='processed' then return receipt.turn_result||jsonb_build_object('anchor_source','chatgpt','workspace','work'); end if;
  select * into version_row from public.work_capture_versions where receipt_id=anchor_uuid and user_id=owner_id;
  if not found then raise exception 'Work capture version missing'; end if;

  -- A Work note without an exact case number is still retained as immutable searchable capture evidence,
  -- but it does not guess a case or mutate case state.
  if case_number is null then
    organized=jsonb_build_object('summary',source_text,'entries',jsonb_build_array(jsonb_build_object(
      'kind','note','text',source_text,'case_numbers','[]'::jsonb,'people','[]'::jsonb,'property',null,
      'truth_status','current','source','raw_transcript','source_version',1,'source_excerpt',left(source_text,6000),
      'date_wording',null,'resolved_date',null,'resolved_at',null
    )));
    perform public.toolbox_store_work_capture_version(version_row.id,organized,source_text,null,null,0);
    result=jsonb_build_object('kind','work_answer','answer','Saved as an unlinked Work capture.','answer_status','capture_only',
      'reply','Saved this Work note.','turn_id',anchor_uuid,'capture_id',anchor_uuid,'organized_version_id',version_row.id,
      'anchor_source','chatgpt','workspace','work');
    update public.work_capture_versions set confirmed_changes=jsonb_build_object('kind','capture_only'),confirmed_at=now()
      where id=version_row.id and user_id=owner_id and confirmed_changes is null;
    update public.items set status='processed',turn_result=result where id=anchor_uuid and user_id=owner_id;
    return result;
  end if;

  desired_title=coalesce(nullif(patch->>'title',''),target.title,case_number);
  desired_status=coalesce(nullif(patch->>'status',''),target.status,'active');
  desired_workflow=coalesce(nullif(patch->>'workflow_state',''),target.workflow_state,'todo');
  desired_current=case when patch ? 'current_situation' then coalesce(patch->>'current_situation','') else coalesce(target.current_situation,'') end;
  desired_next=case when patch ? 'next_action' then coalesce(patch->>'next_action','') else coalesce(target.next_action,'') end;
  desired_memory=case when patch ? 'memory_summary' then coalesce(patch->>'memory_summary','') else coalesce(target.memory_summary,nullif(desired_current,''),'') end;
  desired_follow_at=case when patch ? 'follow_up_at' then nullif(patch->>'follow_up_at','')::timestamptz else target.follow_up_at end;
  desired_follow_date=case when patch ? 'follow_up_date' then nullif(patch->>'follow_up_date','')::date else target.follow_up_date end;
  desired_follow_condition=case when patch ? 'follow_up_condition' then nullif(patch->>'follow_up_condition','') else target.follow_up_condition end;
  desired_closing=case when patch ? 'closing_date' then nullif(patch->>'closing_date','')::date else target.closing_date end;
  event_kind=coalesce(nullif(patch->>'event_kind',''),'action');
  event_summary=coalesce(nullif(patch->>'event_summary',''),left(source_text,2000));
  evidence_excerpt=coalesce(nullif(patch->>'evidence_excerpt',''),left(source_text,2000));
  fact_changes=coalesce(patch->'fact_changes','[]'::jsonb);
  duplicate_event_id=nullif(patch->>'duplicate_event_id','');

  if desired_status not in ('active','completed') then raise exception 'Invalid Work status'; end if;
  if desired_workflow not in ('todo','waiting','watching','follow_up') then raise exception 'Invalid Work workflow'; end if;
  if desired_follow_at is not null and desired_follow_date is not null then raise exception 'Only one Work follow-up kind is allowed'; end if;
  if event_kind not in ('request','response','action','status','note','follow_up','completion') then raise exception 'Invalid Work event kind'; end if;
  if length(desired_title)<1 or length(desired_title)>180 or length(desired_current)>4000 or length(desired_next)>1000 or length(desired_memory)>5000 then raise exception 'Invalid Work text length'; end if;
  if length(event_summary)<1 or length(event_summary)>2000 or length(evidence_excerpt)<1 or length(evidence_excerpt)>2000 then raise exception 'Invalid Work evidence'; end if;
  if jsonb_typeof(fact_changes) is distinct from 'array' or jsonb_array_length(fact_changes)>30 then raise exception 'Invalid Work facts'; end if;

  if desired_status='completed' then desired_ball_owner='none'; desired_ball_with=null;
  elsif desired_workflow='waiting' then desired_ball_owner='other'; desired_ball_with=case when patch ? 'ball_with' then nullif(patch->>'ball_with','') else target.ball_with end;
  elsif desired_workflow='watching' then desired_ball_owner='watching'; desired_ball_with=null;
  else desired_ball_owner='me'; desired_ball_with=null;
  end if;

  organized=jsonb_build_object('summary',source_text,'entries',jsonb_build_array(jsonb_build_object(
    'kind',case when event_kind='follow_up' then 'follow_up' when event_kind='note' then 'note' else 'action' end,
    'text',event_summary,'case_numbers',jsonb_build_array(case_number),'people','[]'::jsonb,'property',null,
    'truth_status','current','source','raw_transcript','source_version',1,'source_excerpt',left(source_text,6000),
    'date_wording',null,'resolved_date',null,'resolved_at',null
  )));

  proposal=jsonb_build_object(
    'duplicate_event_id',duplicate_event_id,
    'case_id',target.id,
    'expected_updated_at',target.updated_at,
    'case_number',case_number,
    'title',desired_title,
    'status',desired_status,
    'workflow_state',desired_workflow,
    'ball_owner',desired_ball_owner,
    'ball_with',desired_ball_with,
    'current_situation',desired_current,
    'next_action',desired_next,
    'memory_summary',desired_memory,
    'follow_up_at',desired_follow_at,
    'follow_up_date',desired_follow_date,
    'follow_up_condition',desired_follow_condition,
    'closing_date',desired_closing,
    'event_kind',event_kind,
    'event_summary',event_summary,
    'evidence_excerpt',evidence_excerpt,
    'match_confidence','high',
    'match_reason',case when target.id is null then 'Explicit new case '||case_number else 'Exact '||case_number end,
    'fact_changes',fact_changes,
    'confirmation_question','Anchor this ChatGPT update to '||case_number||'?'
  );
  preview=jsonb_build_object('kind','changes','headline','ChatGPT anchor for '||case_number,'answer',null,'answer_status',null,
    'commit_reply','Anchored to '||case_number||'.','proposals',jsonb_build_array(proposal),'rule_suggestions','[]'::jsonb);

  -- If a prior attempt reached preview storage but not confirmation, complete that same revision instead of duplicating it.
  if receipt.turn_result->>'kind'='work_preview' then
    revision=coalesce((receipt.turn_result->>'revision')::integer,0);
    if revision<1 then raise exception 'Invalid stored Work revision'; end if;
    result=public.toolbox_confirm_work_capture(anchor_uuid,revision);
    return result||jsonb_build_object('anchor_source','chatgpt','workspace','work');
  end if;

  stored=public.toolbox_store_work_capture_version(version_row.id,organized,source_text,
    jsonb_build_object('kind','work_preview','preview',preview),null,0);
  revision=coalesce((stored->'turn_result'->>'revision')::integer,0);
  if revision<1 then raise exception 'Work preview was not stored'; end if;
  result=public.toolbox_confirm_work_capture(anchor_uuid,revision);
  return result||jsonb_build_object('anchor_source','chatgpt','workspace','work');
end $$;

revoke all on function toolbox_private.chatgpt_anchor_personal(uuid,text,jsonb,text) from public,anon,authenticated;
revoke all on function toolbox_private.chatgpt_anchor_work(uuid,text,text,jsonb,timestamptz,text) from public,anon,authenticated;
grant execute on function toolbox_private.chatgpt_anchor_personal(uuid,text,jsonb,text) to postgres;
grant execute on function toolbox_private.chatgpt_anchor_work(uuid,text,text,jsonb,timestamptz,text) to postgres;

commit;
