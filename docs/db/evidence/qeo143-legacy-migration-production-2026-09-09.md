# QEO-143 Production Migration Evidence — 2026-09-09

## Production identity

- Supabase project: `glwhhrmejlonhyorvtzm`
- Production migration: `20260909044821_qeo143_legacy_portfolio_migration`
- Repository logical migration: `qeo143_legacy_portfolio_migration`

## Pre-apply accounting snapshot

| Metric | Value |
| --- | ---: |
| portfolio_transactions | 1 |
| unlinked transactions | 1 |
| linked transactions | 0 |
| buy quantity | 1,000,000 |
| sell quantity | 0 |
| raw notional | 45,000,000 |
| raw fees | 67,500 |
| portfolio_trades | 0 |
| stop events | 0 |
| journal entries | 0 |

QEO-143 provenance columns and audit table did not exist before apply.

## Post-apply reconciliation

| Metric | Value |
| --- | ---: |
| portfolio_transactions | 1 |
| unlinked transactions | 1 |
| linked transactions | 0 |
| buy quantity | 1,000,000 |
| sell quantity | 0 |
| raw notional | 45,000,000 |
| raw fees | 67,500 |
| portfolio_trades | 0 |
| stop events | 0 |
| journal entries | 0 |
| legacy_ungrouped | 1 |
| deterministic_grouped | 0 |

The production audit row reported:

- `rows_scanned = 1`
- `rows_grouped = 0`
- `trades_created = 0`
- `rows_unresolved = 1`
- buy/sell quantity, notional and fees were identical before/after.

The single production legacy position remains deliberately ungrouped because it is an open campaign; no Trade, execution timestamp, live/paper mode, stop history, risk snapshot, psychology or journal history was fabricated.

## Idempotency

A privileged rerun of `qeo143_backfill_legacy_portfolio_trades()` returned:

- `rows_scanned = 1`
- `rows_grouped = 0`
- `trades_created = 0`
- `rows_unresolved = 1`

After the rerun, the database still had 1 transaction, 1 unlinked legacy row and 0 Trades. The audit table contained two runs, proving replay did not duplicate Trade records.

## Security boundary

- `qeo143_legacy_migration_audit` RLS: enabled.
- `anon` function execute: false.
- `authenticated` function execute: false.
- `service_role` function execute: true.
- Security/performance advisor findings were reviewed before/after; QEO-143 introduced no material new advisor finding.

## Acceptance

- Raw accounting/P&L inputs unchanged: PASS.
- Ambiguous/open legacy record stays unresolved: PASS.
- No fabricated historical evidence: PASS.
- Backfill idempotency: PASS.
- Service-role-only migration RPC: PASS.
- Production migration ledger captured: PASS.
