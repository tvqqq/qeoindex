# QEO-129 VHM Daily price-basis provider probe — 2026-09-07

## Purpose

This investigation began when QEO-129 still assumed retained `market_ohlcv_history` might serve as raw/provider input. The VHM probes disproved that assumption. QEO-132 subsequently established `market_ohlcv_raw_daily` as the only canonical RAW Daily input boundary; legacy `market_ohlcv_history` remains adjusted/provider compatibility evidence only.

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

## StockBiz — bounded raw-basis technical spike

Public historical VHM displays raw OHLC and `Đóng cửa ĐC` side-by-side. A one-shot GitHub Actions probe then tested the deterministic `LookupQuote.aspx?Date=...` surface from a cloud runner.

- workflow: `QEO-132 StockBiz Raw Basis Probe`
- run: `34066329329`
- job: `101575618732`
- three bounded pages queried: `26/06/2026`, `05/08/2026`, `17/10/2025`
- all three returned HTTP `200`
- each parsed page returned `30` historical rows
- observed request latencies: about `2.6s`, `0.7s`, `0.4s`

Exact VHM raw/adjusted evidence:

| Session | Raw O | Raw H | Raw L | Raw C | Adjusted C | Volume |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2025-10-13 | 123.0 | 126.0 | 122.1 | 124.2 | 59.80 | 13,782,200 |
| 2025-10-14 | 124.5 | 131.5 | 124.5 | 127.0 | 61.15 | 14,600,200 |
| 2025-10-15 | 127.5 | 127.6 | 122.6 | 124.0 | 59.70 | 8,062,500 |
| 2025-10-16 | 123.8 | 123.8 | 120.4 | 122.0 | 58.74 | 9,614,900 |
| 2025-10-17 | 122.0 | 122.0 | 114.6 | 116.0 | 55.85 | 12,213,500 |
| 2026-06-26 | 157.5 | 163.9 | 156.5 | **162.0** | 78.00 | 12,073,300 |
| 2026-08-05 | 154.2 | 158.8 | 153.0 | **153.0** | 76.50 | 10,681,100 |

The raw golden-week extrema are exactly:

- high: **`131.5`**
- low: **`114.6`**
- sessions: `5`

This independently reproduces the QEO-124 regression carrier and both externally required raw reference closes without inverse-adjusting an adjusted provider series.

Technical classification: **GO AS A BOUNDED RAW-BASIS EVIDENCE SOURCE**.

Production-source classification: **HOLD**. The public site exposes `Điều khoản sử dụng` and `Bản quyền`, but this investigation did not retrieve terms that authorize automated bulk ingestion. Rate-limit and long-range/canonical-200 suitability are also not established. Therefore StockBiz must not yet be promoted to a production bulk raw provider solely from this successful bounded probe.

## Code hardening produced by this investigation

The initial hardening stopped QEO-129 from inferring RAW price basis from provider names. QEO-132 then replaced that provisional classification boundary with explicit canonical `price_basis='RAW'` persistence. Historical classification findings remain useful for rejecting adjusted providers:

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

QEO-132 now provides the auditable RAW Daily schema/persistence boundary, but production still has no retained VHM canonical RAW range. QEO-133 owns source-operation acceptance: StockBiz remains bounded/manual evidence only unless written permission/licensed use is established, or another documented provider RAW source is selected.

QEO-129 must remain blocked until production contains a retained VHM QEO-132 canonical RAW range with explicit `price_basis='RAW'` provenance and exact retained-session identity. QEO-129 must not mutate QEO-132 RAW evidence or legacy compatibility history during shadow materialization.
