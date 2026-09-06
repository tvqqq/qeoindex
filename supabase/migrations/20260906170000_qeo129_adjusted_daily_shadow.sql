begin;

create table public.market_ohlcv_adjusted_daily (
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  session_date date not null,
  bar_time timestamptz not null,
  open numeric not null check (open > 0),
  high numeric not null check (high > 0),
  low numeric not null check (low > 0),
  close numeric not null check (close > 0),
  volume numeric not null check (volume >= 0),
  raw_bar_time timestamptz not null,
  factor_run_id uuid not null,
  factor_version text not null check (btrim(factor_version) <> ''),
  event_lineage_hash text not null check (event_lineage_hash ~ '^[a-f0-9]{64}$'),
  adjustment_engine_version text not null check (btrim(adjustment_engine_version) <> ''),
  rebuilt_at timestamptz not null default now(),
  primary key (ticker, session_date),
  constraint market_ohlcv_adjusted_daily_factor_run_fk
    foreign key (factor_run_id, ticker)
    references public.market_adjustment_factor_runs (id, ticker),
  constraint market_ohlcv_adjusted_daily_high_ohlc_check
    check (high >= greatest(open, close, low)),
  constraint market_ohlcv_adjusted_daily_low_ohlc_check
    check (low <= least(open, close, high))
);

create index market_ohlcv_adjusted_daily_ticker_bar_time_idx
  on public.market_ohlcv_adjusted_daily (ticker, bar_time desc);

create index market_ohlcv_adjusted_daily_factor_run_session_idx
  on public.market_ohlcv_adjusted_daily (factor_run_id, session_date);

create table public.market_adjusted_daily_rollout (
  ticker text primary key check (ticker ~ '^[A-Z0-9]{2,12}$'),
  status text not null default 'shadow',
  factor_run_id uuid,
  factor_version text,
  event_lineage_hash text,
  verified_from date,
  verified_through date,
  verified_at timestamptz,
  activated_at timestamptz,
  blocked_reason text,
  updated_at timestamptz not null default now(),
  constraint market_adjusted_daily_rollout_status_check
    check (status in ('shadow','active','blocked')),
  constraint market_adjusted_daily_rollout_factor_run_fk
    foreign key (factor_run_id, ticker)
    references public.market_adjustment_factor_runs (id, ticker),
  constraint market_adjusted_daily_rollout_factor_version_check
    check (factor_version is null or btrim(factor_version) <> ''),
  constraint market_adjusted_daily_rollout_lineage_hash_check
    check (event_lineage_hash is null or event_lineage_hash ~ '^[a-f0-9]{64}$'),
  constraint market_adjusted_daily_rollout_lineage_consistency_check
    check (
      (factor_run_id is null and factor_version is null and event_lineage_hash is null)
      or (factor_run_id is not null and factor_version is not null and event_lineage_hash is not null)
    ),
  constraint market_adjusted_daily_rollout_verified_range_check
    check (
      (verified_from is null and verified_through is null)
      or (verified_from is not null and verified_through is not null and verified_from <= verified_through)
    ),
  constraint market_adjusted_daily_rollout_blocked_reason_check
    check (
      (status = 'blocked' and blocked_reason is not null and btrim(blocked_reason) <> '')
      or (status <> 'blocked' and blocked_reason is null)
    ),
  constraint market_adjusted_daily_rollout_activation_check
    check (status <> 'active' or activated_at is not null)
);

alter table public.market_ohlcv_adjusted_daily enable row level security;
alter table public.market_adjusted_daily_rollout enable row level security;

revoke all privileges on table public.market_ohlcv_adjusted_daily from public, anon, authenticated;
revoke all privileges on table public.market_adjusted_daily_rollout from public, anon, authenticated;

grant select, insert, update, delete on table public.market_ohlcv_adjusted_daily to service_role;
grant select, insert, update on table public.market_adjusted_daily_rollout to service_role;

create or replace function public.qeo_adjusted_daily_readback(
  p_ticker text,
  p_from date,
  p_to date,
  p_factor_run_id uuid,
  p_lineage_hash text
)
returns table (
  session_date date,
  bar_time timestamptz,
  raw_bar_time timestamptz,
  factor_run_id uuid,
  factor_version text,
  event_lineage_hash text,
  adjustment_engine_version text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    a.session_date,
    a.bar_time,
    a.raw_bar_time,
    a.factor_run_id,
    a.factor_version,
    a.event_lineage_hash,
    a.adjustment_engine_version
  from public.market_ohlcv_adjusted_daily a
  where p_ticker ~ '^[A-Z0-9]{2,12}$'
    and p_from is not null
    and p_to is not null
    and p_from <= p_to
    and p_factor_run_id is not null
    and p_lineage_hash ~ '^[a-f0-9]{64}$'
    and a.ticker = p_ticker
    and a.session_date between p_from and p_to
    and a.factor_run_id = p_factor_run_id
    and a.event_lineage_hash = p_lineage_hash
  order by a.session_date;
$$;

revoke all on function public.qeo_adjusted_daily_readback(text, date, date, uuid, text)
  from public, anon, authenticated;
grant execute on function public.qeo_adjusted_daily_readback(text, date, date, uuid, text)
  to service_role;

comment on table public.market_ohlcv_adjusted_daily is
  'QEO-129 derived adjusted Daily shadow rows. Recomputable from raw market_ohlcv_history plus one exact QEO-124 factor run; not a raw evidence store.';
comment on table public.market_adjusted_daily_rollout is
  'QEO-129 per-ticker adjusted Daily verification state. QEO-129 writes shadow/blocked only; later rollout owners may activate.';
comment on function public.qeo_adjusted_daily_readback(text, date, date, uuid, text) is
  'QEO-129 service-role-only exact persisted session/lineage readback for adjusted Daily rebuild verification.';

commit;
