# QEO-100 VCI production recovery evidence

Date: 2026-09-05

## Production failure

- Authenticated `/insights/vic` requests reached `/api/market/ohlcv` and returned HTTP 503.
- Production canonical intraday/provenance tables remained empty.

## Provider probes

- SSI iBoard credential-less history endpoint returned HTTP 403 `Security Check - SSI` from a production-like cloud runtime, so it is not suitable as the server-runtime primary.
- VCI `POST https://trading.vietcap.com.vn/api/chart/OHLCChart/gap-chart` with native `ONE_MINUTE` returned HTTP 200 for VIC.
- A bounded `countBack=9300` probe returned 9,300 native 1m rows, sufficient for the 31-day render-horizon request budget before strict requested-range filtering.
- VCI prices are raw VND and are normalized by `/1000` to the existing chart price scale; volume remains shares.
- Aggregating the returned VCI minute vectors into 5-minute bars matched the independent Finhay reference on sampled completed VIC bars, including 2026-09-04 09:15 ICT OHLCV `244.7 / 251.5 / 244.7 / 250.0 / 153600`.
- DNSE public chart hosts timed out during TLS handshake from the probe runtime; signed OpenAPI post-rotation success remains a separate QEO-88/QEO-100 verification item.

## Recovery hierarchy

For production chart recovery, raw 1m provider order is:

1. VCI native `ONE_MINUTE`
2. DNSE signed OHLC
3. SSI iBoard last-resort web endpoint

QEO-93 remains the only owner of derived intraday aggregation. No synthetic bars are introduced.
