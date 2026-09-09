# QEO-158 External Cash-Flow Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit external funding ledger and make Account Equity, flow-adjusted return/drawdown, Active Risk, and Portfolio Performance correct across deposits/withdrawals without fabricating legacy funding history.

**Architecture:** Keep trade/corporate-action accounting in `portfolio_transactions`; add append-only `portfolio_external_cash_flows` plus `portfolios.funding_history_status`. Extend the shared equity-curve domain with actual Account Equity and flow-adjusted performance equity, then make QEO-141/QEO-142 consumers use the correct series. Add owner-scoped API/UI for funding history and block silent opening-capital rewrites after activity.

**Tech Stack:** Next.js App Router, React/TypeScript, Supabase/PostgreSQL/RLS, Node test runner, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-09-qeo-158-external-cash-flow-normalization-design.md`

## Global Constraints

- Deterministic core only; no AI/LLM.
- Do not infer historical deposits/withdrawals from buys, equity differences, holdings, or current prices.
- `portfolio_transactions` remains the raw trading/corporate-action accounting source of truth.
- New portfolios default funding history to `known`; pre-QEO-158 portfolios migrate to `legacy_unrecorded` without synthetic rows.
- Account Equity includes signed external flows; performance return/drawdown neutralizes their direct effect.
- The implemented return is a simple flow-adjusted Total P/L %, explicitly not TWR/MWR.
- Active Risk % uses current post-flow Account Equity; historical Trade risk snapshots are immutable.
- Preserve current `/portfolio` visual language and Vietnamese-primary help copy with canonical English metric names where already required by QEO-131/QEO-136.

---

### Task 1: Database contract and funding provenance

**Files:**
- Create: `supabase/migrations/20260909121500_qeo158_external_cash_flows.sql`
- Create: `tests/portfolio/qeo158-cash-flow-schema.test.ts`
- Modify: `modules/shared/supabase/database.types.ts`
- Modify: `.github/workflows/db-drift.yml` only if current generated-type automation requires no new workflow path

**Interfaces:**
- Produces table `portfolio_external_cash_flows` and `portfolios.funding_history_status`.
- Produces DB row fields consumed by Task 3/4 server adapters.

- [ ] **Step 1: Write the failing schema contract**

Assert the migration contains:

```ts
assert.match(sql, /portfolio_external_cash_flows/i)
assert.match(sql, /funding_history_status/i)
assert.match(sql, /legacy_unrecorded/i)
assert.match(sql, /deposit/i)
assert.match(sql, /withdrawal/i)
assert.match(sql, /capital_adjustment/i)
assert.match(sql, /signed_amount_vnd/i)
assert.match(sql, /enable row level security/i)
```

Also assert no INSERT into `portfolio_external_cash_flows` is used for legacy backfill.

- [ ] **Step 2: Run RED**

Run:

```bash
node --test tests/portfolio/qeo158-cash-flow-schema.test.ts
```

Expected: FAIL because the QEO-158 migration does not exist.

- [ ] **Step 3: Add the migration**

Implement:

```sql
alter table public.portfolios
  add column if not exists funding_history_status text not null default 'known';

alter table public.portfolios
  drop constraint if exists portfolios_funding_history_status_check;
alter table public.portfolios
  add constraint portfolios_funding_history_status_check
  check (funding_history_status in ('known', 'legacy_unrecorded'));

update public.portfolios
set funding_history_status = 'legacy_unrecorded'
where funding_history_status = 'known';

create table if not exists public.portfolio_external_cash_flows (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  flow_type text not null check (flow_type in ('deposit', 'withdrawal', 'capital_adjustment')),
  signed_amount_vnd numeric(20,2) not null,
  effective_at timestamptz not null,
  note text,
  provenance text not null default 'manual' check (provenance in ('manual', 'imported', 'portfolio_settings_adjustment')),
  created_at timestamptz not null default now(),
  constraint portfolio_external_cash_flows_amount_check check (
    (flow_type = 'deposit' and signed_amount_vnd > 0)
    or (flow_type = 'withdrawal' and signed_amount_vnd < 0)
    or (flow_type = 'capital_adjustment' and signed_amount_vnd <> 0)
  )
);
```

Add owner RLS policies, authenticated grants, `(portfolio_id,effective_at,id)` and `(user_id,portfolio_id)` indexes. Do not create legacy flow rows.

- [ ] **Step 4: Replay and regenerate DB types**

Run zero-state migration replay and regenerate `modules/shared/supabase/database.types.ts`; require a clean generated-type diff.

- [ ] **Step 5: Run GREEN**

Run schema contract plus existing QEO-137/QEO-138/QEO-143 schema tests.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260909121500_qeo158_external_cash_flows.sql tests/portfolio/qeo158-cash-flow-schema.test.ts modules/shared/supabase/database.types.ts
git commit -m "feat(QEO-158): add external portfolio cash-flow ledger"
```

### Task 2: Pure equity and flow-adjustment domain

**Files:**
- Create: `modules/portfolio/risk-engine/external-cash-flows.ts`
- Create: `tests/portfolio/qeo158-equity-cash-flows.test.ts`
- Modify: `modules/portfolio/risk-engine/types.ts`
- Modify: `modules/portfolio/risk-engine/equity-curve.ts`

**Interfaces:**
- Produces `ExternalCashFlow`, `sumExternalFlowsAt`, `flowAdjustedEquity`.
- Extends `buildCurrentAccountEquity()` and `buildEquityCurve()` with `externalCashFlows` and `fundingHistoryStatus`.
- Adds `flowAdjustedEquityVnd`, `externalFlowVnd`, `cumulativeExternalFlowVnd`, and `fundingCompleteness` to equity read models.

- [ ] **Step 1: Write failing deposit/withdrawal tests**

Fixtures must prove:

```ts
// deposit only
account.equityVnd === 120_000_000
point.flowAdjustedEquityVnd === 100_000_000

// withdrawal only
account.equityVnd === 80_000_000
point.flowAdjustedEquityVnd === 100_000_000
```

Also cover deposit → market/trading gain, same-day cutoff ordering, and `legacy_unrecorded` completeness.

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo158-equity-cash-flows.test.ts
```

Expected: FAIL because external-flow interfaces do not exist.

- [ ] **Step 3: Implement pure helpers**

```ts
export function flowAdjustedEquity(
  accountEquityVnd: number,
  cumulativeExternalFlowVnd: number,
): number {
  return Math.round(accountEquityVnd - cumulativeExternalFlowVnd)
}
```

`sumExternalFlowsAt()` includes only flows whose effective instant/date is at or before the snapshot cutoff and sorts ties deterministically by effective timestamp then id.

- [ ] **Step 4: Extend equity builders**

Current-equity formula becomes:

```ts
estimatedCashVnd = initialCapitalVnd
  + cumulativeExternalFlowVnd
  + realizedPnlVnd
  - remainingOpenCostBasisVnd
```

Each curve point exposes actual and flow-adjusted equity. `deriveCurrentDrawdown()` uses flow-adjusted equity and returns insufficient when funding history is `legacy_unrecorded`.

- [ ] **Step 5: Run GREEN and QEO-141 regression**

```bash
node --test tests/portfolio/qeo158-equity-cash-flows.test.ts tests/portfolio/qeo141-equity-drawdown.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add modules/portfolio/risk-engine tests/portfolio/qeo158-equity-cash-flows.test.ts
git commit -m "feat(QEO-158): normalize equity across external cash flows"
```

### Task 3: QEO-141/QEO-142 server and performance normalization

**Files:**
- Modify: `modules/portfolio/risk-engine/server.ts`
- Modify: `modules/portfolio/performance/server.ts`
- Modify: `modules/portfolio/performance/ledgers.ts`
- Modify: `modules/portfolio/performance/drawdown.ts`
- Modify: `modules/portfolio/performance/benchmark.ts`
- Modify: `modules/portfolio/performance/types.ts`
- Create: `tests/portfolio/qeo158-performance-normalization.test.ts`
- Create: `tests/portfolio/qeo158-server-context.test.ts`

**Interfaces:**
- Loads owner-scoped external flows once per portfolio context.
- Risk context computes Active Risk % from actual post-flow Account Equity.
- Performance consumers use `flowAdjustedEquityVnd` for return/drawdown/benchmark math.

- [ ] **Step 1: Write RED tests**

Assert:

```ts
// deposit does not create account return
accountTotalReturnPercent === 0
// withdrawal does not create drawdown
drawdown.maxDrawdownPercent === 0
// Active Risk denominator changes after deposit
activeRiskPercent === knownActiveRiskVnd / postFlowEquityVnd * 100
```

Assert dividend cash remains read from `portfolio_transactions` and is absent from the external-flow adapter.

- [ ] **Step 2: Run RED**

Run the new QEO-158 server/performance tests.

- [ ] **Step 3: Load cash-flow rows in both server contexts**

Select:

```text
id,portfolio_id,user_id,flow_type,signed_amount_vnd,effective_at,provenance
```

and map `effectiveDate` with the existing Vietnam date helper. Pass only rows effective at or before `now` to current snapshots; pass full dated history to the equity curve.

- [ ] **Step 4: Normalize performance consumers**

Create one helper accessor for performance equity and use it in account ledgers, drawdown analytics, and benchmark. Do not duplicate flow math in each consumer.

`accountTotalReturnPercent` is only available when `funding_history_status === 'known'`, opening capital is positive, and the last flow-adjusted point is complete.

- [ ] **Step 5: Run GREEN plus QEO-141/QEO-142 regressions**

Run the new tests plus existing risk engine, scorecard, ledgers, drawdown and benchmark tests.

- [ ] **Step 6: Commit**

```bash
git add modules/portfolio/risk-engine/server.ts modules/portfolio/performance tests/portfolio/qeo158-*.test.ts
git commit -m "feat(QEO-158): make risk and performance flow-aware"
```

### Task 4: Owner-scoped cash-flow API and opening-capital guard

**Files:**
- Create: `app/api/portfolio/[id]/cash-flows/route.ts`
- Modify: `app/api/portfolio/[id]/route.ts`
- Create: `tests/portfolio/qeo158-cash-flow-api.test.ts`

**Interfaces:**
- `GET /api/portfolio/[id]/cash-flows`
- `POST /api/portfolio/[id]/cash-flows`
- Existing `PATCH /api/portfolio/[id]` returns HTTP 409 for `initial_capital` mutation after transactions or cash flows exist.

- [ ] **Step 1: Write RED API contract tests**

Cover deposit positive sign, withdrawal negative sign, zero rejection, wrong sign rejection, invalid timestamp, note length, owner predicate, deterministic ordering, and opening-capital conflict.

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo158-cash-flow-api.test.ts
```

- [ ] **Step 3: Implement GET/POST**

Use `requireApiUser()`, UUID validation, no-store headers, owner-scoped queries, and no free-form note logging. Reject effective timestamps more than one day in the future while allowing backdated explicit flows.

- [ ] **Step 4: Guard initial-capital mutation**

Before applying a changed `initial_capital`, count both `portfolio_transactions` and `portfolio_external_cash_flows`. If either exists, return `409` with deterministic copy directing the user to external funding history.

- [ ] **Step 5: Run GREEN**

Run new API tests and existing portfolio API tests.

- [ ] **Step 6: Commit**

```bash
git add app/api/portfolio tests/portfolio/qeo158-cash-flow-api.test.ts
git commit -m "feat(QEO-158): add external funding API and capital guard"
```

### Task 5: Funding history UI and disclosures

**Files:**
- Create: `components/portfolio/risk-engine/external-cash-flow-panel.tsx`
- Create: `components/portfolio/risk-engine/use-external-cash-flows.ts`
- Modify: `components/portfolio/risk-engine/portfolio-risk-dashboard.tsx`
- Modify: `components/portfolio/portfolio-selector.tsx`
- Modify: `components/portfolio/performance/equity-drawdown-panel.tsx`
- Create: `tests/portfolio/qeo158-cash-flow-ui.test.ts`

**Interfaces:**
- Tài sản workspace exposes funding completeness, add-flow form, and history.
- Performance tooltip/copy discloses flow-adjusted Total P/L % is not TWR/MWR.

- [ ] **Step 1: Write RED UI contract**

Require UI strings/controls for:

```text
Dòng vốn ngoài
Nạp vốn
Rút vốn
Điều chỉnh vốn
Legacy · lịch sử vốn chưa đầy đủ
không tính vào Trading P/L
không phải TWR/MWR
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo158-cash-flow-ui.test.ts
```

- [ ] **Step 3: Implement read/write hook and compact panel**

Refresh rows after POST, show signed VND amounts and effective dates, and surface API validation errors inline. Do not add edit/delete controls.

- [ ] **Step 4: Update portfolio settings and performance disclosure**

Rename capital copy to opening capital and explain that later funding changes belong in Dòng vốn ngoài. Add the flow-adjusted return limitation near the existing Total P/L/equity UI.

- [ ] **Step 5: Run GREEN + responsive/static UI regressions**

Run QEO-158 UI contract plus QEO-139/QEO-141/QEO-142 UI contracts.

- [ ] **Step 6: Commit**

```bash
git add components/portfolio tests/portfolio/qeo158-cash-flow-ui.test.ts
git commit -m "feat(QEO-158): surface external funding history in portfolio"
```

### Task 6: Release gates, production migration, and reconciliation

**Files:**
- Create: `.github/workflows/qeo158-preprod.yml`
- Create: `docs/db/evidence/qeo158-external-cash-flow-production-2026-09-09.md`
- Modify/Create latest: `docs/db/evidence/production-migration-ledger-2026-09-09.json`
- Modify: `supabase/migration-equivalence.json` only if production/source versions differ

**Interfaces:**
- QEO-158 exact-head CI proves schema, equity, server/performance, API/UI, zero-state replay, generated types, TypeScript, lint, build, and QEO-141/QEO-142 regressions.

- [ ] **Step 1: Add focused QEO-158 workflow**

Use independent jobs for pure/domain tests and PostgreSQL zero-state replay so a UI failure cannot hide migration evidence.

- [ ] **Step 2: Require exact-head GREEN**

Do not apply production DDL until QEO-158 focused gates plus Verify/DB Drift/QEO-141/QEO-142 are green.

- [ ] **Step 3: Capture production pre-apply snapshot**

Record only counts/accounting totals and funding fields. Do not log transaction notes or journal content.

- [ ] **Step 4: Apply migration and reconcile**

Confirm production existing portfolio becomes `legacy_unrecorded`, external-flow row count remains zero, and raw transaction quantity/notional/fees are unchanged.

- [ ] **Step 5: Verify security/advisors and migration ledger**

Check RLS/policies/grants, generated types, migration drift ledger, and relevant Supabase security/performance advisors. Document any pre-existing unrelated findings separately.

- [ ] **Step 6: Merge/deploy acceptance**

After exact-head CI and production reconciliation are green, move QEO-158 to In Review, merge, verify Vercel production READY on the merge SHA, then mark QEO-158 Done.
