# Canonical chart data

Last reviewed: 2026-09-05.

This document owns the active user-facing chart-data persistence/read contract. It is intentionally separate from the Wyckoff EOD contract documented in `HANDOVER.md` and `wyckoff-chart-unified-data.md`.

## Storage ownership

QeoIndex has two canonical raw OHLCV persistence concerns:

| Concern | Raw resolution | Active store | Purpose |
| --- | --- | --- | --- |
| EOD / Wyckoff | `1D` | `market_ohlcv_history` | Completed Daily evidence for EOD, Wyckoff and deterministic Weekly derivation. |
| Interactive chart | `1m` | `chart_ohlcv_intraday` + private Storage bucket `chart-ohlcv` | Exact intraday chart history with hot/cold lifecycle. |

`market_ohlcv_history` remains Daily-only. QEO-92 does not add `1m` rows to the Wyckoff/EOD table.

## Canonical 1m contract

The chart-data module lives under `modules/market/chart-data/` and owns:

- canonical OHLCV validation;
- deterministic sort/deduplication;
- hot/cold merge precedence;
- provider backfill for missing `1m` ranges;
- coverage and gap evidence;
- integrity issues for invalid bars or source mismatches;
- sanitized API projection.

A canonical bar is epoch-seconds `time` plus finite positive OHLC prices and non-negative volume. Inconsistent high/low relationships are rejected rather than repaired silently.

### Source precedence

When multiple valid sources contain the same timestamp, the active precedence is:

```text
hot > cold > daily > provider
```

For `1m`, hot rows therefore win over overlapping cold rows. If overlapping sources disagree, the selected bar still follows deterministic precedence but the response records a `SOURCE_MISMATCH` integrity issue; it must not silently rewrite disagreement as agreement.

## Hot storage

`chart_ohlcv_intraday` is the server-side hot store for canonical `1m` bars.

Related provenance is batch-scoped in `chart_ohlcv_provenance_batches`. Provider identity and fetch metadata are operational evidence; they are not exposed as browser credentials or provider URLs.

The schema was activated in production by exact migration version:

`20260905065836_qeo92_chart_ohlcv_intraday`

## Cold storage

Cold chart history is stored in the private Supabase Storage bucket `chart-ohlcv`.

- archive objects use immutable checksum-addressed `.ndjson.gz` paths;
- `chart_ohlcv_cold_manifests` records ticker, base resolution, covered range, row count and SHA-256;
- reads verify the stored object against the manifest checksum before bars are accepted;
- object paths and bucket details remain server-only implementation details.

Cold storage is evidence, not an alternate public API. The browser consumes only the unified canonical service.

## Provider backfill

DNSE is the current exact-range `1m` historical provider through `fetchMinuteOhlcvRange`.

Provider data is normalized through the same canonical validation path before it can participate in a response or hot persistence. Provider failures must not cause synthetic candles or fake fallback values.

## Unified API

Browser-facing reads use:

`GET /api/market/ohlcv`

The route requires an authenticated user session and returns a sanitized projection containing canonical bars plus coverage/gap/integrity evidence. It must not return:

- Supabase bucket names or object paths;
- provider request URLs;
- credentials, signatures or headers;
- internal provenance payloads that are not part of the stable browser contract.

## Timeframe boundary

QEO-92 establishes canonical raw `1m` and preserves canonical raw `1D`. It does **not** own the general timeframe aggregation engine.

Until the dedicated timeframe engine consumes canonical `1m`, unsupported intraday selections such as `15m`, `30m`, `1h`, `2h` and `4h` must render an explicit unavailable state. The chart must never derive fake intraday bars from Daily data, inject micro-volatility, or use synthetic `Math.sin()` candles.

Weekly Wyckoff behavior remains separate: `1W` is deterministically derived from canonical `1D` under the existing Wyckoff contract.

## Integrity and release gates

Material changes to this subsystem must preserve:

- no synthetic OHLCV fallbacks;
- deterministic sorted/deduped merge behavior;
- hot-over-cold overlap precedence with mismatch evidence;
- private hot/cold persistence and authenticated browser access;
- Daily-only `market_ohlcv_history` invariant;
- migration drift reconciliation, clean replay and generated Supabase type parity for schema changes;
- current tests, touched lint, TypeScript and production build gates.
