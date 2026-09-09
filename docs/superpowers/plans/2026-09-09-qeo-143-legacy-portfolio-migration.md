# QEO-143 Legacy Portfolio Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely classify and deterministically group provable legacy portfolio fills without changing accounting semantics or fabricating mode, timestamps, stops, risk snapshots, psychology, or Scorecard history.

**Architecture:** Add explicit migration provenance to `portfolio_transactions` / `portfolio_trades`, a service-role-only idempotent Postgres backfill routine for conservative closed campaigns, and read-model/performance/UI completeness semantics. Raw fills remain the accounting source of truth. SQL integration fixtures prove real migration behavior against a replayed local Supabase database.

**Tech Stack:** PostgreSQL 17 / Supabase migrations + RLS, TypeScript 5.7, Node test runner, Next.js 16 / React 19, GitHub Actions, pnpm 10.28.

**Spec:** `docs/superpowers/specs/2026-09-09-qeo-143-legacy-portfolio-migration-design.md`

## Global Constraints

- Do not mutate raw fill accounting fields or AVCO behavior.
- Do not infer legacy live/paper mode.
- Do not convert transaction `created_at` into an execution timestamp.
- Do not synthesize stop events, risk snapshots, psychology, journal entries, Money Management Plan references, targets, or setup rationale.
- Automatic grouping is limited to provable completed `flat → open → flat` buy/sell campaigns.
- Corporate-action sequences, sell-from-flat, over-sells, terminal open campaigns, and same-day multi-campaign ambiguity remain ungrouped.
- Migrated unknown-mode Trades are Scorecard-ineligible.
- Migration/backfill must be idempotent and auditable.

---

### Task 1: RED — schema/provenance contract

**Files:**
- Create: `tests/portfolio/qeo143-legacy-migration-schema.test.ts`
- Create later in GREEN: `supabase/migrations/20260909050000_qeo143_legacy_portfolio_migration.sql`

**Interfaces:**
- Produces required schema contract for Task 2.
- Consumes existing QEO-137 `portfolio_trades` and `portfolio_transactions.trade_id` schema.

- [ ] **Step 1: Write the failing schema test**

The test must read the future migration and assert all of the following strings/constraints exist:

```ts
assert.match(sql, /record_origin/i)
assert.match(sql, /legacy_migration_status/i)
assert.match(sql, /origin/i)
assert.match(sql, /grouping_status/i)
assert.match(sql, /scorecard_eligible/i)
assert.match(sql, /legacy_opened_on/i)
assert.match(sql, /legacy_closed_on/i)
assert.match(sql, /legacy_source_transaction_count/i)
assert.match(sql, /mode in \('live', 'paper', 'unknown'\)/i)
assert.match(sql, /qeo143_backfill_legacy_portfolio_trades/i)
assert.match(sql, /qeo143_legacy_migration_audit/i)
assert.match(sql, /revoke all on function public\.qeo143_backfill_legacy_portfolio_trades/i)
assert.match(sql, /grant execute on function public\.qeo143_backfill_legacy_portfolio_trades/i)
```

Also assert the migration does **not** set legacy risk/journal/stop fields from transaction compatibility columns and does not copy `created_at` into `opened_at`/`closed_at`:

```ts
assert.doesNotMatch(sql, /initial_stop_loss_exit\s*=\s*.*stop_loss_/i)
assert.doesNotMatch(sql, /opened_at\s*=\s*.*created_at/i)
assert.doesNotMatch(sql, /closed_at\s*=\s*.*created_at/i)
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo143-legacy-migration-schema.test.ts
```

Expected: FAIL because the migration file does not exist.

- [ ] **Step 3: Commit RED**

```bash
git add tests/portfolio/qeo143-legacy-migration-schema.test.ts
git commit -m "test(QEO-143): define legacy migration schema contract"
```

---

### Task 2: GREEN — additive migration + conservative backfill routine

**Files:**
- Create: `supabase/migrations/20260909050000_qeo143_legacy_portfolio_migration.sql`
- Modify generated later: `modules/shared/supabase/database.types.ts`
- Test: `tests/portfolio/qeo143-legacy-migration-schema.test.ts`

**Interfaces:**
- Produces `portfolio_transactions.record_origin`.
- Produces `portfolio_transactions.legacy_migration_status`.
- Produces `portfolio_trades.origin`, `grouping_status`, `scorecard_eligible`, `legacy_opened_on`, `legacy_closed_on`, `legacy_source_transaction_count`.
- Produces service-role callable `public.qeo143_backfill_legacy_portfolio_trades()`.
- Produces `public.qeo143_legacy_migration_audit` summary rows.

- [ ] **Step 1: Add transaction provenance columns**

Use defaults that preserve future native behavior:

```sql
alter table public.portfolio_transactions
  add column record_origin text not null default 'native'
    check (record_origin in ('native', 'legacy_pre_trade_domain')),
  add column legacy_migration_status text not null default 'not_applicable'
    check (legacy_migration_status in (
      'not_applicable', 'legacy_ungrouped', 'deterministic_grouped', 'manually_reviewed'
    ));

update public.portfolio_transactions
set record_origin = 'legacy_pre_trade_domain',
    legacy_migration_status = 'legacy_ungrouped'
where trade_id is null;
```

- [ ] **Step 2: Add Trade provenance/date-only lifecycle fields**

Add the fields from the spec, extend persisted DB mode to `unknown`, and replace the existing lifecycle check so:

- native rows retain the current timestamp invariants;
- `origin='legacy_migration'` closed rows may have `opened_at/closed_at NULL` only when `legacy_opened_on/legacy_closed_on` are present and ordered;
- migrated rows remain unable to claim exact timestamps without evidence.

- [ ] **Step 3: Add audit table**

Create `public.qeo143_legacy_migration_audit` with a UUID PK plus run timestamp and numeric summary fields only:

```text
rows_scanned
rows_grouped
trades_created
rows_unresolved
buy_quantity_before / after
sell_quantity_before / after
notional_before / after
fees_before / after
```

RLS is enabled; authenticated/anon receive no grants; service role retains operational access.

- [ ] **Step 4: Implement `qeo143_backfill_legacy_portfolio_trades()`**

The PL/pgSQL routine must:

1. take an advisory transaction lock;
2. snapshot reconciliation totals for rows currently `legacy_ungrouped`;
3. iterate each `(user_id, portfolio_id, ticker)` in canonical date/storage order;
4. reject the whole affected campaign when action is not buy/sell, sell occurs from flat, cumulative quantity becomes negative, or a same-date boundary is ambiguous;
5. create one Trade only when a completed campaign returns from positive quantity to zero;
6. insert with `origin='legacy_migration'`, `grouping_status='deterministic'`, `mode='unknown'`, `status='closed'`, `scorecard_eligible=false`, date-only legacy boundaries and all risk/stop/psychology fields NULL;
7. update only `trade_id` + migration metadata on source fills;
8. leave terminal open rows `legacy_ungrouped`;
9. verify reconciliation totals are unchanged and raise on mismatch;
10. insert one audit row;
11. return the audit summary.

Revoke function execution from `public`, `anon`, `authenticated`; grant only `service_role`.

- [ ] **Step 5: Execute the function once inside the migration**

Call it after provenance classification so production gets a one-time conservative backfill on migration application.

- [ ] **Step 6: Run GREEN contract test**

```bash
node --test tests/portfolio/qeo143-legacy-migration-schema.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260909050000_qeo143_legacy_portfolio_migration.sql tests/portfolio/qeo143-legacy-migration-schema.test.ts
git commit -m "feat(QEO-143): add conservative legacy migration schema"
```

---

### Task 3: RED/GREEN — real Postgres backfill behavior and idempotency

**Files:**
- Create: `tests/portfolio/qeo143-legacy-migration.integration.sql`
- Create: `scripts/db/verify-qeo143-legacy-migration.sh`
- Create: `.github/workflows/qeo143-preprod.yml`

**Interfaces:**
- Executes Task 2's `qeo143_backfill_legacy_portfolio_trades()` on a replayed local DB.
- Produces objective RED/GREEN evidence for deterministic grouping and ambiguity policy.

- [ ] **Step 1: Write the integration SQL fixture before changing backfill behavior**

Create a deterministic local auth user/portfolio using the same `auth.users` insert shape as `scripts/db/recovery/seed.sql`.

Insert synthetic legacy rows covering:

1. one completed multi-fill campaign on separate dates: `buy 100`, `buy 50`, `sell 80`, `sell 70` → exactly one grouped Trade;
2. sell-from-flat → ungrouped;
3. over-sell → ungrouped;
4. corporate-action-containing sequence → ungrouped;
5. terminal open buy → ungrouped;
6. two close/reopen boundaries on one `transaction_date` → ungrouped.

The SQL must assert with `DO $$ ... RAISE EXCEPTION ... $$` that:

- only case 1 receives a `trade_id`;
- the created Trade is `legacy_migration / deterministic / unknown / closed / scorecard_eligible=false`;
- exact `opened_at/closed_at` remain NULL;
- date-only boundaries are correct;
- risk/stop/plan fields remain NULL;
- no stop/journal rows are created;
- raw row count, quantities, notional, and fees are unchanged;
- a second function call creates zero additional Trades and changes zero additional fill links.

- [ ] **Step 2: Add local verification shell**

`scripts/db/verify-qeo143-legacy-migration.sh` must:

```bash
set -euo pipefail
DB_CONTAINER="${QEO_Q143_DB_CONTAINER:-supabase_db_qeoindex}"
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - \
  < tests/portfolio/qeo143-legacy-migration.integration.sql
```

- [ ] **Step 3: Add dedicated workflow**

`qeo143-preprod.yml` runs on QEO-143 paths, installs Supabase CLI, runs focused Node tests, starts Supabase, replays from zero, executes the integration SQL, verifies generated DB types, runs QEO-137/QEO-140/QEO-141/QEO-142 regressions, typecheck and build.

- [ ] **Step 4: Commit RED integration fixture/workflow**

The first workflow run against an incomplete Task 2 implementation is expected to fail on behavior assertions. Record the run as RED evidence in the Linear issue.

- [ ] **Step 5: Adjust only the backfill routine until integration fixture passes**

Do not weaken fixture assertions to accommodate an aggressive grouping implementation.

- [ ] **Step 6: Commit GREEN behavior**

```bash
git add tests/portfolio/qeo143-legacy-migration.integration.sql scripts/db/verify-qeo143-legacy-migration.sh .github/workflows/qeo143-preprod.yml supabase/migrations/20260909050000_qeo143_legacy_portfolio_migration.sql
git commit -m "test(QEO-143): verify legacy backfill against Postgres"
```

---

### Task 4: RED/GREEN — typed completeness + Scorecard exclusion

**Files:**
- Modify: `modules/portfolio/trades/types.ts`
- Modify: `modules/portfolio/trades/server.ts`
- Modify: `modules/portfolio/trades/read-model.ts`
- Modify: `modules/portfolio/risk-engine/active-risk.ts`
- Modify: `modules/portfolio/performance/types.ts`
- Modify: `modules/portfolio/performance/server.ts`
- Modify: `modules/portfolio/performance/closed-trades.ts`
- Modify: `tests/portfolio/qeo137-trade-read-model.test.ts`
- Create: `tests/portfolio/qeo143-performance-eligibility.test.ts`
- Modify: `tests/portfolio/qeo137-legacy-transactions-context.test.ts`

**Interfaces:**
- Introduces persisted mode type `live | paper | unknown` without allowing `unknown` in normal Trade creation input.
- Extends Trade read-model migration/completeness fields.
- Keeps `ClosedTradeOutcome.mode` strictly `live | paper`.

- [ ] **Step 1: RED read-model test**

Add a migrated Trade fixture and assert:

```ts
assert.equal(model.completeness.tradeGroupingState, "deterministic")
assert.equal(model.completeness.modeState, "unknown")
assert.equal(model.completeness.scorecardState, "ineligible")
assert.equal(model.completeness.stopState, "unknown")
assert.equal(model.completeness.initialRiskState, "unknown")
assert.equal(model.completeness.journalState, "unavailable")
```

- [ ] **Step 2: RED performance test**

Feed `deriveClosedTradeOutcomes()`:

- one ordinary closed live Trade;
- one migrated closed `mode='unknown' / scorecard_eligible=false` Trade;
- linked fills for both.

Assert only the live Trade becomes an outcome and the migrated Trade increments `excludedClosedTradeCount`.

- [ ] **Step 3: RED legacy context test**

Assert `readPortfolioTradeContext()` selects and returns transaction migration status, Trade provenance, and explicit counts for ungrouped/deterministic legacy evidence.

- [ ] **Step 4: Run RED tests**

```bash
node --test tests/portfolio/qeo137-trade-read-model.test.ts tests/portfolio/qeo137-legacy-transactions-context.test.ts tests/portfolio/qeo143-performance-eligibility.test.ts
```

Expected: FAIL on missing fields/types/eligibility filter.

- [ ] **Step 5: Implement minimal typed behavior**

Keep `TRADE_MODES = ['live', 'paper']` for creation validation; add a persisted union such as:

```ts
export type PersistedTradeMode = TradeMode | "unknown"
```

Select provenance fields in Trade server/performance server. Extend `TradeReadModel.completeness`. In `deriveClosedTradeOutcomes`, exclude `scorecard_eligible !== true` or `mode === 'unknown'` before creating an outcome.

- [ ] **Step 6: Run GREEN + existing regressions**

```bash
node --test tests/portfolio/qeo137-trade-domain.test.ts tests/portfolio/qeo137-trade-read-model.test.ts tests/portfolio/qeo137-trade-api-contract.test.ts tests/portfolio/qeo137-legacy-transactions-context.test.ts tests/portfolio/qeo143-performance-eligibility.test.ts
node --test tests/portfolio/qeo141-active-risk-engine.test.ts
node --test tests/portfolio/qeo142-*.test.ts
node --test tests/portfolio-pnl.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add modules/portfolio tests/portfolio
git commit -m "feat(QEO-143): expose legacy completeness and protect scorecard"
```

---

### Task 5: RED/GREEN — visible legacy accounting state in Nhật ký

**Files:**
- Modify: `modules/portfolio/pnl.ts`
- Modify: `app/api/portfolio/[id]/transactions/route.ts`
- Modify: `app/api/portfolio/[id]/transactions/[txId]/route.ts`
- Modify: `components/portfolio/portfolio-transaction-history.tsx`
- Create: `tests/portfolio/qeo143-legacy-ui.test.ts`

**Interfaces:**
- `RawTransaction` gains optional migration provenance fields returned by transaction APIs.
- Transaction history renders status only; it does not edit migration facts.

- [ ] **Step 1: Write RED source/UI contract**

Assert API select fields include `record_origin,legacy_migration_status` and transaction history contains copy for:

- `Legacy · chưa nhóm Trade`;
- `Legacy · đã nhóm`;
- explanatory text that ungrouped legacy fills remain valid for P&L but are excluded from Trade-based Scorecard metrics.

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo143-legacy-ui.test.ts
```

- [ ] **Step 3: Implement minimal UI**

Add compact non-interactive badges beside transaction metadata. Preserve current theme/table layout and do not add a new wizard.

- [ ] **Step 4: Run GREEN + portfolio UI regressions**

```bash
node --test tests/portfolio/qeo143-legacy-ui.test.ts tests/portfolio-pnl.test.ts
pnpm lint:touched
pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add modules/portfolio/pnl.ts app/api/portfolio components/portfolio/portfolio-transaction-history.tsx tests/portfolio/qeo143-legacy-ui.test.ts
git commit -m "feat(QEO-143): surface legacy migration state in journal"
```

---

### Task 6: Generated types, migration replay, production evidence, PR

**Files:**
- Modify generated: `modules/shared/supabase/database.types.ts`
- Create: `docs/db/evidence/qeo143-legacy-migration-production-2026-09-09.md`
- Modify after production apply: `supabase/migration-equivalence.json`
- Update Linear: QEO-143

**Interfaces:**
- Final release/evidence gate for QEO-144 downstream acceptance.

- [ ] **Step 1: Let local replay generate exact DB types**

Run/CI:

```bash
pnpm db:replay:verify
pnpm db:types:verify
```

If the dedicated workflow syncs the exact generated type candidate to the branch, rerun from that new head.

- [ ] **Step 2: Full exact-head verification**

Require GREEN on:

```bash
pnpm verify:pr
pnpm db:drift:verify
pnpm db:replay:verify
pnpm db:types:verify
node --test tests/portfolio/qeo143-*.test.ts
node --test tests/portfolio/qeo137-*.test.ts
node --test tests/portfolio/qeo141-*.test.ts
node --test tests/portfolio/qeo142-*.test.ts
node --test tests/portfolio-pnl.test.ts
pnpm build
```

- [ ] **Step 3: Production pre-apply snapshot**

Record counts and reconciliation totals for `portfolio_transactions`, current Trade count, linked/unlinked counts, plus absence of QEO-143 schema before apply. Do not record note/journal free text.

- [ ] **Step 4: Apply the repository-equivalent migration to production**

Use Supabase migration tooling rather than raw DDL execution. Record the production migration version/name.

- [ ] **Step 5: Production post-apply verification**

Verify:

- the existing single open MSN legacy buy remains ungrouped under the closed-campaign-only policy;
- `portfolio_trades` remains 0 unless other new production data appeared during implementation;
- no stop/journal/risk history was fabricated;
- row/quantity/notional/fee reconciliation is unchanged;
- audit summary exists;
- RLS/grants/function execution boundary is correct;
- Supabase security/performance advisors show no new material finding.

- [ ] **Step 6: Commit production evidence + migration mapping**

Document exact timestamps/versions and add `supabase/migration-equivalence.json` mapping if production version differs from repository timestamp.

- [ ] **Step 7: Open PR and attach to Linear**

PR title:

```text
QEO-143: conservative legacy portfolio migration and reconciliation
```

PR body must include RED/GREEN evidence, migration/reconciliation facts, production readback, known limitation that open/ambiguous legacy rows remain ungrouped, and explicit confirmation that Scorecard did not ingest unknown-mode history.

- [ ] **Step 8: Move QEO-143 to In Review only after exact-head gates are green**

Do not mark Done until merge/source integration is complete.

---

## Plan self-review

- Spec coverage: migration policy, deterministic grouping, explicit unknowns, Scorecard boundary, UI distinction, idempotency, observability, P&L reconciliation, production evidence and RLS are all assigned.
- Placeholder scan: no deferred implementation steps or synthetic historical fields are permitted.
- Type consistency: normal Trade creation remains `live|paper`; persisted/read migration mode may be `unknown`; closed Scorecard outcomes remain `live|paper` only.