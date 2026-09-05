# QEO-106 Daily Hot/Cold Full-History Design

## Goal

Make `1D/3D/1W/1M/1Q/1Y` expose full recoverable Daily history while preserving the existing QEO-92/QEO-103 physical tiering model: PostgreSQL is the hot operational tier and private Supabase Storage is the immutable cold tier.

## Authoritative contracts

- QEO-93 owns deterministic timeframe aggregation. `3D/1W/1M/1Q/1Y` derive only from canonical `1D`.
- QEO-103 keeps intraday horizons unchanged: `15m/30m <= 31d`; `1h/2h/4h <= 366d`.
- Daily-derived timeframes are full-history and are not constrained by the physical hot retention window.
- The frontend/API remain storage-agnostic.

## Daily physical storage

### Hot tier — PostgreSQL

`market_ohlcv_history` remains the EOD/Wyckoff operational source for recent canonical `1D` rows. The existing `DAILY_BACKFILL_DAYS = 8 * 366` becomes the target Daily hot/warm retention horizon only; it is not a chart horizon.

### Cold tier — private Storage

Daily history older than the hot cutoff is stored in the existing private `chart-ohlcv` bucket as checksum-addressed immutable `.ndjson.gz` objects with verified manifests. Paths use:

`1D/ticker={TICKER}/year={YYYY}/{first}-{last}-{sha256}.ndjson.gz`

`chart_ohlcv_cold_manifests` is widened from `1m`-only to `1m|1D`. Daily manifests carry explicit provider/provenance metadata. Existing `1m` objects and lifecycle semantics remain unchanged.

## Single read path

`GET /api/market/ohlcv?...resolution=1D...` reads Hot PostgreSQL and intersecting verified Daily Cold manifests, then merges, sorts, de-duplicates and validates through the existing canonical normalization path. Hot Daily wins any overlap. A physical tier boundary must not change returned OHLCV.

Higher timeframes continue to call canonical Daily through QEO-93 and therefore inherit full Hot+Cold history automatically.

## Deep left-edge backfill

A resumable server-only Daily deep-history worker extends each ticker left from its earliest local canonical bar.

- Requests are chunked and bounded.
- The approved provider waterfall remains `VCI -> DNSE -> Yahoo/Fallback -> VNDirect -> TitanLabs`.
- Older recovered bars are written directly to verified Cold Storage when they are outside the Daily hot horizon.
- No synthetic/fill-forward bars are created.
- Each run persists left-edge progress and provenance.
- A ticker reaches a terminal left edge only when a listing-date boundary is verified, a provider-proven earliest boundary is reached, or an explicit unrecoverable boundary is persisted. Transient provider/network failures remain retryable and cannot mark history complete.

## Daily hot archival lifecycle

When Daily rows age past the hot cutoff, a bounded lifecycle operation groups eligible rows into immutable Cold partitions, verifies checksum + readback + row count, then prunes exactly the verified PostgreSQL rows using a service-role-only fail-closed RPC. No Daily row may be pruned before a verified Cold object exists.

## Integrity

- Market-closed phantom Daily rows are rejected by the QEO-106 session-validity rules before Hot or Cold becomes chart-reachable.
- Cold archive rows are normalized canonical OHLCV only.
- Manifest provenance records provider/detail/source URL/fetched timestamp for deep-history recovery.
- Existing valid higher-priority Hot Daily rows must not be overwritten by lower-priority Cold history.

## State and observability

`chart_daily_history_state` records per ticker:

- earliest hot Daily;
- earliest verified cold Daily;
- left-edge status (`IN_PROGRESS`, `PROVIDER_BOUNDARY`, `LISTING_BOUNDARY`, `UNRECOVERABLE`, `RETRYABLE_ERROR`);
- boundary/provider/provenance detail;
- last attempted window and update timestamp.

The canonical-200 acceptance report must expose enough state to distinguish full-history, retryable, and explicit boundary cases.

## Acceptance

1. `1D` Hot+Cold reads are deterministic and Hot wins overlap.
2. `3D/1W/1M/1Q/1Y` can hydrate through the same complete Daily series.
3. The current ~2018 PostgreSQL floor is no longer treated as the full-history boundary.
4. Long-listed representative tickers can extend before 2018 when upstream evidence exists.
5. Hot Daily rows are never pruned before verified Cold readback.
6. Existing intraday QEO-103 behavior remains unchanged.
7. No frontend branch knows whether a bar came from PostgreSQL or Storage.
