-- Opening an item is view metadata and must not make its contents look newly changed.
create or replace function public.toolbox_touch_item() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' then
   new.updated_at=coalesce(new.updated_at,now());
   if new.type<>'capture' and new.last_opened_at is null then new.last_opened_at=coalesce(new.created_at,now()); end if;
   if new.type<>'capture' and new.status='completed' and new.completed_at is null then new.completed_at=now(); end if;
 else
   if (to_jsonb(new)-'updated_at'-'last_opened_at'-'completed_at') is distinct from (to_jsonb(old)-'updated_at'-'last_opened_at'-'completed_at') then
     new.updated_at=now();
   else
     new.updated_at=old.updated_at;
   end if;
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
