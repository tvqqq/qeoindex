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

### Mid-term 1-year requirement

A `1h/2h/4h` chart needs at most one year. The implementation must avoid keeping one year of raw `1m` indexed in Postgres.

Two acceptable storage strategies are benchmarked:

1. **cold raw-minute strategy** — keep raw `1m` partitions for days 32-366 in Object Storage and aggregate on demand;
2. **derived 1h archive/cache strategy** — before raw-minute expiry, deterministically aggregate verified canonical `1m` into session-aware `1h` partitions. Keep those for up to one year and use them as a rebuildable cache for `1h/2h/4h`.

The second strategy is preferred if it materially reduces latency/storage. A derived `1h` archive is never canonical source-of-truth and must carry source range/checksum/provenance sufficient to audit how it was produced.

Intraday data older than one year is outside the current chart product contract. It must not remain in hot Postgres. It may be deleted after archive/cache policy requirements are satisfied unless a separate approved research/backtest requirement explicitly retains it.

## Provider/cache read order

Conceptual read path:

```text
/api/market/ohlcv
  |
  +-- >=1D ----------> local canonical Daily full history
  |
  +-- 1h/2h/4h -----> hot/cold/derived mid-term cache (<=1y)
  |                       |
  |                       +-- miss -> selected upstream from/to fetch
  |
  +-- <1h -----------> hot raw minute / short cold boundary (<=31d)
                          |
                          +-- miss -> selected upstream from/to fetch
```

Provider REST is a refill source behind the canonical service boundary, not a frontend dependency.

## Archive correctness rules

- Never delete hot rows before immutable archive write succeeds.
- Verify checksum, row count, timestamp range, decompression/readback and normalized OHLC invariants before pruning.
- Archive/prune is idempotent and resumable per ticker/partition.
- One failed ticker/partition does not abort the whole lifecycle run.
- Hot/cold overlap uses deterministic dedupe.
- Archive movement must not change candle timestamps/values or time+price drawing anchors.
- Derived `1h` cache creation uses the same session-aware aggregation implementation as QEO-93, not a separate approximation.
- Provider disagreement is preserved as provenance/integrity evidence; storage lifecycle never silently rewrites historical bars.

## UI behavior

The chart must communicate the product horizon through available data rather than unlimited pan-left requests:

- `<1h`: pan-left stops at one month;
- `1h/2h/4h`: pan-left stops at one year;
- `>=1D`: pan-left may continue through all available Daily history.

The visible range, crosshair and drawings must remain stable when data crosses hot/cold/cache boundaries.

## Acceptance additions

- SSI iBoard `from/to` behavior is probed for `1m` and `1D` on representative HOSE/HNX/UPCOM symbols.
- KBS is not selected as authority unless it meets the required history depth in live benchmark evidence.
- Short-term chart data never exceeds one month.
- Mid-term chart data never exceeds one year.
- Long-term Daily/higher chart can render full available history.
- Hot Postgres raw minute retention is bounded to approximately 31 days after archive lifecycle is enabled.
- Legacy `<1D` rows are archived and verified before prune.
- Intraday older than one year is absent from hot Postgres.
- Five visible VIC candles still match canonical API output exactly after crossing the implemented storage tier boundary.
