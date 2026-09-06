# QEO-129 VHM Daily price-basis provider probe — 2026-09-07

## Purpose

QEO-129 production shadow acceptance requires `market_ohlcv_history` input rows to be auditable **raw/provider Daily** before QEO-124 factors are applied. This note records the bounded provider probes performed after production VHM history was found to be predominantly legacy adjusted-basis.

This evidence does **not** authorize any provider as raw merely from its name, unit scale, or successful HTTP response.

## Production baseline / blocker

VHM `1D` production baseline captured before any QEO-129 shadow materialization:

- canonical sessions: `1,998 / 1,998`
- retained range: `2018-08-27 -> 2026-09-04`
- duplicate canonical sessions: `0`
- stable pre-rebuild checksum: `b3681f23…`
- provenance: `1,997 / 1,998` rows are legacy Yahoo/Fallback adjusted-basis; one row has TitanLabs provenance
- no VHM QEO-124 factor run existed when the baseline was captured
- no VHM QEO-129 shadow rows were written

The decisive anchors are incompatible with treating the retained history as raw:

| Session | Raw reference | Adjusted/provider value |
| --- | ---: | ---: |
| 2026-06-26 | `162.0` | about `78.0` |
| 2026-08-05 | `153.0` | `76.5` |

Applying QEO-124 factors to the adjusted/provider values would double-adjust VHM history.

## DNSE

One-shot GitHub Actions probe: `QEO-129 DNSE Raw Basis Probe`.

- run: `34065666062`
- job: `101573860107`
- result: `{ configured: false, provider: "DNSE" }`
- `DNSE_API_KEY` and `DNSE_API_SECRET` were not configured in GitHub Actions.

Classification: **UNAVAILABLE FOR THIS PROBE**, not a provider-data rejection.

## SSI iBoard

Existing QEO-100 production-like cloud evidence records the credential-less SSI iBoard historical endpoint returning HTTP `403 Security Check - SSI`.

Classification: **NOT RELIABLE AS THE SERVER-RUNTIME RAW REPAIR PATH** under current evidence.

## VCI native ONE_DAY

One-shot GitHub Actions probe: `QEO-129 VCI Raw Basis Probe`.

- run: `34065733396`
- job: `101574037353`
- endpoint: Vietcap `gap-chart`
- timeframe: `ONE_DAY`
- response: HTTP success with usable aligned OHLCV vectors

Observed VHM anchors after canonical `/1000` price normalization:

| Session | Open | High | Low | Close |
| --- | ---: | ---: | ---: | ---: |
| 2026-06-26 | — | — | — | `78.003` |
| 2026-08-05 | — | — | — | `76.5` |

Observed 2025-10-13..17 weekly extrema from VCI Daily:

- high: `63.31725`
- low: `55.1799`

These values are already on the independent adjusted benchmark basis. Therefore **provider=`VCI` is not sufficient evidence that a Daily row is raw**.

## TitanLabs — final independent cross-check

One-shot GitHub Actions probe: `QEO-129 TitanLabs Final Basis Probe`.

- run: `34065783520`
- job: `101574170685`
- endpoint: `https://www.titanlabs.vn/api/charts/series?symbol=VHM`
- usable Daily bars: `2,072`
- provider-reported range: `2018-05-17 -> 2026-09-04`

Observed VHM anchors:

| Session | Open | High | Low | Close | Volume |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2026-06-26 | `75.84` | `78.92` | `75.36` | `78.0` | `10,482,758` |
| 2026-08-05 | `77.1` | `79.4` | `76.5` | `76.5` | `10,722,235` |

Observed 2025-10-13..17 weekly extrema:

- high: `63.32`
- low: `55.18`

TitanLabs independently corroborates the **adjusted** VHM series and does not provide raw pre-corporate-action input for QEO-124. This narrows the earlier QEO-102 statement that TitanLabs prices are “raw VND”: unit scale may be raw VND while corporate-action price basis is adjusted. VHM proves these are distinct semantics.

## Independent raw-vs-adjusted evidence

StockBiz historical VHM displays raw OHLC and `Đóng cửa ĐC` side-by-side. For `2026-08-05` it reports:

- raw open/high/low/close: `154.20 / 158.80 / 153.00 / 153.00`
- adjusted close: `76.50`
- volume: `10,681,100`

Source surface: `https://web.stockbiz.vn/Stocks/VHM/HistoricalQuotes.aspx`.

StockBiz is evidence that the raw/adjusted split exists and that the QEO-124 `153.0` raw anchor is externally observable. It is **not yet approved as a canonical bulk raw provider**; coverage, terms, rate limits and deterministic acquisition must be reviewed separately.

## Code hardening produced by this investigation

QEO-129 no longer infers raw price basis from provider names. Persisted Daily rows are classified:

- explicit `source basis: adjusted` or `adjusted OHLC` marker -> `ADJUSTED`
- explicit `source basis: raw` marker -> `RAW`
- anything else -> `UNKNOWN`

`applyDailyAdjustment` rejects both `ADJUSTED` and `UNKNOWN` before any adjusted-row or rollout write.

TDD evidence:

- RED commit: `9b2e1ce431a370ab604604ca35a18976af35a66d`
- RED Verify: `34065954975`
- result: `1,064 pass / 1 fail`; sole failure was the new provider-name-only provenance rejection contract
- GREEN implementation commit: `b4eb0e450f73237b708702ca210751c29669c371`
- GREEN Verify: `34066042171`

## Ownership / next gate

The blocker is not QEO-129 factor arithmetic. It is a migration gap between:

- QEO-106: legacy canonical Daily was intentionally normalized onto provider-adjusted basis; and
- QEO-121: approved final architecture requires auditable raw/provider Daily as adjustment-engine input.

Linear `QEO-132` now owns restoring an auditable raw Daily boundary before VHM shadow materialization.

QEO-129 must remain blocked until QEO-132 provides a retained VHM raw/provider input range with explicit `source basis: raw` provenance. QEO-129 itself must not mutate that raw baseline; its production acceptance requires the pre/post raw checksum to remain identical.
