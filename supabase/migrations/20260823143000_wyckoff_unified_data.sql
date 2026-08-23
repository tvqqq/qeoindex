begin;

create table if not exists public.wyckoff_universe_memberships (
  universe_key text not null default 'hose_top100',
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  exchange text not null default 'HOSE',
  rank smallint not null check (rank between 1 and 100),
  sector text not null default '',
  market_cap_billion numeric check (market_cap_billion is null or market_cap_billion >= 0),
  effective_date date not null,
  active boolean not null default true,
  source text not null default 'notion',
  synced_at timestamptz not null default now(),
  primary key (universe_key, ticker, effective_date),
  unique (universe_key, rank, effective_date)
);

create table if not exists public.wyckoff_scan_runs (
  id uuid primary key,
  universe_key text not null default 'hose_top100',
  universe_effective_date date not null,
  model_version text not null,
  aggregation_version text not null,
  status text not null check (status in ('running', 'published', 'partial', 'failed')),
  requested_count integer not null default 0 check (requested_count >= 0),
  completed_count integer not null default 0 check (completed_count >= 0),
  incomplete_count integer not null default 0 check (incomplete_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  diagnostics jsonb not null default '{}'::jsonb check (jsonb_typeof(diagnostics) = 'object'),
  requested_at timestamptz not null default now(),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.wyckoff_analysis_snapshots (
  id uuid primary key,
  run_id uuid not null references public.wyckoff_scan_runs(id) on delete cascade,
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  timeframe text not null check (timeframe in ('1H', '4H', '1D', '1W', '1M')),
  bar_closed_at timestamptz not null,
  model_version text not null,
  aggregation_version text not null,
  history_bar_count integer not null check (history_bar_count >= 0),
  history_status text not null check (history_status in ('complete', 'incomplete', 'rejected')),
  phase text not null,
  wyckoff_state text not null,
  ta_bias text not null check (ta_bias in ('Bullish', 'Neutral', 'Bearish', 'Mixed')),
  confidence text not null check (confidence in ('HIGH', 'MEDIUM', 'LOW')),
  bull_probability smallint not null check (bull_probability between 0 and 100),
  base_probability smallint not null check (base_probability between 0 and 100),
  bear_probability smallint not null check (bear_probability between 0 and 100),
  support text not null,
  resistance text not null,
  confirmation text not null,
  invalidation text not null,
  what_changed text not null,
  technical jsonb not null check (jsonb_typeof(technical) = 'object'),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  markers jsonb not null default '[]'::jsonb check (jsonb_typeof(markers) = 'array'),
  scenarios jsonb not null default '[]'::jsonb check (jsonb_typeof(scenarios) = 'array'),
  published_at timestamptz not null default now(),
  constraint wyckoff_probability_sum check (bull_probability + base_probability + bear_probability = 100),
  unique (ticker, timeframe, bar_closed_at, model_version, aggregation_version)
);

create table if not exists public.wyckoff_chart_series (
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  timeframe text not null check (timeframe in ('1H', '4H', '1D', '1W', '1M')),
  bars jsonb not null check (jsonb_typeof(bars) = 'array' and jsonb_array_length(bars) <= 260),
  provider text not null,
  provider_detail text not null default '',
  derived boolean not null default false,
  as_of timestamptz not null,
  model_version text not null,
  aggregation_version text not null,
  run_id uuid not null references public.wyckoff_scan_runs(id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (ticker, timeframe)
);

create index if not exists wyckoff_memberships_active_rank_idx
  on public.wyckoff_universe_memberships(universe_key, effective_date desc, rank)
  where active;
create index if not exists wyckoff_runs_started_idx on public.wyckoff_scan_runs(started_at desc);
create index if not exists wyckoff_snapshots_latest_idx
  on public.wyckoff_analysis_snapshots(ticker, timeframe, bar_closed_at desc, published_at desc);

alter table public.wyckoff_universe_memberships enable row level security;
alter table public.wyckoff_scan_runs enable row level security;
alter table public.wyckoff_analysis_snapshots enable row level security;
alter table public.wyckoff_chart_series enable row level security;

revoke all on table public.wyckoff_universe_memberships, public.wyckoff_scan_runs,
  public.wyckoff_analysis_snapshots, public.wyckoff_chart_series from anon, authenticated;
grant select on table public.wyckoff_universe_memberships, public.wyckoff_analysis_snapshots,
  public.wyckoff_chart_series to authenticated;
grant all on table public.wyckoff_universe_memberships, public.wyckoff_scan_runs,
  public.wyckoff_analysis_snapshots, public.wyckoff_chart_series to service_role;

create policy wyckoff_memberships_authenticated_read on public.wyckoff_universe_memberships
  for select to authenticated using (active);
create policy wyckoff_snapshots_authenticated_read on public.wyckoff_analysis_snapshots
  for select to authenticated using (true);
create policy wyckoff_series_authenticated_read on public.wyckoff_chart_series
  for select to authenticated using (true);

create or replace view public.wyckoff_latest_by_timeframe
with (security_invoker = true) as
select distinct on (ticker, timeframe) *
from public.wyckoff_analysis_snapshots
order by ticker, timeframe, bar_closed_at desc, published_at desc;

revoke all on table public.wyckoff_latest_by_timeframe from public, anon;
grant select on table public.wyckoff_latest_by_timeframe to authenticated, service_role;

comment on table public.wyckoff_analysis_snapshots is
  'Immutable, versioned Wyckoff analysis evidence. Scenario probabilities are conditional model outputs, not guaranteed forecasts.';
comment on table public.wyckoff_chart_series is
  'Bounded latest chart read model; source bars remain provider-backed and derived timeframes are versioned.';

commit;
