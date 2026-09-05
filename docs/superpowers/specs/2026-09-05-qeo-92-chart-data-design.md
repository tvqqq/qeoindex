# QEO-92 Chart Data Design

## Goal

Provide production-grade canonical OHLCV data for the Stock Detail chart using real raw `1m` intraday data and canonical raw `1D` history, with hot/cold storage hidden behind one stable chart-data API.

## Scope

QEO-92 owns:

- canonical raw `1m` persistence for chart intraday use;
- canonical raw `1D` reuse from the existing Daily history contract;
- hot Postgres storage for recent `1m` rows;
- cold Object Storage abstraction for older immutable `1m` partitions;
- range merge, sort, dedupe, normalization, and gap reporting;
- provider boundary with DNSE as primary and explicit failure/coverage behavior;
- a stable `/api/market/ohlcv` read contract for downstream QEO-93/QEO-96 consumers;
- removal of production synthetic sub-hour candle generation.

QEO-92 does not own selectable-timeframe aggregation such as `15m`, `30m`, `1h`, `2h`, `4h`, `3D`, `1W`, `1M`, `1Q`, or `1Y`. Deterministic session-aware aggregation belongs to QEO-93.

## Existing Contract That Must Not Be Broken

The active EOD/Wyckoff persistence contract remains unchanged:

- `market_ohlcv_history` stores raw `1D` only;
- Wyckoff operational analysis remains `1D + 1W` completed bars;
- `1W` remains derived from canonical Daily history;
- QEO-92 must not add `1m` rows to `market_ohlcv_history` or relax its `1D` write constraint.

Chart intraday persistence is a separate subsystem.

## Target Architecture

```text
GET /api/market/ohlcv
        |
        v
Chart OHLCV Service
validate / normalize / merge / dedupe / gap detection
        |                              |
        v                              v
Canonical Daily                   Canonical Intraday
market_ohlcv_history              chart_ohlcv_intraday
raw 1D only                       raw 1m hot rows
                                       |
                                       v
                                ColdStorageAdapter
                                Supabase Storage
                                immutable partitions
```

## Canonical Public Contract

```ts
export interface OhlcvBar {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type CanonicalChartResolution = "1m" | "1D"
```

`OhlcvBar.time` is Unix epoch seconds. API output is sorted ascending by `time` and contains at most one candle per requested canonical resolution and timestamp.

## API

Endpoint:

```text
GET /api/market/ohlcv?ticker=VIC&resolution=1m&from=<epoch>&to=<epoch>
GET /api/market/ohlcv?ticker=VIC&resolution=1D&from=<epoch>&to=<epoch>
```

Responsibilities:

1. validate ticker, resolution, and bounded time range;
2. choose canonical Daily or intraday storage path;
3. read required hot/cold ranges;
4. merge overlapping source ranges;
5. sort ascending;
6. dedupe by canonical bar timestamp;
7. reject malformed/non-finite OHLCV;
8. normalize units consistently;
9. detect/report material data gaps without fabricating bars;
10. return a storage/provider-agnostic response.

The chart frontend must not branch on DNSE, SSI, Postgres, Supabase Storage, Parquet, or archive partition details.

## Intraday Hot Data Model

Create a dedicated chart table rather than reusing `market_ohlcv_history`.

Logical schema:

```text
chart_ohlcv_intraday
- ticker text
- base_resolution text = '1m'
- bar_time timestamptz
- open double precision
- high double precision
- low double precision
- close double precision
- volume double precision
- provenance_batch_id uuid/null
- fetched_at timestamptz
PRIMARY KEY (ticker, base_resolution, bar_time)
```

Constraints:

- valid ticker format;
- `base_resolution = '1m'`;
- positive OHLC values;
- non-negative volume;
- idempotent writes on `(ticker, base_resolution, bar_time)`;
- service-role write/read ownership following existing market-data security patterns.

Provider URLs and long detail strings are not duplicated on every candle.

## Provenance

Where provider provenance is required, keep it at batch/file level.

A provenance record should identify at minimum:

- provider;
- ticker;
- base resolution;
- covered range;
- fetched timestamp;
- row count;
- optional provider request/detail metadata without secrets.

Candle rows may reference `provenance_batch_id`.

## Cold Storage

Cold storage is an abstraction, not a frontend concern.

Initial implementation uses Supabase Object Storage through a `ColdOhlcvStorage` interface. Archive paths are deterministic and partitionable, for example:

```text
chart-ohlcv/1m/ticker=VIC/year=2026/month=09/<partition-file>
```

Cold files are immutable after verification. A Postgres manifest records coverage and integrity metadata needed for hydration.

Logical manifest fields:

- ticker;
- base resolution;
- range start/end;
- object path;
- format;
- row count;
- checksum;
- provider/provenance reference;
- verified timestamp.

The storage interface must allow the file format to evolve without changing the chart-data API. Parquet is preferred when the runtime has a safe supported writer/reader; otherwise the first implementation may use a deterministic compressed text representation behind the same interface rather than inventing a fake Parquet implementation.

## Hot/Cold Merge Rules

For a request that crosses the archive boundary:

- query every manifest intersecting the requested cold range;
- query hot Postgres for the intersecting hot range;
- combine bars;
- normalize each bar;
- dedupe by timestamp;
- sort ascending;
- ensure the result is identical whether an overlapping candle came from hot or cold storage.

Overlap precedence must be deterministic. Verified hot canonical rows may win exact-timestamp conflicts during migration windows, but a mismatch is surfaced as data-integrity metadata/test failure rather than silently accepted as two candles.

## Provider Policy

DNSE is primary for Vietnam market OHLCV where supported.

Provider interface must make canonical resolution explicit and return real market bars only.

SSI FastConnect is the preferred future fallback/reconciliation source. If no working SSI historical implementation/credentials exist in the repository, QEO-92 creates the adapter boundary but does not fabricate SSI data or silently substitute synthetic candles.

When providers fail or coverage is incomplete:

- return/record explicit provider failure or coverage-gap evidence;
- preserve any verified bars already available from storage;
- never fabricate missing `1m` bars from `1H`, `1D`, interpolation, sine waves, or random micro-volatility.

## Synthetic Candle Removal

The current Stock Detail timeframe utility contains `deriveSubHourlyBars()` that creates `1m`/`15m`/`30m` candles from hourly/daily bars using artificial price paths. This path must not remain in production chart data flow.

QEO-92 must add a regression guard that prevents synthetic sub-hour OHLCV generation from being reintroduced.

Until QEO-93 consumes canonical `1m` and performs deterministic aggregation, unsupported derived chart resolutions must fail/appear unavailable rather than display fabricated candles.

## Gap Detection

Gap detection distinguishes expected market-session discontinuities from suspicious missing bars where possible with current QEO-92 knowledge. Full session/calendar-aware bucketing belongs to QEO-93.

QEO-92 should at minimum report machine-readable gap evidence for discontinuities inside retrieved canonical sequences and must not fill them synthetically.

## Error Contract

Errors are explicit and bounded. Relevant classes include:

- invalid request;
- unsupported canonical resolution;
- provider unavailable;
- storage unavailable;
- corrupt cold partition;
- data gap / incomplete coverage.

API responses must not leak credentials, signed storage URLs, provider secrets, or internal stack traces.

## Testing

TDD coverage must include:

- request validation;
- canonical bar normalization;
- deterministic sort/dedupe;
- hot-only range;
- cold-only range;
- range crossing hot/cold boundary;
- exact-timestamp overlap at boundary;
- equivalent normalized result across hot/cold boundary movement;
- provider failure without synthetic fallback;
- corrupt/malformed cold data rejection;
- gap reporting;
- DB schema/constraint contract;
- production guard proving synthetic `deriveSubHourlyBars()` is removed/not used.

## Database and Release Safety

Because QEO-92 introduces Supabase schema/storage resources:

- migration drift reconciliation must pass;
- clean local replay must pass;
- generated Supabase types must match;
- no unrelated relaxation of `market_ohlcv_history` Daily-only constraints;
- relevant Active docs must be updated in the same change;
- normal release remains feature branch -> validation -> reviewed merge to `main` -> one Vercel Git Integration production deployment.

Required validation before completion:

```text
pnpm verify:pr
pnpm db:drift:verify
pnpm db:replay:verify
pnpm db:types:verify
pnpm build
```

## Acceptance Criteria

QEO-92 is complete when:

1. canonical raw `1m` chart data is a real-market-data path, not synthetic micro-volatility;
2. canonical raw `1D` continues to use the active Daily history contract without weakening EOD/Wyckoff invariants;
3. recent `1m` data can live in Postgres while older immutable ranges can be addressed through a cold-storage abstraction;
4. one chart-data service/API merges hot/cold data deterministically;
5. identical requested ranges normalize to identical OHLCV regardless of the hot/cold boundary;
6. provider/storage coverage gaps surface explicitly;
7. frontend consumers are provider/storage agnostic;
8. QEO-93 can build deterministic selectable timeframe aggregation on top of this contract without changing the persistence model.
