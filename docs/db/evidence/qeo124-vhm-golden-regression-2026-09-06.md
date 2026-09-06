# QEO-124 VHM Golden Regression Evidence — 2026-09-06

## Scope

This evidence pins the QEO-124 deterministic adjustment-factor regression for VHM around the week 13-17/10/2025. It does not make Finhay, Yahoo, StockBiz, or any external chart provider a factor authority. QEO-123 canonical VSDC corporate-action facts remain the event authority; QeoIndex owns the formulas and factor lineage.

## Canonical corporate-action facts

The frozen QEO-123 regression fixtures identify the two later VHM actions that affect the 13-17/10/2025 historical basis when viewed after 06/08/2026:

| VSDC source event | Canonical ex-date | Type | Terms |
| --- | --- | --- | --- |
| `197086` | `2026-06-29` | cash dividend | `6,000 VND/share` |
| `198392` | `2026-08-06` | stock dividend | `1:1` |

The golden fixture uses synthetic deterministic `rawEvidenceHash` values because live VSDC HTML hashes are evidence payload identities, not stable public golden constants. The portable factor identity still includes the canonical row's evidence hash at runtime; generated database UUIDs are excluded from the lineage hash.

## Raw reference-price evidence

QEO-124 needs the previous raw close for each effective transition.

- `2026-06-26`: VHM market evidence reported `162.0` after the session. With a `6.0` thousand-VND cash dividend, the cash step is `(162 - 6) / 162 = 26/27`.
- `2026-08-05`: StockBiz historical data exposes both the raw close `153.0` and adjusted close `76.5` immediately before the 1:1 stock-dividend ex-date. This independently confirms the pre-event raw basis and the expected `1/2` stock step.

External evidence URLs used for this cross-check:

- `https://solieu5.mediacdn.vn/du-lieu/vhm-2917764/vhm-cbtt-nghi-quyet-hdqt-so-322026-ngay-25062026.chn`
- `https://web.stockbiz.vn/Stocks/VHM/HistoricalQuotes.aspx`

## Deterministic factor lineage

The two effective steps are:

```text
cash step  = (162 - 6) / 162 = 26/27
stock step = 1 / (1 + 1)     = 1/2
```

Therefore dates before `2026-06-29` use:

```text
historical cumulative price factor
= (26/27) * (1/2)
= 13/27
= 0.481481481481...
```

The target week's raw extrema frozen in `tests/fixtures/corporate-actions/vhm-qeo124-golden.json` are `131.5` and `114.6` thousand VND. Applying the QeoIndex factor gives:

```text
131.5 * 13/27 = 63.314814... -> 63.31
114.6 * 13/27 = 55.177777... -> 55.18
```

The full raw Daily week in the fixture is a deterministic pre-action-basis regression carrier reconstructed consistently with the independently observed adjusted benchmark. It is not presented as a separate authoritative OHLC source. The factor itself is derived only from the canonical VSDC terms and the independently supported raw reference closes above.

## Independent benchmark

Finhay historical VHM Daily data for `2025-10-13` through `2025-10-17` returns adjusted weekly extremes:

- High: `63.31`
- Low: `55.18`

Finhay is used only as an independent regression cross-check. It is not used as event evidence or as a hidden factor source.

## Regression path

`tests/qeo-124-vhm-golden.test.ts` verifies the complete deterministic path:

1. Build the candidate factor run from the two QEO-123 VHM actions and raw reference closes.
2. Verify cash step `26/27` and stock step `1/2`.
3. Verify pre-29/06/2026 cumulative price factor `13/27`.
4. Apply that factor to the frozen 13-17/10/2025 raw Daily fixture without changing session timestamps.
5. Aggregate adjusted Daily through the production QEO-93 `aggregateChartTimeframe(..., "1W")` contract.
6. Require weekly `H=63.31` and `L=55.18` within the pinned tolerance and exactly after two-decimal rounding.

Focused workflow evidence: QEO-124 Register Tests Once run `34042723800` completed GREEN, including monetary-unit, lineage-portability, formula, and VHM golden contracts.
