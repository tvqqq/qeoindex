-- QEO-137 follow-up — harden authenticated grants and cover composite foreign-key lookup paths.
-- Additive metadata/index change only; no user data is rewritten and no Trade/Fill history is fabricated.

begin;

-- Production default privileges may pre-grant broader rights than this domain intends.
-- Revoke first, then grant the narrow QEO-137 contract explicitly.
revoke all on public.portfolio_trades from anon, authenticated;
revoke all on public.portfolio_trade_stop_events from anon, authenticated;
revoke all on public.portfolio_trade_journal_entries from anon, authenticated;

grant select, insert, update, delete on public.portfolio_trades to authenticated;
grant select, insert on public.portfolio_trade_stop_events to authenticated;
grant select, insert, update, delete on public.portfolio_trade_journal_entries to authenticated;

create index portfolio_trades_portfolio_owner_fk_idx
  on public.portfolio_trades(portfolio_id, user_id);

create index portfolio_transactions_trade_identity_fk_idx
  on public.portfolio_transactions(trade_id, portfolio_id, user_id, ticker);

create index portfolio_trade_stop_events_trade_identity_fk_idx
  on public.portfolio_trade_stop_events(trade_id, portfolio_id, user_id, ticker);

create index portfolio_trade_journal_entries_trade_identity_fk_idx
  on public.portfolio_trade_journal_entries(trade_id, portfolio_id, user_id, ticker);

commit;
