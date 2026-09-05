# QEO-100 Two-Agent Market Data SOT + UI Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an evidence-driven DNSE/KBS/VCI OHLCV benchmark path, select the canonical upstream hierarchy, promote a bounded VIC `1m` dataset into existing QEO-92 Hot/Cold storage, and verify the exact canonical candles on `/insights/vic` without synthetic data.

**Architecture:** A coordinator first freezes one provider-neutral contract and test entrypoints. Two agents then work in parallel on non-overlapping files: Agent A owns upstream provider adapters and provider error classification; Agent B owns benchmark/reconciliation, root-only probe/promotion surfaces, and UI/canonical verification helpers. The coordinator integrates both lanes, runs live provider probes from the deployed QeoIndex runtime, records the source-of-truth decision, promotes only the approved VIC range, and performs production UI acceptance.

**Tech Stack:** Next.js 16.3, React 19, TypeScript 5.7, Node test runner, Supabase JS 2.112, existing QEO-92 Hot/Cold chart-data storage, GitHub Actions, Vercel production runtime.

**Spec:** `docs/superpowers/specs/2026-09-05-qeo-100-market-data-sot-ui-verification-design.md`

## Global Constraints

- Canonical raw chart resolutions remain exactly `1m` and `1D`; derived timeframe aggregation remains QEO-93.
- Frontend market-data reads continue through `/api/market/ohlcv`; frontend must not branch on DNSE/KBS/VCI/TitanLabs.
- Do not add SSI FastConnect to the critical path without usable project credentials.
- Do not call or promote TitanLabs during the initial DNSE/KBS/VCI decision.
- Do not fabricate `1m` from `5m`, `1H`, or `1D`.
- Do not silently normalize away provider disagreement; OHLC and volume mismatches remain explicit evidence.
- KBS/VCI probe requests are server-only, bounded, and use direct requests; do not add Python/vnstock as a production dependency.
- Provider secrets, signatures, signed headers, internal stack traces, and unrestricted upstream URLs must never appear in probe API responses or logs.
- `market_ohlcv_history` stays the canonical local `1D` operational table; QEO-100 does not pre-decide latest-EOD authority before QEO-101.
- Existing QEO-92 `chart_ohlcv_intraday` + provenance + cold-store boundaries stay intact.
- Normal release gate: `pnpm verify:pr && pnpm build`.
- If no DB migration is introduced, do not add or modify migrations. If implementation unexpectedly requires schema changes, stop both lanes and re-plan before writing DDL.

---

## Parallel Work Model

### Coordinator bootstrap — must finish before dispatch

The coordinator owns only the shared contract and test routing. After this commit, both agents branch/worktree from the same exact SHA.

**Coordinator-owned files:**

- `modules/market/provider-benchmark/contract.ts`
- `modules/market/provider-benchmark/providers/index.ts` only for the initial stub; after dispatch Agent A owns this file exclusively.
- `tests/market-data-provider-adapters.test.ts`
- `tests/market-data-benchmark-ui.test.ts`
- `tests/market-data/provider-adapters.cases.ts`
- `tests/market-data/benchmark-ui.cases.ts`
- `tests/test-contracts.json`

### Agent A — Provider Lane

**Exclusive write ownership:**

- `modules/market/provider-benchmark/providers/dnse.ts`
- `modules/market/provider-benchmark/providers/kbs.ts`
- `modules/market/provider-benchmark/providers/vci.ts`
- `modules/market/provider-benchmark/providers/http.ts`
- `modules/market/provider-benchmark/providers/index.ts`
- `tests/market-data/provider-adapters.cases.ts`
- `tests/fixtures/market-data/kbs-*.json`
- `tests/fixtures/market-data/vci-*.json`

Agent A must not edit benchmark services, admin routes, chart components, `chart-data/service.ts`, or Agent B test files.

### Agent B — Benchmark / Promotion / UI Lane

**Exclusive write ownership:**

- `modules/market/provider-benchmark/benchmark.ts`
- `modules/market/provider-benchmark/reconcile.ts`
- `modules/market/provider-benchmark/probe-service.ts`
- `modules/market/provider-benchmark/promotion.ts`
- `app/api/admin/market-data/probe/route.ts`
- `app/api/admin/market-data/promote/route.ts`
- `tests/market-data/benchmark-ui.cases.ts`

Agent B may read but must not edit provider adapter files. Agent B must not pick a winning provider in code; it consumes the shared resolver contract and operates on normalized `ProviderFetchResult` values.

### Coordinator integration — after both lanes pass independently

**Coordinator-only integration files:**

- `modules/market/chart-data/provider.ts`
- `modules/market/chart-data/service.ts` only if the evidence-backed provider decision requires changing the default provider order.
- `docs/README.md`
- `docs/HANDOVER.md`
- QEO-100/QEO-101/QEO-98 Linear evidence.

This ownership rule is deliberate: the two agents can work concurrently without editing the same production files.

---

### Task 0: Coordinator — Freeze the shared provider contract and parallel test entrypoints

**Files:**
- Create: `modules/market/provider-benchmark/contract.ts`
- Create: `modules/market/provider-benchmark/providers/index.ts`
- Create: `tests/market-data-provider-adapters.test.ts`
- Create: `tests/market-data-benchmark-ui.test.ts`
- Create: `tests/market-data/provider-adapters.cases.ts`
- Create: `tests/market-data/benchmark-ui.cases.ts`
- Modify: `tests/test-contracts.json`

**Interfaces:**
- Produces: `MarketDataProbeProviderName`, `MarketDataProbeResolution`, `ProviderErrorClass`, `ProviderFetchRequest`, `ProviderFetchResult`, `MarketDataProbeProvider`, `ProviderResolver`, `ProviderProbeError`, `normalizeProbeRequest`.
- Agent A implements concrete `MarketDataProbeProvider` objects and the default resolver.
- Agent B consumes only these interfaces and the resolver.

- [ ] **Step 1: Add a failing shared contract test**

Create `tests/market-data-provider-adapters.test.ts`:

```ts
import "./market-data/provider-adapters.cases.ts"
```

Create `tests/market-data/provider-adapters.cases.ts`:

```ts
import assert from "node:assert/strict"
import test from "node:test"

import {
  MARKET_DATA_PROBE_PROVIDERS,
  normalizeProbeRequest,
} from "../../modules/market/provider-benchmark/contract.ts"

test("QEO-100 probe contract exposes only DNSE/KBS/VCI and canonical 1m/1D", () => {
  assert.deepEqual(MARKET_DATA_PROBE_PROVIDERS, ["DNSE", "KBS", "VCI"])
  assert.deepEqual(
    normalizeProbeRequest({ ticker: " vic ", resolution: "1m", from: 1_788_480_000, to: 1_788_566_400 }),
    { ticker: "VIC", resolution: "1m", from: 1_788_480_000, to: 1_788_566_400 },
  )
  assert.throws(() => normalizeProbeRequest({ ticker: "VIC", resolution: "15m" as never, from: 1, to: 2 }))
})
```

Add the test path to `tests/test-contracts.json` in the `fast` suite using the same active-entry shape as neighboring current tests.

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
node --test tests/market-data-provider-adapters.test.ts
```

Expected: FAIL because `modules/market/provider-benchmark/contract.ts` does not exist.

- [ ] **Step 3: Implement the shared contract**

Create `modules/market/provider-benchmark/contract.ts` with these exact exported shapes:

```ts
import "server-only"

import type { CanonicalOhlcvBar } from "@/modules/market/chart-data/contract"

export const MARKET_DATA_PROBE_PROVIDERS = ["DNSE", "KBS", "VCI"] as const
export type MarketDataProbeProviderName = (typeof MARKET_DATA_PROBE_PROVIDERS)[number]
export type MarketDataProbeResolution = "1m" | "1D"

export type ProviderErrorClass =
  | "AUTH"
  | "INVALID_REQUEST"
  | "UNSUPPORTED_RESOLUTION"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "NETWORK"
  | "EMPTY_COVERAGE"
  | "MALFORMED_RESPONSE"
  | "NORMALIZATION"

export type ProviderFetchRequest = {
  ticker: string
  resolution: MarketDataProbeResolution
  from: number
  to: number
}

export type ProviderFetchResult = ProviderFetchRequest & {
  provider: MarketDataProbeProviderName
  bars: CanonicalOhlcvBar[]
  requestedFrom: number
  requestedTo: number
  returnedFrom: number | null
  returnedTo: number | null
  rowCount: number
  latencyMs: number
  fetchedAt: string
  coverage: "FULL" | "PARTIAL" | "EMPTY"
  errorClass?: ProviderErrorClass
  providerDetail?: string
}

export interface MarketDataProbeProvider {
  readonly name: MarketDataProbeProviderName
  fetch(input: ProviderFetchRequest): Promise<ProviderFetchResult>
}

export type ProviderResolver = (name: MarketDataProbeProviderName) => MarketDataProbeProvider

export class ProviderProbeError extends Error {
  constructor(
    public readonly provider: MarketDataProbeProviderName,
    public readonly errorClass: ProviderErrorClass,
    message: string,
  ) {
    super(message)
  }
}

export function normalizeProbeRequest(input: ProviderFetchRequest): ProviderFetchRequest {
  const ticker = String(input.ticker || "").trim().toUpperCase()
  if (!/^[A-Z0-9]{2,12}$/.test(ticker)) throw new Error("Invalid probe ticker")
  if (input.resolution !== "1m" && input.resolution !== "1D") throw new Error("Unsupported probe resolution")
  if (!Number.isInteger(input.from) || !Number.isInteger(input.to) || input.from <= 0 || input.to <= input.from) {
    throw new Error("Invalid probe range")
  }
  const maxSpan = input.resolution === "1m" ? 7 * 86400 : 366 * 86400
  if (input.to - input.from > maxSpan) throw new Error("Probe range is too large")
  return { ticker, resolution: input.resolution, from: input.from, to: input.to }
}
```

Create `modules/market/provider-benchmark/providers/index.ts` as a compile-safe pre-dispatch stub:

```ts
import "server-only"

import type { MarketDataProbeProviderName, ProviderResolver } from "../contract"
import { ProviderProbeError } from "../contract"

export const resolveMarketDataProbeProvider: ProviderResolver = (name: MarketDataProbeProviderName) => {
  throw new ProviderProbeError(name, "INVALID_REQUEST", `Provider ${name} is not registered yet`)
}
```

- [ ] **Step 4: Add the Agent B test entrypoint and smoke case**

Create `tests/market-data-benchmark-ui.test.ts`:

```ts
import "./market-data/benchmark-ui.cases.ts"
```

Create `tests/market-data/benchmark-ui.cases.ts`:

```ts
import assert from "node:assert/strict"
import test from "node:test"

import { normalizeProbeRequest } from "../../modules/market/provider-benchmark/contract.ts"

test("QEO-100 benchmark lane shares the same canonical request contract", () => {
  assert.equal(normalizeProbeRequest({ ticker: "HPG", resolution: "1D", from: 1_780_000_000, to: 1_788_000_000 }).ticker, "HPG")
})
```

Register `tests/market-data-benchmark-ui.test.ts` in `tests/test-contracts.json` under `fast`.

- [ ] **Step 5: Run contract/manifest verification**

Run:

```bash
pnpm test:manifest
node --test tests/market-data-provider-adapters.test.ts tests/market-data-benchmark-ui.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the bootstrap and dispatch both agents from this SHA**

```bash
git add modules/market/provider-benchmark tests/test-contracts.json tests/market-data-provider-adapters.test.ts tests/market-data-benchmark-ui.test.ts tests/market-data
git commit -m "test(QEO-100): freeze provider benchmark contract"
```

Create two isolated branches/worktrees from this exact commit:

```text
agent/qeo-100-providers
agent/qeo-100-benchmark-ui
```

Do not dispatch either agent from an older SHA.

---

## Agent A — Provider Lane

### Task A1: DNSE adapter with decisive sanitized failure classification

**Files:**
- Create: `modules/market/provider-benchmark/providers/http.ts`
- Create: `modules/market/provider-benchmark/providers/dnse.ts`
- Modify: `tests/market-data/provider-adapters.cases.ts`

**Interfaces:**
- Consumes: `ProviderFetchRequest`, `ProviderFetchResult`, `MarketDataProbeProvider`, `ProviderProbeError`.
- Uses existing qeoindex functions `fetchMinuteOhlcvRange(symbol, from, to)` and `fetchDailyOhlcv(symbol, now, lookbackDays)` from `modules/market/providers/dnse/history.ts`.
- Produces: `createDnseProbeProvider()`.

- [ ] **Step 1: Write RED tests for success and AUTH/TIMEOUT classification**

Append tests using dependency injection rather than live internet:

```ts
test("DNSE probe returns normalized 1m metadata", async () => {
  const provider = createDnseProbeProvider({
    fetchMinute: async () => [{ time: 1_788_488_100, open: 244.7, high: 245, low: 244.6, close: 244.9, volume: 1200 }],
    fetchDaily: async () => [],
    nowMs: () => 10_000,
  })
  const result = await provider.fetch({ ticker: "VIC", resolution: "1m", from: 1_788_488_000, to: 1_788_488_200 })
  assert.equal(result.provider, "DNSE")
  assert.equal(result.rowCount, 1)
  assert.equal(result.coverage, "FULL")
})

test("DNSE probe maps credential rejection to AUTH without leaking credential text", async () => {
  const provider = createDnseProbeProvider({
    fetchMinute: async () => { throw new Error("DNSE API request failed (401): unauthorized") },
    fetchDaily: async () => [],
    nowMs: () => 10_000,
  })
  await assert.rejects(
    provider.fetch({ ticker: "VIC", resolution: "1m", from: 1_788_488_000, to: 1_788_488_200 }),
    (error: unknown) => error instanceof ProviderProbeError && error.errorClass === "AUTH" && !error.message.includes("API_SECRET"),
  )
})
```

- [ ] **Step 2: Run Agent A test entrypoint and verify RED**

```bash
node --test tests/market-data-provider-adapters.test.ts
```

Expected: FAIL because `createDnseProbeProvider` is missing.

- [ ] **Step 3: Implement shared provider timing/error helpers**

`providers/http.ts` must export:

```ts
export function classifyProviderError(error: unknown): ProviderErrorClass
export function elapsedMs(startMs: number, endMs: number): number
export function summarizeReturnedRange(bars: CanonicalOhlcvBar[]): { returnedFrom: number | null; returnedTo: number | null }
```

Classification rules:

```text
401/403/unauthorized/forbidden/signature -> AUTH
429/rate limit -> RATE_LIMIT
abort/timeout/deadline -> TIMEOUT
unsupported resolution -> UNSUPPORTED_RESOLUTION
400/422/invalid request -> INVALID_REQUEST
fetch/network/socket/DNS -> NETWORK
malformed/schema/JSON -> MALFORMED_RESPONSE
otherwise -> NETWORK
```

Never include environment values or signed headers in the returned message.

- [ ] **Step 4: Implement `createDnseProbeProvider`**

Use injected dependencies with production defaults. For `1m`, call exact-range `fetchMinuteOhlcvRange`. For `1D`, convert the requested span to a bounded lookback count and call `fetchDailyOhlcv`, then clip returned bars to `[from,to]`.

Return `FULL` when bars cover the requested completed range sufficiently for the probe, `EMPTY` when zero bars return, otherwise `PARTIAL`. Do not invent missing bars.

- [ ] **Step 5: Run tests**

```bash
node --test tests/market-data-provider-adapters.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit A1**

```bash
git add modules/market/provider-benchmark/providers/http.ts modules/market/provider-benchmark/providers/dnse.ts tests/market-data/provider-adapters.cases.ts
git commit -m "feat(QEO-100): add DNSE benchmark adapter"
```

### Task A2: KBS anonymous web-market-data adapter for native `1m` and `1D`

**Files:**
- Create: `modules/market/provider-benchmark/providers/kbs.ts`
- Create: `tests/fixtures/market-data/kbs-vic-1m.json`
- Create: `tests/fixtures/market-data/kbs-vic-1d.json`
- Modify: `tests/market-data/provider-adapters.cases.ts`

**Interfaces:**
- Produces: `createKbsProbeProvider({ fetchImpl?, nowMs? })`.
- Native KBS endpoint pattern: `https://kbbuddywts.kbsec.com.vn/iis-server/investment/stocks/{ticker}/data_{suffix}`.
- Suffixes for this plan: `1m -> 1P`, `1D -> day`.

- [ ] **Step 1: Add RED fixture tests**

Use small committed fixtures with raw keys `t/o/h/l/c/v`. Assert:

```ts
assert.deepEqual(result.bars[0], {
  time: expectedEpochSeconds,
  open: 244.7,
  high: 245.0,
  low: 244.6,
  close: 244.9,
  volume: expectedVolume,
})
```

Also assert the request URL contains `/stocks/VIC/data_1P` for `1m` and `/stocks/VIC/data_day` for `1D`, with `sdate` and `edate` formatted `DD-MM-YYYY`.

- [ ] **Step 2: Run RED**

```bash
node --test tests/market-data-provider-adapters.test.ts
```

Expected: FAIL because KBS adapter is missing.

- [ ] **Step 3: Implement KBS request and normalization**

Production request requirements:

```text
method: GET
Accept: application/json, text/plain, */*
User-Agent: deterministic browser-like UA
bounded AbortSignal.timeout: 8 seconds
no Authorization header
no cookie/account credential
```

Parse `data_1P` or `data_day`. Normalize stock OHLC from raw VND-style integers to the qeoindex canonical stock-price unit by dividing by `1000`, matching existing qeoindex chart storage semantics. Keep volume as returned integer shares; do not alter it to match another provider.

Clip bars strictly to the requested epoch range. Reject non-finite values and invalid OHLC (`low > open/close`, `high < open/close`, `low > high`) as `NORMALIZATION`.

- [ ] **Step 4: Run tests and typecheck**

```bash
node --test tests/market-data-provider-adapters.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit A2**

```bash
git add modules/market/provider-benchmark/providers/kbs.ts tests/fixtures/market-data/kbs-vic-1m.json tests/fixtures/market-data/kbs-vic-1d.json tests/market-data/provider-adapters.cases.ts
git commit -m "feat(QEO-100): add KBS OHLC benchmark adapter"
```

### Task A3: VCI anonymous web-market-data adapter and provider registry

**Files:**
- Create: `modules/market/provider-benchmark/providers/vci.ts`
- Create: `tests/fixtures/market-data/vci-vic-1m.json`
- Create: `tests/fixtures/market-data/vci-vic-1d.json`
- Modify: `modules/market/provider-benchmark/providers/index.ts`
- Modify: `tests/market-data/provider-adapters.cases.ts`

**Interfaces:**
- Produces: `createVciProbeProvider({ fetchImpl?, nowMs? })`.
- VCI endpoint: `POST https://trading.vietcap.com.vn/api/chart/OHLCChart/gap-chart`.
- Request mapping: `1m -> ONE_MINUTE`, `1D -> ONE_DAY`.
- Final registry: `resolveMarketDataProbeProvider("DNSE" | "KBS" | "VCI")`.

- [ ] **Step 1: Add RED VCI normalization/request tests**

Assert the POST body is exactly shaped around:

```ts
{
  timeFrame: "ONE_MINUTE",
  symbols: ["VIC"],
  to: request.to,
  countBack: boundedCountBack,
}
```

For Daily use `ONE_DAY`. Verify vector-form responses (`t/o/h/l/c/v` arrays) normalize into ascending canonical bars and divide stock prices by `1000`, matching the current vnstock VCI normalization behavior.

- [ ] **Step 2: Run RED**

```bash
node --test tests/market-data-provider-adapters.test.ts
```

Expected: FAIL because VCI adapter/registry implementation is absent.

- [ ] **Step 3: Implement VCI adapter**

Use deterministic browser-like headers with `Origin: https://trading.vietcap.com.vn` and `Referer: https://trading.vietcap.com.vn/`, no Authorization credential, and an 8-second bounded timeout.

Compute `countBack` conservatively:

```text
1m: min(5 * 255 + 20, 1500)
1D: min(requested calendar days + 20, 400)
```

The benchmark will discover retention limits; this adapter must not silently request unbounded history.

- [ ] **Step 4: Replace the bootstrap registry stub**

`providers/index.ts` must instantiate the three concrete adapters once and return them by exact provider name. Unknown names are impossible at the TypeScript boundary; runtime-invalid input is rejected by the route/service before resolver invocation.

- [ ] **Step 5: Run Agent A verification**

```bash
node --test tests/market-data-provider-adapters.test.ts
pnpm lint:touched
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit A3 and report Agent A handoff**

```bash
git add modules/market/provider-benchmark/providers tests/fixtures/market-data tests/market-data/provider-adapters.cases.ts
git commit -m "feat(QEO-100): add VCI adapter and provider registry"
```

Agent A handoff must report:

```text
branch SHA
files changed
unit-test command/result
KBS raw price scaling assumption tested
VCI raw price scaling assumption tested
live internet not required by deterministic tests
no provider winner selected
```

---

## Agent B — Benchmark / Promotion / UI Lane

### Task B1: Provider-neutral benchmark and reconciliation engine

**Files:**
- Create: `modules/market/provider-benchmark/reconcile.ts`
- Create: `modules/market/provider-benchmark/benchmark.ts`
- Modify: `tests/market-data/benchmark-ui.cases.ts`

**Interfaces:**
- Consumes: `ProviderFetchRequest`, `ProviderFetchResult`, `MarketDataProbeProvider`, `ProviderResolver`.
- Produces: `compareProviderResults`, `runProviderBenchmark`, `BenchmarkResult`, `ProviderComparison`.

- [ ] **Step 1: Add RED reconciliation tests**

Use fake normalized providers with the VIC 2026-09-04 evidence pattern:

```ts
const yahooLike = { open: 244.7, high: 260, low: 244.7, close: 256.1, volume: 7_584_520 }
const referenceLike = { open: 244.7, high: 260, low: 244.7, close: 256.1, volume: 7_518_600 }
```

Assert:

```text
OHLC exactMatch = true
volumeExactMatch = false
volumeDelta = 65_920
volumeDeltaRatio ≈ 0.00877
mismatch remains in output
```

Also test missing timestamp, extra timestamp, and a one-price-field mismatch.

- [ ] **Step 2: Run RED**

```bash
node --test tests/market-data-benchmark-ui.test.ts
```

Expected: FAIL because benchmark modules are missing.

- [ ] **Step 3: Implement `compareProviderResults`**

Comparison output for each overlapping timestamp must include:

```ts
type BarComparison = {
  time: number
  leftPresent: boolean
  rightPresent: boolean
  ohlcExactMatch: boolean
  volumeExactMatch: boolean
  openDelta: number | null
  highDelta: number | null
  lowDelta: number | null
  closeDelta: number | null
  volumeDelta: number | null
  volumeDeltaRatio: number | null
}
```

Do not apply a hidden tolerance. Exact normalized equality is the primary evidence; callers may inspect deltas separately.

- [ ] **Step 4: Implement `runProviderBenchmark`**

Signature:

```ts
export async function runProviderBenchmark(
  input: ProviderFetchRequest,
  providerNames: MarketDataProbeProviderName[],
  resolveProvider: ProviderResolver,
): Promise<BenchmarkResult>
```

Use `Promise.allSettled` so one provider failure does not suppress evidence from the others. Return provider success/failure summaries and pairwise comparison results. Error outputs expose only provider name, error class, sanitized message, and latency metadata.

- [ ] **Step 5: Run tests**

```bash
node --test tests/market-data-benchmark-ui.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit B1**

```bash
git add modules/market/provider-benchmark/reconcile.ts modules/market/provider-benchmark/benchmark.ts tests/market-data/benchmark-ui.cases.ts
git commit -m "feat(QEO-100): add OHLC provider reconciliation engine"
```

### Task B2: Root-only bounded provider probe API

**Files:**
- Create: `modules/market/provider-benchmark/probe-service.ts`
- Create: `app/api/admin/market-data/probe/route.ts`
- Modify: `tests/market-data/benchmark-ui.cases.ts`

**Interfaces:**
- Uses existing `requireApiRoot()` from `modules/auth/root.ts`.
- Uses `resolveMarketDataProbeProvider` from the shared registry path; the bootstrap stub allows Agent B to compile independently before Agent A integration.
- Produces: `executeMarketDataProbe()` and root-only `POST /api/admin/market-data/probe`.

- [ ] **Step 1: Add RED input/auth/secret-sanitization tests**

Tests must verify source contract contains `requireApiRoot()` before provider work and that service rejects:

```text
provider outside DNSE/KBS/VCI
resolution outside 1m/1D
invalid ticker
1m range > 7 calendar days
1D range > 366 calendar days
```

Add a fake provider that throws a message containing a marker such as `super-secret-marker`; assert the service/API output does not contain that marker.

- [ ] **Step 2: Run RED**

```bash
node --test tests/market-data-benchmark-ui.test.ts
```

Expected: FAIL because probe service/route is missing.

- [ ] **Step 3: Implement probe service**

Input shape:

```ts
type ProbeCommand = {
  providers: MarketDataProbeProviderName[]
  ticker: string
  resolution: MarketDataProbeResolution
  from: number
  to: number
}
```

Require at least one and at most three providers; de-duplicate provider names. Call `normalizeProbeRequest`, then `runProviderBenchmark`.

- [ ] **Step 4: Implement root-only route**

Route requirements:

```text
runtime = nodejs
dynamic = force-dynamic
method = POST
Cache-Control = private, no-store, no-cache, max-age=0
```

Call `requireApiRoot()` first. Parse JSON; return `400` for invalid input and `200` for a benchmark even when one/all providers fail—the failure evidence belongs in the normalized benchmark payload. Return `503` only when the benchmark service itself cannot execute due to an internal dependency failure unrelated to provider availability.

- [ ] **Step 5: Run tests and typecheck**

```bash
node --test tests/market-data-benchmark-ui.test.ts
pnpm lint:touched
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit B2**

```bash
git add modules/market/provider-benchmark/probe-service.ts app/api/admin/market-data/probe/route.ts tests/market-data/benchmark-ui.cases.ts
git commit -m "feat(QEO-100): add root-only market data probe API"
```

### Task B3: Explicit bounded canonical promotion + UI verification support

**Files:**
- Create: `modules/market/provider-benchmark/promotion.ts`
- Create: `app/api/admin/market-data/promote/route.ts`
- Modify: `tests/market-data/benchmark-ui.cases.ts`

**Interfaces:**
- Uses existing `upsertHotIntradayBars()` from `modules/market/chart-data/hot-store.ts`.
- Uses existing `getSupabaseServerClient()` and `requireApiRoot()`.
- Produces: `promoteValidatedMinuteProbe()` and root-only `POST /api/admin/market-data/promote`.
- This task promotes `1m` only. It must reject `1D` promotion and point the operator to QEO-101; QEO-100 must not silently redefine Daily authority.

- [ ] **Step 1: Add RED promotion tests with a fake Supabase boundary**

Assert promotion rejects when:

```text
resolution != 1m
provider result has errorClass
provider result rowCount == 0
coverage == EMPTY
bars violate canonical OHLC invariants
requested span > 7 days
```

Assert valid VIC input calls the hot-store boundary with:

```ts
{
  ticker: "VIC",
  bars,
  provider: "KBS" | "VCI" | "DNSE",
  detail: {
    qeoIssue: "QEO-100",
    resolution: "1m",
    requestedFrom,
    requestedTo,
    benchmarked: true,
  },
}
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/market-data-benchmark-ui.test.ts
```

Expected: FAIL because promotion module/route is missing.

- [ ] **Step 3: Implement promotion service**

`promoteValidatedMinuteProbe()` must accept a normalized successful `ProviderFetchResult` plus injected `upsert` function for tests. It may persist only the bars present in the result; it must not fill gaps or derive bars.

Return:

```ts
{
  ticker: string
  provider: MarketDataProbeProviderName
  rowCount: number
  batchId: string | null
  firstTime: number
  lastTime: number
}
```

- [ ] **Step 4: Implement root-only promotion route**

Request requires an explicit single provider plus ticker/range. The route must refetch the provider through the benchmark adapter at promotion time rather than trusting bars supplied by the browser. This prevents a caller from posting arbitrary OHLC into canonical storage.

Before write:

```text
requireApiRoot
normalize request
fetch one provider
require successful non-empty 1m result
promote through hot-store
```

Return provenance batch ID and row count, never raw upstream secrets.

- [ ] **Step 5: Add UI contract regression assertions**

In the same Agent B case file, read the current production source files and assert:

```text
components/stock-detail/chart/use-canonical-minute-bars.ts requests /api/market/ohlcv
resolution is 1m
stock-tradingview-chart.tsx consumes useCanonicalMinuteBars
no KBS/VCI/DNSE provider URL appears in stock-detail client files
```

These tests protect the provider-agnostic UI boundary; do not modify chart UI unless a test exposes a real regression.

- [ ] **Step 6: Run Agent B verification**

```bash
node --test tests/market-data-benchmark-ui.test.ts
pnpm lint:touched
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit B3 and report Agent B handoff**

```bash
git add modules/market/provider-benchmark app/api/admin/market-data tests/market-data/benchmark-ui.cases.ts
git commit -m "feat(QEO-100): add bounded canonical promotion and UI verification contract"
```

Agent B handoff must report:

```text
branch SHA
files changed
benchmark/reconciliation test result
root-auth/input-bound test result
promotion cannot accept browser-supplied bars
1D promotion explicitly rejected pending QEO-101
no provider winner selected
```

---

## Coordinator Integration

### Task I1: Integrate both agent branches and run the deterministic full gate

**Files:**
- Merge/cherry-pick both agent branches into the QEO-100 integration branch.
- No production behavior changes beyond the two reviewed lanes yet.

- [ ] **Step 1: Review Agent A and Agent B summaries and diffs independently**

Reject integration if either agent:

```text
edits the other lane's exclusive files
adds a frontend provider URL
adds synthetic candles
adds SSI/TitanLabs runtime dependency
logs secrets/signed headers
changes DB schema
pre-selects a winning provider
```

- [ ] **Step 2: Integrate Agent A then Agent B**

Use normal git merge/cherry-pick semantics. Resolve only expected import/registry conflicts. If both agents touched the same non-bootstrap file unexpectedly, stop and review rather than auto-resolving.

- [ ] **Step 3: Run deterministic tests**

```bash
pnpm test:manifest
node --test tests/market-data-provider-adapters.test.ts tests/market-data-benchmark-ui.test.ts
pnpm verify:pr
pnpm build
```

Expected: PASS.

- [ ] **Step 4: Commit integration if needed**

```bash
git commit -m "feat(QEO-100): integrate provider benchmark lanes"
```

### Task I2: Deploy preview and execute live DNSE/KBS/VCI probes

**Files:**
- No code changes expected unless live evidence exposes a root-cause bug.
- Evidence goes to Linear QEO-100.

**Probe order:**

```text
1. DNSE direct VIC 1m, one completed session
2. KBS VIC 1m, same session
3. VCI VIC 1m, same session
4. DNSE/KBS/VCI VIC 1D, same recent 20 sessions
5. Expand successful 1m sources to five sessions
6. Repeat bounded benchmark for VCB, HPG, one canonical HNX name, one canonical UPCOM name
```

- [ ] **Step 1: Deploy the integration branch to a protected preview**

Do not merge to `main` yet.

- [ ] **Step 2: Call `POST /api/admin/market-data/probe` while authenticated as root**

Example payload:

```json
{
  "providers": ["DNSE", "KBS", "VCI"],
  "ticker": "VIC",
  "resolution": "1m",
  "from": 1788487200,
  "to": 1788508800
}
```

Use an actual completed VIC session timestamp range resolved at execution time; do not reuse the example if it does not cover the intended session.

- [ ] **Step 3: Record the sanitized matrix**

For each provider capture:

```text
success/failure
errorClass
latencyMs
rowCount
returnedFrom/returnedTo
OHLC mismatch count
volume mismatch count
missing timestamp count
```

For DNSE, the first priority is a conclusive error class or success after credential rotation.

- [ ] **Step 4: Compare a sample against Finhay MCP**

Use Finhay as independent evidence only. Compare at least five completed `1D` bars and, where Finhay supports the chosen overlapping interval, corresponding intraday bars. Record differences; do not alter provider bars to force equality.

- [ ] **Step 5: Determine provider hierarchy manually from evidence**

Write one explicit decision in QEO-100:

```text
Historical 1m primary: <evidence-backed provider>
Historical 1m fallback: <evidence-backed provider or none>
Historical 1D candidate primary: <provider>
Historical 1D candidate fallback: <provider>
DNSE status: healthy / failed with exact class
Unresolved gap requiring QEO-102: yes/no
```

No automatic score decides this.

### Task I3: Promote bounded VIC minute history and verify canonical API

**Files:**
- No code change expected if promotion path works.

- [ ] **Step 1: Promote only the approved VIC `1m` provider**

Call root-only `POST /api/admin/market-data/promote` for at most five completed sessions.

- [ ] **Step 2: Verify Supabase persistence**

Query production/preview Supabase and require:

```text
chart_ohlcv_intraday rowCount > 0 for VIC/1m
chart_ohlcv_provenance_batches row exists
provider matches the approved provider
range_start/range_end match promoted coverage
no duplicate (ticker, base_resolution, bar_time)
```

- [ ] **Step 3: Verify canonical route**

Authenticated request:

```text
GET /api/market/ohlcv?ticker=VIC&resolution=1m&from=...&to=...
```

Require `200`, non-empty `bars`, deterministic ascending timestamps, and no synthetic gap filling.

- [ ] **Step 4: Repeat the exact request twice**

Require identical normalized historical bars across both responses. Metadata timestamps may differ; candle values must not.

### Task I4: Production UI verification on `/insights/vic`

**Files:**
- Modify chart client code only if this acceptance uncovers a reproducible UI bug; any fix gets its own RED test before code.

- [ ] **Step 1: Merge/deploy only after preview probe + canonical promotion passes**

Use the repository's normal single-merge/single-production-deploy workflow.

- [ ] **Step 2: Hard-refresh `/insights/vic` while authenticated**

Verify `1D` first, then select `1m`.

- [ ] **Step 3: Check network behavior**

Require:

```text
/api/market/ohlcv -> HTTP 200
no direct KBS URL from browser
no direct VCI URL from browser
no direct DNSE URL from browser
```

- [ ] **Step 4: Compare five completed visible candles**

For five timestamps visible on the chart, record:

```text
time
UI open/high/low/close/volume
canonical API open/high/low/close/volume
selected provider normalized bar
```

Require UI == canonical API exactly. Provider-normalized comparison must match the promoted canonical bars for the same timestamps; any mismatch blocks acceptance and is investigated rather than patched visually.

- [ ] **Step 5: Exercise state transitions**

Verify:

```text
1D -> 1m -> 1D -> 1m
reload on 1m
pan/zoom inside loaded minute history
no infinite spinner
no "Không tải được" when canonical rows exist
no synthetic micro-volatility
VN lunch/session gap remains visible
```

- [ ] **Step 6: Simulate provider-unavailable behavior after local promotion**

A previously promoted historical range must remain readable from local canonical storage even if the upstream probe fails. Do not intentionally corrupt or delete production data; use provider injection/preview or a controlled failure test.

### Task I5: Expand sample coverage and finalize QEO-100 evidence

- [ ] **Step 1: Resolve one liquid HNX and one liquid UPCOM ticker from the live canonical universe**

Do not hard-code stale examples.

- [ ] **Step 2: Run the same bounded benchmark for VIC, VCB, HPG, HNX sample, UPCOM sample**

Require provider coverage and mismatch summaries for `1m` and `1D` where available.

- [ ] **Step 3: Update QEO-100 with the final matrix**

Include:

```text
provider
credential requirement
1m availability
1D availability
exchange coverage
historical depth observed
P50/P95 latency from probe sample
failure class/count
OHLC mismatch count
volume mismatch count
Vercel runtime result
selected role
```

- [ ] **Step 4: Update QEO-101**

Pass only the Daily evidence. QEO-101 decides provider-authoritative vs primary/fallback vs local-finalization; QEO-100 must not make that decision implicitly.

- [ ] **Step 5: Update QEO-102**

If DNSE/KBS/VCI leave no material historical gap, keep TitanLabs deferred/cancelable. If a concrete gap remains, document exactly that gap before any TitanLabs probe.

- [ ] **Step 6: Update QEO-98 acceptance evidence**

Attach the VIC five-candle equality check and production UI smoke evidence.

---

## Agent Dispatch Prompts

### Prompt for Agent A

```text
You are Agent A on QEO-100. Work only on the provider lane.

Read:
- docs/superpowers/specs/2026-09-05-qeo-100-market-data-sot-ui-verification-design.md
- docs/superpowers/plans/2026-09-05-qeo-100-two-agent-market-data-sot-ui-verification.md

Implement Tasks A1-A3 using TDD.

Exclusive files:
- modules/market/provider-benchmark/providers/*
- tests/market-data/provider-adapters.cases.ts
- tests/fixtures/market-data/kbs-*.json
- tests/fixtures/market-data/vci-*.json

Do not edit benchmark services, admin routes, chart UI, chart-data service, DB schema, or Agent B files.
Do not select a winning provider.
Do not add SSI/TitanLabs.
Do not expose credentials or signed headers.

Return:
1. root-cause/error-classification findings for DNSE adapter behavior,
2. exact KBS/VCI normalization assumptions covered by fixtures,
3. branch final SHA,
4. tests/typecheck/lint results,
5. changed-file list.
```

### Prompt for Agent B

```text
You are Agent B on QEO-100. Work only on benchmark/reconciliation, root-only probe/promotion surfaces, and provider-agnostic UI/canonical verification contracts.

Read:
- docs/superpowers/specs/2026-09-05-qeo-100-market-data-sot-ui-verification-design.md
- docs/superpowers/plans/2026-09-05-qeo-100-two-agent-market-data-sot-ui-verification.md

Implement Tasks B1-B3 using TDD.

Exclusive files:
- modules/market/provider-benchmark/benchmark.ts
- modules/market/provider-benchmark/reconcile.ts
- modules/market/provider-benchmark/probe-service.ts
- modules/market/provider-benchmark/promotion.ts
- app/api/admin/market-data/probe/route.ts
- app/api/admin/market-data/promote/route.ts
- tests/market-data/benchmark-ui.cases.ts

Read provider files if needed but do not edit them. The bootstrap resolver stub is expected; your tests must use injected fake providers and remain independent of Agent A.
Do not pick a winning provider.
Do not allow browser-supplied bars into canonical storage.
Do not add 1D promotion; QEO-101 owns Daily authority.
Do not modify stock chart UI unless the existing provider-agnostic boundary fails a regression assertion.

Return:
1. benchmark/reconciliation behavior summary,
2. root-auth and input-bound evidence,
3. promotion safety evidence,
4. branch final SHA,
5. tests/typecheck/lint results,
6. changed-file list.
```

---

## Self-Review

### Spec coverage

- DNSE decisive retry: Agent A + I2.
- KBS/VCI server-side probes: Agent A + I2.
- Provider-neutral benchmark/reconciliation: Agent B B1.
- Root-only bounded probe: Agent B B2.
- No SSI critical path: global constraint + no SSI tasks.
- TitanLabs deferred: global constraint + I5.
- Volume mismatch explicit: B1 + I2.
- Bounded VIC canonical promotion: B3 + I3.
- Existing QEO-92 Hot/Cold/provenance boundary: B3 + I3.
- Provider-agnostic `/api/market/ohlcv`: B3 regression + I3/I4.
- Five-candle UI equality verification: I4.
- Staged multi-exchange rollout: I5.
- Daily authority deferred to QEO-101: B3 rejects 1D + I5 handoff.

### Placeholder scan

No `TBD`, `TODO`, or unspecified implementation steps remain. Live timestamps and HNX/UPCOM tickers are intentionally resolved at execution time because the spec requires live canonical-universe evidence rather than stale hard-coding.

### Type consistency

Both lanes use only the Task 0 shared types: `ProviderFetchRequest`, `ProviderFetchResult`, `MarketDataProbeProvider`, `ProviderResolver`, and `ProviderProbeError`. Provider names remain exactly `DNSE | KBS | VCI`; canonical probe resolutions remain exactly `1m | 1D`.
