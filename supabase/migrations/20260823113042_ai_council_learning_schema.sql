alter table public.ai_council_runs
  add column if not exists market_regime text not null default 'UNKNOWN' check (market_regime = any (array['RISK_ON','NEUTRAL','RISK_OFF','UNKNOWN']::text[])),
  add column if not exists weight_profile jsonb not null default '{}'::jsonb check (jsonb_typeof(weight_profile) = 'object'),
  add column if not exists calibration_version text not null default 'static-v1';

create table if not exists public.ai_council_market_benchmarks (
  symbol text not null default 'VNINDEX',
  session_date date not null,
  open numeric not null,
  high numeric not null,
  low numeric not null,
  close numeric not null check (close > 0),
  volume numeric,
  sma20 numeric,
  return_20d_pct numeric,
  regime text not null default 'UNKNOWN' check (regime = any (array['RISK_ON','NEUTRAL','RISK_OFF','UNKNOWN']::text[])),
  provider text not null default 'DNSE',
  provider_detail text not null default '',
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (symbol, session_date)
);

comment on table public.ai_council_market_benchmarks is 'Point-in-time daily benchmark cache for Council outcome alpha and regime classification. It is outcome/context data, never future decision evidence.';

create table if not exists public.ai_council_confirmations (
  source_run_id uuid primary key references public.ai_council_runs(id) on delete cascade,
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  source_as_of_date date not null,
  status text not null default 'pending' check (status = any (array['pending','triggered','failed','expired']::text[])),
  resolved_date date,
  trigger_run_id uuid references public.ai_council_runs(id) on delete set null,
  trigger_price numeric,
  sessions_waited smallint not null default 0 check (sessions_waited >= 0 and sessions_waited <= 60),
  trigger_return_5d_pct numeric,
  trigger_alpha_5d_pct numeric,
  trigger_direction_correct_5d boolean,
  reason text not null default '',
  last_refreshed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.ai_council_confirmations is 'Structured state machine for BUY_ON_CONFIRMATION. Source decisions remain immutable; confirmation is a derived forward outcome.';
create index if not exists ai_council_confirmations_status_idx on public.ai_council_confirmations (status, source_as_of_date desc);
create index if not exists ai_council_confirmations_trigger_run_idx on public.ai_council_confirmations (trigger_run_id) where trigger_run_id is not null;

create table if not exists public.ai_council_agent_stats (
  as_of_date date not null,
  agent_key text not null check (agent_key = any (array['wyckoff','momentum','fundamental','flow','market']::text[])),
  market_regime text not null default 'ALL' check (market_regime = any (array['ALL','RISK_ON','NEUTRAL','RISK_OFF','UNKNOWN']::text[])),
  sample_count integer not null default 0 check (sample_count >= 0),
  directional_count integer not null default 0 check (directional_count >= 0),
  hit_rate_pct numeric,
  brier_score numeric,
  average_signed_return_5d_pct numeric,
  skill_factor numeric not null default 1,
  recommended_weight numeric not null check (recommended_weight >= 0 and recommended_weight <= 1),
  calibrated boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (as_of_date, agent_key, market_regime)
);

comment on table public.ai_council_agent_stats is 'Rolling D+5 directional calibration by agent and market regime. Dynamic weights are shrunk toward static priors and only activate after minimum sample thresholds.';
create index if not exists ai_council_agent_stats_latest_idx on public.ai_council_agent_stats (market_regime, as_of_date desc);

alter table public.ai_council_market_benchmarks enable row level security;
alter table public.ai_council_confirmations enable row level security;
alter table public.ai_council_agent_stats enable row level security;

revoke all on table public.ai_council_market_benchmarks from anon;
revoke all on table public.ai_council_confirmations from anon;
revoke all on table public.ai_council_agent_stats from anon;
grant select on table public.ai_council_market_benchmarks to authenticated;
grant select on table public.ai_council_confirmations to authenticated;
grant select on table public.ai_council_agent_stats to authenticated;

drop policy if exists ai_council_market_benchmarks_authenticated_read on public.ai_council_market_benchmarks;
create policy ai_council_market_benchmarks_authenticated_read on public.ai_council_market_benchmarks for select to authenticated using (true);
drop policy if exists ai_council_confirmations_authenticated_read on public.ai_council_confirmations;
create policy ai_council_confirmations_authenticated_read on public.ai_council_confirmations for select to authenticated using (true);
drop policy if exists ai_council_agent_stats_authenticated_read on public.ai_council_agent_stats;
create policy ai_council_agent_stats_authenticated_read on public.ai_council_agent_stats for select to authenticated using (true);
