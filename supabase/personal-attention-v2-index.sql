drop index if exists public.personal_item_revisions_owner_item;
create index personal_item_revisions_owner_item on public.personal_item_revisions(item_id,user_id,created_at desc);
create index if not exists personal_item_revisions_user on public.personal_item_revisions(user_id);
