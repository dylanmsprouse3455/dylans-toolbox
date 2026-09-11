begin;

create table if not exists public.work_cases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  case_number text,
  title text not null check (length(title) between 1 and 180),
  status text not null default 'active' check (status in ('active','completed')),
  workflow_state text not null default 'todo' check (workflow_state in ('todo','waiting','watching','follow_up')),
  ball_owner text not null default 'me' check (ball_owner in ('me','other','watching','none')),
  ball_with text check (ball_with is null or length(ball_with)<=180),
  current_situation text not null default '' check (length(current_situation)<=4000),
  next_action text not null default '' check (length(next_action)<=1000),
  follow_up_at timestamptz,
  follow_up_date date,
  closing_date date,
  last_event_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,user_id),
  constraint work_case_number_format check (case_number is null or case_number ~ '^G[0-9]{2}-[0-9]{4}$'),
  constraint work_case_one_follow_up_kind check (follow_up_at is null or follow_up_date is null)
);

create unique index if not exists work_cases_owner_case_number
  on public.work_cases(user_id,case_number) where case_number is not null;
create index if not exists work_cases_owner_state
  on public.work_cases(user_id,status,workflow_state,last_event_at desc);
create index if not exists work_cases_owner_follow_up
  on public.work_cases(user_id,follow_up_date,follow_up_at) where status='active';

create table if not exists public.work_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  case_id uuid not null,
  capture_id uuid references public.items(id) on delete set null,
  kind text not null check (kind in ('request','response','action','status','note','follow_up','completion')),
  summary text not null check (length(summary) between 1 and 2000),
  source_text text not null default '' check (length(source_text)<=30000),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint work_event_owned_case foreign key(case_id,user_id) references public.work_cases(id,user_id) on delete cascade
);
create index if not exists work_events_case_time on public.work_events(user_id,case_id,occurred_at desc);

alter table public.work_cases enable row level security;
alter table public.work_events enable row level security;
grant select,insert,update,delete on public.work_cases to authenticated;
grant select,insert,update,delete on public.work_events to authenticated;
revoke all on public.work_cases from anon;
revoke all on public.work_events from anon;

create policy "Read own work cases" on public.work_cases for select to authenticated using ((select auth.uid())=user_id);
create policy "Insert own work cases" on public.work_cases for insert to authenticated with check ((select auth.uid())=user_id);
create policy "Update own work cases" on public.work_cases for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy "Delete own work cases" on public.work_cases for delete to authenticated using ((select auth.uid())=user_id);
create policy "Read own work events" on public.work_events for select to authenticated using ((select auth.uid())=user_id);
create policy "Insert own work events" on public.work_events for insert to authenticated with check ((select auth.uid())=user_id);
create policy "Update own work events" on public.work_events for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy "Delete own work events" on public.work_events for delete to authenticated using ((select auth.uid())=user_id);

create or replace function public.toolbox_touch_work_case() returns trigger
language plpgsql set search_path='' as $$
begin
  new.updated_at=now();
  return new;
end $$;
drop trigger if exists toolbox_touch_work_case on public.work_cases;
create trigger toolbox_touch_work_case before update on public.work_cases
for each row execute function public.toolbox_touch_work_case();

create or replace function public.toolbox_apply_work_preview(capture_uuid uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  owner_id uuid=auth.uid();
  receipt public.items;
  preview jsonb;
  proposal jsonb;
  target public.work_cases;
  case_uuid uuid;
  expected timestamptz;
  case_ids uuid[]='{}';
  cases_json jsonb;
  result jsonb;
begin
  if owner_id is null or not public.toolbox_can_access() then raise exception 'Owner access required'; end if;
  select * into receipt from public.items
    where id=capture_uuid and user_id=owner_id and type='capture' for update;
  if not found then raise exception 'Capture not found'; end if;

  if receipt.status='processed' then
    if receipt.turn_result->>'kind'='work_commit' then return receipt.turn_result; end if;
    raise exception 'Capture already processed';
  end if;

  if receipt.turn_result->>'kind'<>'work_preview' then raise exception 'Work preview not found'; end if;
  preview=receipt.turn_result->'preview';
  if preview->>'kind'<>'changes' or jsonb_typeof(preview->'proposals') is distinct from 'array'
     or jsonb_array_length(preview->'proposals')<1 or jsonb_array_length(preview->'proposals')>20 then
    raise exception 'Invalid work preview';
  end if;

  for proposal in select value from jsonb_array_elements(preview->'proposals') loop
    if proposal->>'case_id' is not null then
      case_uuid=(proposal->>'case_id')::uuid;
      select * into target from public.work_cases where id=case_uuid and user_id=owner_id for update;
      if not found then raise exception 'CASE_CHANGED'; end if;
      expected=(proposal->>'expected_updated_at')::timestamptz;
      if expected is null or target.updated_at is distinct from expected then raise exception 'CASE_CHANGED'; end if;
    else
      if proposal->>'case_number' is not null and exists(
        select 1 from public.work_cases where user_id=owner_id and case_number=proposal->>'case_number'
      ) then raise exception 'CASE_CHANGED'; end if;
      case_uuid=gen_random_uuid();
      target=null;
    end if;

    if proposal->>'case_number' is not null and proposal->>'case_number' !~ '^G[0-9]{2}-[0-9]{4}$' then raise exception 'Invalid case number'; end if;
    if proposal->>'status' not in ('active','completed')
       or proposal->>'workflow_state' not in ('todo','waiting','watching','follow_up')
       or proposal->>'ball_owner' not in ('me','other','watching','none')
       or proposal->>'event_kind' not in ('request','response','action','status','note','follow_up','completion') then
      raise exception 'Invalid work state';
    end if;
    if proposal->>'follow_up_at' is not null and proposal->>'follow_up_date' is not null then raise exception 'Invalid follow-up'; end if;

    if target.id is null then
      insert into public.work_cases(
        id,user_id,case_number,title,status,workflow_state,ball_owner,ball_with,current_situation,next_action,
        follow_up_at,follow_up_date,closing_date,last_event_at
      ) values(
        case_uuid,owner_id,proposal->>'case_number',proposal->>'title',proposal->>'status',proposal->>'workflow_state',proposal->>'ball_owner',proposal->>'ball_with',
        coalesce(proposal->>'current_situation',''),coalesce(proposal->>'next_action',''),
        (proposal->>'follow_up_at')::timestamptz,(proposal->>'follow_up_date')::date,(proposal->>'closing_date')::date,now()
      );
    else
      update public.work_cases set
        case_number=proposal->>'case_number',
        title=proposal->>'title',
        status=proposal->>'status',
        workflow_state=proposal->>'workflow_state',
        ball_owner=proposal->>'ball_owner',
        ball_with=proposal->>'ball_with',
        current_situation=coalesce(proposal->>'current_situation',''),
        next_action=coalesce(proposal->>'next_action',''),
        follow_up_at=(proposal->>'follow_up_at')::timestamptz,
        follow_up_date=(proposal->>'follow_up_date')::date,
        closing_date=(proposal->>'closing_date')::date,
        last_event_at=now()
      where id=case_uuid and user_id=owner_id;
    end if;

    insert into public.work_events(user_id,case_id,capture_id,kind,summary,source_text,occurred_at)
    values(owner_id,case_uuid,capture_uuid,proposal->>'event_kind',proposal->>'event_summary',receipt.source_text,now());
    case_ids=array_append(case_ids,case_uuid);
  end loop;

  select coalesce(jsonb_agg(to_jsonb(c) order by c.updated_at desc),'[]'::jsonb)
    into cases_json from public.work_cases c where c.user_id=owner_id and c.id=any(case_ids);
  result=jsonb_build_object(
    'kind','work_commit','turn_id',capture_uuid,'case_ids',to_jsonb(case_ids),'cases',cases_json,
    'reply',coalesce(preview->>'commit_reply','Saved your confirmed Work updates.')
  );
  update public.items set status='processed',turn_result=result where id=capture_uuid and user_id=owner_id;
  return result;
end $$;

revoke all on function public.toolbox_touch_work_case() from public,anon,authenticated;
revoke all on function public.toolbox_apply_work_preview(uuid) from public,anon;
grant execute on function public.toolbox_apply_work_preview(uuid) to authenticated;

commit;
