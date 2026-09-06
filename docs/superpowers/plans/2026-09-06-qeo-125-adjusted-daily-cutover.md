# QEO-125 Canonical Adjusted Daily Consumer Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Atomically switch Chart, Wyckoff and AI Council Daily consumers from the existing raw/provider source to the verified adjusted-Daily source per ticker, then stage the canonical-200 rollout without repurposing `market_ohlcv_history`.

**Architecture:** QEO-129 owns shadow storage/rebuild. QEO-126 owns EOD maintenance and factor activation. QEO-125 adds one canonical Daily read boundary: active tickers read `market_ohlcv_adjusted_daily`; non-active tickers continue to read raw `market_ohlcv_history`. The boundary is shared by Chart, Wyckoff and AI Council so one ticker cannot use different price bases across consumers.

**Tech Stack:** Supabase/PostgreSQL, TypeScript, existing `modules/market/chart-data/*`, Wyckoff grouped Daily RPC, AI Council EOD market loader, QEO-93 aggregation engine.

**Spec:** `docs/superpowers/specs/2026-09-06-corporate-actions-adjusted-chart-design.md`

## Global Constraints

- Depends on QEO-129 shadow foundation and QEO-126 EOD maintenance/activation.
- `market_ohlcv_history` remains raw/provider evidence and is never overwritten/deleted by this cutover.
- Per ticker, the canonical read boundary is atomic: either RAW or ADJUSTED, never a merged mixed-basis Daily range.
- `1W/1M/1Q/1Y` derive only from the selected canonical `1D`; never adjust after aggregation.
- A ticker may become `active` only after complete adjusted-session/factor/event lineage verification.
- PR #340/QEO-106 transitional Yahoo semantic-repair work must be reconciled before rollout: preserve readback/fail-closed protections but do not use Yahoo adjustment as factor authority.

---

### Task 1: Add canonical Daily read-boundary migration

**Files:**
- Create: `supabase/migrations/20260906165500_qeo125_canonical_adjusted_daily_cutover.sql`
- Modify: `supabase/migration-equivalence.json`
- Modify: `docs/db/evidence/production-migration-ledger-2026-09-06.json`
- Modify: `modules/shared/supabase/database.types.ts`
- Test: `tests/db-schema-contract.test.ts`
- Test: `tests/market-data-contract.test.ts`

**Interfaces:**

Create a read-only canonical view with the current Daily shape plus explicit basis:

```sql
create view public.market_ohlcv_canonical_daily
with (security_invoker = true)
as
select
  a.ticker,
  '1D'::text as timeframe,
  a.bar_time,
  a.open, a.high, a.low, a.close, a.volume,
  'QEO_ADJUSTED'::text as provider,
  ('event_lineage=' || a.event_lineage_hash)::text as provider_detail,
  null::text as source_url,
  a.rebuilt_at as fetched_at,
  'ADJUSTED'::text as price_basis
from public.market_ohlcv_adjusted_daily a
join public.market_adjusted_daily_rollout r
  on r.ticker = a.ticker and r.status = 'active'
union all
select
  h.ticker, h.timeframe, h.bar_time,
  h.open, h.high, h.low, h.close, h.volume,
  h.provider, h.provider_detail, h.source_url, h.fetched_at,
  'RAW'::text as price_basis
from public.market_ohlcv_history h
where h.timeframe = '1D'
  and not exists (
    select 1 from public.market_adjusted_daily_rollout r
    where r.ticker = h.ticker and r.status = 'active'
  );
```

Exact SQL may add lineage columns needed for audit, but it must preserve one basis for every ticker.

- [ ] **Step 1: RED canonical-view contract**

Assert active ticker excludes raw rows, inactive/shadow/blocked ticker excludes adjusted rows, and `price_basis` is explicit.

- [ ] **Step 2: Rebind `qeo_market_ohlcv_recent_grouped(text[], integer)` to read the canonical view**

Preserve its existing function signature/tuple order so Wyckoff callers do not receive a breaking payload shape. Source fields for adjusted rows identify `QEO_ADJUSTED` and lineage.

- [ ] **Step 3: Keep mutation grants unchanged** — the view is a read boundary, not a write API.
- [ ] **Step 4: Regenerate Database types and register exact migration equivalence**

Repository version is `20260906165500`; map any differing production timestamp explicitly.

- [ ] **Step 5: Run DB Drift/replay and commit**

```bash
git add supabase/migrations/20260906165500_qeo125_canonical_adjusted_daily_cutover.sql supabase/migration-equivalence.json docs/db/evidence/production-migration-ledger-2026-09-06.json modules/shared/supabase/database.types.ts tests/db-schema-contract.test.ts tests/market-data-contract.test.ts
git commit -m "feat(QEO-125): add canonical adjusted Daily read boundary"
```

### Task 2: Cut Chart Daily source to the canonical view

**Files:**
- Modify: `modules/market/chart-data/service.ts`
- Modify: `modules/market/chart-data/timeframe-service.ts` only for basis propagation if required
- Modify: `tests/chart-timeframe-service.test.ts`
- Modify: `app/api/market/ohlcv/route.ts` only if response metadata typing needs the new basis value

**Interfaces:**

`loadDailyRows()` must read `market_ohlcv_canonical_daily` instead of `market_ohlcv_history` and select `price_basis`.

- [ ] **Step 1: RED active VHM case** — canonical loader returns only adjusted rows and `metadata.priceBasis === "ADJUSTED"`.
- [ ] **Step 2: RED shadow/non-active case** — remains RAW; no adjusted rows leak into response.
- [ ] **Step 3: RED higher-timeframe case** — `1W/1M/1Q/1Y` preserve the Daily source basis metadata and aggregate only selected Daily bars through QEO-93.
- [ ] **Step 4: Implement minimal source/basis propagation and GREEN tests**
- [ ] **Step 5: Commit**

### Task 3: Cut Wyckoff to the same canonical Daily boundary

**Files:**
- Modify: `modules/wyckoff/eod-cache-read.ts` only if provider/basis metadata handling needs adjustment
- Modify: `modules/wyckoff/eod-chart-series.ts` only if provider/basis metadata handling needs adjustment
- Modify: `tests/wyckoff-v2-runtime-data.test.ts`
- Modify: `tests/wyckoff-v2-chart-series.test.ts`
- Modify: `tests/db-schema-contract.test.ts`

**Interfaces:**

Wyckoff continues calling `qeo_market_ohlcv_recent_grouped`; the migration changes its underlying source to `market_ohlcv_canonical_daily`.

- [ ] **Step 1: RED RPC source contract** — grouped RPC must reference canonical view, not raw table directly.
- [ ] **Step 2: Verify active adjusted ticker yields the same 1D/1W data lineage used by chart**
- [ ] **Step 3: Verify non-active ticker retains current raw behavior**
- [ ] **Step 4: Run Wyckoff runtime/chart-series tests and commit**

### Task 4: Cut AI Council persistent EOD market source to the canonical boundary

**Files:**
- Modify: `modules/ai-council/eod-market.ts`
- Modify: `modules/eod/backfill-ready-step.ts` if source-specific error wording/contract is raw-table-specific
- Modify: `tests/eod-recovery-contract.test.ts`

**Interfaces:**

`loadPersistentCouncilEodSnapshots()` reads `market_ohlcv_canonical_daily`, so current/reference prices use the same basis as chart/Wyckoff. This is essential on an ex-date: adjusted previous close prevents a corporate-action mechanical price gap from being interpreted as market return.

- [ ] **Step 1: RED active ticker current/reference test** — both current and previous rows come from ADJUSTED canonical source.
- [ ] **Step 2: RED non-active ticker test** — remains RAW.
- [ ] **Step 3: Preserve exact-session/freshness/volume finality gates**
- [ ] **Step 4: Implement and GREEN recovery/EOD tests**
- [ ] **Step 5: Commit**

### Task 5: Update active architecture docs/contracts

**Files:**
- Modify: `docs/chart-data.md`
- Modify: `docs/wyckoff-chart-unified-data.md`
- Modify: `docs/HANDOVER.md`
- Modify: `docs/README.md` only if lifecycle/index links require it

- [ ] **Step 1: Document `market_ohlcv_history` = raw evidence, `market_ohlcv_adjusted_daily` = derived shadow/active adjusted store, `market_ohlcv_canonical_daily` = consumer read boundary**
- [ ] **Step 2: Document atomic per-ticker rollout and no mixed basis**
- [ ] **Step 3: Document EOD ownership from QEO-126 and consumer set Chart/Wyckoff/AI Council**
- [ ] **Step 4: Commit**

### Task 6: VHM atomic production cutover

**Files:**
- Create: `docs/db/evidence/qeo125-vhm-adjusted-daily-cutover.md`

- [ ] Preflight QEO-129 VHM shadow coverage + QEO-126 incremental maintenance/readback.
- [ ] Verify VHM current shadow lineage matches active QEO-124 factor lineage and has exact sessions through latest completed trading day.
- [ ] In one controlled DB update set VHM rollout `shadow -> active` with verified lineage/version.
- [ ] Query canonical view: VHM returns only ADJUSTED; raw table remains unchanged and queryable for audit.
- [ ] Verify `/api/market/ohlcv` VHM 1D and 1W. Week 13–17/10/2025 must be H≈63.31 / L≈55.18 within documented tolerance.
- [ ] Verify Wyckoff grouped Daily/Weekly uses adjusted source for VHM.
- [ ] Verify AI Council current/reference price pair uses adjusted source and no false corporate-action return jump.
- [ ] Verify no duplicate/shifted VHM sessions around 13–21/10/2025.
- [ ] Capture DB/API/UI evidence and commit.

### Task 7: Regression set + multi-exchange rollout

- [ ] Activate HCM/VCB/VIC only after shadow coverage/readback passes.
- [ ] Pick representative HOSE/HNX/UPCOM tickers covering cash, stock/split and rights actions.
- [ ] For every activation require: 0 unresolved effective events, complete adjusted-session/factor lineage, 0 duplicate sessions, Chart/Wyckoff/Council basis parity.
- [ ] Measure DB size/capacity after each stage.
- [ ] Stop rollout immediately on any consumer mismatch or unresolved lineage.

### Task 8: Canonical-200 staged rollout

- [ ] Process 10–20 tickers per activation batch.
- [ ] Before each batch: event/factor/shadow-session/capacity preflight.
- [ ] After each batch: canonical-view basis check, Chart derived-timeframe smoke, Wyckoff grouped read, AI Council current/reference smoke.
- [ ] Fail closed on ambiguous effective event or stale/missing shadow session.
- [ ] Final report: active, shadow-blocked, ambiguous, unresolved, event coverage, factor coverage, adjusted-session coverage, DB size.
- [ ] QEO-98 consumes this report as release gate.
- [ ] Only after canonical acceptance consider retiring transitional QEO-106 Yahoo-adjustment repair logic; raw evidence remains retained.
