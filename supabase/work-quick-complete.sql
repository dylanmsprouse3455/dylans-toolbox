begin;

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

  update public.work_cases set
    status='completed',
    ball_owner='none',
    ball_with=null,
    next_action='',
    follow_up_at=null,
    follow_up_date=null,
    last_event_at=now()
  where id=case_uuid and user_id=owner_id
  returning * into target;

  insert into public.work_events(user_id,case_id,capture_id,kind,summary,source_text,occurred_at)
  values(owner_id,case_uuid,null,'completion','Marked '||coalesce(target.case_number,target.title)||' done.','Quick completion confirmation',now());

  return to_jsonb(target);
end $$;

revoke all on function public.toolbox_mark_work_case_done(uuid) from public,anon;
grant execute on function public.toolbox_mark_work_case_done(uuid) to authenticated;

commit;
