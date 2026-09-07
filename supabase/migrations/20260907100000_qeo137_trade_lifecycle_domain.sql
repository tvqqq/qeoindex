-- QEO-137 — normalized Trade lifecycle domain for Portfolio & Risk Management
-- Additive only: existing portfolio_transactions remain the AVCO accounting source of truth.
-- Legacy rows intentionally keep trade_id NULL unless explicitly linked later.

begin;

-- Relational ownership identity used by user-owned Trade rows.
alter table public.portfolios
  add constraint portfolios_id_user_id_key unique (id, user_id);

create table public.portfolio_trades (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  mode text not null default 'live'
    check (mode in ('live', 'paper')),
  status text not null default 'planned'
    check (status in ('planned', 'open', 'partially_closed', 'closed', 'cancelled')),
  trade_type text
    check (trade_type is null or trade_type in ('day', 'position')),
  timeframe text,
  system_tags text[] not null default '{}',
  setup_tags text[] not null default '{}',

  -- Initial plan / risk snapshot. Domain APIs freeze these after planned -> open.
  planned_entry numeric(15,2)
    check (planned_entry is null or planned_entry > 0),
  initial_stop_loss_exit numeric(15,2)
    check (initial_stop_loss_exit is null or initial_stop_loss_exit > 0),
  initial_account_equity numeric(18,2)
    check (initial_account_equity is null or initial_account_equity >= 0),
  initial_risk_percent numeric(7,4)
    check (
      initial_risk_percent is null
      or (initial_risk_percent >= 0 and initial_risk_percent <= 100)
    ),
  initial_risk_amount numeric(18,2)
    check (initial_risk_amount is null or initial_risk_amount >= 0),
  initial_risk_amount_per_share numeric(15,2)
    check (initial_risk_amount_per_share is null or initial_risk_amount_per_share > 0),
  planned_trade_size numeric(15,4)
    check (planned_trade_size is null or planned_trade_size > 0),
  planned_position_value numeric(18,2)
    check (planned_position_value is null or planned_position_value >= 0),
  estimated_commission numeric(18,2)
    check (estimated_commission is null or estimated_commission >= 0),
  slippage_allowance numeric(18,2)
    check (slippage_allowance is null or slippage_allowance >= 0),

  opened_at timestamptz,
  closed_at timestamptz,
  pre_trade_plan text,
  thesis_summary text,
  final_review text,
  lesson_learned text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (id, portfolio_id, user_id, ticker),
  foreign key (portfolio_id, user_id)
    references public.portfolios(id, user_id) on delete cascade,

  check (
    (status = 'planned' and opened_at is null and closed_at is null)
    or (status = 'cancelled' and opened_at is null and closed_at is null)
    or (status in ('open', 'partially_closed') and opened_at is not null and closed_at is null)
    or (
      status = 'closed'
      and opened_at is not null
      and closed_at is not null
      and closed_at >= opened_at
    )
  )
);

alter table public.portfolio_transactions
  add column trade_id uuid;

alter table public.portfolio_transactions
  add constraint portfolio_transactions_trade_identity_fkey
  foreign key (trade_id, portfolio_id, user_id, ticker)
  references public.portfolio_trades(id, portfolio_id, user_id, ticker)
  on delete restrict;

create table public.portfolio_trade_stop_events (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null,
  portfolio_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  stop_type text not null
    check (stop_type in ('initial', 'trailing', 'support', 'trendline', 'manual', 'other')),
  price numeric(15,2) not null check (price > 0),
  quantity_covered numeric(15,4)
    check (quantity_covered is null or quantity_covered > 0),
  signal text,
  reason text,
  effective_at timestamptz not null,
  created_at timestamptz not null default now(),

  foreign key (trade_id, portfolio_id, user_id, ticker)
    references public.portfolio_trades(id, portfolio_id, user_id, ticker)
    on delete cascade
);

create table public.portfolio_trade_journal_entries (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null,
  portfolio_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  phase text not null
    check (phase in ('before', 'during', 'after')),
  note text not null check (length(btrim(note)) > 0),
  emotion_tags text[] not null default '{}',
  behavior_tags text[] not null default '{}',
  adherence_status text
    check (
      adherence_status is null
      or adherence_status in ('followed', 'deviated', 'not_applicable', 'unknown')
    ),
  override_reason text,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  foreign key (trade_id, portfolio_id, user_id, ticker)
    references public.portfolio_trades(id, portfolio_id, user_id, ticker)
    on delete cascade
);

create index portfolio_trades_user_portfolio_status_idx
  on public.portfolio_trades(user_id, portfolio_id, status, created_at desc);

create index portfolio_trades_user_portfolio_ticker_idx
  on public.portfolio_trades(user_id, portfolio_id, ticker, created_at desc);

create index portfolio_transactions_trade_idx
  on public.portfolio_transactions(user_id, portfolio_id, trade_id, transaction_date, created_at);

create index portfolio_trade_stop_events_trade_time_idx
  on public.portfolio_trade_stop_events(user_id, trade_id, effective_at, created_at);

create index portfolio_trade_journal_entries_trade_time_idx
  on public.portfolio_trade_journal_entries(user_id, trade_id, occurred_at, created_at);

create trigger qeo_portfolio_trades_updated_at
before update on public.portfolio_trades
for each row execute function public.qeo_touch_updated_at();

create trigger qeo_portfolio_trade_journal_entries_updated_at
before update on public.portfolio_trade_journal_entries
for each row execute function public.qeo_touch_updated_at();

alter table public.portfolio_trades enable row level security;
alter table public.portfolio_trade_stop_events enable row level security;
alter table public.portfolio_trade_journal_entries enable row level security;

revoke all on public.portfolio_trades from anon;
revoke all on public.portfolio_trade_stop_events from anon;
revoke all on public.portfolio_trade_journal_entries from anon;

grant select, insert, update, delete on public.portfolio_trades to authenticated;
grant select, insert on public.portfolio_trade_stop_events to authenticated;
grant select, insert, update, delete on public.portfolio_trade_journal_entries to authenticated;

create policy portfolio_trades_select_own on public.portfolio_trades
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy portfolio_trades_insert_own on public.portfolio_trades
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy portfolio_trades_update_own on public.portfolio_trades
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy portfolio_trades_delete_own on public.portfolio_trades
  for delete to authenticated
  using (user_id = (select auth.uid()));

create policy portfolio_trade_stop_events_select_own on public.portfolio_trade_stop_events
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy portfolio_trade_stop_events_insert_own on public.portfolio_trade_stop_events
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy portfolio_trade_journal_entries_select_own on public.portfolio_trade_journal_entries
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy portfolio_trade_journal_entries_insert_own on public.portfolio_trade_journal_entries
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy portfolio_trade_journal_entries_update_own on public.portfolio_trade_journal_entries
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy portfolio_trade_journal_entries_delete_own on public.portfolio_trade_journal_entries
  for delete to authenticated
  using (user_id = (select auth.uid()));

commit;
