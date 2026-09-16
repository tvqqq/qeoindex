# QEO-172 SSR Daily Seed Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the redundant initial `/api/market/ohlcv` round-trip when the authenticated Stock Detail SSR payload already contains usable canonical `1D` bars, so the initial chart can become render-ready from the server seed immediately.

**Architecture:** Keep `fetchStockDetailData()` and the existing Daily-only chart API unchanged. Change only the client `useChartHistory()` bootstrap decision: an exact prepared dataset still wins; otherwise a non-empty `1D` `seedDailyBars` is authoritative for the first usable render and must not be hidden behind `loading` or an immediate duplicate initial history request. Non-1D transitions continue to use the existing prepared-history path.

**Tech Stack:** Next.js 16.3, React 19.2, TypeScript, Node test runner, Playwright production benchmark.

**Spec:** `docs/superpowers/specs/2026-09-10-qeo-172-chart-performance-design.md`

## Global Constraints

- QEO-172 active chart contract is Daily-derived only: `1D, 3D, 1W, 1M, 1Q, 1Y`.
- Frozen uncached initial usable chart budget remains p95 `<= 2500 ms`.
- Do not change canonical Daily data correctness, cache admission, prepared navigation semantics, settings hydration, drawings ownership, or production benchmark thresholds.
- `main` remains deployment-only through Vercel Git Integration; no manual production deployment.

---

### Task 1: Add a regression guard for SSR Daily seed readiness

**Files:**
- Create: `tests/qeo172/ssr-daily-seed-readiness-contract.test.ts`
- Inspect: `components/stock-detail/chart/use-chart-history.ts`

**Interfaces:**
- Consumes: `useChartHistory({ ticker, timeframe, seedDailyBars, preparedInitial })`.
- Produces: deterministic source contract proving a non-empty `1D` SSR seed is treated as initial-ready and suppresses the duplicate initial loader.

- [ ] **Step 1: Write the failing regression test**

```ts
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("../../components/stock-detail/chart/use-chart-history.ts", import.meta.url), "utf8")

test("QEO-172 usable 1D SSR seed renders ready without duplicate initial history fetch", () => {
  assert.match(source, /const hasUsableDailySeed = timeframe === "1D" && seedDailyBars\.length > 0/)
  assert.match(source, /useState\(\(\) => !exactPrepared && !hasUsableDailySeed\)/)
  assert.match(source, /if \(hasUsableDailySeed\) \{[\s\S]*?setLoading\(false\)[\s\S]*?return \(\) => controller\.abort\(\)/)
})
```

- [ ] **Step 2: Run the focused QEO-172 contract workflow and verify RED**

Expected: the new contract fails because current `useChartHistory()` initializes `loading` from `!exactPrepared` and falls through to `loadInitialChartHistory()` even when `1D` seed bars exist.

---

### Task 2: Make the SSR Daily seed an immediate initial-ready dataset

**Files:**
- Modify: `components/stock-detail/chart/use-chart-history.ts`
- Test: `tests/qeo172/ssr-daily-seed-readiness-contract.test.ts`

**Interfaces:**
- Consumes: existing `seedDailyBars`, `timeframe`, and `preparedInitial` inputs.
- Produces: initial `1D` render-ready state without an unnecessary `/api/market/ohlcv` request; all other timeframes retain the existing loader/prepared behavior.

- [ ] **Step 1: Implement the minimal bootstrap decision**

Add one derived boolean:

```ts
const hasUsableDailySeed = timeframe === "1D" && seedDailyBars.length > 0
```

Use it for initial state:

```ts
const [loading, setLoading] = useState(() => !exactPrepared && !hasUsableDailySeed)
```

Inside the existing `useLayoutEffect`, after resetting state and after the higher-priority prepared-dataset branch, return early when `hasUsableDailySeed` is true. Preserve the earliest/latest seed cursors so pan-left can still request older history when available:

```ts
if (hasUsableDailySeed) {
  const horizonTo = seedDailyBars.at(-1)?.time ?? null
  const historyCursor = seedDailyBars.at(0)?.time ?? null
  horizonToRef.current = horizonTo
  historyCursorRef.current = historyCursor
  setHasMore(Boolean(
    horizonTo
    && historyCursor
    && historyCursor > chartHistoryFloor(timeframe, horizonTo) + 1,
  ))
  setLoading(false)
  return () => controller.abort()
}
```

The prepared dataset branch stays higher priority than the seed branch.

- [ ] **Step 2: Verify GREEN on focused contracts**

Expected: new regression contract passes and existing QEO-172 contracts remain green.

- [ ] **Step 3: Run release gates**

Run/verify the repository's current QEO-172 workflow plus Verify workflow covering current contracts, touched lint, TypeScript, and production build.

- [ ] **Step 4: Review exact diff**

Expected runtime diff: one client hook plus one regression test and this plan only. No benchmark threshold changes, no server/API changes, no unrelated formatting.

- [ ] **Step 5: Merge, verify exact-SHA Vercel READY, rerun the unchanged authenticated production benchmark**

Acceptance: initial usable chart p95 `<= 2500 ms` and every other frozen QEO-172 budget remains green. If any budget still fails, keep QEO-172 `In Progress` and use the new production evidence for the next root-cause iteration.
