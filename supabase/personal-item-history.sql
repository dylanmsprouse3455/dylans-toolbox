-- Personal-mode history fields used for Done grouping and 24-hour unopened highlighting.
alter table public.items add column if not exists completed_at timestamptz;
alter table public.items add column if not exists last_opened_at timestamptz;

-- Backfill metadata without making every existing item look newly updated.
alter table public.items disable trigger toolbox_touch;
update public.items
set completed_at=coalesce(completed_at,updated_at)
where type<>'capture' and status='completed' and completed_at is null;

update public.items
set last_opened_at=coalesce(last_opened_at,created_at)
where type<>'capture' and last_opened_at is null;
alter table public.items enable trigger toolbox_touch;

create index if not exists items_owner_completed_at
  on public.items(user_id,completed_at desc)
  where type<>'capture' and status='completed';

create or replace function public.toolbox_touch_item() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' then
   new.updated_at=coalesce(new.updated_at,now());
   if new.type<>'capture' and new.last_opened_at is null then new.last_opened_at=coalesce(new.created_at,now()); end if;
   if new.type<>'capture' and new.status='completed' and new.completed_at is null then new.completed_at=now(); end if;
 else
   new.updated_at=now();
   if new.type<>'capture' and old.status is distinct from new.status then
     if new.status='completed' then new.completed_at=now(); end if;
     if new.status='active' then new.completed_at=null; end if;
   end if;
 end if;
 if new.parent_id is not null then
   if new.type<>'task' or not exists(select 1 from public.items where id=new.parent_id and user_id=new.user_id and type='task' and parent_id is null) then
     raise exception 'Subtasks require an owned top-level task';
   end if;
 end if;
 if new.type<>'task' and exists(select 1 from public.items where parent_id=new.id) then raise exception 'A task with subtasks must remain a task'; end if;
 return new;
end $$;
