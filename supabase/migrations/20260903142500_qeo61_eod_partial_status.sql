begin;

-- QEO-61: a parent EOD run can complete its healthy ticker work while keeping
-- the canonical publish gate closed. `partial` is terminal operational state,
-- distinct from succeeded and failed.
alter table public.system_job_runs
  drop constraint if exists system_job_runs_status_check;

alter table public.system_job_runs
  add constraint system_job_runs_status_check
  check (status in ('queued', 'running', 'succeeded', 'partial', 'failed', 'skipped'));

-- Append-only ticker/stage attempt ledger. Retry appends a new attempt number;
-- it never rewrites the failure evidence from a prior attempt.
create table if not exists public.system_job_ticker_attempts (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.system_job_runs(id) on delete cascade,
  job_key text not null check (job_key ~ '^[a-z0-9_]+([.][a-z0-9_]+)*$'),
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  stage text not null check (stage ~ '^[A-Z0-9_]+$'),
  attempt integer not null check (attempt > 0),
  status text not null check (status in ('succeeded', 'failed')),
  error_class text check (error_class is null or error_class in ('ticker_local', 'recoverable_systemic', 'critical_systemic')),
  retry_eligible boolean not null default false,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  unique (run_id, ticker, stage, attempt),
  check ((status = 'succeeded' and error_class is null and retry_eligible = false)
    or status = 'failed')
);

create index if not exists system_job_ticker_attempts_run_stage_idx
  on public.system_job_ticker_attempts(run_id, stage, ticker, attempt desc);

create index if not exists system_job_ticker_attempts_retry_idx
  on public.system_job_ticker_attempts(run_id, retry_eligible, ticker)
  where status = 'failed' and retry_eligible = true;

alter table public.system_job_ticker_attempts enable row level security;
revoke all privileges on table public.system_job_ticker_attempts from anon, authenticated;
grant all privileges on table public.system_job_ticker_attempts to service_role;
grant usage, select on sequence public.system_job_ticker_attempts_id_seq to service_role;

commit;
