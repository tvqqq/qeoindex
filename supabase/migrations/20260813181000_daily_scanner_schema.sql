create table public.stock_universe (
  id uuid primary key default gen_random_uuid(),
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,10}$'),
  exchange text not null default 'HOSE' check (exchange = 'HOSE'),
  rank integer not null check (rank > 0),
  market_cap_t numeric not null check (market_cap_t > 0),
  sector text,
  active boolean not null default true,
  universe_version date not null,
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ticker, universe_version),
  check (effective_to is null or effective_to >= effective_from)
);

create unique index stock_universe_active_rank_idx
  on public.stock_universe (universe_version, rank) where active;

create table public.scanner_runs (
  id uuid primary key default gen_random_uuid(),
  run_key text not null unique,
  scan_date date not null,
  universe_version date not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'partial', 'failed')),
  total_count integer not null default 0 check (total_count >= 0),
  completed_count integer not null default 0 check (completed_count >= 0),
  incomplete_count integer not null default 0 check (incomplete_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.scanner_jobs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.scanner_runs (id) on delete cascade,
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,10}$'),
  rank integer not null check (rank > 0),
  scan_date date not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'complete', 'incomplete', 'failed', 'dead')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, ticker)
);

create index scanner_jobs_claim_idx on public.scanner_jobs (status, next_attempt_at, rank)
  where status in ('pending', 'failed', 'processing');

create table public.daily_scans (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.scanner_jobs (id) on delete set null,
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,10}$'),
  scan_date date not null,
  rank integer not null check (rank > 0),
  bar_count integer not null check (bar_count >= 60),
  price numeric not null check (price > 0),
  change_pct numeric,
  volume numeric check (volume is null or volume >= 0),
  rsi14 numeric, macd numeric, macd_signal numeric,
  ma20 numeric, ma50 numeric, ma200 numeric, atr14 numeric, rel_volume numeric,
  wyckoff_state text not null, phase text not null,
  ta_bias text not null check (ta_bias in ('Bullish', 'Neutral', 'Bearish', 'Mixed')),
  bull_probability integer not null check (bull_probability between 0 and 100),
  base_probability integer not null check (base_probability between 0 and 100),
  bear_probability integer not null check (bear_probability between 0 and 100),
  support text not null, resistance text not null, confirmation text not null,
  invalidation text not null, what_changed text not null,
  confidence text not null check (confidence in ('HIGH', 'MEDIUM', 'LOW')),
  provider text not null check (provider in ('DNSE', 'Fallback')),
  provider_detail text not null,
  status text not null check (status in ('Complete', 'Incomplete')),
  engine_version text not null,
  notion_page_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ticker, scan_date, engine_version),
  check (bull_probability + base_probability + bear_probability = 100),
  check ((bar_count >= 200 and status = 'Complete') or (bar_count between 60 and 199 and status = 'Incomplete' and confidence = 'LOW'))
);

create index daily_scans_latest_idx on public.daily_scans (ticker, scan_date desc, created_at desc);

create table public.provider_health (
  provider text primary key,
  status text not null check (status in ('healthy', 'degraded', 'unavailable')),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  last_detail text,
  updated_at timestamptz not null default now()
);

create trigger stock_universe_set_updated_at before update on public.stock_universe
for each row execute function public.set_updated_at();
create trigger scanner_runs_set_updated_at before update on public.scanner_runs
for each row execute function public.set_updated_at();
create trigger scanner_jobs_set_updated_at before update on public.scanner_jobs
for each row execute function public.set_updated_at();
create trigger daily_scans_set_updated_at before update on public.daily_scans
for each row execute function public.set_updated_at();
create trigger provider_health_set_updated_at before update on public.provider_health
for each row execute function public.set_updated_at();

alter table public.stock_universe enable row level security;
alter table public.scanner_runs enable row level security;
alter table public.scanner_jobs enable row level security;
alter table public.daily_scans enable row level security;
alter table public.provider_health enable row level security;

revoke all on table public.stock_universe, public.scanner_runs, public.scanner_jobs, public.daily_scans, public.provider_health from anon, authenticated;
grant select, insert, update on table public.stock_universe, public.scanner_runs, public.scanner_jobs, public.daily_scans, public.provider_health to service_role;

alter table public.notion_sync_outbox drop constraint notion_sync_outbox_entity_type_check;
alter table public.notion_sync_outbox add constraint notion_sync_outbox_entity_type_check
  check (entity_type in ('trade_recommendation', 'signal_event', 'daily_scan'));

create function public.enqueue_daily_scanner(p_scan_date date)
returns table(run_id uuid, queued_count integer)
language plpgsql security definer set search_path = ''
as $$
declare
  v_version date;
  v_run_id uuid;
  v_count integer;
begin
  select max(universe_version) into v_version from public.stock_universe where active and effective_from <= p_scan_date and (effective_to is null or effective_to >= p_scan_date);
  if v_version is null then raise exception 'No active universe for %', p_scan_date; end if;

  insert into public.scanner_runs (run_key, scan_date, universe_version)
  values ('daily-scanner:' || p_scan_date::text, p_scan_date, v_version)
  on conflict (run_key) do update set updated_at = now()
  returning id into v_run_id;

  insert into public.scanner_jobs (run_id, ticker, rank, scan_date)
  select v_run_id, ticker, rank, p_scan_date from public.stock_universe
  where universe_version = v_version and active and effective_from <= p_scan_date and (effective_to is null or effective_to >= p_scan_date)
  on conflict on constraint scanner_jobs_run_id_ticker_key do nothing;

  select count(*)::integer into v_count from public.scanner_jobs where scanner_jobs.run_id = v_run_id;
  update public.scanner_runs set total_count = v_count where id = v_run_id;
  return query select v_run_id, v_count;
end;
$$;

create function public.claim_scanner_jobs(p_limit integer default 5)
returns setof public.scanner_jobs
language sql security definer set search_path = ''
as $$
  with exhausted as (
    update public.scanner_jobs stale set status = 'dead', finished_at = now(), last_error = coalesce(stale.last_error, 'Worker lease expired after final attempt')
    where stale.status = 'processing' and stale.updated_at <= now() - interval '5 minutes' and stale.attempt_count >= 5
  ), claimed as (
    update public.scanner_jobs item set status = 'processing', attempt_count = item.attempt_count + 1, started_at = coalesce(item.started_at, now())
    where item.id in (
      select candidate.id from public.scanner_jobs candidate
      where ((candidate.status in ('pending', 'failed') and candidate.next_attempt_at <= now()) or (candidate.status = 'processing' and candidate.updated_at <= now() - interval '5 minutes'))
        and candidate.attempt_count < 5
      order by candidate.scan_date, candidate.rank for update skip locked limit greatest(1, least(p_limit, 10))
    ) returning item.*
  ) select claimed.* from claimed;
$$;

revoke all on function public.enqueue_daily_scanner(date) from public, anon, authenticated;
revoke all on function public.claim_scanner_jobs(integer) from public, anon, authenticated;
grant execute on function public.enqueue_daily_scanner(date) to service_role;
grant execute on function public.claim_scanner_jobs(integer) to service_role;
