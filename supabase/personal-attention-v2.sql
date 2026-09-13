begin;

alter table public.items add column if not exists workflow_state text not null default 'active';
alter table public.items add column if not exists waiting_on text;
alter table public.items add column if not exists follow_up_at timestamptz;
alter table public.items add column if not exists follow_up_date date;
alter table public.items add column if not exists highlighted boolean not null default false;

do $$ begin
  if not exists(select 1 from pg_constraint where conname='items_personal_workflow_state') then
    alter table public.items add constraint items_personal_workflow_state check(workflow_state in ('active','waiting'));
  end if;
  if not exists(select 1 from pg_constraint where conname='items_follow_up_one_kind') then
    alter table public.items add constraint items_follow_up_one_kind check(follow_up_at is null or follow_up_date is null);
  end if;
  if not exists(select 1 from pg_constraint where conname='items_waiting_on_length') then
    alter table public.items add constraint items_waiting_on_length check(waiting_on is null or length(waiting_on)<=180);
  end if;
end $$;

create index if not exists items_owner_personal_waiting on public.items(user_id,workflow_state,follow_up_date) where area<>'Work' and status='active';
create index if not exists items_owner_soft_due on public.items(user_id,due_date) where area<>'Work' and type='task' and status='active' and highlighted=false and due_at is null;

create table if not exists public.personal_item_revisions(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  foreign key(item_id,user_id) references public.items(id,user_id) on delete cascade
);
alter table public.personal_item_revisions enable row level security;
revoke all on public.personal_item_revisions from anon;
grant select,delete on public.personal_item_revisions to authenticated;
drop policy if exists "Read own personal revisions" on public.personal_item_revisions;
create policy "Read own personal revisions" on public.personal_item_revisions for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists "Delete own personal revisions" on public.personal_item_revisions;
create policy "Delete own personal revisions" on public.personal_item_revisions for delete to authenticated using ((select auth.uid())=user_id);
create index if not exists personal_item_revisions_owner_item on public.personal_item_revisions(user_id,item_id,created_at desc);

create or replace function public.toolbox_record_personal_revision() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.area<>'Work' and old.type<>'capture' and row(old.title,old.content,old.area,old.type,old.status,old.importance,old.urgency,old.due_at,old.due_date,old.parent_id,old.depends_on_id,old.workflow_state,old.waiting_on,old.follow_up_at,old.follow_up_date,old.highlighted)
    is distinct from row(new.title,new.content,new.area,new.type,new.status,new.importance,new.urgency,new.due_at,new.due_date,new.parent_id,new.depends_on_id,new.workflow_state,new.waiting_on,new.follow_up_at,new.follow_up_date,new.highlighted) then
    insert into public.personal_item_revisions(user_id,item_id,snapshot) values(old.user_id,old.id,to_jsonb(old));
    delete from public.personal_item_revisions r where r.user_id=old.user_id and r.item_id=old.id and r.id in(select x.id from public.personal_item_revisions x where x.user_id=old.user_id and x.item_id=old.id order by x.created_at desc,x.id desc offset 20);
  end if;
  return new;
end $$;
drop trigger if exists toolbox_personal_revision on public.items;
create trigger toolbox_personal_revision before update on public.items for each row execute function public.toolbox_record_personal_revision();

create or replace function public.toolbox_undo_personal_item(item_uuid uuid)
returns setof public.items language plpgsql security invoker set search_path='' as $$
declare owner_id uuid=auth.uid(); revision public.personal_item_revisions; snap jsonb;
begin
  if owner_id is null or not public.toolbox_can_access() then raise exception 'Owner access required'; end if;
  if not exists(select 1 from public.items where id=item_uuid and user_id=owner_id and area<>'Work' and type<>'capture' for update) then raise exception 'Personal item not found'; end if;
  select * into revision from public.personal_item_revisions where user_id=owner_id and item_id=item_uuid order by created_at desc,id desc limit 1 for update;
  if not found then raise exception 'Nothing to undo'; end if;
  snap=revision.snapshot;
  update public.items set
    title=snap->>'title',content=coalesce(snap->>'content',''),area=snap->>'area',type=snap->>'type',status=snap->>'status',
    importance=coalesce((snap->>'importance')::smallint,1),urgency=coalesce((snap->>'urgency')::smallint,1),
    due_at=nullif(snap->>'due_at','')::timestamptz,due_date=nullif(snap->>'due_date','')::date,
    parent_id=nullif(snap->>'parent_id','')::uuid,depends_on_id=nullif(snap->>'depends_on_id','')::uuid,
    workflow_state=coalesce(nullif(snap->>'workflow_state',''),'active'),waiting_on=nullif(snap->>'waiting_on',''),
    follow_up_at=nullif(snap->>'follow_up_at','')::timestamptz,follow_up_date=nullif(snap->>'follow_up_date','')::date,
    highlighted=coalesce((snap->>'highlighted')::boolean,false)
  where id=item_uuid and user_id=owner_id and area<>'Work';
  delete from public.personal_item_revisions where id=revision.id and user_id=owner_id;
  return query select * from public.items where id=item_uuid and user_id=owner_id;
end $$;

create or replace function public.toolbox_save_capture(capture_uuid uuid,source text,entries jsonb)
returns setof public.items language plpgsql security invoker set search_path='' as $$
declare owner_id uuid=auth.uid(); capture_state text; entry jsonb;
begin
 if owner_id is null then raise exception 'Sign in required'; end if;
 select status into capture_state from public.items where id=capture_uuid and user_id=owner_id and type='capture' for update;
 if not found then raise exception 'Capture not found'; end if;
 if capture_state='processed' then return query select * from public.items where capture_id=capture_uuid and user_id=owner_id; return; end if;
 if jsonb_typeof(entries)<>'array' or jsonb_array_length(entries)>840 then raise exception 'Invalid capture'; end if;
 for entry in select value from jsonb_array_elements(entries) order by case when value->>'parent_id' is null then 0 else 1 end loop
   if entry->>'type' not in ('task','reminder','note','reference') then raise exception 'Invalid item type'; end if;
   insert into public.items(id,user_id,type,title,content,area,status,importance,urgency,due_at,parent_id,depends_on_id,capture_id,source_text,workflow_state,waiting_on,follow_up_at,follow_up_date,highlighted)
   values((entry->>'id')::uuid,owner_id,entry->>'type',entry->>'title',entry->>'content',entry->>'area','active',
   (entry->>'importance')::smallint,(entry->>'urgency')::smallint,(entry->>'due_at')::timestamptz,(entry->>'parent_id')::uuid,(entry->>'depends_on_id')::uuid,capture_uuid,source,
   coalesce(entry->>'workflow_state','active'),nullif(entry->>'waiting_on',''),nullif(entry->>'follow_up_at','')::timestamptz,nullif(entry->>'follow_up_date','')::date,coalesce((entry->>'highlighted')::boolean,false));
 end loop;
 update public.items set status='processed',source_text=source where id=capture_uuid and user_id=owner_id;
 return query select * from public.items where capture_id=capture_uuid and user_id=owner_id;
end $$;

create or replace function public.toolbox_apply_turn(capture_uuid uuid, source text, entries jsonb, changes jsonb, reply text, needs_clarification boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare owner_id uuid=auth.uid(); receipt public.items; change jsonb; entry jsonb; target public.items; changed_ids uuid[]='{}'; result jsonb; created jsonb; updated jsonb;
begin
 if owner_id is null or not public.toolbox_can_access() then raise exception 'Owner access required'; end if;
 select * into receipt from public.items where id=capture_uuid and user_id=owner_id and type='capture' for update;
 if not found then raise exception 'Capture not found'; end if;
 if receipt.status='processed' then
   if receipt.turn_result is not null then
     return receipt.turn_result||jsonb_build_object('items',(select coalesce(jsonb_agg(to_jsonb(i)),'[]') from public.items i where capture_id=capture_uuid and user_id=owner_id),'updated_items',(select coalesce(jsonb_agg(to_jsonb(i)),'[]') from public.items i where user_id=owner_id and id in(select value::uuid from jsonb_array_elements_text(receipt.turn_result->'updated_ids'))));
   end if;
   return jsonb_build_object('turn_id',capture_uuid,'items',(select coalesce(jsonb_agg(to_jsonb(i)),'[]') from public.items i where capture_id=capture_uuid and user_id=owner_id),'updated_items','[]'::jsonb,'updated_ids','[]'::jsonb,'reply','This capture was already saved.','needs_clarification',false);
 end if;
 if jsonb_typeof(entries) is distinct from 'array' or jsonb_typeof(changes) is distinct from 'array' or jsonb_array_length(entries)>840 or jsonb_array_length(changes)>40 or length(reply)>2000 then raise exception 'Invalid turn'; end if;
 if needs_clarification and (jsonb_array_length(entries)>0 or jsonb_array_length(changes)>0) then raise exception 'Clarification cannot modify items'; end if;
 if (select count(*) from jsonb_array_elements(changes))<>(select count(distinct value->>'item_id') from jsonb_array_elements(changes)) then raise exception 'Duplicate changes'; end if;
 perform 1 from public.items where user_id=owner_id and (id in(select (value->>'item_id')::uuid from jsonb_array_elements(changes)) or parent_id in(select (value->>'item_id')::uuid from jsonb_array_elements(changes))) order by id for update;
 for change in select value from jsonb_array_elements(changes) loop
   select * into target from public.items where id=(change->>'item_id')::uuid and user_id=owner_id and type<>'capture';
   if not found then raise exception 'Target not found'; end if;
   if target.updated_at is distinct from (change->>'expected_updated_at')::timestamptz then raise exception 'ITEM_CHANGED'; end if;
   if change->>'status' is not null and (target.type not in ('task','reminder') or change->>'status' not in ('active','completed')) then raise exception 'Invalid completion'; end if;
   if coalesce((change->>'change_due')::boolean,false) and target.type not in ('task','reminder') then raise exception 'Invalid due date'; end if;
   if coalesce((change->>'change_dependency')::boolean,false) then
     if target.area='Work' or target.parent_id is not null or target.type not in ('task','reminder') then raise exception 'Invalid dependency change'; end if;
     if change->>'depends_on_id' is not null and not exists(select 1 from public.items d where d.id=(change->>'depends_on_id')::uuid and d.user_id=owner_id and d.area<>'Work' and d.parent_id is null and d.type in ('task','reminder')) then raise exception 'Dependency target not found'; end if;
   end if;
   if coalesce((change->>'change_waiting')::boolean,false) then
     if target.area='Work' or target.type not in ('task','reminder') or change->>'workflow_state' not in ('active','waiting') then raise exception 'Invalid waiting change'; end if;
     if change->>'follow_up_at' is not null and change->>'follow_up_date' is not null then raise exception 'Invalid follow-up'; end if;
   end if;
   if coalesce((change->>'change_highlighted')::boolean,false) and (target.area='Work' or target.type not in ('task','reminder')) then raise exception 'Invalid highlight change'; end if;
 end loop;
 perform public.toolbox_save_capture(capture_uuid,source,entries);
 for entry in select value from jsonb_array_elements(entries) loop
   if entry->>'due_date' is not null then update public.items set due_date=(entry->>'due_date')::date where id=(entry->>'id')::uuid and user_id=owner_id; end if;
 end loop;
 for change in select value from jsonb_array_elements(changes) loop
   update public.items set
     title=coalesce(change->>'title',title),content=coalesce(change->>'content',content),area=coalesce(change->>'area',area),
     due_at=case when (change->>'change_due')::boolean then (change->>'due_at')::timestamptz else due_at end,
     due_date=case when (change->>'change_due')::boolean then (change->>'due_date')::date else due_date end,
     depends_on_id=case when coalesce((change->>'change_dependency')::boolean,false) then (change->>'depends_on_id')::uuid else depends_on_id end,
     workflow_state=case when coalesce((change->>'change_waiting')::boolean,false) then change->>'workflow_state' else workflow_state end,
     waiting_on=case when coalesce((change->>'change_waiting')::boolean,false) then nullif(change->>'waiting_on','') else waiting_on end,
     follow_up_at=case when coalesce((change->>'change_waiting')::boolean,false) then nullif(change->>'follow_up_at','')::timestamptz else follow_up_at end,
     follow_up_date=case when coalesce((change->>'change_waiting')::boolean,false) then nullif(change->>'follow_up_date','')::date else follow_up_date end,
     highlighted=case when coalesce((change->>'change_highlighted')::boolean,false) then coalesce((change->>'highlighted')::boolean,false) else highlighted end
   where id=(change->>'item_id')::uuid and user_id=owner_id;
   changed_ids=array_append(changed_ids,(change->>'item_id')::uuid);
   if change->>'status' is not null then
     perform public.toolbox_set_status((change->>'item_id')::uuid,change->>'status');
     changed_ids=changed_ids||array(select id from public.items where parent_id=(change->>'item_id')::uuid and user_id=owner_id);
   end if;
 end loop;
 select coalesce(jsonb_agg(to_jsonb(i)),'[]') into created from public.items i where capture_id=capture_uuid and user_id=owner_id;
 select coalesce(jsonb_agg(to_jsonb(i)),'[]') into updated from public.items i where id=any(changed_ids) and user_id=owner_id;
 result=jsonb_build_object('turn_id',capture_uuid,'items',created,'created_ids',(select coalesce(jsonb_agg(value->'id'),'[]') from jsonb_array_elements(created)),'updated_items',updated,'updated_ids',to_jsonb(array(select distinct unnest(changed_ids))),'reply',reply,'needs_clarification',needs_clarification);
 update public.items set turn_result=result-'items'-'updated_items' where id=capture_uuid and user_id=owner_id;
 return result;
end $$;

create or replace function public.toolbox_create_personal_backup()
returns table(backup_id uuid,backup_created_at timestamptz,backed_up_items integer) language plpgsql security invoker set search_path='' as $$
declare owner_id uuid=auth.uid(); snap jsonb; cnt integer; new_id uuid; made_at timestamptz;
begin
 if owner_id is null or not public.toolbox_can_access() then raise exception 'Owner access required'; end if;
 select jsonb_build_object('version',3,'items',coalesce(jsonb_agg(to_jsonb(i)-'user_id' order by i.created_at,i.id),'[]'::jsonb),'entities',(select coalesce(jsonb_agg(to_jsonb(e)-'user_id' order by e.canonical_name),'[]'::jsonb) from public.personal_entities e where e.user_id=owner_id)),count(*)::integer into snap,cnt from public.items i where i.user_id=owner_id and i.area<>'Work';
 insert into public.personal_backups(user_id,item_count,snapshot) values(owner_id,cnt,snap) returning id,created_at into new_id,made_at;
 delete from public.personal_backups b where b.user_id=owner_id and b.id in(select old.id from public.personal_backups old where old.user_id=owner_id order by old.created_at desc offset 10);
 return query select new_id,made_at,cnt;
end $$;

create or replace function public.toolbox_restore_personal_backup(backup_uuid uuid)
returns integer language plpgsql security invoker set search_path='' as $$
declare owner_id uuid=auth.uid(); snap jsonb; entry jsonb; safety jsonb; safety_count integer; restored integer=0; version integer;
begin
 if owner_id is null or not public.toolbox_can_access() then raise exception 'Owner access required'; end if;
 select b.snapshot into snap from public.personal_backups b where b.id=backup_uuid and b.user_id=owner_id for update;
 if not found then raise exception 'Backup not found'; end if;
 version=coalesce((snap->>'version')::integer,0);
 if version not in (1,2,3) or jsonb_typeof(snap->'items') is distinct from 'array' then raise exception 'Unsupported backup'; end if;
 select jsonb_build_object('version',3,'items',coalesce(jsonb_agg(to_jsonb(i)-'user_id' order by i.created_at,i.id),'[]'::jsonb),'entities',(select coalesce(jsonb_agg(to_jsonb(e)-'user_id' order by e.canonical_name),'[]'::jsonb) from public.personal_entities e where e.user_id=owner_id)),count(*)::integer into safety,safety_count from public.items i where i.user_id=owner_id and i.area<>'Work';
 insert into public.personal_backups(user_id,item_count,snapshot) values(owner_id,safety_count,safety);
 set constraints all deferred;
 for entry in select value from jsonb_array_elements(snap->'items') order by case when value->>'type'='capture' then 0 when value->>'parent_id' is null then 1 else 2 end loop
   if entry->>'area'='Work' then raise exception 'Work data cannot be restored through Personal recovery'; end if;
   if entry->>'type' not in ('task','reminder','note','reference','capture') then raise exception 'Invalid backup item'; end if;
   insert into public.items as existing(id,user_id,type,title,content,area,status,importance,urgency,due_at,due_date,parent_id,depends_on_id,capture_id,source_text,created_at,updated_at,completed_at,last_opened_at,turn_result,workflow_state,waiting_on,follow_up_at,follow_up_date,highlighted)
   values((entry->>'id')::uuid,owner_id,entry->>'type',entry->>'title',coalesce(entry->>'content',''),entry->>'area',entry->>'status',coalesce((entry->>'importance')::smallint,1),coalesce((entry->>'urgency')::smallint,1),nullif(entry->>'due_at','')::timestamptz,nullif(entry->>'due_date','')::date,nullif(entry->>'parent_id','')::uuid,null,nullif(entry->>'capture_id','')::uuid,coalesce(entry->>'source_text',''),coalesce(nullif(entry->>'created_at','')::timestamptz,now()),coalesce(nullif(entry->>'updated_at','')::timestamptz,now()),nullif(entry->>'completed_at','')::timestamptz,nullif(entry->>'last_opened_at','')::timestamptz,case when entry ? 'turn_result' and jsonb_typeof(entry->'turn_result')<>'null' then entry->'turn_result' else null end,coalesce(nullif(entry->>'workflow_state',''),'active'),nullif(entry->>'waiting_on',''),nullif(entry->>'follow_up_at','')::timestamptz,nullif(entry->>'follow_up_date','')::date,coalesce((entry->>'highlighted')::boolean,false))
   on conflict(id) do update set type=excluded.type,title=excluded.title,content=excluded.content,area=excluded.area,status=excluded.status,importance=excluded.importance,urgency=excluded.urgency,due_at=excluded.due_at,due_date=excluded.due_date,parent_id=excluded.parent_id,depends_on_id=null,capture_id=excluded.capture_id,source_text=excluded.source_text,completed_at=excluded.completed_at,last_opened_at=excluded.last_opened_at,turn_result=excluded.turn_result,workflow_state=excluded.workflow_state,waiting_on=excluded.waiting_on,follow_up_at=excluded.follow_up_at,follow_up_date=excluded.follow_up_date,highlighted=excluded.highlighted where existing.user_id=owner_id and existing.area<>'Work';
   restored=restored+1;
 end loop;
 for entry in select value from jsonb_array_elements(snap->'items') where value->>'depends_on_id' is not null loop
   update public.items set depends_on_id=(entry->>'depends_on_id')::uuid where id=(entry->>'id')::uuid and user_id=owner_id and area<>'Work';
 end loop;
 if version>=2 and jsonb_typeof(snap->'entities')='array' then
   delete from public.personal_entities where user_id=owner_id;
   for entry in select value from jsonb_array_elements(snap->'entities') loop
     insert into public.personal_entities(id,user_id,canonical_name,aliases,relationship,entity_type,active,created_at,updated_at)
     values(coalesce(nullif(entry->>'id','')::uuid,gen_random_uuid()),owner_id,entry->>'canonical_name',coalesce(array(select jsonb_array_elements_text(entry->'aliases')),'{}'),entry->>'relationship',coalesce(entry->>'entity_type','person'),coalesce((entry->>'active')::boolean,true),coalesce(nullif(entry->>'created_at','')::timestamptz,now()),coalesce(nullif(entry->>'updated_at','')::timestamptz,now()));
   end loop;
 end if;
 delete from public.personal_backups b where b.user_id=owner_id and b.id in(select old.id from public.personal_backups old where old.user_id=owner_id order by old.created_at desc offset 10);
 return restored;
end $$;

revoke all on function public.toolbox_record_personal_revision() from public,anon,authenticated;
revoke all on function public.toolbox_undo_personal_item(uuid) from public,anon;
revoke all on function public.toolbox_save_capture(uuid,text,jsonb) from public,anon;
revoke all on function public.toolbox_apply_turn(uuid,text,jsonb,jsonb,text,boolean) from public,anon;
revoke all on function public.toolbox_create_personal_backup() from public,anon;
revoke all on function public.toolbox_restore_personal_backup(uuid) from public,anon;
grant execute on function public.toolbox_undo_personal_item(uuid) to authenticated;
grant execute on function public.toolbox_save_capture(uuid,text,jsonb) to authenticated;
grant execute on function public.toolbox_apply_turn(uuid,text,jsonb,jsonb,text,boolean) to authenticated;
grant execute on function public.toolbox_create_personal_backup() to authenticated;
grant execute on function public.toolbox_restore_personal_backup(uuid) to authenticated;

commit;
