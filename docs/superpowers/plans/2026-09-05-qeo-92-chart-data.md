# QEO-92 Chart Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build canonical real-market `1m` + existing canonical `1D` chart data with hot Postgres, cold Supabase Storage, deterministic merge/dedupe/gap reporting, and one storage/provider-agnostic API while removing synthetic sub-hour candles.

**Architecture:** Keep `market_ohlcv_history` strictly `1D` for EOD/Wyckoff. Add a separate `modules/market/chart-data` subsystem backed by `chart_ohlcv_intraday` for hot `1m`, provenance/manifest metadata, and a `ColdOhlcvStorage` adapter using deterministic gzip NDJSON objects in Supabase Storage. `GET /api/market/ohlcv` exposes only canonical `1m` and `1D`; QEO-93 later owns session-aware aggregation for selectable derived timeframes.

**Tech Stack:** Next.js 16.3 App Router, TypeScript 5.7, Node.js runtime, Supabase Postgres + Storage, DNSE OpenAPI, Node `zlib`/`crypto`, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-05-qeo-92-chart-data-design.md`

## Global Constraints

- Do not relax the active `market_ohlcv_history` `1D`-only constraint.
- Do not write chart `1m` rows into `market_ohlcv_history`.
- Do not synthesize sub-hour OHLCV from `1H`, `1D`, interpolation, sine waves, or random paths.
- Canonical public resolutions for QEO-92 are exactly `"1m" | "1D"`.
- API bar timestamps are Unix epoch seconds, sorted ascending and deduped by timestamp.
- Hot/cold source boundaries must not change normalized OHLCV output.
- Provider/storage failures and gaps are explicit; secrets, signed URLs, stack traces, and provider credentials never reach API responses.
- SSI FastConnect remains an adapter boundary only unless a verified runtime implementation and credentials are already available.
- Parquet is preferred but must not be faked; the first implementation uses deterministic gzip NDJSON behind a format-agnostic cold-storage interface.
- DB changes must pass migration drift, clean replay, generated type parity, PR gates, and build.

---

### Task 1: Lock the schema and service-role storage contract

**Files:**
- Create: `supabase/migrations/20260905143000_qeo92_chart_ohlcv_intraday.sql`
- Create: `tests/chart-ohlcv-schema.test.ts`
- Modify: `tests/test-contracts.json`
- Generated later: `modules/shared/supabase/database.types.ts`

**Interfaces:**
- Produces tables `chart_ohlcv_provenance_batches`, `chart_ohlcv_intraday`, and `chart_ohlcv_cold_manifests`.
- Produces private Supabase Storage bucket `chart-ohlcv` through idempotent `storage.buckets` insert.
- `chart_ohlcv_intraday` identity is `(ticker, base_resolution, bar_time)` with `base_resolution = '1m'`.
- `chart_ohlcv_cold_manifests` records immutable object path, format, row count, SHA-256, covered range, and verification time.

- [ ] **Step 1: Write the failing schema contract test**

Create `tests/chart-ohlcv-schema.test.ts` that locates exactly one migration ending `_qeo92_chart_ohlcv_intraday.sql` and asserts:

```ts
assert.match(sql, /create table if not exists public\.chart_ohlcv_provenance_batches/i)
assert.match(sql, /create table if not exists public\.chart_ohlcv_intraday/i)
assert.match(sql, /primary key \(ticker, base_resolution, bar_time\)/i)
assert.match(sql, /base_resolution text not null check \(base_resolution = '1m'\)/i)
assert.match(sql, /references public\.chart_ohlcv_provenance_batches\(id\)/i)
assert.match(sql, /create table if not exists public\.chart_ohlcv_cold_manifests/i)
assert.match(sql, /sha256 text not null check \(sha256 ~ '\^\[a-f0-9\]\{64\}\$'\)/i)
assert.match(sql, /enable row level security/i)
assert.match(sql, /grant all privileges on table public\.chart_ohlcv_intraday to service_role/i)
assert.match(sql, /insert into storage\.buckets/i)
assert.match(sql, /'chart-ohlcv'/i)
assert.doesNotMatch(sql, /alter table public\.market_ohlcv_history[\s\S]*timeframe[\s\S]*1m/i)
```

Add the test to `tests/test-contracts.json` with owner `market`, bucket `canonical`, suite `fast`.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --test tests/chart-ohlcv-schema.test.ts
```

Expected: FAIL because the QEO-92 migration does not exist.

- [ ] **Step 3: Implement the migration**

Create service-role-only tables with RLS and indexes:

```sql
create table if not exists public.chart_ohlcv_provenance_batches (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  base_resolution text not null check (base_resolution = '1m'),
  range_start timestamptz not null,
  range_end timestamptz not null,
  row_count integer not null check (row_count >= 0),
  fetched_at timestamptz not null default now(),
  detail jsonb not null default '{}'::jsonb,
  check (range_end >= range_start)
);

create table if not exists public.chart_ohlcv_intraday (
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  base_resolution text not null check (base_resolution = '1m'),
  bar_time timestamptz not null,
  open double precision not null check (open > 0),
  high double precision not null check (high > 0),
  low double precision not null check (low > 0),
  close double precision not null check (close > 0),
  volume double precision not null check (volume >= 0),
  provenance_batch_id uuid references public.chart_ohlcv_provenance_batches(id) on delete set null,
  fetched_at timestamptz not null default now(),
  primary key (ticker, base_resolution, bar_time),
  check (high >= greatest(open, close, low)),
  check (low <= least(open, close, high))
);

create index if not exists chart_ohlcv_intraday_lookup_idx
  on public.chart_ohlcv_intraday (ticker, base_resolution, bar_time desc);

create table if not exists public.chart_ohlcv_cold_manifests (
  id uuid primary key default gen_random_uuid(),
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  base_resolution text not null check (base_resolution = '1m'),
  range_start timestamptz not null,
  range_end timestamptz not null,
  object_path text not null,
  archive_format text not null check (archive_format in ('ndjson.gz','parquet')),
  row_count integer not null check (row_count > 0),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  provenance_batch_id uuid references public.chart_ohlcv_provenance_batches(id) on delete set null,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (range_end >= range_start),
  unique (object_path),
  unique (ticker, base_resolution, range_start, range_end, sha256)
);
```

Enable RLS, revoke `anon, authenticated`, grant service role, and create private bucket `chart-ohlcv` with `public = false`.

- [ ] **Step 4: Run schema and manifest tests**

Run:

```bash
node --test tests/chart-ohlcv-schema.test.ts
pnpm test:manifest
```

Expected: PASS.

- [ ] **Step 5: Commit schema foundation**

```bash
git add supabase/migrations/20260905143000_qeo92_chart_ohlcv_intraday.sql tests/chart-ohlcv-schema.test.ts tests/test-contracts.json
git commit -m "feat(qeo-92): add canonical chart intraday schema"
```

---

### Task 2: Build pure canonical normalization, merge, and gap evidence

**Files:**
- Create: `modules/market/chart-data/contract.ts`
- Create: `modules/market/chart-data/normalize.ts`
- Create: `tests/chart-ohlcv-normalize.test.ts`
- Modify: `tests/test-contracts.json`

**Interfaces:**
- Produces `CanonicalChartResolution = "1m" | "1D"`.
- Produces `CanonicalOhlcvBar` compatible with existing `OhlcvBar` shape.
- Produces `normalizeCanonicalBars(inputs)` and `detectSequenceGaps(bars, resolution)`.
- Produces `ChartDataGap`, `ChartDataIntegrityIssue`, and `ChartOhlcvResult` response types.

- [ ] **Step 1: Write failing pure unit tests**

Tests must cover:

```ts
const merged = normalizeCanonicalBars([
  { source: "cold", bar: { time: 100, open: 10, high: 12, low: 9, close: 11, volume: 100 } },
  { source: "hot",  bar: { time: 100, open: 10, high: 12, low: 9, close: 11, volume: 100 } },
  { source: "hot",  bar: { time: 160, open: 11, high: 13, low: 10, close: 12, volume: 120 } },
])
assert.deepEqual(merged.bars.map((bar) => bar.time), [100, 160])
assert.deepEqual(merged.integrityIssues, [])
```

Also assert:
- hot wins exact timestamp conflicts deterministically;
- a value mismatch at the same timestamp emits an integrity issue;
- malformed/non-finite/negative-volume bars are rejected;
- output is sorted ascending;
- `1m` discontinuity from `100` to `220` emits one machine-readable gap and never fills a candle;
- `1D` gap detection does not assume every 86400 seconds is a trading day; only sequence discontinuity metadata is emitted without fabricating expected sessions.

- [ ] **Step 2: Run and verify RED**

```bash
node --test tests/chart-ohlcv-normalize.test.ts
```

Expected: FAIL because modules are missing.

- [ ] **Step 3: Implement the pure contract and normalization layer**

Use source-tagged input:

```ts
export type CanonicalBarSource = "hot" | "cold" | "daily" | "provider"
export type CanonicalChartResolution = "1m" | "1D"

export interface CanonicalOhlcvBar {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface SourceTaggedBar {
  source: CanonicalBarSource
  bar: CanonicalOhlcvBar
}
```

Normalization rules:
- finite epoch seconds > 0;
- prices > 0;
- volume >= 0;
- `high >= max(open, close, low)` and `low <= min(open, close, high)`;
- map by timestamp with precedence `hot > cold > daily > provider` only after recording mismatches;
- never round/interpolate prices or create bars.

- [ ] **Step 4: Run unit tests and manifest gate**

```bash
node --test tests/chart-ohlcv-normalize.test.ts
pnpm test:manifest
```

Expected: PASS.

- [ ] **Step 5: Commit canonical merge logic**

```bash
git add modules/market/chart-data tests/chart-ohlcv-normalize.test.ts tests/test-contracts.json
git commit -m "feat(qeo-92): add deterministic chart ohlcv normalization"
```

---

### Task 3: Add exact-range real `1m` DNSE provider path

**Files:**
- Modify: `modules/market/providers/dnse/history.ts`
- Create: `modules/market/chart-data/provider.ts`
- Create: `tests/chart-ohlcv-provider.test.ts`
- Modify: `tests/test-contracts.json`

**Interfaces:**
- Produces `fetchDnseMinuteOhlcvRange(symbol: string, from: number, to: number, now?: Date): Promise<OhlcvBar[]>`.
- Produces `ChartOhlcvProvider` interface with exact-range `fetch({ticker,resolution,from,to})`.
- Production provider supports `1m` through DNSE and does not fall back to Yahoo/VNDirect/hourly synthesis.

- [ ] **Step 1: Write failing provider contract tests**

Source/behavior tests assert:

```ts
assert.match(dnseSource, /fetchDnseMinuteOhlcvRange/)
assert.match(dnseSource, /resolution[^\n]*"1"|requestOhlcWindows\([^)]*"1"/)
assert.doesNotMatch(providerSource, /Yahoo|VNDirect|deriveSubHourlyBars|Math\.sin|random/i)
```

Pure validation tests assert exact-range requests reject invalid ticker, `to <= from`, excessively large range, and unsupported resolution.

- [ ] **Step 2: Run and verify RED**

```bash
node --test tests/chart-ohlcv-provider.test.ts
```

Expected: FAIL because the minute provider path does not exist.

- [ ] **Step 3: Implement exact-range DNSE minute fetch**

Reuse existing signed request/adaptive window machinery. Add minute constants with bounded windows/deadline and a completed-minute filter:

```ts
const MINUTE_REQUEST_WINDOW_DAYS = 7
const MINUTE_MIN_RETRY_WINDOW_DAYS = 1
const MINUTE_ADAPTIVE_BUDGET_MS = 20_000

function removeIncompleteCurrentMinuteBar(bars: OhlcvBar[], now = new Date()) {
  const nowSeconds = Math.floor(now.getTime() / 1000)
  return bars.filter((bar) => bar.time + 60 <= nowSeconds)
}
```

Try verified DNSE resolution aliases only (`"1"`, then `"1m"` if DNSE runtime accepts it); failure is explicit if both fail. Do not convert hourly data.

- [ ] **Step 4: Implement provider adapter boundary**

`modules/market/chart-data/provider.ts` defines a provider interface and `createPrimaryChartOhlcvProvider()` that returns DNSE production behavior. Leave SSI as a typed optional future adapter dependency; do not create fake SSI responses.

- [ ] **Step 5: Run provider tests**

```bash
node --test tests/chart-ohlcv-provider.test.ts tests/dnse-request-windows.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit provider path**

```bash
git add modules/market/providers/dnse/history.ts modules/market/chart-data/provider.ts tests/chart-ohlcv-provider.test.ts tests/test-contracts.json
git commit -m "feat(qeo-92): add real dnse one-minute chart provider"
```

---

### Task 4: Implement hot Postgres and cold Supabase Storage adapters

**Files:**
- Create: `modules/market/chart-data/hot-store.ts`
- Create: `modules/market/chart-data/cold-store.ts`
- Create: `tests/chart-ohlcv-storage.test.ts`
- Modify: `tests/test-contracts.json`

**Interfaces:**
- `readHotIntradayRange(supabase, ticker, from, to): Promise<CanonicalOhlcvBar[]>`
- `upsertHotIntradayBars(supabase, input): Promise<{ batchId: string; rowCount: number }>`
- `ColdOhlcvStorage.readIntersectingRange(...)`
- `ColdOhlcvStorage.archiveVerifiedPartition(...)`
- `createSupabaseColdOhlcvStorage(supabase)`
- deterministic archive format `ndjson.gz`, SHA-256 over exact compressed bytes, immutable object path.

- [ ] **Step 1: Write failing storage adapter tests using in-memory fakes**

Test cases:
- hot-only range;
- cold-only range;
- cold object decode validates checksum and row count;
- corrupt gzip/checksum rejects partition;
- archive object path is deterministic and contains `chart-ohlcv/1m/ticker=VIC/year=YYYY/month=MM/`;
- immutable upload uses `upsert: false`;
- no signed/public object URL is returned from the adapter.

- [ ] **Step 2: Run and verify RED**

```bash
node --test tests/chart-ohlcv-storage.test.ts
```

Expected: FAIL because adapters are missing.

- [ ] **Step 3: Implement hot store**

Use explicit selected fields from `chart_ohlcv_intraday`; convert ISO timestamps to epoch seconds; upsert provenance batch first and candle rows in bounded chunks using conflict key `ticker,base_resolution,bar_time`.

- [ ] **Step 4: Implement cold storage abstraction**

Define:

```ts
export interface ColdOhlcvStorage {
  readIntersectingRange(input: { ticker: string; from: number; to: number }): Promise<ColdReadResult>
  archiveVerifiedPartition(input: { ticker: string; bars: CanonicalOhlcvBar[]; provenanceBatchId?: string | null }): Promise<ColdArchiveResult>
}
```

Serialization is canonical one-JSON-object-per-line with stable field order, final newline, UTF-8, then gzip. On archive: upload immutable bytes, verify/download bytes, recompute SHA-256, then insert manifest. Do not delete hot rows in QEO-92 automatically; archival/pruning automation can be added later only after verified end-to-end coverage.

- [ ] **Step 5: Run storage tests**

```bash
node --test tests/chart-ohlcv-storage.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit storage adapters**

```bash
git add modules/market/chart-data/hot-store.ts modules/market/chart-data/cold-store.ts tests/chart-ohlcv-storage.test.ts tests/test-contracts.json
git commit -m "feat(qeo-92): add hot cold chart ohlcv storage adapters"
```

---

### Task 5: Build the unified chart-data service with read-through provider hydration

**Files:**
- Create: `modules/market/chart-data/service.ts`
- Create: `tests/chart-ohlcv-service.test.ts`
- Modify: `tests/test-contracts.json`

**Interfaces:**
- Produces `getCanonicalChartOhlcv(deps, request): Promise<ChartOhlcvResult>`.
- `1D` reads only `market_ohlcv_history` with `timeframe = '1D'`.
- `1m` reads hot + intersecting cold manifests, merges deterministically, and may hydrate missing recent requested coverage from the real DNSE provider into hot storage.

- [ ] **Step 1: Write failing service tests with dependency fakes**

Cover:
- `1D` route never queries `chart_ohlcv_intraday` and never requests `1m` provider data;
- `1m` hot-only;
- `1m` cold-only;
- crossing hot/cold boundary with duplicate timestamp returns one bar;
- moving a bar from hot fake to cold fake returns identical normalized bars;
- hot/cold mismatch emits integrity issue;
- provider failure preserves verified stored bars and emits provider error/coverage state;
- empty storage + provider failure returns explicit unavailable state, not fabricated bars;
- suspicious sequence gaps are reported but never filled.

- [ ] **Step 2: Run and verify RED**

```bash
node --test tests/chart-ohlcv-service.test.ts
```

Expected: FAIL because service does not exist.

- [ ] **Step 3: Implement request validation and Daily reader**

Bound requests:
- ticker regex `^[A-Z0-9]{2,12}$`;
- canonical resolution only;
- integer epoch seconds;
- `from < to`;
- maximum `1m` request span 31 calendar days per API call;
- maximum `1D` request span 10 years per API call.

Daily reader queries `market_ohlcv_history` for `ticker`, `timeframe = '1D'`, `bar_time >= from`, `bar_time <= to`.

- [ ] **Step 4: Implement intraday merge/read-through**

Read hot and cold concurrently. Normalize/merge first. Only when storage does not cover any requested recent sequence sufficiently, call the provider for the bounded range, persist real provider bars to hot storage, and re-merge. Provider hydration must not overwrite a mismatch silently; normalization records integrity evidence.

- [ ] **Step 5: Run service tests**

```bash
node --test tests/chart-ohlcv-service.test.ts tests/chart-ohlcv-normalize.test.ts tests/chart-ohlcv-storage.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit unified service**

```bash
git add modules/market/chart-data/service.ts tests/chart-ohlcv-service.test.ts tests/test-contracts.json
git commit -m "feat(qeo-92): add unified canonical chart data service"
```

---

### Task 6: Expose `GET /api/market/ohlcv` without leaking storage/provider details

**Files:**
- Create: `app/api/market/ohlcv/route.ts`
- Create: `tests/chart-ohlcv-api.test.ts`
- Modify: `tests/test-contracts.json`

**Interfaces:**
- Auth: `requireApiUser()`.
- Server data client: `getSupabaseServerClient()`; fail closed with 503 if missing.
- Response success shape:

```ts
{
  ok: true,
  ticker: string,
  resolution: "1m" | "1D",
  from: number,
  to: number,
  bars: CanonicalOhlcvBar[],
  gaps: ChartDataGap[],
  integrityIssues: ChartDataIntegrityIssue[],
  coverage: { complete: boolean; state: "COMPLETE" | "PARTIAL" },
  generatedAt: string
}
```

No provider name, table name, object path, source URL, signed URL, or secret-bearing details are part of the public response.

- [ ] **Step 1: Write failing API source/validation tests**

Assert route uses `requireApiUser`, `getSupabaseServerClient`, `getCanonicalChartOhlcv`, `runtime = "nodejs"`, `dynamic = "force-dynamic"`, no-store headers, and does not expose `object_path`, `source_url`, `DNSE_API_SECRET`, stack traces, or storage signed URLs.

- [ ] **Step 2: Run and verify RED**

```bash
node --test tests/chart-ohlcv-api.test.ts
```

Expected: FAIL because route does not exist.

- [ ] **Step 3: Implement API route**

Parse URL query params only. Map request validation to 400; auth to existing 401/503 responses; unavailable storage/provider to sanitized 503; successful partial stored coverage may return 200 with `coverage.state = "PARTIAL"` and explicit gaps/integrity metadata.

- [ ] **Step 4: Run API tests**

```bash
node --test tests/chart-ohlcv-api.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit API**

```bash
git add app/api/market/ohlcv/route.ts tests/chart-ohlcv-api.test.ts tests/test-contracts.json
git commit -m "feat(qeo-92): expose canonical chart ohlcv api"
```

---

### Task 7: Remove synthetic Stock Detail candles and make unsupported derived timeframes explicit until QEO-93

**Files:**
- Modify: `components/stock-detail/chart/stock-chart-timeframes.ts`
- Modify: `components/stock-detail/stock-tradingview-chart.tsx`
- Modify: `tests/stock-tradingview-chart-v2.test.ts`
- Create: `tests/chart-ohlcv-no-synthetic.test.ts`
- Modify: `tests/test-contracts.json`

**Interfaces:**
- Existing higher-timeframe temporary functions may remain only for Daily-derived views until QEO-93 replaces them.
- `1m`, `15m`, `30m`, `1h`, `2h`, `4h` must never be generated from Daily/hourly fallback.
- Unsupported derived intraday timeframes return no bars and chart renders a clear data-unavailable message instead of fake candles.

- [ ] **Step 1: Change tests to require no synthetic candles**

Replace the old assertion that `15m` from Daily mock bars must be non-empty with:

```ts
assert.deepEqual(aggregateBarsByTimeframe(mockBars, undefined, "15m"), [])
```

Add regression source assertions:

```ts
assert.doesNotMatch(timeframeSource, /deriveSubHourlyBars|Math\.sin|micro-volatility/i)
assert.doesNotMatch(timeframeSource, /hourly\s*=\s*.*daily\.slice/i)
```

- [ ] **Step 2: Run and verify RED against current synthetic implementation**

```bash
node --test tests/stock-tradingview-chart-v2.test.ts tests/chart-ohlcv-no-synthetic.test.ts
```

Expected: FAIL because `deriveSubHourlyBars()` still exists and `15m` is fabricated.

- [ ] **Step 3: Remove synthetic derivation**

Delete `deriveSubHourlyBars`. Do not treat Daily bars as hourly fallback. For QEO-92, unsupported intraday timeframe cases return `[]`; preserve `1D` and existing Daily-derived higher placeholders only where they do not claim intraday truth.

- [ ] **Step 4: Render explicit unavailable state**

When `displayBars.length === 0`, keep chart dimensions stable and render a lightweight text state such as `Dữ liệu timeframe này chưa sẵn sàng. QEO-93 sẽ tổng hợp từ canonical 1m.` Do not add blur/filter/animation.

- [ ] **Step 5: Run chart regression tests**

```bash
node --test tests/stock-tradingview-chart-v2.test.ts tests/chart-ohlcv-no-synthetic.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit synthetic-removal guard**

```bash
git add components/stock-detail/chart/stock-chart-timeframes.ts components/stock-detail/stock-tradingview-chart.tsx tests/stock-tradingview-chart-v2.test.ts tests/chart-ohlcv-no-synthetic.test.ts tests/test-contracts.json
git commit -m "fix(qeo-92): remove synthetic intraday chart candles"
```

---

### Task 8: Update canonical docs, generated types, and verify the complete release gate

**Files:**
- Modify: `docs/HANDOVER.md`
- Create: `docs/chart-ohlcv-data.md`
- Modify: `docs/README.md`
- Modify: `modules/shared/supabase/database.types.ts` via generator
- Modify if generated by local Next dev/build: `AGENTS.md` only if Next's managed block changes; do not hand-edit unrelated content.

**Interfaces:**
- `docs/chart-ohlcv-data.md` becomes Active domain doc for Stock Detail canonical chart data.
- HANDOVER explicitly distinguishes chart raw `1m` subsystem from Wyckoff/EOD raw `1D` storage.

- [ ] **Step 1: Update Active docs**

Document:
- chart canonical raw `1m` lives in `chart_ohlcv_intraday` + `chart-ohlcv` cold bucket;
- chart canonical `1D` reuses `market_ohlcv_history`;
- EOD/Wyckoff remains unchanged (`1D` raw, `1D + 1W` analysis);
- `/api/market/ohlcv` hides hot/cold/provider branching;
- QEO-93 owns derived timeframe aggregation;
- no synthetic intraday bars are permitted.

- [ ] **Step 2: Apply migration to production as required by repository invariant**

After local DB gates pass and before claiming the DB change complete:

```bash
npx supabase db push
```

If credentials/connectivity prevent this, report QEO-92 as blocked at DB deployment rather than claiming production-complete.

- [ ] **Step 3: Regenerate Supabase types**

```bash
pnpm db:types:generate
```

Confirm generated types include all three `chart_ohlcv_*` tables.

- [ ] **Step 4: Run focused QEO-92 tests**

```bash
node --test \
  tests/chart-ohlcv-schema.test.ts \
  tests/chart-ohlcv-normalize.test.ts \
  tests/chart-ohlcv-provider.test.ts \
  tests/chart-ohlcv-storage.test.ts \
  tests/chart-ohlcv-service.test.ts \
  tests/chart-ohlcv-api.test.ts \
  tests/chart-ohlcv-no-synthetic.test.ts \
  tests/stock-tradingview-chart-v2.test.ts
```

Expected: PASS, 0 failures.

- [ ] **Step 5: Run required DB gates**

```bash
pnpm db:drift:verify
pnpm db:replay:verify
pnpm db:types:verify
```

Expected: PASS.

- [ ] **Step 6: Run PR verification and build**

```bash
pnpm verify:pr
pnpm build
```

Expected: PASS.

- [ ] **Step 7: Inspect diff for invariants**

Run:

```bash
git diff main...HEAD -- supabase/migrations modules/market/chart-data modules/market/providers/dnse app/api/market/ohlcv components/stock-detail docs tests
```

Verify manually:
- no relaxation of `market_ohlcv_history` Daily-only constraint;
- no synthetic sub-hour generation;
- no credentials/secrets;
- no frontend provider/storage branching;
- no automatic deletion of hot `1m` after archive without verified lifecycle automation.

- [ ] **Step 8: Commit docs/generated types if not already committed**

```bash
git add docs modules/shared/supabase/database.types.ts
git commit -m "docs(qeo-92): document canonical chart data contract"
```

- [ ] **Step 9: Final exact-head verification**

Re-run on final HEAD:

```bash
pnpm verify:pr
pnpm db:drift:verify
pnpm db:replay:verify
pnpm db:types:verify
pnpm build
```

Only after all commands pass may QEO-92 be marked implemented. Production acceptance/deployment to `main` is a separate release decision; do not manually deploy Vercel.
