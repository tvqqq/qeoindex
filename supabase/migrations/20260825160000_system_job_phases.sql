begin;

create table if not exists public.system_job_phases (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.system_job_runs(id) on delete cascade,
  job_key text not null check (job_key ~ '^[a-z0-9_]+([.][a-z0-9_]+)*$'),
  phase_key text not null check (phase_key ~ '^[A-Z0-9_]+$'),
  phase_order smallint not null check (phase_order between 1 and 100),
  status text not null check (status in ('queued','running','succeeded','failed','skipped')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms bigint check (duration_ms is null or duration_ms >= 0),
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  unique (run_id, phase_key)
);

create index if not exists system_job_phases_run_order_idx
  on public.system_job_phases(run_id, phase_order asc);

create index if not exists system_job_phases_job_started_idx
  on public.system_job_phases(job_key, started_at desc);

alter table public.system_job_phases enable row level security;

revoke all privileges on table public.system_job_phases from anon, authenticated;
grant all privileges on table public.system_job_phases to service_role;

commit;
