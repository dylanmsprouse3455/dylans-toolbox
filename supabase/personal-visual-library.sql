begin;

create table if not exists public.personal_visual_assets(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  title text not null,
  description text not null default '',
  tags text[] not null default '{}',
  style text not null default 'photo' check(style in ('photo','illustration','texture','sticker','background','other')),
  mood text not null default 'neutral' check(mood in ('neutral','calm','fun','warm','serious','urgent','energetic')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,storage_path)
);

alter table public.personal_visual_assets enable row level security;
revoke all on public.personal_visual_assets from anon;
grant select,insert,update,delete on public.personal_visual_assets to authenticated;

drop policy if exists "Read own visual assets" on public.personal_visual_assets;
create policy "Read own visual assets" on public.personal_visual_assets for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists "Insert own visual assets" on public.personal_visual_assets;
create policy "Insert own visual assets" on public.personal_visual_assets for insert to authenticated with check ((select auth.uid())=user_id);
drop policy if exists "Update own visual assets" on public.personal_visual_assets;
create policy "Update own visual assets" on public.personal_visual_assets for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
drop policy if exists "Delete own visual assets" on public.personal_visual_assets;
create policy "Delete own visual assets" on public.personal_visual_assets for delete to authenticated using ((select auth.uid())=user_id);

create index if not exists personal_visual_assets_owner_active on public.personal_visual_assets(user_id,active,created_at desc);

alter table public.items add column if not exists visual_asset_id uuid;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='items_visual_asset_id_fkey') then
    alter table public.items add constraint items_visual_asset_id_fkey foreign key(visual_asset_id) references public.personal_visual_assets(id) on delete set null;
  end if;
end $$;
create index if not exists items_visual_asset_idx on public.items(visual_asset_id) where visual_asset_id is not null;

create or replace function public.toolbox_validate_visual_asset() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.visual_asset_id is not null then
    if new.area='Work' or new.type='capture' then raise exception 'Visual assets are Personal only'; end if;
    if not exists(select 1 from public.personal_visual_assets v where v.id=new.visual_asset_id and v.user_id=new.user_id and v.active=true) then
      raise exception 'Visual asset not found';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists toolbox_validate_visual_asset on public.items;
create trigger toolbox_validate_visual_asset before insert or update of visual_asset_id,user_id,area,type on public.items for each row execute function public.toolbox_validate_visual_asset();
revoke all on function public.toolbox_validate_visual_asset() from public,anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('personal-visuals','personal-visuals',false,6291456,array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "Read own personal visuals" on storage.objects;
create policy "Read own personal visuals" on storage.objects for select to authenticated
using(bucket_id='personal-visuals' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists "Upload own personal visuals" on storage.objects;
create policy "Upload own personal visuals" on storage.objects for insert to authenticated
with check(bucket_id='personal-visuals' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists "Update own personal visuals" on storage.objects;
create policy "Update own personal visuals" on storage.objects for update to authenticated
using(bucket_id='personal-visuals' and (storage.foldername(name))[1]=(select auth.uid())::text)
with check(bucket_id='personal-visuals' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists "Delete own personal visuals" on storage.objects;
create policy "Delete own personal visuals" on storage.objects for delete to authenticated
using(bucket_id='personal-visuals' and (storage.foldername(name))[1]=(select auth.uid())::text);

create or replace function public.toolbox_record_personal_revision() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if current_setting('toolbox.skip_revision',true)='1' then return new; end if;
  if old.area<>'Work' and old.type<>'capture' and row(old.title,old.content,old.area,old.type,old.status,old.importance,old.urgency,old.due_at,old.due_date,old.parent_id,old.depends_on_id,old.workflow_state,old.waiting_on,old.follow_up_at,old.follow_up_date,old.highlighted,old.visual_asset_id)
    is distinct from row(new.title,new.content,new.area,new.type,new.status,new.importance,new.urgency,new.due_at,new.due_date,new.parent_id,new.depends_on_id,new.workflow_state,new.waiting_on,new.follow_up_at,new.follow_up_date,new.highlighted,new.visual_asset_id) then
    insert into public.personal_item_revisions(user_id,item_id,snapshot) values(old.user_id,old.id,to_jsonb(old));
    delete from public.personal_item_revisions r where r.user_id=old.user_id and r.item_id=old.id and r.id in(select x.id from public.personal_item_revisions x where x.user_id=old.user_id and x.item_id=old.id order by x.created_at desc,x.id desc offset 20);
  end if;
  return new;
end $$;

create or replace function public.toolbox_undo_personal_item(item_uuid uuid)
returns setof public.items language plpgsql security invoker set search_path='' as $$
declare owner_id uuid=auth.uid(); revision public.personal_item_revisions; snap jsonb;
begin
  if owner_id is null or not public.toolbox_can_access() then raise exception 'Owner access required'; end if;
  if not exists(select 1 from public.items where id=item_uuid and user_id=owner_id and area<>'Work' and type<>'capture' for update) then raise exception 'Personal item not found'; end if;
  select * into revision from public.personal_item_revisions where user_id=owner_id and item_id=item_uuid order by created_at desc,id desc limit 1 for update;
  if not found then raise exception 'Nothing to undo'; end if;
  snap=revision.snapshot;
  perform set_config('toolbox.skip_revision','1',true);
  update public.items set
    title=snap->>'title',content=coalesce(snap->>'content',''),area=snap->>'area',type=snap->>'type',status=snap->>'status',
    importance=coalesce((snap->>'importance')::smallint,1),urgency=coalesce((snap->>'urgency')::smallint,1),
    due_at=nullif(snap->>'due_at','')::timestamptz,due_date=nullif(snap->>'due_date','')::date,
    parent_id=nullif(snap->>'parent_id','')::uuid,depends_on_id=nullif(snap->>'depends_on_id','')::uuid,
    workflow_state=coalesce(nullif(snap->>'workflow_state',''),'active'),waiting_on=nullif(snap->>'waiting_on',''),
    follow_up_at=nullif(snap->>'follow_up_at','')::timestamptz,follow_up_date=nullif(snap->>'follow_up_date','')::date,
    highlighted=coalesce((snap->>'highlighted')::boolean,false),
    visual_asset_id=case when nullif(snap->>'visual_asset_id','') is not null and exists(select 1 from public.personal_visual_assets v where v.id=(snap->>'visual_asset_id')::uuid and v.user_id=owner_id and v.active=true) then (snap->>'visual_asset_id')::uuid else null end
  where id=item_uuid and user_id=owner_id and area<>'Work';
  perform set_config('toolbox.skip_revision','0',true);
  delete from public.personal_item_revisions where id=revision.id and user_id=owner_id;
  return query select * from public.items where id=item_uuid and user_id=owner_id;
end $$;

commit;
