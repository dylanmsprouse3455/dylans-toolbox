begin;

create table if not exists public.personal_backups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  item_count integer not null check (item_count>=0),
  snapshot jsonb not null,
  unique (id,user_id)
);

alter table public.personal_backups enable row level security;
revoke all on public.personal_backups from anon;
grant select,delete on public.personal_backups to authenticated;

drop policy if exists "Read own personal backups" on public.personal_backups;
create policy "Read own personal backups" on public.personal_backups for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists "Delete own personal backups" on public.personal_backups;
create policy "Delete own personal backups" on public.personal_backups for delete to authenticated using ((select auth.uid())=user_id);

create index if not exists personal_backups_owner_created on public.personal_backups(user_id,created_at desc);

create or replace function public.toolbox_create_personal_backup()
returns table(backup_id uuid, backup_created_at timestamptz, backed_up_items integer)
language plpgsql security invoker set search_path='' as $$
declare owner_id uuid=auth.uid(); snap jsonb; cnt integer; new_id uuid; made_at timestamptz;
begin
  if owner_id is null or not public.toolbox_can_access() then raise exception 'Owner access required'; end if;
  select jsonb_build_object(
    'version',1,
    'items',coalesce(jsonb_agg(to_jsonb(i)-'user_id' order by i.created_at,i.id),'[]'::jsonb)
  ),count(*)::integer into snap,cnt
  from public.items i where i.user_id=owner_id and i.area<>'Work';
  insert into public.personal_backups(user_id,item_count,snapshot) values(owner_id,cnt,snap)
    returning id,created_at into new_id,made_at;
  delete from public.personal_backups b where b.user_id=owner_id and b.id in(
    select old.id from public.personal_backups old where old.user_id=owner_id order by old.created_at desc offset 10
  );
  return query select new_id,made_at,cnt;
end $$;

create or replace function public.toolbox_restore_personal_backup(backup_uuid uuid)
returns integer language plpgsql security invoker set search_path='' as $$
declare owner_id uuid=auth.uid(); snap jsonb; entry jsonb; safety jsonb; safety_count integer; restored integer=0;
begin
  if owner_id is null or not public.toolbox_can_access() then raise exception 'Owner access required'; end if;
  select b.snapshot into snap from public.personal_backups b where b.id=backup_uuid and b.user_id=owner_id for update;
  if not found then raise exception 'Backup not found'; end if;
  if coalesce((snap->>'version')::integer,0)<>1 or jsonb_typeof(snap->'items') is distinct from 'array' then raise exception 'Unsupported backup'; end if;

  -- Always save the current Personal state first so a restore itself is recoverable.
  select jsonb_build_object(
    'version',1,
    'items',coalesce(jsonb_agg(to_jsonb(i)-'user_id' order by i.created_at,i.id),'[]'::jsonb)
  ),count(*)::integer into safety,safety_count
  from public.items i where i.user_id=owner_id and i.area<>'Work';
  insert into public.personal_backups(user_id,item_count,snapshot) values(owner_id,safety_count,safety);

  set constraints all deferred;
  for entry in
    select value from jsonb_array_elements(snap->'items')
    order by case when value->>'type'='capture' then 0 when value->>'parent_id' is null then 1 else 2 end
  loop
    if entry->>'area'='Work' then raise exception 'Work data cannot be restored through Personal recovery'; end if;
    if entry->>'type' not in ('task','reminder','note','reference','capture') then raise exception 'Invalid backup item'; end if;
    insert into public.items as existing(
      id,user_id,type,title,content,area,status,importance,urgency,due_at,due_date,parent_id,capture_id,source_text,created_at,updated_at,completed_at,last_opened_at,turn_result
    ) values(
      (entry->>'id')::uuid,owner_id,entry->>'type',entry->>'title',coalesce(entry->>'content',''),entry->>'area',entry->>'status',
      coalesce((entry->>'importance')::smallint,1),coalesce((entry->>'urgency')::smallint,1),nullif(entry->>'due_at','')::timestamptz,nullif(entry->>'due_date','')::date,
      nullif(entry->>'parent_id','')::uuid,nullif(entry->>'capture_id','')::uuid,coalesce(entry->>'source_text',''),
      coalesce(nullif(entry->>'created_at','')::timestamptz,now()),coalesce(nullif(entry->>'updated_at','')::timestamptz,now()),
      nullif(entry->>'completed_at','')::timestamptz,nullif(entry->>'last_opened_at','')::timestamptz,
      case when entry ? 'turn_result' and jsonb_typeof(entry->'turn_result')<>'null' then entry->'turn_result' else null end
    )
    on conflict(id) do update set
      type=excluded.type,title=excluded.title,content=excluded.content,area=excluded.area,status=excluded.status,
      importance=excluded.importance,urgency=excluded.urgency,due_at=excluded.due_at,due_date=excluded.due_date,
      parent_id=excluded.parent_id,capture_id=excluded.capture_id,source_text=excluded.source_text,
      completed_at=excluded.completed_at,last_opened_at=excluded.last_opened_at,turn_result=excluded.turn_result
    where existing.user_id=owner_id and existing.area<>'Work';
    restored=restored+1;
  end loop;

  delete from public.personal_backups b where b.user_id=owner_id and b.id in(
    select old.id from public.personal_backups old where old.user_id=owner_id order by old.created_at desc offset 10
  );
  return restored;
end $$;

revoke all on function public.toolbox_create_personal_backup() from public,anon;
revoke all on function public.toolbox_restore_personal_backup(uuid) from public,anon;
grant execute on function public.toolbox_create_personal_backup() to authenticated;
grant execute on function public.toolbox_restore_personal_backup(uuid) to authenticated;

commit;
