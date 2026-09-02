# N+1 Query Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the active Wyckoff EOD N+1 history reads and reuse one immutable 200-ticker build artifact across build, validation, and publish phases.

**Architecture:** First make `qeo_market_ohlcv_recent` efficient and safe for bounded multi-ticker reads, then add a batch cache loader so 200 tickers require 20 RPCs instead of 200. Next persist run-scoped Wyckoff build artifacts so `SUPABASE_VALIDATE` and `SUPABASE_PUBLISH` reuse the exact build result instead of re-reading/rebuilding the universe. Chart series is derived from the same cached Daily history, eliminating a second history-read pass.

**Tech Stack:** Next.js 16 / TypeScript, Supabase Postgres + PostgREST RPC, `@supabase/supabase-js`, Vercel Workflow, `node:test`, GitHub Actions DB Drift.

**Spec:** `docs/superpowers/specs/2026-09-02-n-plus-one-query-audit-design.md`

## Global Constraints

- Canonical universe remains capped at 200 tickers.
- `DAILY_V2_CACHE_LIMIT` remains 1,700 Daily bars; do not trade away historical depth for fewer queries.
- `market_ohlcv_history` remains canonical hot history and is not pruned in this work.
- Preserve separate `WYCKOFF_BUILD`, `SUPABASE_VALIDATE`, and `SUPABASE_PUBLISH` phase telemetry.
- Validation remains fail-closed on incomplete coverage, canonical mismatch, or validation-hash mismatch.
- New DB objects/RPC changes are service-role only.
- Batch size is explicit and bounded at 10 tickers for full-history reads.
- Supabase migration changes require clean replay, generated type verification, migration ledger reconciliation, and production migration application before runtime merge.
- TDD: regression must fail before production code is changed.

---

### Task 1: Lock the N+1 regression contract before changing runtime code

**Files:**
- Modify: `tests/wyckoff-v2-chart-series.test.ts`
- Modify: `tests/wyckoff-v2-runtime-data.test.ts`
- Modify: `tests/db-schema-contract.test.ts`

**Interfaces:**
- Consumes: current `loadWyckoffV2ChartSeriesRows()`, `cachedHistoryFromRows()`, `qeo_market_ohlcv_recent(text[], integer)`.
- Produces: failing query-count and SQL-shape contracts used by Tasks 2-4.

- [ ] **Step 1: Replace the existing chart-series test that intentionally requires one RPC per ticker**

Change the 100-ticker regression to require bounded batches:

```ts
test("chart-series loader batches ticker RPC reads instead of issuing N+1 requests", async () => {
  const tickers = Array.from({ length: 100 }, (_, index) => `T${String(index + 1).padStart(3, "0")}`)
  const calls: Array<{ tickers: string[]; limit: number }> = []
  const supabase = {
    rpc: async (_name: string, args: { p_tickers: string[]; p_limit: number }) => {
      calls.push({ tickers: args.p_tickers, limit: args.p_limit })
      return { data: completeRows(args.p_tickers), error: null }
    },
  } as unknown as SupabaseClient

  const rows = await loadWyckoffV2ChartSeriesRows(supabase, tickers, RUN_ID)

  assert.equal(rows.length, 100)
  assert.equal(calls.length, 10)
  assert.ok(calls.every((call) => call.tickers.length > 0 && call.tickers.length <= 10))
  assert.ok(calls.every((call) => call.limit === 260))
})
```

- [ ] **Step 2: Add a batch cached-history loader contract**

Extend `tests/wyckoff-v2-runtime-data.test.ts` with a mocked RPC test for a new interface:

```ts
const histories = await loadWyckoffV2CachedHistories(supabase, tickers)
assert.equal(histories.size, 100)
assert.equal(calls.length, 10)
assert.ok(calls.every((call) => call.p_tickers.length <= 10))
assert.ok(calls.every((call) => call.p_limit === DAILY_V2_CACHE_LIMIT))
```

The mock must return complete per-ticker rows and the test must also fail closed when one requested ticker is absent.

- [ ] **Step 3: Add a SQL contract for batch-friendly RPC semantics**

In `tests/db-schema-contract.test.ts`, locate the newest migration ending in `_wyckoff_batch_history_reads.sql` and assert:

```ts
assert.match(sql, /create or replace function public\.qeo_market_ohlcv_recent\(p_tickers text\[\], p_limit integer default 260\)/i)
assert.match(sql, /unnest\(p_tickers\)/i)
assert.match(sql, /cross join lateral/i)
assert.match(sql, /least\(coalesce\(p_limit,\s*260\),\s*1700\)/i)
assert.match(sql, /grant execute on function public\.qeo_market_ohlcv_recent\(text\[\], integer\) to service_role/i)
```

- [ ] **Step 4: Run the targeted tests and confirm RED**

Run:

```bash
node --test tests/wyckoff-v2-chart-series.test.ts tests/wyckoff-v2-runtime-data.test.ts tests/db-schema-contract.test.ts
```

Expected: FAIL because the existing loaders still issue one request per ticker and the new migration does not exist.

- [ ] **Step 5: Commit the RED tests**

```bash
git add tests/wyckoff-v2-chart-series.test.ts tests/wyckoff-v2-runtime-data.test.ts tests/db-schema-contract.test.ts
git commit -m "test: define Wyckoff N+1 query contracts"
```

---

### Task 2: Make the OHLCV RPC batch-friendly and index-aligned

**Files:**
- Create: `supabase/migrations/<timestamp>_wyckoff_batch_history_reads.sql`
- Modify after replay: `lib/supabase/database.types.ts` only if generated output changes
- Modify after production apply: `supabase/migration-equivalence.json`
- Modify after production apply: `docs/db/evidence/production-migration-ledger-2026-09-02.json` or the current-date ledger file

**Interfaces:**
- Consumes: `public.market_ohlcv_history`, lookup index `(ticker, timeframe, bar_time desc)`.
- Produces: same RPC signature `qeo_market_ohlcv_recent(p_tickers text[], p_limit integer default 260)` but supports up to 1,700 rows per ticker and executes one bounded index-backed lateral lookup per ticker inside one SQL statement.

- [ ] **Step 1: Create the migration with the same RPC signature**

Use the following SQL shape:

```sql
begin;

create or replace function public.qeo_market_ohlcv_recent(
  p_tickers text[],
  p_limit integer default 260
)
returns table (
  ticker text,
  timeframe text,
  bar_time timestamptz,
  open double precision,
  high double precision,
  low double precision,
  close double precision,
  volume double precision,
  provider text,
  provider_detail text,
  source_url text,
  fetched_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    h.ticker,
    h.timeframe,
    h.bar_time,
    h.open,
    h.high,
    h.low,
    h.close,
    h.volume,
    h.provider,
    h.provider_detail,
    h.source_url,
    h.fetched_at
  from unnest(p_tickers) as requested(ticker)
  cross join lateral (
    select source.*
    from public.market_ohlcv_history source
    where source.ticker = requested.ticker
      and source.timeframe = '1D'
    order by source.bar_time desc
    limit greatest(1, least(coalesce(p_limit, 260), 1700))
  ) h
  order by h.ticker, h.bar_time;
$$;

revoke all on function public.qeo_market_ohlcv_recent(text[], integer) from public, anon, authenticated;
grant execute on function public.qeo_market_ohlcv_recent(text[], integer) to service_role;

commit;
```

- [ ] **Step 2: Run the DB schema contract**

```bash
node --test tests/db-schema-contract.test.ts
```

Expected: PASS for the new SQL-shape assertions.

- [ ] **Step 3: Run clean local Supabase replay and generated-type verification**

```bash
pnpm db:replay:verify
pnpm db:types:verify
```

If the signature is unchanged, generated types should remain semantically unchanged. If the generator changes formatting/output, commit the generated file rather than editing it by hand.

- [ ] **Step 4: Benchmark the local/production query shape before runtime cutover**

Use `EXPLAIN (ANALYZE, BUFFERS)` with ten representative canonical tickers for `p_limit=260` and `p_limit=1700`. Verify the plan uses the existing ticker/timeframe/bar-time index path and does not introduce a sequential scan over the entire table.

- [ ] **Step 5: Apply the migration to production and reconcile the ledger immediately**

Apply through the Supabase migration tool / `npx supabase db push` equivalent required by repository instructions. Record the actual production migration version in `migration-equivalence.json` if it differs from the repository filename, refresh the production migration ledger, then rerun drift verification.

- [ ] **Step 6: Commit the migration/evidence**

```bash
git add supabase/migrations lib/supabase/database.types.ts supabase/migration-equivalence.json docs/db/evidence
git commit -m "perf: support bounded batch OHLCV history reads"
```

---

### Task 3: Replace one-ticker cache reads with a bounded batch loader

**Files:**
- Modify: `lib/wyckoff-v2-cache-read.ts`
- Modify: `tests/wyckoff-v2-runtime-data.test.ts`

**Interfaces:**
- Produces:
  - `WYCKOFF_HISTORY_QUERY_BATCH_SIZE = 10`
  - `loadWyckoffV2CachedHistories(supabase, tickerInputs): Promise<Map<string, { daily: CachedOhlcvHistory; hourly: CachedOhlcvHistory }>>`
- Preserves: `loadWyckoffV2CachedTickerHistory()` as a one-ticker compatibility wrapper around the batch loader.

- [ ] **Step 1: Add ticker normalization shared by single and batch reads**

```ts
export const WYCKOFF_HISTORY_QUERY_BATCH_SIZE = 10

function normalizeHistoryTickers(input: string[]) {
  const tickers = [...new Set(input.map((value) => value.trim().toUpperCase()).filter(Boolean))]
  for (const ticker of tickers) {
    if (!/^[A-Z0-9]{2,12}$/.test(ticker)) throw new Error(`Invalid ticker: ${ticker}`)
  }
  return tickers
}
```

- [ ] **Step 2: Implement the batch RPC loader**

```ts
export async function loadWyckoffV2CachedHistories(
  supabase: SupabaseClient,
  tickerInputs: string[],
) {
  const tickers = normalizeHistoryTickers(tickerInputs)
  const rows: StoredV2OhlcvRow[] = []

  for (let offset = 0; offset < tickers.length; offset += WYCKOFF_HISTORY_QUERY_BATCH_SIZE) {
    const batch = tickers.slice(offset, offset + WYCKOFF_HISTORY_QUERY_BATCH_SIZE)
    const { data, error } = await supabase.rpc("qeo_market_ohlcv_recent", {
      p_tickers: batch,
      p_limit: DAILY_V2_CACHE_LIMIT,
    })
    if (error) throw new Error(`OHLCV batch cache read failed: ${error.message}`)
    rows.push(...((data || []) as StoredV2OhlcvRow[]))
  }

  const result = new Map<string, { daily: CachedOhlcvHistory; hourly: CachedOhlcvHistory }>()
  for (const ticker of tickers) {
    const daily = cachedHistoryFromRows(ticker, rows)
    result.set(ticker, { daily, hourly: daily })
  }
  return result
}
```

- [ ] **Step 3: Convert the single-ticker loader into a wrapper**

```ts
export async function loadWyckoffV2CachedTickerHistory(supabase: SupabaseClient, tickerInput: string) {
  const ticker = normalizeHistoryTickers([tickerInput])[0]
  const histories = await loadWyckoffV2CachedHistories(supabase, [ticker])
  return histories.get(ticker)!
}
```

- [ ] **Step 4: Run runtime-data tests**

```bash
node --test tests/wyckoff-v2-runtime-data.test.ts
```

Expected: PASS, including 100 tickers → exactly 10 RPC calls and missing ticker → fail closed.

- [ ] **Step 5: Commit**

```bash
git add lib/wyckoff-v2-cache-read.ts tests/wyckoff-v2-runtime-data.test.ts
git commit -m "perf: batch Wyckoff cached history reads"
```

---

### Task 4: Derive chart series from the same cached history and remove the second EOD history pass

**Files:**
- Modify: `lib/wyckoff-v2-chart-series.ts`
- Modify: `tests/wyckoff-v2-chart-series.test.ts`

**Interfaces:**
- Produces: `buildWyckoffV2ChartSeriesFromCachedHistory(history, runId, updatedAt?)`.
- Keeps `loadWyckoffV2ChartSeriesRows()` for legacy/manual callers, but changes it to ten-ticker RPC batches rather than one RPC per ticker.

- [ ] **Step 1: Add a pure chart-series builder from `CachedOhlcvHistory`**

```ts
export function buildWyckoffV2ChartSeriesFromCachedHistory(
  history: CachedOhlcvHistory,
  runId: string,
  updatedAt = new Date().toISOString(),
): WyckoffV2ChartSeriesRow {
  if (!history.bars.length) throw new Error(`WYCKOFF_CHART_SERIES_INVALID: ${history.ticker}|1D bars=0`)
  return {
    ticker: history.ticker,
    timeframe: "1D",
    bars: history.bars.slice(-260),
    provider: history.provider,
    provider_detail: history.detail,
    derived: false,
    as_of: history.lastBarAt || new Date(history.bars.at(-1)!.time * 1000).toISOString(),
    model_version: WYCKOFF_V2_MODEL_VERSION,
    aggregation_version: WYCKOFF_V2_AGGREGATION_VERSION,
    run_id: runId,
    updated_at: updatedAt,
  }
}
```

- [ ] **Step 2: Batch the legacy loader rather than calling one ticker per RPC**

Inside `loadWyckoffV2ChartSeriesRows()`, call `qeo_market_ohlcv_recent` once per ten-ticker batch:

```ts
const { data, error } = await supabase.rpc("qeo_market_ohlcv_recent", {
  p_tickers: batch,
  p_limit: 260,
})
```

Remove `Promise.all(batch.map(async (ticker) => rpc(...[ticker])))`.

- [ ] **Step 3: Run chart-series tests**

```bash
node --test tests/wyckoff-v2-chart-series.test.ts
```

Expected: PASS and 100 tickers → exactly 10 RPC calls.

- [ ] **Step 4: Commit**

```bash
git add lib/wyckoff-v2-chart-series.ts tests/wyckoff-v2-chart-series.test.ts
git commit -m "perf: batch and reuse Wyckoff chart history"
```

---

### Task 5: Add run-scoped Wyckoff build artifacts so build happens once

**Files:**
- Create: `supabase/migrations/<timestamp>_wyckoff_build_artifacts.sql`
- Create: `lib/wyckoff-build-artifacts.ts`
- Create: `tests/wyckoff-build-artifacts.test.ts`
- Modify: `tests/db-schema-contract.test.ts`
- Modify after replay: `lib/supabase/database.types.ts`

**Interfaces:**
- Produces table `public.wyckoff_build_artifacts` keyed by `(run_id, ticker)`.
- Produces:
  - `stageWyckoffBuildArtifacts(supabase, artifacts)`
  - `loadWyckoffBuildArtifacts(supabase, runId)`
- Each artifact contains exactly two snapshots and one Daily chart-series row for one ticker.

- [ ] **Step 1: Add failing DB contract tests for service-role-only ephemeral artifacts**

Assert the migration creates:

```sql
create table public.wyckoff_build_artifacts
```

with:

```sql
run_id uuid not null references public.system_job_runs(id) on delete cascade,
run_key text not null,
scan_date date not null,
ticker text not null,
snapshots jsonb not null,
chart_series jsonb not null,
provider text not null,
created_at timestamptz not null default now(),
primary key (run_id, ticker)
```

and RLS/revokes/grant-all only for `service_role`.

- [ ] **Step 2: Add the migration**

Use JSON type checks:

```sql
check (jsonb_typeof(snapshots) = 'array'),
check (jsonb_array_length(snapshots) = 2),
check (jsonb_typeof(chart_series) = 'object')
```

Add an index on `(run_id, ticker)` only if the primary key does not already satisfy the read plan; do not add redundant indexes.

- [ ] **Step 3: Extend one-day terminal cleanup**

In the same migration, `create or replace` `qeo_run_job_telemetry_cleanup()` so it deletes artifacts older than one day only when the parent `system_job_runs.status` is terminal (`succeeded`, `failed`, `skipped`). Preserve queued/running artifacts.

Add returned cleanup metrics for `wyckoff_build_artifacts`.

- [ ] **Step 4: Implement the TypeScript adapter**

Define:

```ts
export interface WyckoffBuildArtifact {
  runId: string
  runKey: string
  scanDate: string
  ticker: string
  snapshots: WyckoffV2Snapshot[]
  chartSeries: WyckoffV2ChartSeriesRow
  provider: string
}
```

`stageWyckoffBuildArtifacts()` must upsert chunks of 100 on conflict `run_id,ticker`.

`loadWyckoffBuildArtifacts()` must select explicit columns by `run_id`, order by `ticker`, parse JSON, verify exactly two snapshots per ticker, and reject malformed or empty artifact sets.

- [ ] **Step 5: Unit-test round-trip and fail-closed behavior**

Tests must cover:

- 200 artifacts write in two chunks of 100;
- explicit projection, not `select("*")`;
- exact reconstruction of snapshots/chart series;
- malformed `snapshots` JSON rejected;
- missing artifact rejected by caller-level coverage validation.

- [ ] **Step 6: Replay migrations, generate types, and run targeted tests**

```bash
pnpm db:replay:verify
pnpm db:types:verify
node --test tests/db-schema-contract.test.ts tests/wyckoff-build-artifacts.test.ts
```

- [ ] **Step 7: Apply production migration and reconcile ledger before runtime cutover**

Follow the same production migration + mapping/ledger procedure as Task 2.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations lib/wyckoff-build-artifacts.ts lib/supabase/database.types.ts tests/wyckoff-build-artifacts.test.ts tests/db-schema-contract.test.ts supabase/migration-equivalence.json docs/db/evidence
git commit -m "feat: add run-scoped Wyckoff build artifacts"
```

---

### Task 6: Rewire EOD build/validate/publish to consume the same artifact set

**Files:**
- Modify: `lib/qeoindex-eod-workflow-steps.ts`
- Modify: `lib/wyckoff-supabase-publish.ts`
- Modify: `workflows/qeoindex-eod-pipeline.ts` only if function signatures require it
- Modify: `tests/qeoindex-eod-v3.test.ts`
- Modify: `tests/wyckoff-eod-refresh.test.ts`
- Modify: `tests/qeoindex-eod-pipeline.test.ts`

**Interfaces:**
- `runWyckoffBuildStep()` stages immutable artifacts and returns metadata/hash only.
- `runSupabaseValidateStep()` loads artifacts by `runId`; no OHLCV query.
- `runSupabasePublishStep()` loads the same artifacts by `runId`; no OHLCV query.
- `publishWyckoffV2SnapshotsDirect()` receives chart series from the caller and does not query market history on the active EOD path.

- [ ] **Step 1: Write failing workflow-source regressions**

Add assertions that active EOD steps:

```ts
assert.match(steps, /loadWyckoffV2CachedHistories/)
assert.match(steps, /stageWyckoffBuildArtifacts/)
assert.match(steps, /loadWyckoffBuildArtifacts/)
assert.doesNotMatch(steps, /stocks\.slice\([\s\S]*loadWyckoffV2CachedTickerHistory/)
```

Also assert `SUPABASE_VALIDATE` and `SUPABASE_PUBLISH` bodies do not call `qeo_market_ohlcv_recent` or read `market_ohlcv_history`.

- [ ] **Step 2: Change `buildAllSnapshots()` into a one-pass build-artifact producer**

Pseudo-implementation:

```ts
const histories = await loadWyckoffV2CachedHistories(
  supabase,
  stocks.map((stock) => stock.ticker),
)

const artifacts = stocks.map((stock) => {
  const history = histories.get(stock.ticker)
  if (!history) throw new Error(`Missing cached history for ${stock.ticker}`)
  const snapshots = buildWyckoffV2TickerSnapshots({ stock, daily: history.daily, runKey, scanDate })
  const chartSeries = buildWyckoffV2ChartSeriesFromCachedHistory(history.daily, runId)
  return { runId, runKey, scanDate, ticker: stock.ticker, snapshots, chartSeries, provider: history.daily.provider }
})
```

Flatten snapshots, validate exactly `stocks.length * 2`, compute validation hash, then stage artifacts.

- [ ] **Step 3: Make validation load staged artifacts**

`runSupabaseValidateStep()` should:

1. `loadWyckoffBuildArtifacts(supabase, runId)`;
2. assert artifact ticker set equals the supplied/canonical ticker set;
3. flatten snapshots;
4. recompute `validateWyckoffV2SnapshotSet()` and `computeWyckoffV2ValidationHash()`;
5. return the hash and counts.

It must not call `buildAllSnapshots()`.

- [ ] **Step 4: Make publish load the same artifacts**

`runSupabasePublishStep()` should load artifacts, recompute hash, compare with `expectedValidationHash`, then call the publisher with:

```ts
{
  snapshots: artifacts.flatMap((artifact) => artifact.snapshots),
  chartSeries: artifacts.map((artifact) => artifact.chartSeries),
  runKey,
  scanDate,
  runId,
}
```

- [ ] **Step 5: Remove active publisher history lookup**

Change the direct publisher input to include `chartSeries: WyckoffV2ChartSeriesRow[]` and replace:

```ts
const chartSeries = await loadWyckoffV2ChartSeriesRows(supabase, tickers, runId)
```

with validation of the provided rows:

```ts
assertWyckoffV2ChartSeriesCoverage(tickers, input.chartSeries)
const chartSeries = input.chartSeries
```

Update any legacy/manual caller to use the now-batched `loadWyckoffV2ChartSeriesRows()` before invoking the publisher.

- [ ] **Step 6: Run EOD regressions**

```bash
node --test \
  tests/qeoindex-eod-v3.test.ts \
  tests/qeoindex-eod-pipeline.test.ts \
  tests/wyckoff-eod-refresh.test.ts \
  tests/wyckoff-v2-chart-series.test.ts \
  tests/wyckoff-v2-runtime-data.test.ts \
  tests/wyckoff-build-artifacts.test.ts
```

Expected: PASS with build → validate → publish preserving the same hash and no active per-ticker history loop.

- [ ] **Step 7: Commit**

```bash
git add lib/qeoindex-eod-workflow-steps.ts lib/wyckoff-supabase-publish.ts workflows/qeoindex-eod-pipeline.ts tests
git commit -m "perf: reuse one Wyckoff build across EOD phases"
```

---

### Task 7: Add query-count acceptance and production smoke evidence

**Files:**
- Modify: `docs/HANDOVER.md`
- Create: `docs/db/evidence/<date>-wyckoff-n-plus-one-smoke.md`
- Optionally modify an existing performance regression test if one already owns DB query-count contracts.

**Interfaces:**
- Produces durable acceptance evidence for query count, correctness, and migration parity.

- [ ] **Step 1: Run the complete repository verification before claiming success**

Run the repository's normal Verify equivalents, at minimum:

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm db:replay:verify
pnpm db:types:verify
```

Use the repository's exact scripts if names differ.

- [ ] **Step 2: Run a production RPC smoke for ten canonical tickers**

Verify both limits:

- `p_limit=260`: every requested ticker returns at most 260 rows;
- `p_limit=1700`: every requested ticker returns at most 1,700 rows;
- no ticker is silently missing when production history exists.

- [ ] **Step 3: Run one full 200-ticker EOD/manual smoke after runtime deployment**

Acceptance:

- `universeCount = 200`;
- `snapshotCount = 400`;
- `chartSeriesCount = 200`;
- build/validate/publish hashes match;
- no artifact coverage error;
- no regression in Council or archive phases.

- [ ] **Step 4: Measure query-count improvement**

Capture `pg_stat_statements` before/after around the smoke. The active EOD path target is:

- direct PostgREST `market_ohlcv_history` one-ticker build reads: **0**;
- `qeo_market_ohlcv_recent` full-history calls for 200 tickers: **20** at batch size 10;
- no extra chart-series history calls in active EOD publish;
- total history round trips in build/validate/publish path approximately **20**, down from approximately **800**.

Do not claim a latency percentage unless measured from the actual run.

- [ ] **Step 5: Update handover/evidence**

Document:

- batch size and why it is bounded;
- RPC max 1,700 per ticker;
- build-artifact retention = one day for terminal runs;
- query-count before/after;
- production migration versions;
- exact smoke run ID.

- [ ] **Step 6: Final review and commit**

```bash
git add docs/HANDOVER.md docs/db/evidence
git commit -m "docs: record Wyckoff N+1 remediation evidence"
```

---

## Follow-up plan boundary: Notion N+1

Do **not** fold `lib/research-data.ts::loadChanges()` into the Wyckoff PR. After the Postgres fix is verified, create a separate design/plan for Research Changes that replaces one Analysis Log query per thesis with a bounded paginated read grouped client-side, with an explicit semantic decision about whether the UI promises “two logs per thesis” or “latest changes overall”.

## Self-review

- Spec coverage: P0 direct per-ticker history reads, chart-series per-ticker RPCs, triple EOD rebuild, fail-closed validation, migration security, cleanup, and production measurement are all mapped to Tasks 1-7.
- Placeholder scan: runtime paths, interfaces, tests, SQL shape, and acceptance criteria are explicit; timestamp/evidence filenames are intentionally runtime-generated values, not implementation placeholders.
- Type consistency: `loadWyckoffV2CachedHistories`, `WyckoffBuildArtifact`, staged `snapshots`, and `chartSeries` are consistently consumed by later tasks.
