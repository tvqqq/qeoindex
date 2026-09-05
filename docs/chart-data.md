# Canonical chart data

Last reviewed: 2026-09-05.

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

## Render horizons and read path

| Public timeframe | Maximum history | Normal source path |
| --- | ---: | --- |
| `1m`, `15m`, `30m` | 31 days | canonical raw `1m` hot path |
| `1h`, `2h`, `4h` | 366 days | derived `1h` for old history + recent hot raw `1m -> 1h`; then `1h -> 2h/4h` when needed |
| `1D`, `3D`, `1W`, `1M`, `1Q`, `1Y` | full available | canonical raw `1D` + deterministic Daily-derived aggregation |

The server clamps ranges to these horizons. For `1h/2h/4h`, history older than the hot boundary is read from `chart_ohlcv_derived_hourly`; only the recent hot segment loads canonical raw `1m`. The normal hourly path therefore does not download one year of cold raw objects and does not refill old raw minute bars into Postgres.

At the hot/derived boundary, recent hot-derived `1h` wins deterministic timestamp dedupe. Missing derived history is reported as partial/storage-unavailable coverage; no synthetic candles are fabricated.

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
- service-role-only fail-closed prune authority;
- authenticated browser boundary;
- Daily-only `market_ohlcv_history` invariant;
- migration drift reconciliation, clean replay, and generated Supabase type parity;
- current tests, touched lint, TypeScript, and production build gates.
