begin;

alter table public.work_case_facts drop constraint if exists work_fact_source_event;
alter table public.work_case_facts add constraint work_fact_source_event
  foreign key(source_event_id) references public.work_events(id) on delete set null;

alter table public.work_cases drop constraint if exists work_case_current_phase_owned;
alter table public.work_cases drop constraint if exists work_case_current_phase;
alter table public.work_cases add constraint work_case_current_phase
  foreign key(current_phase_id) references public.work_case_phases(id) on delete set null;

commit;
