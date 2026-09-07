-- QEO-137 follow-up — cover composite foreign-key lookup paths detected by the production advisor.
-- Index-only additive change; no user data is rewritten and no Trade/Fill history is fabricated.

begin;

create index portfolio_trades_portfolio_owner_fk_idx
  on public.portfolio_trades(portfolio_id, user_id);

create index portfolio_transactions_trade_identity_fk_idx
  on public.portfolio_transactions(trade_id, portfolio_id, user_id, ticker);

create index portfolio_trade_stop_events_trade_identity_fk_idx
  on public.portfolio_trade_stop_events(trade_id, portfolio_id, user_id, ticker);

create index portfolio_trade_journal_entries_trade_identity_fk_idx
  on public.portfolio_trade_journal_entries(trade_id, portfolio_id, user_id, ticker);

commit;
