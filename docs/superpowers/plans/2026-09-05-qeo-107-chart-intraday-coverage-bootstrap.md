# QEO-107 Chart Intraday Coverage Bootstrap Implementation Plan

> **For agentic workers:** Implement inline in this branch using the existing chart-data contracts. This plan intentionally follows the user's Spec-Driven preference; verification is contract/runtime oriented rather than a new TDD cycle.

**Goal:** Bootstrap canonical real `1m` Hot + Cold coverage for the latest published 200-stock universe, expose explicit provider gaps, and make `1h/2h/4h` history recoverable from verified canonical `1m` without fabricating bars.

**Architecture:** Reuse the existing VCI → DNSE → SSI iBoard provider waterfall, hot store, verified cold object store, and deterministic derived-hourly cache. Run a durable workflow in two logical phases: newest 31-day chunk for every canonical ticker first, then older 31-day chunks back to the 366-day horizon. Every successful or terminal provider-gap chunk is recorded in `chart_ohlcv_provenance_batches`, making restarts idempotent without adding a second bootstrap state table.

**Tech Stack:** Next.js 16, TypeScript 5.7, Supabase/Postgres/Storage, Vercel Workflow SDK.

**Spec:** Linear QEO-107.

## Global Constraints

- Canonical universe = latest published `vn_top_stocks`, maximum 200 tickers across HOSE/HNX/UPCOM.
- Raw intraday source is real provider `1m` only; never synthesize `1m` from coarser bars.
- Hot horizon is the existing complete Vietnam-calendar-day retention policy (~31 days).
- Mid intraday render horizon is 366 calendar days where providers retain history.
- Old recovered raw `1m` is archived as verified private Storage objects and immediately used to rebuild deterministic `1h`; it is not retained in Postgres hot storage.
- Existing QEO-103 prune remains fail-closed: checksum + row count + derived cache verification precede any prune.
- Provider retention gaps must be explicit and must not count as canonical source coverage.
- Bootstrap must be resumable/idempotent and conservative about rate limits.

---

### Task 1: Provider failure contract and provenance helpers

**Files:**
- Modify: `modules/market/chart-data/provider.ts`
- Modify: `modules/market/chart-data/hot-store.ts`

**Interfaces:**
- `ChartOhlcvProviderWaterfallError` exposes per-provider failure codes plus `retryable` and `terminalCoverageGap`.
- `recordChartProviderAttempt(...)` persists success/failure/gap attempt provenance including requested range.
- `readQeo107AttemptedRanges(...)` returns only successful ranges and terminal provider-gap ranges for bootstrap idempotence; canonical `readProviderRequestCoverage(...)` continues to treat only positive-row successful requests as source coverage.
- `upsertHotIntradayBars(...)` accepts an optional existing provenance batch id.

**Verification:** typecheck source contract and confirm zero-row bootstrap gaps cannot become canonical provider coverage.

### Task 2: Bootstrap chunk persistence and coverage report

**Files:**
- Create: `modules/market/chart-data/bootstrap.ts`
- Create: `supabase/migrations/20260905213000_qeo107_chart_intraday_coverage_report.sql`
- Modify: `modules/shared/supabase/database.types.ts`

**Interfaces:**
- 12 bounded chunks cover the 366-day mid-horizon; chunk 0 is the newest 31 days.
- `bootstrapChartIntradayChunk(...)` skips already terminal-attempted chunks, fetches real `1m`, persists hot bars at/after the hot cutoff, archives older bars by Vietnam trading date, rebuilds verified derived `1h`, and records failures without fabricating data.
- `readChartIntradayCoverageReport(...)` calls an aggregate RPC and returns one row for every requested canonical ticker with hot/cold/derived counts and provider-gap/failure telemetry.

**Verification:** ensure old bars never call hot upsert and each old partition passes through `archiveVerifiedPartition` before `upsertDerivedHourlyBars`.

### Task 3: Durable canonical-200 bootstrap workflow

**Files:**
- Create: `modules/market/chart-data/bootstrap-workflow-steps.ts`
- Create: `workflows/chart-intraday-bootstrap.ts`

**Interfaces:**
- Start step freezes the current canonical universe and target range.
- Workflow processes chunk 0 for all tickers before chunks 1..11.
- Each ticker/chunk is one durable step; success/gap is terminal, transient provider failure is retried with bounded backoff, other failures are recorded and surfaced.
- Final step emits the live canonical-200 coverage report.

**Verification:** workflow remains deterministic and provider/DB/network calls stay inside `use step` functions.

### Task 4: Operations route and release gate

**Files:**
- Modify: `app/api/qeoindex/eod/route.ts`
- Modify: `docs/chart-data.md`
- Modify: `tests/qeo-100-market-data.cases.ts`

**Interfaces:**
- Authenticated `POST ?mode=chart-bootstrap` starts the durable QEO-107 workflow and returns `202` + workflowRunId.
- Authenticated `GET/POST ?mode=chart-coverage` returns the current canonical-200 coverage report.
- Existing `chart-archive` and `chart-derived-recovery` modes remain unchanged.
- QEO-98 acceptance is updated in Linear with an explicit canonical-200 intraday coverage gate.

**Verification:** run source-contract checks, TypeScript, lint/build/CI gates available through GitHub/Vercel, then smoke the production coverage endpoint and trigger one bootstrap workflow after deployment.