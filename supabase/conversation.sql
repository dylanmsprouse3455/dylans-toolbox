begin;
alter table public.items add column if not exists due_date date;
alter table public.items add column if not exists turn_result jsonb;
alter table public.items add constraint items_one_due_kind check (due_at is null or due_date is null);
create index if not exists items_owner_updated on public.items(user_id,updated_at desc);

-- One locked receipt covers creation, edits, completion, and the assistant reply.
-- A lost HTTP response can be retried without applying the edit a second time.
create or replace function public.toolbox_apply_turn(capture_uuid uuid, source text, entries jsonb, changes jsonb, reply text, needs_clarification boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare owner_id uuid=auth.uid(); receipt public.items; change jsonb; entry jsonb;
 target public.items; changed_ids uuid[]='{}'; result jsonb; created jsonb; updated jsonb;
begin
 if owner_id is null or not public.toolbox_can_access() then raise exception 'Owner access required'; end if;
 select * into receipt from public.items where id=capture_uuid and user_id=owner_id and type='capture' for update;
 if not found then raise exception 'Capture not found'; end if;
 if receipt.status='processed' then
   if receipt.turn_result is not null then
     return receipt.turn_result||jsonb_build_object(
       'items',(select coalesce(jsonb_agg(to_jsonb(i)),'[]') from public.items i where capture_id=capture_uuid and user_id=owner_id),
       'updated_items',(select coalesce(jsonb_agg(to_jsonb(i)),'[]') from public.items i where user_id=owner_id and id in(select value::uuid from jsonb_array_elements_text(receipt.turn_result->'updated_ids'))));
   end if;
   return jsonb_build_object('turn_id',capture_uuid,'items',(select coalesce(jsonb_agg(to_jsonb(i)),'[]') from public.items i where capture_id=capture_uuid and user_id=owner_id),
     'updated_items','[]'::jsonb,'updated_ids','[]'::jsonb,'reply','This capture was already saved.','needs_clarification',false);
 end if;
 if jsonb_typeof(entries) is distinct from 'array' or jsonb_typeof(changes) is distinct from 'array'
   or jsonb_array_length(entries)>840 or jsonb_array_length(changes)>40 or length(reply)>2000 then raise exception 'Invalid turn'; end if;
 if needs_clarification and (jsonb_array_length(entries)>0 or jsonb_array_length(changes)>0) then raise exception 'Clarification cannot modify items'; end if;
 if (select count(*) from jsonb_array_elements(changes))<>(select count(distinct value->>'item_id') from jsonb_array_elements(changes)) then raise exception 'Duplicate changes'; end if;
 -- Lock targets and their children in a stable order before checking their versions.
 perform 1 from public.items where user_id=owner_id and (id in(select (value->>'item_id')::uuid from jsonb_array_elements(changes))
   or parent_id in(select (value->>'item_id')::uuid from jsonb_array_elements(changes))) order by id for update;
 for change in select value from jsonb_array_elements(changes) loop
   select * into target from public.items where id=(change->>'item_id')::uuid and user_id=owner_id and type<>'capture';
   if not found then raise exception 'Target not found'; end if;
   if target.updated_at is distinct from (change->>'expected_updated_at')::timestamptz then raise exception 'ITEM_CHANGED'; end if;
   if change->>'status' is not null and (target.type not in ('task','reminder') or change->>'status' not in ('active','completed')) then raise exception 'Invalid completion'; end if;
   if coalesce((change->>'change_due')::boolean,false) and target.type not in ('task','reminder') then raise exception 'Invalid due date'; end if;
 end loop;
 perform public.toolbox_save_capture(capture_uuid,source,entries);
 for entry in select value from jsonb_array_elements(entries) loop
   if entry->>'due_date' is not null then update public.items set due_date=(entry->>'due_date')::date where id=(entry->>'id')::uuid and user_id=owner_id; end if;
 end loop;
 for change in select value from jsonb_array_elements(changes) loop
   update public.items set
     title=coalesce(change->>'title',title), content=coalesce(change->>'content',content), area=coalesce(change->>'area',area),
     due_at=case when (change->>'change_due')::boolean then (change->>'due_at')::timestamptz else due_at end,
     due_date=case when (change->>'change_due')::boolean then (change->>'due_date')::date else due_date end
   where id=(change->>'item_id')::uuid and user_id=owner_id;
   changed_ids=array_append(changed_ids,(change->>'item_id')::uuid);
   if change->>'status' is not null then
     perform public.toolbox_set_status((change->>'item_id')::uuid,change->>'status');
     changed_ids=changed_ids||array(select id from public.items where parent_id=(change->>'item_id')::uuid and user_id=owner_id);
   end if;
 end loop;
 select coalesce(jsonb_agg(to_jsonb(i)),'[]') into created from public.items i where capture_id=capture_uuid and user_id=owner_id;
 select coalesce(jsonb_agg(to_jsonb(i)),'[]') into updated from public.items i where id=any(changed_ids) and user_id=owner_id;
 result=jsonb_build_object('turn_id',capture_uuid,'items',created,'created_ids',(select coalesce(jsonb_agg(value->'id'),'[]') from jsonb_array_elements(created)),'updated_items',updated,
   'updated_ids',to_jsonb(array(select distinct unnest(changed_ids))),'reply',reply,'needs_clarification',needs_clarification);
 -- Keep only the reply and IDs in history, not copies of every task/transcript.
 update public.items set turn_result=result-'items'-'updated_items' where id=capture_uuid and user_id=owner_id;
 return result;
end $$;
revoke all on function public.toolbox_apply_turn(uuid,text,jsonb,jsonb,text,boolean) from public,anon;
grant execute on function public.toolbox_apply_turn(uuid,text,jsonb,jsonb,text,boolean) to authenticated;
commit;
