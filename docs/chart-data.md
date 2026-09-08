# Canonical chart data

Last reviewed: 2026-09-08.

This document owns the active user-facing chart-data persistence/read contract. It is intentionally separate from the Wyckoff EOD contract documented in `HANDOVER.md` and `wyckoff-chart-unified-data.md`.

## Storage ownership

QeoIndex has two canonical raw OHLCV persistence concerns:

| Concern | Raw resolution | Active store | Purpose |
| --- | --- | --- | --- |
| EOD / Wyckoff | `1D` | `market_ohlcv_history` | Completed Daily evidence for EOD, Wyckoff and deterministic Weekly derivation. |
| Interactive chart | `1m` | `chart_ohlcv_intraday` + private Storage bucket `chart-ohlcv` | Exact intraday chart history with verified hot/cold lifecycle. |

`market_ohlcv_history` remains Daily-only. Intraday chart storage never widens the active Wyckoff/EOD persistence contract.

## Canonical 1m contract

The chart-data module under `modules/market/chart-data/` owns canonical validation, deterministic sort/deduplication, provider backfill, coverage/gap evidence, integrity reporting, storage lifecycle, timeframe derivation, and the sanitized browser API projection.

A canonical bar is epoch-seconds `time` plus finite positive OHLC prices and non-negative volume. Inconsistent high/low relationships are rejected rather than repaired silently. Raw `1m` remains the canonical intraday evidence; derived intraday timeframes are rebuildable views/caches only.

### Source precedence

For canonical `1m` overlap, active precedence remains:

```text
hot > cold > daily > provider
```

If overlapping canonical sources disagree, the selected bar follows deterministic precedence and the response records integrity evidence rather than silently treating disagreement as agreement.

## Hot raw 1m retention

`chart_ohlcv_intraday` is the server-side hot store for canonical `1m` bars.

- target retention is **31 complete Vietnam calendar days**;
- pruning is partitioned by ticker + Vietnam trading date so a session is never split by a rolling UTC cutoff;
- the lifecycle is bounded and failures are partition-isolated;
- provider/provenance evidence remains batch-scoped in `chart_ohlcv_provenance_batches`.

The global five-session cutoff is an efficient discovery bound only. Before a
candidate ticker/session enters the archive sequence, the lifecycle pages that
ticker's `1m` HOT rows in descending `bar_time` order and proves that at least
`CHART_HOT_RETENTION_SESSIONS` distinct, valid Vietnam trading dates are
strictly newer than the candidate boundary. A ticker with only four newer
sessions therefore remains HOT even when another ticker has enough history;
the candidate is eligible only when it is sixth-or-older for that ticker.
Malformed timestamps, query failures, a bounded proof-page cap, and fewer than
five newer sessions all defer the candidate. Deferred partitions are recorded
in archive metrics and never reach archive, cache, or prune. A candidate with
fewer than five newer sessions is a normal protected partition; read failures,
malformed evidence, and proof-cap exhaustion keep the lifecycle partial.

Bootstrap and provider-coverage discovery continue to use the bounded global
cutoff in this release. An exact per-ticker coverage RPC can be introduced as a
follow-up if bootstrap coverage needs the same stronger proof.

The base QEO-92 schema was activated by migration `20260905065836_qeo92_chart_ohlcv_intraday`. QEO-103 extends the lifecycle through `20260905115319_qeo103_chart_storage_lifecycle`.

## Cold raw 1m archive

Cold chart history is stored in the private Supabase Storage bucket `chart-ohlcv`.

- archive objects use immutable checksum-addressed `.ndjson.gz` paths;
- `chart_ohlcv_cold_manifests` records ticker, base resolution, exact covered range, row count, SHA-256, format version and byte count;
- an archive object is downloaded and verified against SHA-256 + row count before its manifest is accepted for pruning;
- an already-existing matching object/manifest is verified and reused idempotently;
- object paths and bucket details remain server-only.

Cold raw storage is durability/reconstruction evidence, not the normal one-year hourly rendering path.

## Derived 1h cache

`chart_ohlcv_derived_hourly` is a **rebuildable cache**, never canonical source-of-truth.

Each cached `1h` bar records the verified raw source manifest/checksum/range/row-count plus aggregation version. The cache is produced by the same Vietnam-session-aware aggregation engine used by chart rendering.

Lifecycle order for an expired raw partition is fail-closed:

```text
hot raw 1m snapshot
  -> immutable cold write
  -> cold readback + SHA256 + row-count verify
  -> deterministic 1h cache persist
  -> hot snapshot re-read / equality check
  -> service-role manifest-verified atomic prune RPC
```

The prune RPC refuses deletion when the manifest, checksum, row count, or derived-cache evidence does not match. Any exception rolls back the delete transaction. Daily/Wyckoff history is never touched by this RPC.

### Legacy cold-to-derived recovery

QEO-103 can encounter verified cold manifests created by the earlier archive slice before the derived cache existed. Those manifests are recovered through bounded server-only mode `chart-derived-recovery`.

Recovery order is also fail-closed:

```text
verified cold manifest
  -> private object download
  -> SHA256 + row-count + exact range verification
  -> deterministic 1h aggregation
  -> derived cache upsert
  -> derived OHLCV readback equality verification
```

Recovery refreshes manifest byte-count evidence after the verified object read. It never reconstructs raw bars from a provider and never writes legacy raw minutes back into hot Postgres.

Until every verified cold manifest intersecting an hourly request has derived evidence, the server reads that old segment directly from verified cold raw storage and aggregates it in memory. This temporary correctness fallback prevents a partial derived backfill from creating missing hourly history. Once manifest coverage is complete, the normal path automatically uses only the derived `1h` cache for old history.

## Render horizons and read path

| Public timeframe | Maximum history | Normal source path |
| --- | ---: | --- |
| `1m`, `15m`, `30m` | 31 days | canonical raw `1m` hot path |
| `1h`, `2h`, `4h` | 366 days | derived `1h` for old history + recent hot raw `1m -> 1h`; then `1h -> 2h/4h` when needed |
| `1D`, `3D`, `1W`, `1M`, `1Q`, `1Y` | full available | canonical raw `1D` + deterministic Daily-derived aggregation |

The server clamps ranges to these horizons. For `1h/2h/4h`, history older than the hot boundary normally comes from `chart_ohlcv_derived_hourly`; only the recent hot segment loads canonical raw `1m`. The normal steady-state hourly path therefore does not download one year of cold raw objects and does not refill old raw minute bars into Postgres.

At the hot/derived boundary, recent hot-derived `1h` wins deterministic timestamp dedupe. During legacy recovery, incomplete derived-manifest coverage selects verified cold raw fallback for the affected old segment rather than returning a partially populated cache. No synthetic candles are fabricated.

## Interactive renderer boundary

The stock detail renderer keeps market data and interaction ownership explicit:

```text
canonical real OHLCV ──> Lightweight Charts candles / volume / panes
        │                         │
        ├── future whitespace ────┤  (addressable time horizon, no OHLC)
        │                         │
        └── indicators/drawings ──> coordinate adapter -> clipped overlay
                                      (price/time scales remain LWC-owned)
```

Lightweight Charts owns the Japanese candlestick series, volume series, price
scales, time scale, crosshair, pan/zoom and pane-local axes. Future timestamps
are supplied by a dedicated invisible whitespace series; `setData` and
incremental `update` on the candlestick series receive real bars only. Drawing
anchors remain canonical epoch time plus price, so a timestamp absent from an
aggregated timeframe is interpolated between the known real/future timeline
points for display and is never rewritten during persistence.

The chart settings queue is ticker-generation scoped. Remote hydration merges
each field independently: a newer local timeframe/style/indicator/drawing edit
keeps ownership of that field while untouched remote drawings and preferences
are merged into the pending save. A pending save waits for hydration before it
can send an unowned drawing set, preventing a slow initial response from
turning the remote collection into `[]`. Drawing controls stay disabled until
the remote collection is known; a failed GET shows an offline/retry state and
does not authorize destructive replacement.

### Interactive view ownership

`StockDetailWorkstation` owns fullscreen mode and guarded watchlist keyboard
navigation. `StockTradingViewChartData` owns the history request boundary and
bridges the active ticker's timeframe into that history path. The chart core
remains the sole owner of the Lightweight Charts instance; ticker changes and
fullscreen toggles must not remount it or reset the current mode.

Arrow navigation carries a request shaped as
`{ ticker: string, timeframe: ChartTimeframe }`. The chart core interface must
accept that request as `navigationTimeframe?: ... | null` and pass the matching
timeframe into the ticker-generation sync. While the request matches the active
ticker, remote settings hydration must not replace that session timeframe. The
request is navigation intent only; an ordinary timeframe selection remains the
user's local edit and follows the normal persistence queue.

User-wide presentation settings use the authenticated `viewSettingsScope`:
indicator visibility and style plus RSI/MACD collapse state. Ticker payloads
continue to own timeframe, chart style, and drawings. The renderer applies an
initial 55/15/15/15 price/volume/RSI/MACD split and persists the two supported
collapse states. Copying a view across symbols must never copy another symbol's
drawings; drawing visibility metadata still applies within its ticker and
source-timeframe rules.

Renderer verification covers numeric coordinate round trips, bounded pointer
conversion, exact eight-bar initial/reset offset, future whitespace ownership,
pane visibility and collapse behavior, indicator repaint after pan/zoom, and
real-versus-empty/loading states. Production evidence is separate from these
source/unit gates: intraday lazy-fill and older provenance gaps remain explicit
coverage metadata rather than fabricated history.

## Provider backfill

Provider data is normalized through the same canonical validation path before it can participate in a response or hot persistence. Provider failure must never generate synthetic candles or fake fallback values.

Provider backfill does not weaken archive integrity: data that QeoIndex has chosen to retain must pass the local verified cold lifecycle before hot deletion.

## Unified API

Browser-facing reads use authenticated `GET /api/market/ohlcv`.

The response exposes canonical/derived chart bars plus sanitized coverage, gap, integrity and session metadata. It must not expose Storage bucket/object paths, provider request URLs, credentials/signatures/headers, or private provenance payloads.

## Integrity and release gates

Material changes to this subsystem must preserve:

- no synthetic OHLCV fallback;
- raw `1m` as canonical intraday evidence;
- deterministic session-aware aggregation;
- immutable cold archive + checksum/readback verification before prune;
- derived `1h` as rebuildable non-canonical cache;
- verified cold fallback while derived-manifest coverage is incomplete;
- service-role-only fail-closed prune authority;
- authenticated browser boundary;
- Daily-only `market_ohlcv_history` invariant;
- migration drift reconciliation, clean replay, and generated Supabase type parity;
- current tests, touched lint, TypeScript, and production build gates.
