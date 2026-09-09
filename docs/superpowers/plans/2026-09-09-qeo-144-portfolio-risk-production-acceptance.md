# QEO-144 Portfolio/Risk Production Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic local acceptance harness plus real-browser evidence that proves the complete QEO-136 Portfolio/Risk core works together, then perform exact-head and production acceptance without fabricating production data.

**Architecture:** Add a synthetic local-only QEO-144 fixture, independent reconciliation tests, a QEO-131 terminology/accessibility contract, and a minimal Playwright Chromium harness that runs the real `/portfolio` application against local Supabase. Keep acceptance infrastructure separate from application domain logic; any production code change is allowed only when an acceptance test exposes a real P0/P1 defect or source-fidelity gap.

**Tech Stack:** Next.js 16.3, React 19, TypeScript 5.7, Node 22 test runner, Supabase CLI/local Postgres, `@supabase/supabase-js`, Playwright Chromium, GitHub Actions, Vercel.

**Spec:** `docs/superpowers/specs/2026-09-09-qeo-144-portfolio-risk-production-acceptance-design.md`

## Global Constraints

- QEO-144 is acceptance work, not a new Portfolio/Risk feature.
- Deterministic non-AI core only; QEO-145/QEO-157 stay out of scope.
- Never seed/fabricate production user data.
- Synthetic fixture is local/preprod-only and idempotent.
- Live/paper isolation is mandatory.
- `Risk Unknown` and `UNKNOWN` remain explicit; never coerce missing evidence to zero/safe.
- Money Management Plan rules are authoritative; no silent universal thresholds.
- QEO-141 remains source of Active Risk; QEO-139 sizing formulas remain unchanged.
- External flows remain distinct from trading P/L.
- QEO-131 terminology rules are acceptance criteria: prefer `Trade Size`; compact `Initial Stop` / `Risk per Share` aliases must preserve source terminology in help text.
- No generalized exact Risk-of-Ruin probability from incomplete source evidence.
- No QEO-144 DB migration is expected. If a durable schema change appears necessary, stop and review architecture before DDL.

---

### Task 1: Add the Browser Acceptance Toolchain

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `playwright.config.ts`
- Create: `tests/browser/qeo144-auth.ts`
- Create: `tests/portfolio/qeo144-browser-harness-contract.test.ts`
- Modify: `tests/test-contracts.json`

**Interfaces:**
- Consumes: local app at `QEO144_BASE_URL` (default `http://127.0.0.1:3000`) and local credentials `QEO144_TEST_EMAIL` / `QEO144_TEST_PASSWORD`.
- Produces: Playwright `chromium` project named `desktop` and `mobile`; helper `loginQeo144(page)`.

- [ ] **Step 1: Write the failing harness contract**

Create `tests/portfolio/qeo144-browser-harness-contract.test.ts` that reads `package.json`, `playwright.config.ts`, and `tests/browser/qeo144-auth.ts` and asserts:

```ts
assert.equal(pkg.devDependencies?.["@playwright/test"] != null, true)
assert.match(config, /name:\s*["']desktop["']/)
assert.match(config, /name:\s*["']mobile["']/)
assert.match(config, /trace:\s*["']retain-on-failure["']/)
assert.match(authHelper, /QEO144_TEST_EMAIL/)
assert.match(authHelper, /QEO144_TEST_PASSWORD/)
assert.match(authHelper, /page\.getByLabel\([^)]*email/i)
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo144-browser-harness-contract.test.ts
```

Expected: FAIL because Playwright config/helper/dependency do not exist.

- [ ] **Step 3: Add Playwright and scripts**

Run:

```bash
pnpm add -D @playwright/test
```

Add package scripts:

```json
"test:qeo144": "node --test tests/portfolio/qeo144-*.test.ts",
"test:qeo144:browser": "playwright test tests/browser/qeo144-portfolio.spec.ts"
```

Create `playwright.config.ts` with:

```ts
import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: process.env.QEO144_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"] } },
  ],
})
```

Create `loginQeo144(page)` that opens `/`, fills the login form by accessible email/password labels, submits, waits for authenticated navigation, then opens `/portfolio`.

- [ ] **Step 4: Add the Node contract to the canonical test manifest and run GREEN**

```bash
node --test tests/portfolio/qeo144-browser-harness-contract.test.ts
pnpm test:manifest
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml playwright.config.ts tests/browser/qeo144-auth.ts tests/portfolio/qeo144-browser-harness-contract.test.ts tests/test-contracts.json
git commit -m "test(QEO-144): add portfolio browser acceptance harness"
```

---

### Task 2: Build the Local-Only Acceptance Fixture

**Files:**
- Create: `scripts/portfolio/qeo144-create-local-user.mjs`
- Create: `scripts/portfolio/qeo144-seed-local.sh`
- Create: `tests/portfolio/qeo144-acceptance-fixture.sql`
- Create: `tests/portfolio/qeo144-acceptance-fixture.test.ts`
- Modify: `tests/test-contracts.json`

**Interfaces:**
- Consumes: `API_URL`, `SERVICE_ROLE_KEY`, local Docker DB container `supabase_db_qeoindex`.
- Produces: local auth account `qeo144-acceptance@example.invalid` / `Qeo144!LocalOnly`, its bootstrap portfolio, and deterministic acceptance rows.

Use fixed fixture record UUIDs prefixed by scenario semantics in comments and fixed UTC dates from `2026-08-01` through `2026-08-31`. The auth user UUID may be generated by Supabase Admin API; all domain rows locate the portfolio by the emitted user UUID.

Required scenario map in `qeo144-acceptance-fixture.sql`:

| Scenario | Ticker | Mode | Required state |
| --- | --- | --- | --- |
| planned no fill | FPT | live | Trade status planned, no fills |
| open initial stop | HPG | live | positive open qty + initial stop |
| multi scale-in | MWG | live | >=2 entry fills in one Trade |
| partial scale-out | VNM | live | buy fills + partial exit, trade still open/partial |
| closed winner | ACB | live | one logical closed winning Trade |
| closed loser | SSI | live | one logical closed losing Trade |
| trailed stop | MSN | live | initial stop + later stop event |
| risk unknown | UNKNOWNSTOP | live | open position, no valid stop |
| legacy migrated | LEGACY | live | migration provenance/legacy completeness state |
| paper isolation | PAPER | paper | valid Trade excluded from live calculations |
| known sector breach | VIC | live | structured sector + configured hard sector rule breached |
| unknown sector | QEOUNK | live | no canonical structured sector classification |

Also seed:

```text
Money Management Plan:
- defaultTradeRiskPercent = 1
- maxActiveRiskPercent = 6
- diversificationRules.enabled = true
- concentrationWarningPercent = 20
- maxTickerConcentrationPercent = 30
- maxSectorRiskPercent = 4
- maxConcurrentOpenPositions = 8

External flows:
- +100,000,000 VND deposit on 2026-08-05
- -20,000,000 VND withdrawal on 2026-08-20
```

- [ ] **Step 1: Write RED fixture contract**

`qeo144-acceptance-fixture.test.ts` must parse the SQL/source files and assert every required scenario/ticker, both flow types, `live` + `paper`, and all configured diversification rule keys are present. It must also assert the seed shell contains a safety guard rejecting non-local API URLs:

```ts
assert.match(seedShell, /127\.0\.0\.1|localhost/)
assert.match(seedShell, /refus|abort|exit 1/i)
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo144-acceptance-fixture.test.ts
```

Expected: FAIL because fixture/seeding infrastructure does not exist.

- [ ] **Step 3: Implement local auth creation and safety guard**

`qeo144-create-local-user.mjs` uses `createClient(API_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })`, reuses the user by email if present, otherwise calls:

```js
supabase.auth.admin.createUser({
  email: "qeo144-acceptance@example.invalid",
  password: "Qeo144!LocalOnly",
  email_confirm: true,
  user_metadata: { display_name: "QEO-144 Acceptance Fixture" },
})
```

Print only the user UUID to stdout.

`qeo144-seed-local.sh` must refuse execution unless `API_URL` points to localhost/127.0.0.1, call the Node helper, then execute:

```bash
docker exec -i "${QEO144_DB_CONTAINER:-supabase_db_qeoindex}" \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 -v qeo144_user_id="$USER_ID" -f - \
  < tests/portfolio/qeo144-acceptance-fixture.sql
```

- [ ] **Step 4: Implement idempotent SQL fixture**

Use `:'qeo144_user_id'::uuid`, select the bootstrap portfolio owned by that user, delete only rows owned by that user and tagged/provenanced as QEO-144 fixture data, then insert the scenario matrix. Never truncate shared tables.

- [ ] **Step 5: Run GREEN and local replay/seed smoke**

```bash
node --test tests/portfolio/qeo144-acceptance-fixture.test.ts
supabase start
pnpm db:replay:verify
eval "$(supabase status -o env | sed 's/^/export /')"
API_URL="$API_URL" SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" bash scripts/portfolio/qeo144-seed-local.sh
supabase stop --no-backup
```

Expected: fixture contract PASS; replay/seed exits 0.

- [ ] **Step 6: Commit**

```bash
git add scripts/portfolio/qeo144-create-local-user.mjs scripts/portfolio/qeo144-seed-local.sh tests/portfolio/qeo144-acceptance-fixture.sql tests/portfolio/qeo144-acceptance-fixture.test.ts tests/test-contracts.json
git commit -m "test(QEO-144): add deterministic portfolio acceptance fixture"
```

---

### Task 3: Add Independent Formula and Accounting Reconciliation

**Files:**
- Create: `tests/portfolio/qeo144-formula-reconciliation.test.ts`
- Create: `tests/portfolio/qeo144-flow-and-accounting-reconciliation.test.ts`
- Modify only if acceptance exposes a real bug: existing `modules/portfolio/**`
- Modify: `tests/test-contracts.json`

**Interfaces:**
- Consumes: primitive fixture values and public deterministic functions from QEO-139/QEO-141/QEO-142/QEO-158/QEO-159.
- Produces: one acceptance matrix proving expected math independently.

- [ ] **Step 1: Write RED independent calculations**

Use helper calculations defined inside the acceptance test, not imported from production implementation:

```ts
const expectedRiskAmount = (equity: number, riskPercent: number) => equity * riskPercent / 100
const expectedTradeSize = (riskAmount: number, commission: number, slippage: number, entryKvnd: number, stopKvnd: number) =>
  Math.floor((riskAmount - commission - slippage) / (Math.abs(entryKvnd - stopKvnd) * 1_000))
const expectedWinRatio = (wins: number, closed: number) => wins / closed
const expectedPayoff = (avgWin: number, avgLossMagnitude: number) => avgWin / avgLossMagnitude
```

Assert at minimum:

- 100,000,000 equity × 1% = 1,000,000 Risk Amount;
- wider stop produces strictly smaller Trade Size with same equity/risk/cost assumptions;
- multi-fill MWG counts once in closed-trade outcome statistics;
- VNM partial exit does not count as closed outcome;
- `UNKNOWNSTOP` risk stays unknown, not 0;
- paper `PAPER` row is excluded from live read model;
- Commission Ratio is `null`/N/A when gross profit <=0;
- Payoff Ratio uses positive loss magnitude;
- external +100m/-20m flow does not appear as trading P/L;
- flow-adjusted return/drawdown does not treat deposit/withdrawal as performance;
- VIC configured concentration/sector rule can breach;
- QEOUNK sector check is `UNKNOWN`;
- a planned trade can breach projected ticker/sector/open-position rule without changing QEO-139 quantity.

- [ ] **Step 2: Run RED against current production functions**

```bash
node --test tests/portfolio/qeo144-formula-reconciliation.test.ts tests/portfolio/qeo144-flow-and-accounting-reconciliation.test.ts
```

Expected: tests either PASS immediately (existing implementation already satisfies contract) or expose an exact reconciliation gap. A RED caused by missing acceptance plumbing is fixed in test infrastructure; a RED caused by wrong domain behavior is treated as a real QEO-144 defect and fixed minimally with a regression assertion.

- [ ] **Step 3: Fix only proven defects**

Do not refactor unrelated modules. For every production-code correction, add the smallest focused regression to the owning QEO test (137/138/139/141/142/143/158/159) in addition to the QEO-144 acceptance assertion.

- [ ] **Step 4: Run GREEN plus owning regressions**

```bash
node --test tests/portfolio/qeo144-formula-reconciliation.test.ts tests/portfolio/qeo144-flow-and-accounting-reconciliation.test.ts
pnpm test:current
```

- [ ] **Step 5: Commit**

```bash
git add tests/portfolio/qeo144-formula-reconciliation.test.ts tests/portfolio/qeo144-flow-and-accounting-reconciliation.test.ts tests/test-contracts.json modules/portfolio tests/portfolio
git commit -m "test(QEO-144): reconcile portfolio formulas and accounting"
```

---

### Task 4: Lock QEO-131 Terminology and Tooltip Accessibility

**Files:**
- Create: `tests/portfolio/qeo144-source-fidelity.test.ts`
- Modify only where test proves a gap: `components/portfolio/**`
- Modify only where shared tooltip semantics need correction: existing shared tooltip/help component used by Portfolio
- Modify: `tests/test-contracts.json`

**Interfaces:**
- Consumes: QEO-131 terminology contract and actual Portfolio component source.
- Produces: source-fidelity precondition for browser tests.

- [ ] **Step 1: Write RED terminology contract**

Assert that actual rendered Portfolio component source contains the canonical set and Vietnamese explanation/help affordances. At minimum verify:

```text
Account Equity
Risk per Trade
Risk Amount
Initial Stop
Risk per Share
Trade Size
Active Risk
Max Active Risk
Remaining Risk Budget
Drawdown
Win Ratio
Payoff Ratio
Commission Ratio
Risk Profile
Discipline Profile
Trading Scorecard
Trade Posting Card
```

Also assert:

- `Trade Size` is preferred over `Position Size` on the sizing surface;
- help text distinguishes book formula from `Slippage Allowance`, Active Risk and drawdown product extensions;
- `Risk Unknown` caveat exists;
- no exact generalized ROR probability claim exists;
- tooltip/help trigger is a focusable interactive element (`button` or equivalent accessible trigger) and not color-only.

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo144-source-fidelity.test.ts
```

- [ ] **Step 3: Make minimal UI/copy/accessibility fixes**

Preserve current dark theme/layout. Do not redesign `/portfolio`. Prefer updating labels/tooltips/ARIA over restructuring components.

- [ ] **Step 4: Run GREEN plus QEO UI regressions**

```bash
node --test tests/portfolio/qeo144-source-fidelity.test.ts \
  tests/portfolio/qeo138-risk-plan-ui.test.ts \
  tests/portfolio/qeo139-trade-size-ui.test.ts \
  tests/portfolio/qeo141-risk-ui.test.ts \
  tests/portfolio/qeo142-performance-ui.test.ts \
  tests/portfolio/qeo159-concentration-ui.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add tests/portfolio/qeo144-source-fidelity.test.ts tests/test-contracts.json components/portfolio
git commit -m "test(QEO-144): enforce McDowell source fidelity"
```

---

### Task 5: Add Local Postgres Fixture Reconciliation

**Files:**
- Create: `tests/portfolio/qeo144-acceptance.integration.sql`
- Create: `scripts/portfolio/verify-qeo144-acceptance.sh`

**Interfaces:**
- Consumes: seeded local QEO-144 user/portfolio.
- Produces: database-level proof that fixture lifecycle/accounting rows reconcile and live/paper/legacy/flow records remain distinguishable.

- [ ] **Step 1: Write integration SQL assertions**

Use `DO $$ ... RAISE EXCEPTION ... $$` checks to prove:

- exactly one QEO-144 live fixture portfolio owner context;
- planned FPT has no fill;
- MWG has >=2 entry fills but one logical Trade;
- VNM remains partial/open after a scale-out;
- ACB is winner and SSI is loser;
- MSN has a later stop event than initial stop;
- UNKNOWNSTOP has no usable stop evidence;
- PAPER rows are paper mode and not mixed into live fixture counts;
- external flow rows sum to +80,000,000 VND while deposit=+100m and withdrawal=-20m remain separate events;
- diversification JSON contains all configured QEO-159 rules;
- QEOUNK has no structured classification fixture inserted by QEO-144.

- [ ] **Step 2: Create verifier shell**

Follow the established QEO-143 pattern:

```bash
#!/usr/bin/env bash
set -euo pipefail
DB_CONTAINER="${QEO144_DB_CONTAINER:-supabase_db_qeoindex}"
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - \
  < tests/portfolio/qeo144-acceptance.integration.sql
```

- [ ] **Step 3: Run integration gate**

```bash
supabase start
pnpm db:replay:verify
eval "$(supabase status -o env | sed 's/^/export /')"
API_URL="$API_URL" SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" bash scripts/portfolio/qeo144-seed-local.sh
bash scripts/portfolio/verify-qeo144-acceptance.sh
supabase stop --no-backup
```

Expected: PASS without modifying production schema/data.

- [ ] **Step 4: Commit**

```bash
git add tests/portfolio/qeo144-acceptance.integration.sql scripts/portfolio/verify-qeo144-acceptance.sh
git commit -m "test(QEO-144): reconcile acceptance fixture in Postgres"
```

---

### Task 6: Exercise the Real `/portfolio` Flow in Chromium

**Files:**
- Create: `tests/browser/qeo144-portfolio.spec.ts`
- Modify only if browser test exposes a real UI bug: `components/portfolio/**`, `app/portfolio/**`

**Interfaces:**
- Consumes: local Supabase fixture, `loginQeo144(page)`, running Next.js app.
- Produces: desktop/mobile screenshots and Playwright traces on failure; real interactive evidence.

- [ ] **Step 1: Write browser tests**

Create named tests so CI evidence maps directly to QEO-144 acceptance:

```ts
test("Tài sản shows Active Risk, Risk Unknown and concentration evidence", async ({ page }) => {})
test("Nhật ký preserves one Trade Card across fills, stops and lifecycle", async ({ page }) => {})
test("Phân bổ vốn is stop-first and shows projected risk/concentration", async ({ page }) => {})
test("Hiệu suất reconciles scorecard/ledger and live-paper filter", async ({ page }) => {})
test("McDowell help works by desktop focus and mobile tap", async ({ page }, testInfo) => {})
```

Required browser assertions:

- authenticated `/portfolio` loads;
- each major tab is reachable by accessible role/name;
- `Active Risk` and `Risk Unknown` are visible where fixture requires;
- known concentration breach is visibly differentiated with text/icon, not color alone;
- unknown classification visibly says UNKNOWN/không đủ phân loại and does not guess sector;
- Trade Card lifecycle shows multiple MWG fills within one card/campaign;
- planned FPT remains planned until user explicitly persists/executes;
- sizing requires Initial Stop before valid Trade Size;
- projected conflict is advisory;
- override path asks for reason before planned Trade persistence when warning/breach exists;
- live/paper switching excludes PAPER from live metrics;
- desktop help trigger works by keyboard focus/Enter or hover;
- mobile help trigger works by tap;
- `Commission Ratio` N/A state is explicit when applicable.

Take explicit screenshots at the end of the four tab tests into `testInfo.outputPath(...)` so they are uploaded with Playwright artifacts.

- [ ] **Step 2: Run browser RED/GREEN locally**

```bash
supabase start
eval "$(supabase status -o env | sed 's/^/export /')"
API_URL="$API_URL" SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" bash scripts/portfolio/qeo144-seed-local.sh
export NEXT_PUBLIC_SUPABASE_URL="$API_URL"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY"
export QEO144_TEST_EMAIL="qeo144-acceptance@example.invalid"
export QEO144_TEST_PASSWORD="Qeo144!LocalOnly"
pnpm build
pnpm start &
APP_PID=$!
pnpm exec playwright install chromium
pnpm test:qeo144:browser
kill "$APP_PID"
supabase stop --no-backup
```

- [ ] **Step 3: Fix only browser-proven defects and rerun**

Any production code change must have an owning Node regression in addition to the browser assertion.

- [ ] **Step 4: Commit**

```bash
git add tests/browser/qeo144-portfolio.spec.ts components/portfolio app/portfolio tests/portfolio
git commit -m "test(QEO-144): add portfolio end-to-end browser acceptance"
```

---

### Task 7: Add the QEO-144 CI Acceptance Gate

**Files:**
- Create: `.github/workflows/qeo144-preprod.yml`
- Modify: `tests/test-contracts.json` if new Node tests are not yet registered

**Interfaces:**
- Consumes: Tasks 1-6.
- Produces: exact-head GitHub Actions gate `QEO-144 Portfolio Risk Acceptance` with Node, Postgres and browser jobs/artifacts.

- [ ] **Step 1: Write workflow with three jobs**

`contract-and-formulas`:

```bash
pnpm install --frozen-lockfile
pnpm test:qeo144
pnpm test:manifest
pnpm lint
pnpm typecheck
pnpm build
```

`postgres-acceptance`:

```bash
supabase start
pnpm db:replay:verify
eval "$(supabase status -o env | sed 's/^/export /')"
API_URL="$API_URL" SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" bash scripts/portfolio/qeo144-seed-local.sh
bash scripts/portfolio/verify-qeo144-acceptance.sh
```

`browser-acceptance`:

```bash
supabase start
eval "$(supabase status -o env | sed 's/^/export /')"
API_URL="$API_URL" SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" bash scripts/portfolio/qeo144-seed-local.sh
pnpm exec playwright install --with-deps chromium
NEXT_PUBLIC_SUPABASE_URL="$API_URL" NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY" pnpm build
NEXT_PUBLIC_SUPABASE_URL="$API_URL" NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY" pnpm start &
pnpm test:qeo144:browser
```

Always stop Supabase. Upload `playwright-report/` and `test-results/` with `actions/upload-artifact@v4` using `if: always()`.

Workflow path filters must include QEO-144 tests/scripts, Portfolio application/domain files, migrations, package files, Playwright config and the workflow itself.

- [ ] **Step 2: Run static workflow contract**

Extend `qeo144-browser-harness-contract.test.ts` to assert the workflow contains all three jobs, local Supabase, Playwright Chromium install, artifact upload, lint/typecheck/build and no production Supabase project id/URL.

- [ ] **Step 3: Run GREEN**

```bash
pnpm test:qeo144
pnpm test:manifest
```

- [ ] **Step 4: Commit and open draft PR**

```bash
git add .github/workflows/qeo144-preprod.yml tests/portfolio/qeo144-browser-harness-contract.test.ts tests/test-contracts.json
git commit -m "ci(QEO-144): gate portfolio production acceptance"
```

Open a draft PR to `main` linked to QEO-144.

---

### Task 8: Exact-Head Regression, Production Acceptance and Parent Closure

**Files:**
- Create: `docs/db/evidence/qeo144-portfolio-risk-production-acceptance-2026-09-09.md`
- Update only if evidence requires: QEO-144/QEO-136 Linear descriptions/comments/statuses

**Interfaces:**
- Consumes: exact PR head and merged production deployment.
- Produces: auditable acceptance evidence and closure decision.

- [ ] **Step 1: Require exact-head workflow success**

Before merge, verify on the same PR head SHA:

```text
Verify
DB Drift (when triggered/applicable)
QEO-137 Trade Domain
QEO-138 Risk Plan
QEO-139 Risk Sizing
QEO-141 Portfolio Risk Engine
QEO-142 Performance Preprod
QEO-143 Legacy Migration
QEO-158 External Cash Flows
QEO-159 Concentration Guardrails
QEO-144 Portfolio Risk Acceptance
```

No stale green run from an older head is accepted.

- [ ] **Step 2: Review browser artifacts and defect severity**

Treat wrong sizing/P&L/trade grouping/risk state/migration as P0/P1 blockers. Do not close QEO-144 while any P0/P1 remains. Cosmetic gaps can be documented and deferred only when they do not violate QEO-131 accessibility/source-fidelity acceptance.

- [ ] **Step 3: Record pre-merge evidence**

Evidence doc must list:

- exact feature SHA;
- workflow run IDs/conclusions;
- controlled fixture scenario matrix;
- independent expected vs actual formula table;
- browser desktop/mobile artifact names;
- migration replay result;
- known limitations and any deferred non-core/UI work.

- [ ] **Step 4: Merge using expected-head guard**

Merge only after all required exact-head gates are terminal success and PR review has no unresolved P0/P1 issue.

- [ ] **Step 5: Verify Git-triggered production deployment**

Do not create a duplicate manual deployment if Vercel Git integration already deployed the merge SHA. Verify:

- `main` == merge SHA;
- Vercel target `production`, state `READY`, exact `githubCommitSha`;
- canonical alias includes `qeoindex.qeoqeo.com`;
- canonical domain HTTP 200/auth shell;
- production build completed;
- no error/fatal runtime logs in post-deploy window;
- production migration ledger/schema matches expected state.

- [ ] **Step 6: Perform truthful production read-only smoke**

Use existing real production rows only. If production lacks a row required for a scenario (for example configured concentration rules), state that the scenario was proven by controlled acceptance fixture and was not observed on real production data. Never insert synthetic production rows for acceptance.

- [ ] **Step 7: Close QEO-144 and update QEO-136**

Comment QEO-144 with exact merge/deployment/evidence. Mark Done only when completion criteria pass.

Update QEO-136 with:

- accepted deterministic architecture across QEO-137→143/158/159;
- final schema/migration state;
- canonical sizing/risk/performance/concentration formulas;
- source-fidelity terminology decisions;
- external-flow normalization behavior;
- known limitations (`Risk Unknown`, unknown classification, incomplete ROR source, fixture-only acceptance cases);
- explicit note that AI remains deferred to QEO-157.

If all deterministic children are Done and QEO-144 is accepted, mark QEO-136 Done.

- [ ] **Step 8: Final verification**

Freshly re-read QEO-144 and QEO-136 after status changes and verify they reflect the actual evidence; do not claim closure from mutation success alone.