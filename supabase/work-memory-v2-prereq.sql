begin;

do $$ begin
  if not exists(select 1 from pg_constraint where conname='work_events_id_user_unique') then
    alter table public.work_events add constraint work_events_id_user_unique unique(id,user_id);
  end if;
end $$;

commit;
