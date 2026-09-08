-- QEO-140 — append-only stop-event to actual exit-fill evidence.
-- No historical backfill or inference. portfolio_transactions remains the AVCO source of truth.

begin;

-- Composite parent identities let the relation enforce Trade/portfolio/user/ticker
-- consistency at the database boundary. Including transaction action makes sell-only
-- execution evidence enforceable by FK rather than application convention alone.
alter table public.portfolio_trade_stop_events
  add constraint portfolio_trade_stop_events_identity_key
  unique (id, trade_id, portfolio_id, user_id, ticker);

alter table public.portfolio_transactions
  add constraint portfolio_transactions_stop_exit_identity_key
  unique (id, trade_id, portfolio_id, user_id, ticker, action);

create table public.portfolio_trade_stop_exit_fills (
  id uuid primary key default gen_random_uuid(),
  stop_event_id uuid not null,
  transaction_id uuid not null,
  trade_id uuid not null,
  portfolio_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  exit_action text not null default 'sell'
    check (exit_action = 'sell'),
  created_at timestamptz not null default now(),

  unique (stop_event_id, transaction_id),
  unique (transaction_id),

  foreign key (stop_event_id, trade_id, portfolio_id, user_id, ticker)
    references public.portfolio_trade_stop_events(id, trade_id, portfolio_id, user_id, ticker)
    on delete restrict,

  foreign key (transaction_id, trade_id, portfolio_id, user_id, ticker, exit_action)
    references public.portfolio_transactions(id, trade_id, portfolio_id, user_id, ticker, action)
    on delete restrict
);

-- Cover child-side composite FK lookup paths explicitly.
create index portfolio_trade_stop_exit_fills_stop_fk_idx
  on public.portfolio_trade_stop_exit_fills(stop_event_id, trade_id, portfolio_id, user_id, ticker);

create index portfolio_trade_stop_exit_fills_tx_fk_idx
  on public.portfolio_trade_stop_exit_fills(transaction_id, trade_id, portfolio_id, user_id, ticker, exit_action);

create index portfolio_trade_stop_exit_fills_trade_read_idx
  on public.portfolio_trade_stop_exit_fills(user_id, portfolio_id, trade_id, stop_event_id, created_at);

alter table public.portfolio_trade_stop_exit_fills enable row level security;

-- Production default privileges may be broad. Keep evidence append-only for authenticated users.
revoke all on public.portfolio_trade_stop_exit_fills from anon, authenticated;
grant select, insert on public.portfolio_trade_stop_exit_fills to authenticated;

create policy portfolio_trade_stop_exit_fills_select_own
  on public.portfolio_trade_stop_exit_fills
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy portfolio_trade_stop_exit_fills_insert_own
  on public.portfolio_trade_stop_exit_fills
  for insert to authenticated
  with check (user_id = (select auth.uid()));

commit;
