-- Run once on the existing Toolbox database, then bind the owner's confirmed
-- auth.users UUID in toolbox_private.owner using an administrator connection.
-- The singleton table allows only one owner. No email or owner UUID is in Git.
begin;
create schema if not exists toolbox_private;
revoke all on schema toolbox_private from public, anon;
grant usage on schema toolbox_private to authenticated;
create table if not exists toolbox_private.owner (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null unique references auth.users(id) on delete cascade
);
alter table toolbox_private.owner enable row level security;
revoke all on toolbox_private.owner from public, anon, authenticated;
grant select on toolbox_private.owner to authenticated;
drop policy if exists "Owner may verify access" on toolbox_private.owner;
create policy "Owner may verify access" on toolbox_private.owner
  for select to authenticated using ((select auth.uid()) = user_id);
create or replace function public.toolbox_can_access()
returns boolean language sql stable security invoker set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from toolbox_private.owner where user_id = auth.uid()
  );
$$;
revoke all on function public.toolbox_can_access() from public, anon;
grant execute on function public.toolbox_can_access() to authenticated;
drop policy if exists "Toolbox owner only" on public.items;
create policy "Toolbox owner only" on public.items as restrictive
  for all to authenticated
  using ((select public.toolbox_can_access()))
  with check ((select public.toolbox_can_access()));
commit;
