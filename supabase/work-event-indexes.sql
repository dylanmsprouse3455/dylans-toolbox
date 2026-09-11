-- Already applied to Orbit after the Work case-memory migration.
-- Keep these indexes for foreign-key lookup/delete performance as event history grows.
create index if not exists work_events_case_owner on public.work_events(case_id,user_id);
create index if not exists work_events_capture_id on public.work_events(capture_id) where capture_id is not null;
