create table public.items (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 type text not null check (type in ('task','reminder','note','reference','capture')),
 title text not null check (length(title) between 1 and 180),
 content text not null default '' check (length(content)<=12000),
 area text not null default 'Inbox' check (area in ('Work','Home','Money','Personal','People','Projects','Ideas','Inbox')),
 status text not null default 'active',
 importance smallint not null default 1 check (importance between 1 and 5),
 urgency smallint not null default 1 check (urgency between 1 and 5),
 due_at timestamptz,
 parent_id uuid,
 capture_id uuid,
 source_text text not null default '' check (length(source_text)<=30000),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 completed_at timestamptz,
 last_opened_at timestamptz,
 unique (id,user_id),
 constraint item_status check ((type='capture' and status in ('pending','processed')) or (type<>'capture' and status in ('active','completed'))),
 constraint own_parent foreign key (parent_id,user_id) references public.items(id,user_id) deferrable initially deferred,
 constraint own_capture foreign key (capture_id,user_id) references public.items(id,user_id) deferrable initially deferred,
 constraint no_self_parent check (parent_id is null or parent_id<>id)
);
alter table public.items enable row level security;
grant select,insert,update,delete on public.items to authenticated;
revoke all on public.items from anon;
create policy "Read own items" on public.items for select to authenticated using ((select auth.uid())=user_id);
create policy "Insert own items" on public.items for insert to authenticated with check ((select auth.uid())=user_id);
create policy "Update own items" on public.items for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy "Delete own items" on public.items for delete to authenticated using ((select auth.uid())=user_id);
create index items_owner_status on public.items(user_id,status,created_at desc);
create index items_owner_area on public.items(user_id,area,status);
create index items_parent_owner on public.items(parent_id,user_id);
create index items_capture_owner on public.items(capture_id,user_id);
create index items_owner_completed_at on public.items(user_id,completed_at desc) where type<>'capture' and status='completed';
create function public.toolbox_touch_item() returns trigger language plpgsql set search_path='' as $$
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
create trigger toolbox_touch before update or insert on public.items for each row execute function public.toolbox_touch_item();
create function public.toolbox_save_capture(capture_uuid uuid,source text,entries jsonb)
returns setof public.items language plpgsql security invoker set search_path='' as $$
declare owner_id uuid=auth.uid(); capture_state text; entry jsonb;
begin
 if owner_id is null then raise exception 'Sign in required'; end if;
 select status into capture_state from public.items where id=capture_uuid and user_id=owner_id and type='capture' for update;
 if not found then raise exception 'Capture not found'; end if;
 if capture_state='processed' then return query select * from public.items where capture_id=capture_uuid and user_id=owner_id; return; end if;
 if jsonb_typeof(entries)<>'array' or jsonb_array_length(entries)>840 then raise exception 'Invalid capture'; end if;
 -- Parents first so the parent validator can authorize children. All inserts are one transaction.
 for entry in select value from jsonb_array_elements(entries) order by case when value->>'parent_id' is null then 0 else 1 end loop
   if entry->>'type' not in ('task','reminder','note','reference') then raise exception 'Invalid item type'; end if;
   insert into public.items(id,user_id,type,title,content,area,status,importance,urgency,due_at,parent_id,capture_id,source_text)
   values((entry->>'id')::uuid,owner_id,entry->>'type',entry->>'title',entry->>'content',entry->>'area','active',
   (entry->>'importance')::smallint,(entry->>'urgency')::smallint,(entry->>'due_at')::timestamptz,(entry->>'parent_id')::uuid,capture_uuid,source);
 end loop;
 update public.items set status='processed',source_text=source where id=capture_uuid and user_id=owner_id;
 return query select * from public.items where capture_id=capture_uuid and user_id=owner_id;
end $$;
create function public.toolbox_set_status(item_uuid uuid,new_status text)
returns setof public.items language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null or new_status not in ('active','completed') then raise exception 'Invalid status'; end if;
 if not exists(select 1 from public.items where id=item_uuid and user_id=auth.uid() and type in ('task','reminder')) then raise exception 'Task not found'; end if;
 return query update public.items set status=new_status where user_id=auth.uid() and (id=item_uuid or parent_id=item_uuid) and type in ('task','reminder') returning *;
end $$;
revoke all on function public.toolbox_touch_item() from public,anon,authenticated;
revoke all on function public.toolbox_save_capture(uuid,text,jsonb) from public,anon;
revoke all on function public.toolbox_set_status(uuid,text) from public,anon;
grant execute on function public.toolbox_save_capture(uuid,text,jsonb) to authenticated;
grant execute on function public.toolbox_set_status(uuid,text) to authenticated;
