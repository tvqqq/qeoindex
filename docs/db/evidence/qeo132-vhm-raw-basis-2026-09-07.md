# QEO-132 VHM RAW Daily golden evidence — 2026-09-07

## Scope

This fixture is a bounded regression artifact for QEO-132. It proves that the StockBiz history surface exposes raw OHLC separately from adjusted close for the frozen VHM rows used by the implementation. It is not approval for bulk StockBiz ingestion and it is not an adjusted-price authority.

## Frozen VHM anchors

The regression keeps seven observed VHM rows with raw and adjusted values separate. Required anchors are:

- 2025-10-13 through 2025-10-17: five raw Daily sessions with weekly raw high `131.5` and raw low `114.6`.
- 2026-06-26: raw close `162.0`; adjusted-close audit value `78.0`.
- 2026-08-05: raw close `153.0`; adjusted-close audit value `76.5`.

These values are intentionally not reconciled against legacy `market_ohlcv_history`. QEO-132 forbids deriving RAW values by reversing or relabeling adjusted history.

## Composed regression contract

`tests/market-history/qeo132-vhm-raw-golden.test.ts` exercises the complete source-to-persistence-input boundary:

1. parse the frozen StockBiz table using semantic headers;
2. preserve raw OHLCV and adjusted close as distinct fields;
3. reproduce the five-session raw VHM high/low benchmark;
4. transform the parsed raw bar into `buildRawDailyObservationPayload(...)`;
5. require persisted `price_basis` to be exactly `RAW`;
6. require the persisted close to equal the raw close and differ from the adjusted-close audit value;
7. require no `adjusted_close` field in the persistence payload;
8. require the SHA-256 evidence identity to remain stable when only `fetched_at` changes.

## Boundary decision

The adjusted-close values are retained only as parser audit evidence. They never enter QEO-132 RAW OHLC persistence. This fixture therefore guards the specific failure mode that motivated QEO-132: feeding already-adjusted prices into the corporate-action adjustment engine and adjusting them a second time.

## Production status

QEO-132 schema/RLS/RPC is already promoted and rollback-smoked in production. No VHM raw rows were persisted by that smoke, and bulk StockBiz ingestion remains on hold pending operational/source suitability approval.
