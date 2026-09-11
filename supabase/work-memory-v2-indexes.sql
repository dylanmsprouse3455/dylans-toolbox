begin;

create index if not exists work_case_facts_source_capture_idx on public.work_case_facts(source_capture_id) where source_capture_id is not null;
create index if not exists work_case_facts_source_event_idx on public.work_case_facts(source_event_id) where source_event_id is not null;
create index if not exists work_case_facts_case_owner_fk_idx on public.work_case_facts(case_id,user_id);
create index if not exists work_case_phases_case_owner_fk_idx on public.work_case_phases(case_id,user_id);
create index if not exists work_cases_current_phase_idx on public.work_cases(current_phase_id) where current_phase_id is not null;
create index if not exists work_rules_source_capture_idx on public.work_rules(source_capture_id) where source_capture_id is not null;

commit;
