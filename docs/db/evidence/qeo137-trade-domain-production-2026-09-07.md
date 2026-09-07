# QEO-137 Trade lifecycle domain — production evidence — 2026-09-07

## Verified production migrations

- Supabase project: `qeoindex` / `glwhhrmejlonhyorvtzm`.
- Repository `20260907100000_qeo137_trade_lifecycle_domain.sql` maps to production `20260907111730 qeo137_trade_lifecycle_domain`.
- Repository `20260907112500_qeo137_trade_fk_indexes.sql` maps to production `20260907112934 qeo137_trade_fk_indexes`.

## Additive / no fabricated legacy history

Fresh production readback after both migrations showed:

- `portfolio_trades`: 0 rows;
- `portfolio_trade_stop_events`: 0 rows;
- `portfolio_trade_journal_entries`: 0 rows;
- `portfolio_transactions`: 1 existing row, with `trade_id IS NULL`;
- no existing transaction was auto-grouped into a Trade and no historical stop/risk/psychology record was synthesized.

This preserves `portfolio_transactions` as the existing AVCO accounting/fill source of truth while making Trade linkage explicitly opt-in for legacy data.

## Ownership and API boundary

Production metadata confirms RLS is enabled on all three new Trade-domain tables. Every authenticated policy is scoped by `user_id = (select auth.uid())`.

Authenticated table privileges after the hardening migration are:

- `portfolio_trades`: SELECT, INSERT, UPDATE, DELETE;
- `portfolio_trade_journal_entries`: SELECT, INSERT, UPDATE, DELETE;
- `portfolio_trade_stop_events`: SELECT, INSERT only.

`portfolio_trade_stop_events` therefore has no authenticated UPDATE/DELETE privilege and no UPDATE/DELETE policy: stop history is append-only at the authenticated database boundary. Anonymous access is not granted.

## Index readback

Production contains the expected Trade read/history indexes plus four covering indexes for the new composite foreign keys:

- `portfolio_trades_portfolio_owner_fk_idx (portfolio_id, user_id)`;
- `portfolio_transactions_trade_identity_fk_idx (trade_id, portfolio_id, user_id, ticker)`;
- `portfolio_trade_stop_events_trade_identity_fk_idx (trade_id, portfolio_id, user_id, ticker)`;
- `portfolio_trade_journal_entries_trade_identity_fk_idx (trade_id, portfolio_id, user_id, ticker)`.

A fresh performance-advisor read after the index migration reports no QEO-137 unindexed-foreign-key finding. The advisor can report the new indexes as unused while the Trade tables are empty; that is expected immediately after rollout and is not evidence to remove FK coverage.

A fresh security-advisor read reports no QEO-137 table-specific RLS finding. Existing advisor findings on unrelated tables/Auth remain outside QEO-137 scope.

## Activation boundary

QEO-137 establishes the normalized Trade/Fill/Stop/Journal storage and typed domain/API boundary only. It does not fabricate legacy Trade identity, does not persist the QEO-138 Money Management Plan, does not perform the `/portfolio` UI revamp, and does not introduce AI behavior.
