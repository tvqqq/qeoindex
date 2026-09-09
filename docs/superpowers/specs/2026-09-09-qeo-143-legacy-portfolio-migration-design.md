# QEO-143 Legacy Portfolio Migration / Backfill Design

## Goal

Migrate pre-Trade-domain `/portfolio` records into the QEO-137+ Trade/Risk domain **only when facts are provable from stored data**, while preserving raw fills as the AVCO/accounting source of truth and keeping unavailable history explicitly unavailable.

This document is the repository copy of the approved Linear QEO-143 contract, with implementation decisions required by the current schema.

## Non-negotiable invariants

1. `portfolio_transactions` remain the canonical accounting/fill source of truth.
2. Migration must not change quantity, price, fee, action, transaction date, target/stop compatibility fields, notes, tags, or AVCO P&L semantics.
3. Never invent historical psychology, rule adherence, account equity, risk %, Risk Amount, Money Management Plan reference, stop-event history, or exact execution timestamps.
4. A legacy transaction may remain ungrouped indefinitely when evidence is ambiguous.
5. Closed-Trade Scorecard metrics must never consume an unreviewed/unknown-mode migrated Trade.
6. Re-running the migration/backfill must be safe and must not duplicate Trades or relink already-classified fills.
7. Live and paper results remain separated; unknown mode is not silently treated as live.

## Current-schema conflict discovered during audit

The existing normalized Trade schema requires:

- `mode in ('live', 'paper')`;
- `opened_at` for open/partially-closed Trades;
- `opened_at + closed_at` for closed Trades.

Legacy fills contain `transaction_date` (date-only) and `created_at`, but `created_at` is record-creation provenance and is not guaranteed to be the execution timestamp. Legacy fills also do not contain live/paper mode.

Therefore QEO-143 must not use `created_at` as a fabricated execution timestamp and must not default mode to `live`.

### Chosen representation

Persisted Trade mode gains an explicit `unknown` state for migration records. Normal user-created Trades still accept only `live|paper` through the existing create/validation path.

`portfolio_trades` gains migration provenance fields:

- `origin`: `native | legacy_migration`;
- `grouping_status`: `native | deterministic | manually_reviewed`;
- `scorecard_eligible`: boolean;
- `legacy_opened_on`: nullable date;
- `legacy_closed_on`: nullable date;
- `legacy_source_transaction_count`: nullable integer.

Legacy Trade lifecycle checks allow date-only provenance for `origin='legacy_migration'` without fabricating `opened_at/closed_at`. Native Trade lifecycle constraints remain unchanged.

`portfolio_transactions` gains migration-state metadata:

- `record_origin`: `native | legacy_pre_trade_domain`;
- `legacy_migration_status`: `not_applicable | legacy_ungrouped | deterministic_grouped | manually_reviewed`.

Rows that already exist when the QEO-143 migration is applied and are still `trade_id IS NULL` are marked `legacy_pre_trade_domain / legacy_ungrouped`. This classification is factual migration provenance, not inferred trading history. New transactions retain `native / not_applicable` by default.

## Deterministic grouping policy

Grouping is deliberately conservative. It works per `(user_id, portfolio_id, ticker)` and only on legacy-unlinked rows.

### Eligible actions

Automatic grouping only uses `buy` and `sell` fills.

If a candidate sequence contains `rights`, `dividend_stock`, or `dividend_cash`, it remains ungrouped. Corporate actions can change quantity/cost basis and must not be silently interpreted as a Trade-campaign boundary.

### Canonical ordering

Rows are evaluated by:

1. `transaction_date ASC`;
2. `created_at ASC`;
3. `id ASC`.

`created_at` is only a deterministic storage-order tie-breaker. It is never copied into `opened_at` or `closed_at` as an execution timestamp.

### Quantity-state rules

A candidate campaign begins only from flat (`openQty = 0`) with a `buy`.

For each fill:

- `buy` increases open quantity;
- `sell` decreases open quantity;
- cumulative quantity may never become negative;
- a sell from flat is ambiguous;
- an over-sell is ambiguous;
- a closed deterministic campaign ends when cumulative quantity returns exactly to zero within numeric epsilon.

Automatic backfill creates only completed `flat → open → flat` campaigns. A terminal still-open legacy sequence remains ungrouped in QEO-143. This is intentionally conservative and matches the approved QEO-143 scope; current open legacy positions continue to appear as legacy holdings with Risk Unknown rather than being promoted into a canonical Trade without a complete campaign.

### Same-day ambiguity

If grouping would require distinguishing two campaign boundaries for the same ticker on the same `transaction_date`, the affected rows remain ungrouped because legacy data has no execution time. We do not use record creation time to manufacture intraday lifecycle order.

### Result of deterministic grouping

For each proven closed campaign:

- create one `portfolio_trades` row;
- `origin = 'legacy_migration'`;
- `grouping_status = 'deterministic'`;
- `mode = 'unknown'`;
- `status = 'closed'`;
- `opened_at = NULL`, `closed_at = NULL`;
- `legacy_opened_on = first transaction_date`;
- `legacy_closed_on = final transaction_date`;
- risk/stop/psychology/plan fields remain NULL;
- `scorecard_eligible = false` because mode is unknown;
- attach only campaign fills via `portfolio_transactions.trade_id`;
- mark those fills `deterministic_grouped`.

No stop event or journal row is created from compatibility `stop_loss_*`, target, note, setup, or mistake fields.

## Completeness and provenance contract

`TradeReadModel.completeness` is extended with:

- `tradeGroupingState`: `native | deterministic | manually_reviewed | legacy_ungrouped` where applicable;
- `modeState`: `known | unknown`;
- `scorecardState`: `eligible | ineligible`;
- existing `stopState`;
- existing `initialRiskState`;
- existing `journalState`;
- existing Money Management Plan state.

For legacy fills that remain without a Trade, `readPortfolioTradeContext()` returns explicit migration status and counts. Unknown remains unknown.

## Scorecard boundary

`PerformanceTradeInput` accepts persisted `mode='unknown'`, but `deriveClosedTradeOutcomes()` excludes a Trade when:

- `scorecard_eligible !== true`; or
- `mode` is not `live|paper`; or
- the existing close-review requirements are not met.

For reviewed legacy Trades that later become eligible, performance ordering/period grouping may use `closed_at ?? legacy_closed_on`. A date-only `legacy_closed_on` is valid evidence for a Daily/Weekly/Monthly/Annual ledger; it is not converted into a fake exact time.

QEO-143 itself does not auto-review mode and does not auto-enable Scorecard eligibility.

## UI behavior

Preserve the existing `/portfolio` visual language.

The transaction/journal surface must distinguish:

- native fill;
- deterministic legacy grouped fill;
- ungrouped legacy fill.

Ungrouped legacy copy must state that the record remains valid for accounting/P&L but is excluded from Trade-based Scorecard statistics until reviewed/grouped. Do not show missing legacy psychology/risk/stop history as zero or completed.

A full manual campaign-linking wizard is not required for QEO-143 because production currently contains only one open unlinked legacy buy and no closed legacy campaign. The existing canonical Trade/fill APIs remain the manual path for future review; a larger UX can be added only when real ambiguous history justifies it.

## Migration/backfill implementation

Use one additive Supabase migration containing:

1. provenance/completeness columns and constraints;
2. replacement lifecycle constraint that preserves native invariants and permits date-only legacy lifecycle evidence;
3. supporting indexes;
4. a deterministic/idempotent SQL backfill routine scoped to legacy-unlinked rows;
5. execution of that routine once during migration;
6. a compact migration audit table recording one run summary, not free-form journal content.

Audit summary fields:

- migration version/key;
- rows scanned;
- rows grouped;
- Trades created;
- ambiguous/unresolved rows;
- reconciliation quantity/cash/fee totals before/after classification;
- completed timestamp.

The audit must not copy notes or psychology fields.

## Reconciliation

Before and after migration/backfill, verify invariant totals from raw `portfolio_transactions`:

- row count;
- sum buy/sell quantity by action/ticker;
- sum notional (`price * quantity`) by action/ticker;
- sum fee;
- AVCO output from `computePortfolioPositions()`.

Only `trade_id` and migration provenance metadata may change for deterministic legacy rows.

## Production evidence baseline — 2026-09-09

Fresh production readback before QEO-143 implementation:

- `portfolio_transactions`: 1 row;
- unlinked (`trade_id IS NULL`): 1 row;
- linked: 0 rows;
- `portfolio_trades`: 0 rows;
- the single legacy row is an open `MSN` buy dated 2026-09-06 with no target/stop fields recorded.

Under the conservative closed-campaign policy this row remains `legacy_ungrouped`; QEO-143 must not manufacture a closed Trade, live/paper mode, stop, risk snapshot, psychology, or exact execution timestamp for it.

## Tests / release gates

Required focused tests:

- schema/provenance contract;
- deterministic grouping: one closed campaign, scale-in/scale-out campaign, multiple completed campaigns on separate dates;
- ambiguity: sell-from-flat, over-sell, corporate action, same-day boundary ambiguity, terminal open campaign;
- idempotent rerun;
- no fabricated stop/risk/journal/mode/timestamps;
- Scorecard exclusion of unknown/ineligible migrated Trades;
- existing AVCO/P&L regression unchanged;
- UI legacy/grouping state copy;
- generated Supabase type drift;
- zero-to-latest migration replay.

Final gates: focused tests, existing QEO-137/QEO-140/QEO-141/QEO-142 regressions, lint, TypeScript, production build, migration drift/replay/types verification, production dry-run/readback and reconciliation evidence.