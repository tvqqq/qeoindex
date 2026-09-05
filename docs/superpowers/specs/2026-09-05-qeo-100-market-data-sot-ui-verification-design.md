# QEO-100 — Market Data Source-of-Truth and UI Verification Design

Date: 2026-09-05
Status: Approved design, pending written-spec review
Owner: QEO-100
Related: QEO-92, QEO-93, QEO-96, QEO-98, QEO-101, QEO-102

## Decision

QeoIndex will not promote TitanLabs, KBS, VCI, DNSE, SSI, Yahoo, or any other upstream merely because it returns OHLCV.

The next implementation establishes one provider-neutral benchmark path, runs the same bounded requests against available upstreams, reconciles the results against independent reference data, and only then nominates the upstream authority/fallback order for canonical `1m` and `1D`.

The interactive chart will continue to read only from the QeoIndex canonical chart-data API. Provider-specific code remains server-side. Local canonical Hot/Cold storage is the runtime data source for the product after data has been validated and promoted.

## Goals

1. Determine why the current DNSE canonical `VIC 1m` request returns `503` even though production DNSE credentials are configured.
2. Benchmark DNSE, KBS, and VCI through the same normalized provider contract.
3. Keep SSI FastConnect out of the critical path until usable credentials exist; its official API remains a future benchmark candidate.
4. Keep TitanLabs deferred until the preferred sources are tested and a specific unresolved historical gap is proven.
5. Select evidence-backed upstream authority/fallback order for canonical historical `1m` and `1D`.
6. Hydrate a small VIC dataset into existing QEO-92 Hot/Cold storage and prove it through `/api/market/ohlcv`.
7. Verify the exact canonical bars on `/insights/vic` before expanding to more tickers.

## Non-goals

- Do not bulk-clone TitanLabs in this workstream.
- Do not self-build the latest EOD Daily candle before QEO-100/QEO-101 decide whether that is necessary.
- Do not add SSI FastConnect scraping or fake credentials.
- Do not make KBS/VCI endpoints direct browser dependencies.
- Do not implement QEO-93 derived timeframe aggregation here.
- Do not fabricate `1m` from `5m`, `1H`, or `1D` data.
- Do not silently normalize away provider disagreements, especially volume mismatches.

## Current evidence

### DNSE

- Production `DNSE_API_KEY` and `DNSE_API_SECRET` are configured according to the operator.
- Credentials were rotated after a historical exposure, but a decisive post-rotation provider-read smoke has not yet been recorded.
- Current canonical `VIC 1m` browser requests reach `/api/market/ohlcv` and return `503` after the provider path fails.
- The failure class is not yet known: auth/signature, request range, resolution contract, timeout, rate limit, empty coverage, or normalization/runtime error remain possible.
- Existing `/api/market/index-candles?resolution=1` is a useful no-fallback DNSE probe once called with an authenticated QeoIndex session.

### KBS explorer source

The current `thinh-vu/vnstock` KBS explorer calls the KBS website market-data endpoint directly without user broker credentials:

```text
https://kbbuddywts.kbsec.com.vn/iis-server/investment/stocks/{symbol}/data_{interval}
```

It constructs browser-like headers and does not pass Authorization/API-key credentials from the caller. The current interval map includes native paths for `1m`, `5m`, `15m`, `30m`, `1H`, `1D`, `1W`, and `1M`.

This makes KBS an actionable candidate, but not automatically an official contractual API or source-of-truth.

### VCI explorer source

The current `thinh-vu/vnstock` VCI explorer calls:

```text
POST https://trading.vietcap.com.vn/api/chart/OHLCChart/gap-chart
```

with browser-like headers and no user-supplied Authorization credential. It uses upstream `ONE_MINUTE`, `ONE_HOUR`, and `ONE_DAY`; vnstock derives `5m`, `15m`, and `30m` from upstream minute data.

This aligns well with QEO-92/QEO-93 architecture because canonical minute bars can remain the only intraday raw source.

### Independent reference

Finhay MCP is used only as an independent investigation reference, not as an application runtime dependency.

For VIC on 2026-09-04, local Yahoo fallback and Finhay agreed exactly on OHLC (`244.7 / 260 / 244.7 / 256.1`) but differed on volume (`7,584,520` vs `7,518,600`, about 0.88%). Provider selection therefore must explicitly resolve volume semantics and cannot rely on price-only agreement.

## Architecture

```text
DNSE ─┐
KBS  ─┼──> Provider Adapters ──> Normalize/Validate ──> Benchmark/Reconcile
VCI  ─┘                                                   │
                                                          ▼
                                                  Provider Decision
                                                          │
                                                          ▼
                                               QEO-92 Canonical Storage
                                                Hot DB + Cold Storage
                                                          │
                                                          ▼
                                                /api/market/ohlcv
                                                          │
                                                          ▼
                                                /insights/[ticker]
```

No provider name, provider URL, storage bucket, credentials, signed request details, or raw upstream schema reaches the frontend contract.

## Canonical provider contract

All probe adapters implement one server-only shape conceptually equivalent to:

```ts
type MarketDataResolution = "1m" | "1D"

type ProviderFetchRequest = {
  ticker: string
  resolution: MarketDataResolution
  from: number
  to: number
}

type ProviderFetchResult = {
  provider: string
  bars: OhlcvBar[]
  requestedFrom: number
  requestedTo: number
  returnedFrom: number | null
  returnedTo: number | null
  rowCount: number
  latencyMs: number
  fetchedAt: string
  coverage: "FULL" | "PARTIAL" | "EMPTY"
  errorClass?: ProviderErrorClass
  providerDetail?: string
}
```

Canonical bars retain the existing QEO-92 normalized contract:

```ts
interface OhlcvBar {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}
```

The benchmark path must not write canonical storage until explicit promotion is requested after validation.

## Provider adapters

### DNSE adapter

Reuse the current signed OpenAPI history implementation rather than creating a second signer.

Probe in increasing scope:

1. direct index minute read through the existing no-fallback index path;
2. VIC `1m` for one completed trading session;
3. VIC recent `1D` for about 20 completed sessions;
4. only after success, expand `1m` to five sessions and `1D` to one year.

Capture sanitized failure evidence: HTTP/provider status category, latency, resolution, range, error class, and returned row count. Never log credentials, signatures, or complete signed headers.

### KBS adapter

Implement the minimal server-only request pattern proven by the current vnstock explorer rather than adding Python/vnstock as a production dependency.

Initial native resolutions for this workstream: `1m` and `1D` only.

The adapter must identify any server-side access restrictions, rate limits, response-size limits, timezone semantics, raw price units, volume units, and historical-retention limits.

### VCI adapter

Implement the minimal server-only request pattern corresponding to the current vnstock VCI explorer.

Use `ONE_MINUTE` for canonical `1m` and `ONE_DAY` for canonical `1D`. Do not use vnstock-style resampling inside QEO-100; derived timeframe aggregation remains QEO-93.

The adapter must record the same operational/semantic metadata as KBS.

### SSI FastConnect

No production adapter is required in this phase because the project does not currently have usable FastConnect credentials. Keep only the interface boundary and documentation that SSI can be benchmarked later if credentials are provisioned.

### TitanLabs

Not called during the initial provider decision. QEO-102 may activate TitanLabs only if QEO-100 proves a concrete gap after DNSE/KBS/VCI evaluation.

## Admin probe surface

Add an authenticated root/admin-only probe surface; do not expose raw provider testing to normal chart clients.

Conceptual route:

```text
POST /api/admin/market-data/probe
```

Request fields:

```text
provider
ticker
resolution
from
to
```

Response contains normalized bars plus sanitized benchmark metadata. It must never return secrets, provider signatures, internal stack traces, or unrestricted arbitrary URLs.

The route uses an allowlist of known providers/tickers/resolutions and bounded range limits to prevent it from becoming an open proxy or bulk-scraping endpoint.

## Benchmark matrix

### Initial symbols

Use five representative names:

- VIC (HOSE)
- VCB (HOSE)
- HPG (HOSE)
- one liquid HNX ticker from the current canonical universe
- one liquid UPCOM ticker from the current canonical universe

The HNX/UPCOM names must be resolved from the live canonical universe at implementation time rather than hard-coded from stale assumptions.

### Initial ranges

```text
1m: one completed session -> five completed sessions
1D: about 20 completed sessions -> one year
```

Only after these bounded cases succeed should historical-depth probes expand further.

### Comparison fields

For overlapping completed bars compare:

- timestamp and session date;
- open/high/low/close;
- volume;
- missing bars/sessions;
- duplicate timestamps;
- OHLC invariant validity;
- lunch/session boundaries for minute data;
- earliest/latest returned timestamp;
- response latency;
- failure/retry/rate-limit behavior.

Provider disagreements remain visible evidence. The benchmark may calculate deltas, but it must not automatically rewrite one provider to match another.

## Source-of-truth decision policy

A provider is not promoted merely because it returns data. Rank candidates using:

1. OHLC correctness on completed bars — critical;
2. understood volume semantics — critical;
3. real canonical `1m` — critical for intraday source;
4. canonical-universe HOSE/HNX/UPCOM coverage — critical;
5. stable timestamps/session semantics — critical;
6. production Vercel runtime reliability — high;
7. historical depth — high;
8. latest-session freshness — high;
9. rate limits/latency — high;
10. documented/stable upstream contract and acceptable usage terms — high;
11. corporate-action/raw-vs-adjusted behavior — high.

The final QEO-100 output must explicitly nominate:

- historical `1m` primary;
- historical `1m` fallback;
- historical `1D` primary;
- historical `1D` fallback;
- realtime/current-session source or owning issue;
- unresolved gaps requiring QEO-102, if any.

A valid outcome may use different primary providers for `1m` and `1D`.

## Canonical promotion and hydration

Only after provider decision evidence is recorded:

1. request a bounded VIC range from the selected upstream;
2. normalize and validate bars;
3. persist provenance through the existing QEO-92 batch/provenance boundary;
4. write recent canonical minute bars to `chart_ohlcv_intraday`;
5. keep older immutable minute history behind the existing cold-storage abstraction as required by retention policy;
6. keep canonical Daily in `market_ohlcv_history` according to QEO-101 provider-authority decision;
7. prove hot/cold reads return identical normalized values at overlap boundaries.

Initial promotion scope:

```text
VIC 1m: five completed trading sessions
VIC 1D: at least one year when the selected Daily source is approved
```

Do not start full-universe historical cloning before VIC end-to-end acceptance passes.

## Chart/UI verification

The production chart must consume the same canonical API regardless of which upstream won the provider benchmark.

Verification sequence on `/insights/vic`:

1. hard refresh while authenticated;
2. load `1D`;
3. switch to `1m`;
4. switch repeatedly between `1D` and `1m`;
5. pan/zoom within loaded history;
6. reload and repeat;
7. verify provider outage/unavailable state does not fabricate candles.

UI acceptance requires:

- no infinite spinner;
- `/api/market/ohlcv` returns `200` for promoted VIC ranges;
- non-empty real `1m` bars;
- non-empty real `1D` bars;
- chart crosshair OHLCV matches canonical API values;
- VN lunch/session gaps remain correct;
- historical bars remain deterministic after reload/timeframe switch;
- no frontend provider-specific branching;
- unsupported derived intraday timeframes remain owned by QEO-93 rather than being synthesized here.

Select at least five completed candles visible on the chart and compare:

```text
UI candle
  == canonical /api/market/ohlcv bar
  == promoted provider normalized bar
```

Use an independent reference sample for additional confidence, but canonical acceptance is based on the selected provider policy plus reconciliation evidence, not on a single third-party comparator.

## Rollout stages

Expand only after the previous stage passes:

```text
VIC
 -> five representative exchange/liquidity samples
 -> 20 canonical tickers
 -> 200 canonical-universe tickers
```

For each stage report:

- expected ticker count;
- covered ticker count;
- provider failures;
- unresolved gaps;
- provider mismatch count;
- P50/P95 latency;
- canonical rows written;
- provenance coverage;
- storage growth.

A claim of `200/200` is allowed only after the exact frozen canonical universe has been measured.

## Error handling

Use explicit provider error classes, for example:

- `AUTH`
- `INVALID_REQUEST`
- `UNSUPPORTED_RESOLUTION`
- `RATE_LIMIT`
- `TIMEOUT`
- `NETWORK`
- `EMPTY_COVERAGE`
- `MALFORMED_RESPONSE`
- `NORMALIZATION`

Provider retries must be bounded and limited to retryable classes. Never convert an outage into fake bars or stale-success telemetry.

## Security and operational safeguards

- Provider probes are server-only and admin/root protected.
- No secrets or signed headers in logs/API responses.
- KBS/VCI requests use bounded concurrency and range sizes.
- Do not use random proxy rotation as normal production behavior.
- Review upstream Terms/usage restrictions before any high-volume/full-universe archival job.
- Cache only where it does not hide provider freshness or benchmark evidence.
- Provider adapters remain replaceable without changing frontend code or canonical bar shape.

## Testing strategy

Follow TDD for implementation.

Required test groups:

1. provider adapter contract tests;
2. DNSE sanitized error classification tests;
3. KBS response normalization fixtures;
4. VCI response normalization fixtures;
5. OHLC invariant/duplicate/range clipping tests;
6. reconciliation/mismatch tests, including volume mismatch;
7. admin probe authentication/input-bound tests;
8. canonical promotion/provenance tests;
9. `/api/market/ohlcv` VIC `1m`/`1D` integration tests;
10. stock chart regression tests proving no spinner trap and no synthetic bars;
11. production UI smoke after deployment.

External provider live probes are evidence/smoke tests and must not make the deterministic unit test suite dependent on internet availability.

## Issue ownership

### QEO-100

Owns provider adapters used for evaluation, bounded benchmark/probe infrastructure, source-of-truth decision evidence, and the first bounded VIC canonical promotion needed to prove the decision.

### QEO-101

Consumes QEO-100's Daily provider evidence and decides whether latest completed `1D` should be provider-authoritative, primary/fallback consensus, or locally finalized as an explicit redundancy layer.

### QEO-102

Remains deferred. Activates TitanLabs/third-source investigation only if QEO-100 documents a concrete unresolved gap.

### QEO-93

Owns deterministic aggregation of derived timeframes from canonical `1m`/`1D`. It must not fetch KBS/VCI/DNSE/TitanLabs directly.

### QEO-98

Owns final production chart acceptance and must include source-of-truth evidence, canonical API/UI candle equality, hot/cold correctness, provider outage behavior, and real production verification.

## Acceptance criteria

- [ ] DNSE direct provider read is classified conclusively with sanitized evidence.
- [ ] KBS `1m` and `1D` can be probed from the QeoIndex server runtime, or a precise access failure is documented.
- [ ] VCI `1m` and `1D` can be probed from the QeoIndex server runtime, or a precise access failure is documented.
- [ ] Same-range completed bars are benchmarked across available candidates and an independent reference sample.
- [ ] Volume semantics/mismatches are explicitly investigated rather than ignored.
- [ ] One historical `1m` primary/fallback policy is selected.
- [ ] One historical `1D` primary/fallback policy is selected or formally deferred to QEO-101 with sufficient evidence.
- [ ] TitanLabs remains deferred unless a specific unresolved gap is proven.
- [ ] VIC bounded canonical data is promoted with provenance through existing QEO-92 storage boundaries.
- [ ] `/api/market/ohlcv` returns stable non-synthetic VIC data for the promoted resolutions/ranges.
- [ ] `/insights/vic` displays canonical bars without infinite loading/error loops under healthy provider/storage conditions.
- [ ] At least five UI candles match the canonical API exactly after normalization.
- [ ] Provider-specific implementation remains invisible to frontend code.
- [ ] Full regression, lint, TypeScript, build, relevant DB gates, and production smoke pass before final acceptance.
