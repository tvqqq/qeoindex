# QEO-100 Horizon + Retention Addendum

Date: 2026-09-05
Status: Approved requirement update
Supersedes: conflicting provider/storage/horizon sections in `2026-09-05-qeo-100-market-data-sot-ui-verification-design.md`
Related: QEO-92, QEO-93, QEO-97, QEO-98, QEO-100, QEO-101, QEO-103

## Product history horizons

The chart has three explicit product horizons. These are server-enforced data contracts, not merely UI defaults.

| Timeframe family | Resolutions | Maximum render history |
| --- | --- | --- |
| Long term | `1D`, `3D`, `1W`, `1M`, `1Q`, `1Y` | full available history |
| Mid term | `1h`, `2h`, `4h` | 1 year |
| Short term | `1m`, `15m`, `30m` | 1 month |

`>=1D` means full canonical Daily history is available to the chart and higher-timeframe aggregation may consume the full Daily sequence.

`>=1h && <1D` means the chart must not request or render more than 366 calendar days of source history.

`<1h` means the chart must not request or render more than 31 calendar days of source history.

The server clamps/validates ranges even if a client attempts a larger request.

## SSI iBoard REST candidate

A credential-less SSI iBoard chart endpoint has been identified:

```text
GET https://iboard-api.ssi.com.vn/statistics/charts/history
    ?resolution={resolution}
    &symbol={ticker}
    &from={epoch}
    &to={epoch}
```

This endpoint is distinct from authenticated SSI FastConnect. It is a web-market-data endpoint and therefore must be treated as an upstream candidate, not as a contractual SLA-backed API.

QEO-100 must benchmark SSI iBoard alongside DNSE and VCI. KBS remains an optional comparison source but is deprioritized because observed history depth appears insufficient for the desired ranges.

No browser code calls SSI directly. QeoIndex continues to expose only `/api/market/ohlcv`.

## Runtime storage model

### Full Daily

Canonical `1D` remains locally persisted for full available history in `market_ohlcv_history` because the row count is small relative to minute history and Daily is required by EOD/Wyckoff/indicators/backtests.

Higher resolutions `3D/1W/1M/1Q/1Y` are deterministic derived views from canonical Daily and are not separately authoritative.

### Recent raw minute hot tier

`chart_ohlcv_intraday` contains only recent raw `1m` rows needed for short-term rendering and realtime merge.

Target hot retention is 31 calendar days, session-aware.

### Legacy intraday cold tier

Raw `1m` older than 31 days is not allowed to accumulate indefinitely in Postgres.

Archive lifecycle:

```text
hot raw 1m
  -> immutable cold partition
  -> checksum + row-count + range manifest
  -> readback verification
  -> eligible hot prune
```

The existing checksum-verified cold storage abstraction remains valid. Pruning is a new lifecycle responsibility tracked by QEO-103.

Verified raw `<1D` history may remain indefinitely in private cold Object Storage as the legacy/backup archive. This is intentionally separate from the online chart render horizon: data can remain archived even when the chart is not allowed to request it.

### Mid-term 1-year requirement

A `1h/2h/4h` chart needs at most one year. The implementation must avoid keeping one year of raw `1m` indexed in Postgres.

The first implementation uses the existing **cold raw-minute strategy**: raw `1m` older than the 31-day hot window is stored as immutable verified Object Storage partitions and the QEO-93 timeframe engine aggregates those bars on demand for `1h/2h/4h` up to one year.

A deterministic rebuildable `1h` cache may be added later under QEO-97 only if measured latency/storage evidence justifies it. Such a cache would remain derived and non-canonical.

Intraday data older than one year is outside the current **render** contract and must not remain in hot Postgres. When retained for backup/reproducibility, it stays cold and is not hydrated into the browser through normal chart requests.

## Provider/cache read order

Conceptual read path:

```text
/api/market/ohlcv
  |
  +-- >=1D ----------> local canonical Daily full history
  |
  +-- 1h/2h/4h -----> hot + cold raw 1m (<=1y) -> QEO-93 aggregation
  |                       |
  |                       +-- missing canonical range -> selected upstream from/to refill
  |
  +-- <1h -----------> hot/cold raw 1m (<=31d) -> QEO-93 aggregation where derived
                          |
                          +-- missing canonical range -> selected upstream from/to refill
```

Provider REST is a refill source behind the canonical service boundary, not a frontend dependency.

## Archive correctness rules

- Never delete hot rows before immutable archive write succeeds.
- Verify checksum, row count, timestamp range, decompression/readback and normalized OHLC invariants before pruning.
- Archive/prune is idempotent and resumable per ticker/partition.
- One failed ticker/partition does not abort the whole lifecycle run.
- Hot/cold overlap uses deterministic dedupe.
- Archive movement must not change candle timestamps/values or time+price drawing anchors.
- QEO-93 remains the single session-aware aggregation implementation; storage lifecycle does not introduce a second OHLC aggregation algorithm.
- Provider disagreement is preserved as provenance/integrity evidence; storage lifecycle never silently rewrites historical bars.

## UI behavior

The chart must communicate the product horizon through available data rather than unlimited pan-left requests:

- `<1h`: pan-left stops at one month;
- `1h/2h/4h`: pan-left stops at one year;
- `>=1D`: pan-left may continue through all available Daily history.

The visible range, crosshair and drawings must remain stable when data crosses hot/cold boundaries.

## Acceptance additions

- SSI iBoard `from/to` behavior is probed for `1m` and `1D` on representative HOSE/HNX/UPCOM symbols.
- KBS is not selected as authority unless it meets the required history depth in live benchmark evidence.
- Short-term chart data never exceeds one month.
- Mid-term chart data never exceeds one year.
- Long-term Daily/higher chart can render full available history.
- Hot Postgres raw minute retention is bounded to approximately 31 days after archive lifecycle is enabled.
- Legacy `<1D` rows are archived and verified before prune.
- Intraday older than one year is absent from hot Postgres and may remain only in verified cold legacy archive.
- Normal chart requests cannot hydrate archived intraday beyond the one-year mid-term horizon.
- Five visible VIC candles still match canonical API output exactly after crossing the implemented storage tier boundary.
