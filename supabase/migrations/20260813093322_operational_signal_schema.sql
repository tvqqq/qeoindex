create table public.trade_recommendations (
  id uuid primary key default gen_random_uuid(),
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,10}$'),
  status text not null default 'open' check (status in ('open', 'closed', 'stopped', 'cancelled')),
  buy_signal_at timestamptz not null,
  buy_price numeric not null check (buy_price > 0),
  buy_reason text not null,
  stop_price numeric not null check (stop_price > 0 and stop_price < buy_price),
  risk_pct numeric not null check (risk_pct > 0),
  initial_target numeric check (initial_target is null or initial_target > buy_price),
  sell_signal_at timestamptz,
  sell_price numeric check (sell_price is null or sell_price > 0),
  sell_reason text,
  return_pct numeric,
  vnindex_entry numeric check (vnindex_entry is null or vnindex_entry > 0),
  vnindex_exit numeric check (vnindex_exit is null or vnindex_exit > 0),
  vnindex_return_pct numeric,
  alpha_pct numeric,
  outcome text not null default 'open' check (outcome in ('open', 'win', 'loss', 'flat', 'cancelled')),
  daily_bias text not null,
  scan_date date not null,
  confidence text not null,
  provider text not null,
  engine_version text not null,
  last_monitor_at timestamptz,
  last_price numeric check (last_price is null or last_price > 0),
  last_rel_volume numeric,
  max_favorable_pct numeric,
  max_adverse_pct numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint closed_recommendation_has_exit check (
    (status = 'open' and sell_signal_at is null and sell_price is null)
    or (status <> 'open' and sell_signal_at is not null and sell_price is not null)
  )
);

create unique index one_open_recommendation_per_ticker
  on public.trade_recommendations (ticker)
  where status = 'open';

create index trade_recommendations_status_created_idx
  on public.trade_recommendations (status, created_at desc);

create table public.signal_events (
  id uuid primary key default gen_random_uuid(),
  recommendation_id uuid references public.trade_recommendations (id) on delete restrict,
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,10}$'),
  event_type text not null check (event_type in ('BUY', 'SELL', 'EXIT_FAIL', 'WATCH')),
  signal_at timestamptz not null,
  price numeric not null check (price > 0),
  volume numeric check (volume is null or volume >= 0),
  rel_volume numeric,
  rule text not null,
  provider text not null,
  scan_date date,
  daily_bias text,
  stop_price numeric check (stop_price is null or stop_price > 0),
  vnindex numeric check (vnindex is null or vnindex > 0),
  engine_version text not null,
  idempotency_key text not null unique check (length(idempotency_key) between 8 and 240),
  created_at timestamptz not null default now(),
  constraint recommendation_required_for_trade_event check (
    event_type = 'WATCH' or recommendation_id is not null
  )
);

create index signal_events_ticker_signal_idx
  on public.signal_events (ticker, signal_at desc);

create index signal_events_recommendation_idx
  on public.signal_events (recommendation_id, signal_at);

create table public.monitor_runs (
  id uuid primary key default gen_random_uuid(),
  run_key text not null unique,
  scheduled_for timestamptz not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  session_state text not null,
  candidate_count integer not null default 0 check (candidate_count >= 0),
  open_count integer not null default 0 check (open_count >= 0),
  quote_count integer not null default 0 check (quote_count >= 0),
  buy_count integer not null default 0 check (buy_count >= 0),
  exit_count integer not null default 0 check (exit_count >= 0),
  missing_quote_count integer not null default 0 check (missing_quote_count >= 0),
  provider text,
  status text not null check (status in ('running', 'succeeded', 'failed', 'skipped')),
  error text,
  function_version text not null,
  created_at timestamptz not null default now(),
  constraint finished_run_has_timestamp check (
    status = 'running' or finished_at is not null
  )
);

create index monitor_runs_scheduled_idx
  on public.monitor_runs (scheduled_for desc);

create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.signal_events (id) on delete cascade,
  channel text not null check (channel in ('telegram')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed', 'dead')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, channel)
);

create index notification_outbox_dispatch_idx
  on public.notification_outbox (status, next_attempt_at)
  where status in ('pending', 'failed');

create table public.notion_sync_outbox (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('trade_recommendation', 'signal_event')),
  entity_id uuid not null,
  operation text not null check (operation in ('create', 'update')),
  idempotency_key text not null unique check (length(idempotency_key) between 8 and 240),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending' check (status in ('pending', 'processing', 'synced', 'failed', 'dead')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error text,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index notion_sync_outbox_dispatch_idx
  on public.notion_sync_outbox (status, next_attempt_at)
  where status in ('pending', 'failed');

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trade_recommendations_set_updated_at
before update on public.trade_recommendations
for each row execute function public.set_updated_at();

create trigger notification_outbox_set_updated_at
before update on public.notification_outbox
for each row execute function public.set_updated_at();

create trigger notion_sync_outbox_set_updated_at
before update on public.notion_sync_outbox
for each row execute function public.set_updated_at();
