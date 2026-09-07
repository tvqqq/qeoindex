# QEO-138 Risk Profile, Discipline Profile + Money Management Plan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-portfolio Risk Profile, Discipline Profile, and immutable versioned Money Management Plan persistence/UI grounded in QEO-131, while preserving QEO-137 Trade/Fill snapshots and existing portfolio accounting.

**Architecture:** Add three ownership-safe Supabase tables plus a nullable plan-provenance FK on `portfolio_trades`. Keep scoring, plan validation, evidence aggregation, persistence and UI concerns separated under `modules/portfolio/risk-plan/*`; API routes remain thin adapters, and the existing `Phân bổ vốn` calculator stays behaviorally unchanged until QEO-139.

**Tech Stack:** Next.js 16.3, React 19, TypeScript 5.7, Supabase/Postgres + RLS, Node test runner, pnpm 10.28, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-07-qeo-138-risk-discipline-money-management-plan-design.md`

## Global Constraints

- Source authority is QEO-131. Primary canonical labels are English; Vietnamese is tooltip/help copy.
- Risk Profile and Discipline Profile each use six 5/10/15-point answers; software bands are exactly `30–45`, `50–65`, `70–90` and must be disclosed as product disambiguation.
- A low Risk Profile score never auto-authorizes `Risk per Trade > 2%`.
- McDowell values such as 2%, 6%, 10%, 10%/15% drawdown, seven stop-outs and 25 Trades are examples/presets, never silently persisted defaults.
- Profiles and Money Management Plans are per portfolio.
- Profile attempts and Money Management Plan versions are immutable history.
- Existing Trades retain entry-time risk snapshots; later plan versions never rewrite them.
- No legacy profile/plan/Trade provenance is fabricated.
- Existing `PortfolioCapitalAllocation` calculation behavior remains unchanged in QEO-138.
- UI calls authenticated API routes, not Supabase directly.
- Production promotion happens only after zero-to-latest replay, generated types, typecheck/build and exact-head CI are green.

---

### Task 1: QEO-138 schema, ownership, immutability and Trade plan provenance

**Files:**
- Create: `tests/portfolio/qeo138-risk-plan-schema.test.ts`
- Create: `supabase/migrations/20260907130000_qeo138_risk_plan.sql`
- Modify after replay generation only: `modules/shared/supabase/database.types.ts`
- Create: `.github/workflows/qeo138-preprod.yml`

**Interfaces:**
- Consumes: QEO-137 `portfolios(id,user_id)` ownership identity and `portfolio_trades(id,portfolio_id,user_id)`.
- Produces: `portfolio_risk_profile_attempts`, `portfolio_discipline_profile_attempts`, `portfolio_money_management_plans`, and nullable `portfolio_trades.money_management_plan_id`.

- [ ] **Step 1: Add a QEO-138 pre-production workflow before production code**

Create `.github/workflows/qeo138-preprod.yml` that runs, in order:

```yaml
name: QEO-138 Risk Plan
on:
  pull_request:
    paths:
      - "supabase/migrations/**"
      - "modules/portfolio/**"
      - "app/api/portfolio/**"
      - "components/portfolio/**"
      - "tests/portfolio/qeo138-*.test.ts"
      - ".github/workflows/qeo138-preprod.yml"
```

The job must run the six QEO-138 test files introduced by this plan, `tests/portfolio-pnl.test.ts`, `pnpm lint:touched`, local Supabase zero-to-latest replay, generated type verification/sync using the QEO-137 pattern, `pnpm typecheck`, and `pnpm build`.

- [ ] **Step 2: Write the failing schema contract**

The test reads the QEO-138 migration and asserts all of these strings/constraints exist:

```ts
assert.match(sql, /create table public\.portfolio_risk_profile_attempts/i)
assert.match(sql, /create table public\.portfolio_discipline_profile_attempts/i)
assert.match(sql, /create table public\.portfolio_money_management_plans/i)
assert.match(sql, /add column money_management_plan_id uuid/i)
assert.match(sql, /unique \(portfolio_id, version\)/i)
assert.match(sql, /enable row level security/i)
assert.match(sql, /revoke all .* anonymous/i)
```

Also assert profile point constraints only accept `5,10,15`, the six-point sum drives `total_score`, plan/profile ownership composite FKs exist, and authenticated UPDATE/DELETE is absent for attempt/plan history tables.

- [ ] **Step 3: Run RED**

Run through the PR workflow:

```bash
node --test tests/portfolio/qeo138-risk-plan-schema.test.ts
```

Expected: FAIL because `20260907130000_qeo138_risk_plan.sql` does not exist.

- [ ] **Step 4: Implement the additive migration**

Migration requirements:

```sql
create table public.portfolio_risk_profile_attempts (...);
create table public.portfolio_discipline_profile_attempts (...);
create table public.portfolio_money_management_plans (...);
alter table public.portfolio_trades add column money_management_plan_id uuid null;
```

Use `(portfolio_id,user_id) -> portfolios(id,user_id)` on both attempt tables and plan table. Use ownership-safe profile references from plan rows. Use `(money_management_plan_id,portfolio_id,user_id) -> portfolio_money_management_plans(id,portfolio_id,user_id)` on Trade. Enable RLS on all three new tables. Authenticated access is `SELECT + INSERT` only for profile attempts and plan versions. Service role remains unrestricted. No insert/backfill statement may create history rows for existing portfolios/Trades.

- [ ] **Step 5: Verify GREEN and DB replay**

Run:

```bash
node --test tests/portfolio/qeo138-risk-plan-schema.test.ts
supabase start
pnpm db:replay:verify
pnpm db:types:verify
```

Expected: schema contract and replay pass; generated-type verification may fail only because committed types are stale.

- [ ] **Step 6: Regenerate generated Supabase types from replay**

Use the existing CI candidate generation/sync pattern; do not hand-edit QEO-138 table typings.

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/qeo138-preprod.yml tests/portfolio/qeo138-risk-plan-schema.test.ts supabase/migrations/20260907130000_qeo138_risk_plan.sql modules/shared/supabase/database.types.ts
git commit -m "feat(qeo-138): add risk plan persistence schema"
```

---

### Task 2: Deterministic profile scoring and Money Management Plan validation

**Files:**
- Create: `tests/portfolio/qeo138-risk-plan-domain.test.ts`
- Create: `modules/portfolio/risk-plan/types.ts`
- Create: `modules/portfolio/risk-plan/scoring.ts`
- Create: `modules/portfolio/risk-plan/validation.ts`

**Interfaces:**
- Produces: `scoreProfile(points)`, `scoreRiskProfile(input)`, `scoreDisciplineProfile(input)`, `validateMoneyManagementPlan(input)` and typed rule groups from the approved spec.

- [ ] **Step 1: Write failing scoring tests**

Test exact deterministic bands:

```ts
assert.equal(scoreProfile([5,5,5,5,5,5]).band, "low")
assert.equal(scoreProfile([10,10,10,10,5,5]).total, 50)
assert.equal(scoreProfile([10,10,10,10,5,5]).band, "middle")
assert.equal(scoreProfile([15,15,10,10,10,10]).total, 70)
assert.equal(scoreProfile([15,15,10,10,10,10]).band, "high")
```

Reject any answer outside `5 | 10 | 15` and any answer array not length six.

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo138-risk-plan-domain.test.ts
```

Expected: FAIL because `modules/portfolio/risk-plan/scoring.ts` is missing.

- [ ] **Step 3: Implement the minimal pure scoring module**

Use:

```ts
export type ProfilePoint = 5 | 10 | 15
export type ProfileBand = "low" | "middle" | "high"

export function scoreProfile(points: readonly ProfilePoint[]) {
  const total = points.reduce((sum, point) => sum + point, 0)
  const band: ProfileBand = total < 50 ? "low" : total < 70 ? "middle" : "high"
  return { total, band }
}
```

Add source-mapped numeric helpers for 12-month return, Win Ratio and Payoff Ratio using the inequalities fixed in the spec.

- [ ] **Step 4: Add failing plan-validation tests**

Cover:

```ts
// >2% requires explicit advanced acknowledgement
assert.throws(() => validateMoneyManagementPlan({ defaultTradeRiskPercent: 2.5, advancedRiskOverrideAcknowledged: false, ...base }))
// pause threshold cannot be below reduce threshold
// enabled rules require thresholds
// factor must be 0 < factor < 1
// custom scale percentages sum to 100
// max active risk >= default trade risk
```

Also verify a low profile score never mutates plan risk:

```ts
const result = validateMoneyManagementPlan({ ...base, defaultTradeRiskPercent: 1.5 })
assert.equal(result.defaultTradeRiskPercent, 1.5)
```

- [ ] **Step 5: Run RED then implement validation GREEN**

Implement a focused `RiskPlanDomainError` with stable codes for invalid scores/rules. Do not add default values for disabled optional rules.

- [ ] **Step 6: Run GREEN**

```bash
node --test tests/portfolio/qeo138-risk-plan-domain.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add tests/portfolio/qeo138-risk-plan-domain.test.ts modules/portfolio/risk-plan
git commit -m "feat(qeo-138): add deterministic profile and plan domain"
```

---

### Task 3: Canonical closed-Trade metric evidence and explicit insufficient-history states

**Files:**
- Create: `tests/portfolio/qeo138-risk-profile-evidence.test.ts`
- Create: `modules/portfolio/risk-plan/evidence.ts`
- Modify: `modules/portfolio/risk-plan/types.ts`

**Interfaces:**
- Consumes: closed `portfolio_trades` plus linked `portfolio_transactions` fills.
- Produces: `buildRiskProfileEvidence({ trades, fills, periodEnd })` with `winRatio`, `payoffRatio`, `activeReturn12m` evidence entries.

- [ ] **Step 1: Write failing evidence tests**

Use one logical Trade with multiple fills to prove fills are not counted as separate Trades. Assert:

```ts
assert.equal(evidence.winRatio.sampleSize, 3)
assert.equal(evidence.winRatio.value, 2 / 3 * 100)
```

Use deterministic closed Trade net outcomes for two winners and one loser, then assert Payoff Ratio uses `avgWin / abs(avgLoss)`.

- [ ] **Step 2: Add insufficient-history tests**

Cases:

```ts
// no eligible closed Trade => insufficient
// closed Trade without complete linked fills => excluded + partial/insufficient
// no losing Trade => Payoff Ratio insufficient, never Infinity
// ungrouped legacy transactions => ignored
// 12m active return => unavailable when canonical equity history does not exist
```

The last rule is intentional: QEO-138 must not manufacture a 12-month return from `initial_capital` plus a single current snapshot.

- [ ] **Step 3: Run RED**

```bash
node --test tests/portfolio/qeo138-risk-profile-evidence.test.ts
```

- [ ] **Step 4: Implement evidence aggregation**

`buildRiskProfileEvidence` returns typed `ProfileMetricEvidence` with `source`, `value`, `periodStart`, `periodEnd`, `sampleSize`, `completeness`, and `computedAt`. Return `activeReturn12m.source = "unavailable"` until a canonical equity-history source exists.

- [ ] **Step 5: Run GREEN and AVCO regression**

```bash
node --test tests/portfolio/qeo138-risk-profile-evidence.test.ts
node --test tests/portfolio-pnl.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add tests/portfolio/qeo138-risk-profile-evidence.test.ts modules/portfolio/risk-plan/evidence.ts modules/portfolio/risk-plan/types.ts
git commit -m "feat(qeo-138): add profile metric evidence"
```

---

### Task 4: Authenticated persistence, immutable versions and Trade provenance freeze

**Files:**
- Create: `tests/portfolio/qeo138-risk-plan-server-api.test.ts`
- Create: `modules/portfolio/risk-plan/server.ts`
- Modify: `modules/portfolio/trades/validation.ts`
- Modify: `modules/portfolio/trades/server.ts`

**Interfaces:**
- Produces server functions:

```ts
listRiskProfileAttempts(context, portfolioId)
createRiskProfileAttempt(context, portfolioId, input)
listDisciplineProfileAttempts(context, portfolioId)
createDisciplineProfileAttempt(context, portfolioId, input)
listMoneyManagementPlans(context, portfolioId)
getCurrentMoneyManagementPlan(context, portfolioId)
createMoneyManagementPlanVersion(context, portfolioId, input)
getRiskPlanOverview(context, portfolioId)
```

- [ ] **Step 1: Write failing server-boundary tests**

Static/runtime contract tests must prove all queries are scoped by authenticated `user_id` + portfolio ownership and no server method exposes update/delete for profile attempts or plans.

- [ ] **Step 2: Write failing concurrency contract**

`createMoneyManagementPlanVersion` must allocate the next version atomically. Implement this with a transaction-safe database RPC, advisory lock, or equivalent DB-enforced operation; do not implement `select max(version) + 1` as an unprotected read-then-insert race.

- [ ] **Step 3: Run RED**

```bash
node --test tests/portfolio/qeo138-risk-plan-server-api.test.ts
```

- [ ] **Step 4: Implement authenticated persistence**

Reuse `ServerAuthContext` and existing ownership/error patterns. Persist exact user-confirmed point answers and evidence JSON. A Save creates a new plan row; no update path exists.

- [ ] **Step 5: Add Trade provenance to QEO-137 lifecycle validation**

While `status === "planned"`, `money_management_plan_id` may change. During `planned -> open`, it freezes together with initial risk snapshot fields. Attempts to change it after open return the existing frozen-snapshot conflict pattern.

- [ ] **Step 6: Run GREEN**

```bash
node --test tests/portfolio/qeo138-risk-plan-server-api.test.ts
node --test tests/portfolio/qeo137-trade-domain.test.ts
node --test tests/portfolio/qeo137-trade-api-contract.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add tests/portfolio/qeo138-risk-plan-server-api.test.ts modules/portfolio/risk-plan/server.ts modules/portfolio/trades
git commit -m "feat(qeo-138): add immutable risk plan persistence"
```

---

### Task 5: Thin authenticated API adapters

**Files:**
- Create: `app/api/portfolio/[id]/risk-plan/route.ts`
- Create: `app/api/portfolio/[id]/risk-plan/risk-profile/route.ts`
- Create: `app/api/portfolio/[id]/risk-plan/discipline-profile/route.ts`
- Create: `app/api/portfolio/[id]/risk-plan/plans/route.ts`
- Extend: `tests/portfolio/qeo138-risk-plan-server-api.test.ts`

**Interfaces:**
- GET overview: latest attempts + current plan + evidence completeness.
- POST Risk Profile attempt.
- POST Discipline Profile attempt.
- POST Money Management Plan version.

- [ ] **Step 1: Add failing thin-route contracts**

Assert every route uses `requireApiUser()` and delegates to `modules/portfolio/risk-plan/server.ts`. Route files must not call `.from("portfolio_*profile*")` or `.from("portfolio_money_management_plans")` directly.

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo138-risk-plan-server-api.test.ts
```

- [ ] **Step 3: Implement minimal routes**

Follow the existing QEO-137 route style: `runtime = "nodejs"`, `dynamic = "force-dynamic"`, `Cache-Control: no-store`, stable 400/404/409 domain error mapping, bounded 500 responses.

- [ ] **Step 4: Run GREEN**

```bash
node --test tests/portfolio/qeo138-risk-plan-server-api.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add app/api/portfolio/[id]/risk-plan tests/portfolio/qeo138-risk-plan-server-api.test.ts
git commit -m "feat(qeo-138): expose risk plan API"
```

---

### Task 6: Existing-theme Risk Profile, Discipline Profile and Money Management Plan UI

**Files:**
- Create: `tests/portfolio/qeo138-risk-plan-ui.test.ts`
- Create: `components/portfolio/portfolio-risk-plan.tsx`
- Create: `components/portfolio/risk-plan/risk-profile-form.tsx`
- Create: `components/portfolio/risk-plan/discipline-profile-form.tsx`
- Create: `components/portfolio/risk-plan/money-management-plan-form.tsx`
- Create: `components/portfolio/risk-plan/risk-term-tooltip.tsx`
- Modify: `components/portfolio/portfolio-page.tsx`
- Modify: `components/portfolio/portfolio-capital-allocation.tsx` only to compose the new panel alongside the existing calculator; do not change calculator math/defaults in this task.

**Interfaces:**
- Consumes QEO-138 APIs only.
- Produces an existing-theme risk-planning surface inside `Phân bổ vốn`.

- [ ] **Step 1: Write failing UI contract tests**

Static/UI contracts assert canonical English labels exist:

```text
Risk Profile
Discipline Profile
Money Management Plan
Win Ratio
Payoff Ratio
Risk per Trade
Max Active Risk
Account Drawdown
```

and every metric/rule label uses the shared tooltip component with Vietnamese help text. Assert copy does not contain `triệt tiêu hoàn toàn nguy cơ`, `zero risk`, or any statement that a low profile score permits higher risk automatically.

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo138-risk-plan-ui.test.ts
```

- [ ] **Step 3: Implement the shell and loading/error states**

`PortfolioRiskPlan` fetches `/api/portfolio/${portfolioId}/risk-plan` whenever the selected portfolio changes and renders latest scores/current plan/last updated. Preserve existing cards, borders, fonts and color tokens.

- [ ] **Step 4: Implement Risk Profile form**

Render six source-aligned questions. For Win Ratio/Payoff Ratio evidence, display the value plus sample/period/completeness and let the user confirm/select the corresponding 5/10/15 answer. If evidence is insufficient, show `Insufficient History` and require manual answer; never display zero as a substitute.

- [ ] **Step 5: Implement Discipline Profile form**

Render six 5/10/15 choices with respectful neutral Vietnamese explanations. Do not ship left-brain/right-brain copy.

- [ ] **Step 6: Implement Money Management Plan form**

Include explicit editable sections for Risk per Trade, Max Active Risk, drawdown reduce/pause, stop-out/rolling window, holiday rules, execution rules, scaling, diversification and optional risk-capital policy. Values above 2% require an explicit acknowledgement control before Save.

- [ ] **Step 7: Run GREEN, lint and typecheck**

```bash
node --test tests/portfolio/qeo138-risk-plan-ui.test.ts
pnpm lint:touched
pnpm typecheck
```

- [ ] **Step 8: Commit**

```bash
git add components/portfolio tests/portfolio/qeo138-risk-plan-ui.test.ts
git commit -m "feat(qeo-138): add portfolio risk planning UI"
```

---

### Task 7: Read-model integration, regression, production acceptance and evidence

**Files:**
- Create: `tests/portfolio/qeo138-risk-plan-read-model.test.ts`
- Modify: `modules/portfolio/trades/read-model.ts`
- Create: `docs/db/evidence/qeo138-risk-plan-production-2026-09-07.md` only after production promotion/readback.
- Modify after production promotion: `supabase/migration-equivalence.json`
- Modify after production promotion: latest production migration ledger under `docs/db/evidence/`.

**Interfaces:**
- Produces nullable `moneyManagementPlanId`/plan provenance in deterministic Trade read facts without fetching current-plan UI state.

- [ ] **Step 1: Write failing read-model contract**

Assert a Trade read model exposes its entry-time `money_management_plan_id` as nullable provenance and that `null` remains `unknown/unavailable`, never remapped to the current plan.

- [ ] **Step 2: Run RED then implement GREEN**

```bash
node --test tests/portfolio/qeo138-risk-plan-read-model.test.ts
node --test tests/portfolio/qeo137-trade-read-model.test.ts
```

- [ ] **Step 3: Run exact pre-production gate**

Require all of:

```bash
node --test tests/portfolio/qeo138-risk-plan-schema.test.ts
node --test tests/portfolio/qeo138-risk-plan-domain.test.ts
node --test tests/portfolio/qeo138-risk-profile-evidence.test.ts
node --test tests/portfolio/qeo138-risk-plan-server-api.test.ts
node --test tests/portfolio/qeo138-risk-plan-ui.test.ts
node --test tests/portfolio/qeo138-risk-plan-read-model.test.ts
node --test tests/portfolio-pnl.test.ts
pnpm lint:touched
pnpm db:replay:verify
pnpm db:types:verify
pnpm typecheck
pnpm build
```

- [ ] **Step 4: Production preflight**

Confirm production does not yet contain QEO-138 tables/Trade column and record existing row counts. Do not apply migration if branch/head differs from the green exact-head.

- [ ] **Step 5: Promote the exact committed migration**

Apply the exact SQL already replayed by CI. Do not hand-edit SQL in production.

- [ ] **Step 6: Production readback**

Verify:

```text
new profile attempt rows = 0
new money-management plan rows = 0
existing portfolio/trade/transaction counts unchanged
existing Trades have money_management_plan_id IS NULL
RLS enabled
attempt/plan authenticated privileges are SELECT+INSERT only
all ownership FKs/indexes exist
```

Run Supabase security and performance advisors and fix only QEO-138 findings before acceptance.

- [ ] **Step 7: Reconcile migration evidence**

Map repository migration version to the actual production migration version in `supabase/migration-equivalence.json`, update production ledger, and write `docs/db/evidence/qeo138-risk-plan-production-2026-09-07.md` with no-fabricated-history, RLS/privilege/index/advisor evidence.

- [ ] **Step 8: Final exact-head verification**

Require `Verify`, `DB Drift Reconciliation`, `EOD v4`, and `QEO-138 Risk Plan` workflows GREEN on the same final head.

- [ ] **Step 9: PR/Linear handoff**

Mark the QEO-138 PR ready for review and move Linear QEO-138 to `In Review`. Do not mark Done before source integration into `main`/the accepted base.
