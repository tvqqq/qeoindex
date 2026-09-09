# QEO-158 External Cash-Flow Production Acceptance — 2026-09-09

## Scope

Production readback for QEO-158 on Supabase project `qeoindex` (`glwhhrmejlonhyorvtzm`). This evidence is limited to external funding schema/state and raw Portfolio accounting invariants. No free-form transaction or funding notes are included.

## Migration state

- Production migration registry contains `20260909061101 qeo158_external_cash_flows`.
- The repository migration uses the same version and logical name.
- The migration was already present in production when the final acceptance audit began, so no DDL was re-applied during this audit.
- The temporary `REPO_AHEAD` manifest was retired and the canonical production migration ledger was advanced through QEO-158.

## Production readback

Captured at approximately `2026-09-09T08:22Z` UTC:

| Check | Production value |
| --- | ---: |
| Portfolios | 1 |
| Portfolios marked `legacy_unrecorded` | 1 |
| Initial capital total | 0.00 VND |
| External cash-flow rows | 0 |
| Portfolio transaction rows | 1 |
| Transaction quantity total | 1,000,000.0000 |
| Transaction notional total | 45,000,000.000000 kVND |
| Transaction fee total | 67,500.00 kVND |

This confirms the existing legacy portfolio is explicitly marked as having incomplete historical funding and no deposit/withdrawal row was fabricated for it. The current raw transaction accounting totals remain present after QEO-158.

## Security / ownership

Production readback confirms:

- RLS is enabled on `public.portfolio_external_cash_flows`.
- Authenticated table grants are limited to `SELECT` and `INSERT`.
- Owner policies exist for `SELECT` and `INSERT`:
  - `portfolio_external_cash_flows_select_own`
  - `portfolio_external_cash_flows_insert_own`
- The application API additionally scopes portfolio and cash-flow queries by authenticated `user_id` and `portfolio_id`.
- Normal application semantics remain append-only; corrections use compensating rows rather than PATCH/DELETE funding mutations.

## Advisor readback

Supabase security advisor produced no QEO-158-specific RLS/policy finding for `portfolio_external_cash_flows`.

The performance advisor reported one informational finding that the composite FK `(portfolio_id, user_id)` does not have a covering index in that exact column order. QEO-158 already has the required timeline index `(portfolio_id, effective_at, id)` and owner lookup index `(user_id, portfolio_id)`. This INFO advisory is not a correctness/RLS acceptance blocker and is intentionally not addressed by mutating the already-applied production migration.

## Accounting / performance invariants

QEO-158 implementation and focused contracts require:

- deposits/withdrawals remain separate from `portfolio_transactions`;
- Account Equity includes signed external flows;
- flow-adjusted return/drawdown removes the direct capital-flow jump;
- a withdrawal alone cannot create a flow-adjusted drawdown;
- a deposit alone cannot create flow-adjusted return;
- Active Risk % uses current post-flow Account Equity;
- historical Trade initial-risk snapshots are not rewritten;
- legacy funding history fails closed as insufficient instead of being reconstructed from trading rows;
- the exposed return remains a simple flow-adjusted Total P/L %, explicitly not TWR/MWR.

## Release gates

Final acceptance requires exact-head GREEN for the QEO-158 focused workflow plus repository Verify, DB Drift Reconciliation, QEO-141 Portfolio Risk Engine and QEO-142 Performance Preprod. Those run results are recorded on PR #386 / Linear QEO-158 rather than hard-coded here so this production evidence file does not require a post-verification source commit.
