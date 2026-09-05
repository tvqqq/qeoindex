# QEO-100 v2 SSI + Horizon + Legacy Intraday Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the original DNSE/KBS/VCI-only benchmark plan with an SSI-iBoard-first provider benchmark, enforce explicit chart history horizons, keep full Daily history, bound hot Postgres minute storage to ~31 days, archive older `<1D` raw data to verified cold storage, and verify the resulting canonical data on `/insights/vic`.

**Architecture:** Two agents work in parallel from one coordinator bootstrap commit. Agent A owns upstream provider adapters and evidence collection for SSI iBoard, DNSE, VCI, and optional KBS comparison. Agent B owns chart history policy, server/client horizon enforcement, hot-to-cold archive/prune lifecycle, and provider-agnostic UI tests. The coordinator integrates the evidence-backed provider order into the existing QEO-92 canonical service and runs production verification.

**Tech Stack:** Next.js 16.3, React 19, TypeScript 5.7, Node test runner, Supabase JS 2.112, existing QEO-92 `chart_ohlcv_intraday` / `chart_ohlcv_cold_manifests` / private `chart-ohlcv` bucket, QEO-93 server timeframe aggregation, GitHub Actions, Vercel.

**Specs:**
- `docs/superpowers/specs/2026-09-05-qeo-100-market-data-sot-ui-verification-design.md`
- `docs/superpowers/specs/2026-09-05-qeo-100-horizon-retention-addendum.md`

## Global Constraints

- Product history horizons are exact: `<1h` = maximum 31 calendar days; `1h/2h/4h` = maximum 366 calendar days; `>=1D` = full available canonical Daily history.
- Canonical raw data remains `1m` + `1D`; QEO-93 remains the single derived-timeframe aggregation engine.
- Frontend reads only `/api/market/ohlcv`; never call SSI/DNSE/VCI/KBS directly from the browser.
- SSI iBoard REST is an upstream candidate, not a contractual SLA-backed API.
- KBS is comparison-only unless live evidence proves required history depth.
- Do not fabricate bars or upsample coarse bars to `1m`.
- Full canonical `1D` remains locally persisted.
- Hot Postgres raw `1m` target retention is ~31 days.
- Raw `<1D` older than hot retention is archived to private Object Storage before hot-row pruning.
- Verified cold legacy intraday may remain indefinitely for backup/reproducibility; normal chart requests must not render intraday beyond the product horizon.
- No DB migration is expected: reuse existing QEO-92 hot table, cold manifests and private storage bucket. If implementation proves a schema change is required, stop and re-plan before DDL.
- Provider secrets/signatures/internal stack traces never appear in API responses or logs.
- Release gate: `pnpm verify:pr && pnpm build` plus production smoke after deploy.

---

## Parallel work model

### Coordinator bootstrap — complete before dispatch

Coordinator owns shared contracts only:

- Create `modules/market/chart-data/history-policy.ts`
- Modify `modules/market/provider-benchmark/contract.ts`
- Modify `modules/market/provider-benchmark/providers/index.ts` only to compile-safe stubs
- Modify provider and chart test entrypoints/manifest

After bootstrap, dispatch both agents from the exact same commit SHA.

### Agent A — Provider lane

Exclusive files:

- `modules/market/provider-benchmark/providers/ssi-iboard.ts`
- `modules/market/provider-benchmark/providers/dnse.ts`
- `modules/market/provider-benchmark/providers/vci.ts`
- `modules/market/provider-benchmark/providers/kbs.ts`
- `modules/market/provider-benchmark/providers/http.ts`
- `modules/market/provider-benchmark/providers/index.ts`
- `tests/market-data/provider-adapters.cases.ts`
- `tests/fixtures/market-data/ssi-*.json`
- `tests/fixtures/market-data/vci-*.json`
- `tests/fixtures/market-data/kbs-*.json`

Agent A must not edit chart components, timeframe service, cold/hot stores or archive lifecycle.

### Agent B — Horizon/archive/UI lane

Exclusive files:

- `modules/market/chart-data/history-policy.ts`
- `modules/market/chart-data/timeframe-service.ts`
- `modules/market/chart-data/archive-lifecycle.ts`
- `modules/market/chart-data/hot-store.ts`
- `components/stock-detail/chart/use-canonical-chart-bars.ts`
- `components/stock-detail/chart/use-canonical-minute-bars.ts` only for removal/compat shim
- `components/stock-detail/stock-tradingview-chart.tsx`
- `tests/chart-history-policy.test.ts`
- `tests/chart-archive-lifecycle.test.ts`
- `tests/market-data/benchmark-ui.cases.ts`

Agent B may use provider-neutral interfaces only and must not choose provider precedence.

### Coordinator integration files after both lanes are green

- `modules/market/chart-data/provider.ts`
- `modules/market/chart-data/service.ts`
- `docs/README.md`
- `docs/HANDOVER.md`
- Linear QEO-100/QEO-101/QEO-103/QEO-98 evidence

---

### Task 0: Coordinator — Freeze provider list and history-horizon contract

**Files:**
- Create: `modules/market/chart-data/history-policy.ts`
- Modify: `modules/market/provider-benchmark/contract.ts`
- Modify: `modules/market/provider-benchmark/providers/index.ts`
- Modify: provider/chart test entrypoints and `tests/test-contracts.json`

**Interfaces:**

```ts
export type ChartHistoryClass = "SHORT" | "MID" | "LONG"

export function chartHistoryClass(resolution: ChartResolution): ChartHistoryClass
export function maxChartHistorySeconds(resolution: ChartResolution): number | null
export function clampChartHistoryRange(input: {
  resolution: ChartResolution
  from: number
  to: number
  now?: number
}): { from: number; to: number; clamped: boolean }
```

Expected policy:

```ts
1m/15m/30m -> 31 * 86400
1h/2h/4h   -> 366 * 86400
1D/3D/1W/1M/1Q/1Y -> null // full history
```

Provider benchmark list becomes:

```ts
["SSI_IBOARD", "DNSE", "VCI", "KBS"]
```

- [ ] **Step 1: Write RED policy tests**

Create `tests/chart-history-policy.test.ts` with assertions for all 12 chart resolutions and explicit clamping examples.

Example:

```ts
test("15m is capped at 31 days while 4h is capped at 366 days and 1D is full-history", () => {
  assert.equal(maxChartHistorySeconds("15m"), 31 * 86400)
  assert.equal(maxChartHistorySeconds("4h"), 366 * 86400)
  assert.equal(maxChartHistorySeconds("1D"), null)
})
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/chart-history-policy.test.ts
```

Expected: FAIL because the policy module does not exist.

- [ ] **Step 3: Implement `history-policy.ts` minimally**

Use an exhaustive `switch` on `ChartResolution`; do not infer ordering from strings such as `"1D" > "4h"`.

`clampChartHistoryRange` clamps only the lower bound relative to `min(to, now)` and never expands a caller's requested range.

- [ ] **Step 4: Extend provider contract**

Add `SSI_IBOARD` to `MarketDataProbeProviderName`. Keep resolution contract at `"1m" | "1D"` for source-of-truth benchmarking.

- [ ] **Step 5: Run manifest/typecheck**

```bash
pnpm test:manifest
node --test tests/chart-history-policy.test.ts tests/market-data-provider-adapters.test.ts tests/market-data-benchmark-ui.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit bootstrap and dispatch both agents from this SHA**

Commit message:

```text
test(QEO-100): freeze SSI benchmark and chart history horizons
```

---

## Agent A — Provider lane

### Task A1: SSI iBoard credential-less OHLC adapter

**Files:**
- Create: `modules/market/provider-benchmark/providers/ssi-iboard.ts`
- Modify: `tests/market-data/provider-adapters.cases.ts`
- Create: `tests/fixtures/market-data/ssi-history-1d.json`
- Create: `tests/fixtures/market-data/ssi-history-1m.json`

**Interface:** `createSsiIboardProbeProvider(deps?) -> MarketDataProbeProvider`

Production endpoint is fixed and not caller-configurable:

```text
https://iboard-api.ssi.com.vn/statistics/charts/history
```

Request mapping:

```text
1D -> resolution=1D
1m -> resolution=1
symbol -> uppercase ticker
from/to -> Unix seconds from normalized request
```

- [ ] **Step 1: Write RED fixture tests**

Tests must prove:

- envelope parsing supports the observed SSI response container;
- `t/o/h/l/c/v` arrays have equal lengths;
- timestamps are clipped to requested `[from,to]`;
- OHLC/volume are finite and sorted ascending;
- malformed unequal arrays raise `ProviderProbeError(..., "MALFORMED_RESPONSE", ...)`;
- no Authorization header/API key is required by the adapter contract.

- [ ] **Step 2: Run RED**

```bash
node --test tests/market-data-provider-adapters.test.ts
```

Expected: SSI tests fail because adapter is missing.

- [ ] **Step 3: Implement adapter**

Use native `fetch` with bounded timeout via `AbortController`. Browser-like headers may include `Accept`, `Origin`/`Referer` only if live probe evidence shows they are necessary; do not add fake credentials or cookies.

Returned `providerDetail` may include endpoint family + resolution token but never full uncontrolled URL/query.

- [ ] **Step 4: Run fixture tests GREEN**

```bash
node --test tests/market-data-provider-adapters.test.ts
pnpm typecheck
```

- [ ] **Step 5: Commit**

```text
feat(QEO-100): add SSI iBoard OHLC probe adapter
```

### Task A2: DNSE decisive retry + VCI comparison + KBS depth classification

**Files:**
- Modify/create provider files listed in Agent A ownership
- Modify provider test cases/fixtures only

- [ ] **Step 1: Keep DNSE exact failure classification tests**

Map 401/403/signature to `AUTH`, deadline/abort to `TIMEOUT`, 429 to `RATE_LIMIT`, 400/422 to `INVALID_REQUEST`, transport failures to `NETWORK`.

- [ ] **Step 2: Preserve VCI `ONE_MINUTE`/`ONE_DAY` adapter behavior**

No 5m/15m/30m resampling belongs in provider benchmark.

- [ ] **Step 3: Make KBS a normal probe but not a default authority**

The adapter may return `PARTIAL` when requested history depth is not satisfied. Do not pad or extrapolate missing dates.

- [ ] **Step 4: Register all providers**

`resolveMarketDataProbeProvider()` resolves `SSI_IBOARD`, `DNSE`, `VCI`, `KBS`.

- [ ] **Step 5: Run Agent A gate**

```bash
node --test tests/market-data-provider-adapters.test.ts
pnpm lint:touched
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```text
feat(QEO-100): complete OHLC provider benchmark adapters
```

### Task A3: Live evidence matrix after preview deploy

This is an evidence task, not a deterministic CI test.

Probe at least:

```text
VIC, VCB, HPG, one HNX universe ticker, one UPCOM universe ticker
```

Ranges:

```text
1D: 20 sessions, 1 year, then earliest practical full-history probe
1m: 1 completed session, 5 sessions, 31-day boundary
```

Record for each provider: status, latency, returned rows, earliest/latest timestamp, coverage state, OHLC mismatch count, volume mismatch count and failure class.

SSI iBoard must additionally prove the requested `from/to` boundaries are respected well enough for chart hydration.

Do not nominate the final provider inside Agent A code. Return evidence to coordinator.

---

## Agent B — Horizon/archive/UI lane

### Task B1: Enforce differentiated server history horizons

**Files:**
- Modify: `modules/market/chart-data/timeframe-service.ts`
- Test: `tests/chart-history-policy.test.ts`
- Modify: `tests/market-data/benchmark-ui.cases.ts`

Current `MAX_DERIVED_INTRADAY_SPAN_SECONDS = 186d` must be replaced by the shared policy.

- [ ] **Step 1: Write RED request-boundary tests**

Required cases:

```text
1m 32d -> clamped/rejected according to public service contract
15m 32d -> clamped to 31d
30m 31d -> accepted
1h 367d -> clamped to 366d
4h 366d -> accepted
1D multi-decade -> accepted subject to canonical Daily availability
1W full Daily history -> accepted
```

Prefer clamping at the public chart-service boundary and return the actual `from` in the response so frontend behavior is deterministic.

- [ ] **Step 2: Run RED**

```bash
node --test tests/chart-history-policy.test.ts tests/chart-timeframe-service.test.ts
```

- [ ] **Step 3: Implement policy in timeframe service**

Call `clampChartHistoryRange()` during public request normalization. Keep canonical raw `1m` chunk loading bounded by the existing per-fetch max span; a one-year 1h request is satisfied by multiple canonical chunks.

- [ ] **Step 4: Verify no aggregation changes**

Run existing QEO-93 engine tests unchanged.

```bash
node --test tests/chart-timeframe-engine.test.ts tests/chart-timeframe-service.test.ts tests/chart-history-policy.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```text
feat(QEO-103): enforce chart history horizons
```

### Task B2: Implement verified hot-to-cold archive/prune lifecycle

**Files:**
- Create: `modules/market/chart-data/archive-lifecycle.ts`
- Modify: `modules/market/chart-data/hot-store.ts`
- Test: `tests/chart-archive-lifecycle.test.ts`

**New hot-store interface:**

```ts
export async function deleteHotIntradayRange(
  supabase: SupabaseClient,
  ticker: string,
  from: number,
  to: number,
): Promise<number>
```

Deletion must be scoped by ticker + `base_resolution='1m'` + exact archived time range.

**Archive lifecycle interface:**

```ts
export async function archiveExpiredHotIntraday(input: {
  supabase: SupabaseClient
  ticker: string
  now?: Date
  hotRetentionDays?: number // default 31
  coldStorage?: ColdOhlcvStorage
}): Promise<{
  archivedRows: number
  prunedRows: number
  partitions: number
  skippedPartitions: number
}>
```

- [ ] **Step 1: Write RED safety tests**

Tests must prove:

1. bars newer than cutoff are untouched;
2. expired bars are read and partitioned deterministically;
3. `archiveVerifiedPartition()` is called before delete;
4. simulated archive failure results in **zero deletes** for that partition;
5. after archive, exact cold readback must match hot normalized bars before delete;
6. rerun on already archived range does not duplicate data and can safely prune remaining hot duplicates;
7. one failed partition does not prevent later independent partitions from being processed.

- [ ] **Step 2: Run RED**

```bash
node --test tests/chart-archive-lifecycle.test.ts
```

- [ ] **Step 3: Implement lifecycle using existing QEO-92 cold storage**

Use existing `readHotIntradayRange()` and `ColdOhlcvStorage.archiveVerifiedPartition()`.

Partition expired data by bounded calendar-month ranges (or smaller final partial range) so objects remain reasonably sized and manifest intersection stays efficient.

Before pruning each partition:

```text
hot bars
 -> normalize/sort
 -> check exact cold coverage; if absent archiveVerifiedPartition
 -> read exact range from cold
 -> normalize/dedupe cold result
 -> exact compare time/O/H/L/C/V
 -> delete hot range
```

Do not introduce a second serialization/checksum implementation; reuse `cold-store.ts`.

- [ ] **Step 4: Verify archive tests GREEN**

```bash
node --test tests/chart-archive-lifecycle.test.ts tests/chart-data-storage-isolation.test.ts
pnpm typecheck
```

- [ ] **Step 5: Commit**

```text
feat(QEO-103): archive and prune expired minute hot data
```

### Task B3: Replace minute-only UI fetch with horizon-aware canonical chart hook

**Files:**
- Create: `components/stock-detail/chart/use-canonical-chart-bars.ts`
- Modify: `components/stock-detail/stock-tradingview-chart.tsx`
- Modify/remove compatibility logic in `use-canonical-minute-bars.ts`
- Modify: `tests/stock-tradingview-chart-v2.test.ts`
- Modify: `tests/market-data/benchmark-ui.cases.ts`

**Hook interface:**

```ts
export function useCanonicalChartBars(input: {
  ticker: string
  resolution: ChartResolution
  enabled?: boolean
}): {
  bars: OhlcvBar[]
  status: "idle" | "loading" | "ready" | "error"
  error: string | null
  effectiveFrom: number | null
  effectiveTo: number | null
}
```

- [ ] **Step 1: Write RED UI contract tests**

Assert request windows:

```text
1m/15m/30m -> no more than 31 days
1h/2h/4h   -> no more than 366 days
1D and higher -> request full-history mode through canonical API/server contract, not a hard-coded 7-day lookback
```

The hook must use `/api/market/ohlcv` for the selected timeframe so QEO-93 server aggregation is exercised consistently.

- [ ] **Step 2: Run RED**

```bash
node --test tests/stock-tradingview-chart-v2.test.ts tests/market-data-benchmark-ui.test.ts
```

- [ ] **Step 3: Implement generic hook**

Use shared history policy to construct bounded `from/to`. For long-term resolutions, use the earliest Daily boundary made available by the stock-detail data contract or a server-supported long-range request; do not invent a fixed 10-year limit in the client.

Chart `displayBars` becomes canonical hook bars for supported timeframes. Existing prop bars may remain only as initial/fallback Daily bootstrap if necessary during migration, but must not cause duplicate synthetic aggregation paths.

- [ ] **Step 4: Add horizon UI behavior**

At the left boundary, stop increasing `scrollOffset` when all bars in the allowed horizon are loaded. Do not show an error merely because the product horizon has been reached.

- [ ] **Step 5: Run UI gate**

```bash
node --test tests/stock-tradingview-chart-v2.test.ts tests/market-data-benchmark-ui.test.ts
pnpm lint:touched
pnpm typecheck
```

- [ ] **Step 6: Commit**

```text
feat(QEO-103): wire horizon-aware canonical chart loading
```

---

## Coordinator integration

### Task C1: Select provider hierarchy from live evidence

Do not preselect SSI solely because it has a convenient `from/to` endpoint.

Required decision table:

| Capability | SSI iBoard | DNSE | VCI | KBS |
| --- | --- | --- | --- | --- |
| 1D depth |  |  |  |  |
| real 1m |  |  |  |  |
| 31d 1m coverage |  |  |  |  |
| HOSE/HNX/UPCOM |  |  |  |  |
| from/to compliance |  |  |  |  |
| Vercel runtime stability |  |  |  |  |
| OHLC match |  |  |  |  |
| volume semantics |  |  |  |  |
| latency/rate limit |  |  |  |  |

Nominate separately:

```text
historical 1m primary
historical 1m fallback
historical 1D primary
historical 1D fallback
realtime/current-session owner
```

Record evidence in QEO-100 and QEO-101.

### Task C2: Wire selected upstream order behind QEO-92 canonical service

**Files:**
- Modify: `modules/market/chart-data/provider.ts`
- Modify: `modules/market/chart-data/service.ts` only where provider order/provenance needs change

Requirements:

- local hot/cold remains first for existing canonical data;
- on canonical gap/miss, selected provider order is used;
- provider result is normalized/validated before promotion;
- provenance batch stores the real provider name rather than hard-coded `DNSE`;
- provider failures do not fabricate candles;
- no frontend provider branching.

Run:

```bash
node --test tests/market-data-provider-adapters.test.ts tests/chart-data-canonical-merge.test.ts tests/chart-timeframe-service.test.ts
pnpm verify:pr
pnpm build
```

Expected: PASS.

### Task C3: Preview/production acceptance

Verify VIC first.

Backend evidence:

```text
/api/market/ohlcv?resolution=1m -> <=31d, 200, real bars
/api/market/ohlcv?resolution=15m -> <=31d, server-derived
/api/market/ohlcv?resolution=1h -> <=1y, server-derived
/api/market/ohlcv?resolution=4h -> <=1y
/api/market/ohlcv?resolution=1D -> full available Daily
/api/market/ohlcv?resolution=1W -> full available derived Daily history
```

Archive evidence after a controlled fixture/production-safe lifecycle run:

- archive manifest exists;
- checksum/readback verified;
- expired hot rows were pruned only after verification;
- same range read through cold returns identical normalized bars;
- cold legacy data older than one year is not served by normal intraday requests.

UI evidence on `/insights/vic`:

1. `1m`: one-month maximum;
2. `15m/30m`: same short horizon;
3. `1h/2h/4h`: one-year maximum;
4. `1D/1W`: pan through full available history;
5. switch repeatedly among short/mid/long timeframes;
6. reload and compare five completed candles per tested source boundary;
7. verify no infinite spinner, no synthetic bars, no drawing anchor movement.

Final equality requirement:

```text
UI candle
 == /api/market/ohlcv normalized bar
 == selected upstream normalized bar for provider-filled ranges
```

### Task C4: Documentation and Linear closure evidence

Update:

- `docs/README.md`
- `docs/HANDOVER.md`
- QEO-100 provider decision
- QEO-101 Daily authority decision input
- QEO-103 archive/horizon evidence
- QEO-98 production QA gate

Do not mark QEO-103 or QEO-98 Done based only on CI; production runtime evidence is required.

---

## Agent prompts

### Agent A prompt

Implement only the Provider Lane of `docs/superpowers/plans/2026-09-05-qeo-100-v2-ssi-horizon-archive.md`. Read both QEO-100 specs first. You own only provider-benchmark adapter files and provider fixtures/tests. Add SSI iBoard `1m`/`1D` using the fixed credential-less history endpoint, preserve DNSE sanitized error classification, keep VCI native minute/day support, and classify KBS history-depth shortfalls as partial evidence rather than padding data. Do not edit chart storage/UI/timeframe files and do not choose a winning provider in code. Follow TDD and return commits plus live-probe evidence summary.

### Agent B prompt

Implement only the Horizon/Archive/UI Lane of `docs/superpowers/plans/2026-09-05-qeo-100-v2-ssi-horizon-archive.md`. Read both QEO-100 specs first. Enforce 31d short-term, 366d mid-term and full-history Daily/higher ranges; implement verified hot-1m to existing cold-storage archive followed by scoped pruning; replace minute-only UI loading with provider-neutral canonical timeframe loading. Do not edit provider adapters or choose provider precedence. Reuse QEO-93 aggregation and QEO-92 cold serialization/checksum logic. Follow TDD and return commits plus verification output.

## Self-review

- Spec coverage: SSI iBoard discovery, three render horizons, full Daily, one-year mid-term, one-month short-term and legacy `<1D` archive are all assigned to explicit tasks.
- No schema migration is assumed.
- Agent file ownership is non-overlapping.
- Provider choice remains an evidence decision at coordinator integration.
- Legacy cold data may outlive the render horizon without re-entering hot Postgres or normal browser hydration.
