# QEO-144 Portfolio/Risk Production Acceptance Design

## Objective

QEO-144 is the final deterministic-core acceptance gate for QEO-136. It does not add a new Portfolio/Risk feature. It proves that QEO-137, QEO-138, QEO-139, QEO-140, QEO-141, QEO-142, QEO-143, QEO-158 and QEO-159 work together without P0/P1 correctness regressions and that the shipped `/portfolio` UX remains source-faithful to QEO-131.

## Locked constraints

- Deterministic non-AI core only. QEO-157/QEO-145 AI work stays out of scope.
- Never fabricate production user data to make an acceptance scenario pass.
- Acceptance fixture data is synthetic and local/preprod-only.
- Live and paper data remain isolated.
- Historical/already-executed fills are never blocked by planning guardrails.
- Missing stop remains `Risk Unknown`, never numeric zero.
- Missing sector/classification remains `UNKNOWN`, never guessed.
- User Money Management Plan is authoritative; no silent universal diversification/risk threshold.
- QEO-141 remains the source of Active Risk; QEO-139 sizing formulas remain unchanged.
- External cash flow is distinct from trading P/L and must not manufacture return/drawdown.
- Canonical English metric labels + Vietnamese help/tooltip copy follow QEO-131. Prefer `Trade Size`; `Initial Stop` and `Risk per Share` are compact aliases for the source terms.
- Do not claim generalized exact Risk of Ruin probability from the incomplete source table.

## Acceptance architecture

### 1. Controlled synthetic fixture

Create one deterministic fixture that can be loaded into a local Supabase instance after migration replay. It owns fixed UUIDs and dates and must cover at minimum:

1. planned trade with no fill;
2. open trade with initial stop;
3. multi-fill scale-in trade;
4. partially scaled-out trade;
5. closed winner;
6. closed loser;
7. trailed-stop trade;
8. open/legacy position without stop (`Risk Unknown`);
9. legacy migrated sequence;
10. separate live and paper records;
11. external deposit and withdrawal;
12. configured ticker/sector concentration breach;
13. ticker with no structured sector classification;
14. auditable planning override.

The fixture is test infrastructure, not application seed data. It must be idempotent and must never target the production Supabase project.

### 2. Independent deterministic reconciliation

Create QEO-144 acceptance tests that calculate expected values from primitive fixture inputs rather than copying service output back into assertions. Reconcile:

- Risk Amount = Account Equity × Risk %;
- Trade Size including commission and product Slippage Allowance;
- wider stop => smaller Trade Size at equal risk;
- projected Active Risk after planned trade;
- Win Ratio;
- Payoff Ratio using losing-trade magnitude;
- Commission Ratio and `N/A` when gross profit is non-positive;
- average/largest win and loss;
- consecutive-loss streak;
- rolling-25 P/L behavior;
- max drawdown and total P/L %;
- flow-adjusted return/drawdown;
- ticker market-value concentration;
- ticker Active Risk contribution;
- sector Active Risk concentration;
- projected concentration and open-position conflicts.

The acceptance test may call production domain/read-model functions, but expected results must be derived independently from fixture primitives.

### 3. Source-fidelity contract

Create a focused terminology/accessibility contract that verifies the required QEO-131 labels and caveats are present in actual Portfolio/Risk UI components. It is a precondition for browser acceptance, not a substitute for it.

Minimum labels/terms: `Account Equity`, `Risk per Trade`, `Risk Amount`, `Initial Stop`, `Risk per Share`, `Trade Size`, `Active Risk`, `Max Active Risk`, `Remaining Risk Budget`, `Drawdown`, `Win Ratio`, `Payoff Ratio`, `Commission Ratio`, `Risk Profile`, `Discipline Profile`, `Trading Scorecard`, `Trade Posting Card`, and `Optimal f` when rendered.

### 4. Real browser harness

The repository currently has source-contract UI tests but no real browser dependency. Add a minimal Playwright test harness for QEO-144. Browser tests run against the local Next.js app backed by the controlled local Supabase fixture and authenticate through a deterministic local test account.

Browser acceptance must exercise both desktop and responsive/mobile viewport behavior for `/portfolio`, including:

- tab navigation across Tài sản / Nhật ký / Phân bổ vốn / Hiệu suất;
- visible Active Risk, Risk Unknown, risk-state reason and concentration status;
- Trade Card lifecycle evidence and fill/stop/journal visibility;
- stop-first sizing and projected Active Risk/concentration context;
- scorecard/ledger/equity/drawdown rendering;
- live/paper separation;
- tooltip/help interaction by hover/focus on desktop and tap/help affordance at responsive width;
- keyboard accessibility for help controls;
- no color-only state communication.

Screenshots/traces from the acceptance run are CI artifacts and evidence, not committed golden images unless a later issue explicitly adopts visual regression testing.

### 5. CI acceptance workflow

Add `QEO-144 Portfolio Risk Acceptance` workflow. It must:

1. install dependencies;
2. run QEO-144 deterministic acceptance and source-fidelity tests;
3. start local Supabase and replay all migrations;
4. load the synthetic QEO-144 fixture;
5. run reconciliation/integration SQL where needed;
6. start the Next.js app with local Supabase environment values;
7. install/run Playwright Chromium tests;
8. upload browser evidence artifacts;
9. run manifest validation, lint, TypeScript and production build;
10. preserve existing QEO-137/138/139/141/142/143/158/159 regression workflows as independent release gates.

No QEO-144 application DDL is expected. If implementation proves a schema change is required, stop and treat that as an architecture change rather than hiding it inside acceptance work.

## Production acceptance

After exact-head PR gates pass and code is merged/deployed:

- verify Vercel production deployment is `READY` for the exact merge SHA;
- canonical `qeoindex.qeoqeo.com` returns HTTP 200/auth shell;
- scan runtime error/fatal logs;
- verify production migration ledger/schema remains expected;
- use existing real production data only for read-only smoke checks;
- explicitly mark fixture-only scenarios as validated in the controlled harness, not as observed in production when no suitable real row exists.

QEO-144 can close when no P0/P1 correctness issue remains, browser evidence is attached/commented, and all required deterministic-core children are complete. Then update QEO-136 with accepted architecture, formulas, schema state and known limitations; QEO-136 may close while AI remains deferred to QEO-157.