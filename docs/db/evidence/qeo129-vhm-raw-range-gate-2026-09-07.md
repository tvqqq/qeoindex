# QEO-129 VHM retained canonical RAW range gate — 2026-09-07

## Status

**BLOCKED — PR #356 must not merge yet.**

QEO-132 has established the auditable RAW storage boundary, but production does not yet contain the retained canonical VHM RAW Daily range required for QEO-129 shadow materialization.

This note is the release-gate evidence. It must not be interpreted as authorization to synthesize RAW prices from adjusted providers or to bulk-ingest StockBiz.

## Production readback

Captured from production project `glwhhrmejlonhyorvtzm` on 2026-09-07 before any VHM QEO-129 shadow rebuild:

| Store | VHM rows | Range |
| --- | ---: | --- |
| `market_ohlcv_raw_daily_evidence` | **0** | none |
| `market_ohlcv_raw_daily` | **0** | none |
| `market_ohlcv_adjusted_daily` | **0** | none |
| legacy `market_ohlcv_history` / `1D` | `1,998` | `2018-08-27 -> 2026-09-04` |

The legacy table remains adjusted-basis compatibility/history evidence. It is **not** a QEO-129 RAW input.

Two decisive legacy anchors remain inconsistent with provider RAW:

- `2026-06-26`: legacy close `81.0`; independently observed StockBiz RAW close `162.0`.
- `2026-08-05`: legacy close `76.5`; independently observed StockBiz RAW close `153.0`.

Therefore no legacy-price fallback is allowed.

## Immutable retained VHM identity baseline

QEO-129 needs an independent expected retained-session identity so a sparse set of RAW anchors cannot be marked as a complete shadow range.

The pre-rebuild VHM retained session baseline is:

- expected session count: **`1,998`**
- first retained session: `2018-08-27`
- last retained session: `2026-09-04`
- ordered session-identity SHA256: **`13dd4a37df57229bf033a22c6f616a4e136bf99200714cfca9c4dbb96cdb3dbe`**

The hash is SHA-256 of ordered `YYYY-MM-DD` session identities joined by newline. It contains no price values and does not assert that legacy prices are RAW.

Additional immutable mutation guards for the legacy table:

- ordered VHM `session|OHLCV` SHA256: **`341b9b453a337c01d8e0ef9044038665d74476df866eb370a2a0f34fbe9b9292`**
- ordered VHM `session|OHLCV|provider|provider_detail` SHA256: **`6545a25ce22d8fb6d4616e25732434f5ada2f6c42640eb60db0f5bc755559c41`**

These two checksums are pre/post mutation guards only. QEO-129 must not derive adjusted prices from these legacy values.

## Why exchange calendar alone is not the completeness authority

For the same retained date range, `market_trading_sessions` contains `2,002` exchange trading sessions while VHM has `1,998` retained Daily session identities.

The four exchange sessions not represented by the retained VHM series are:

- `2019-12-03`
- `2019-12-04`
- `2019-12-05`
- `2020-03-04`

Therefore a per-ticker retained-range gate cannot blindly require one VHM bar for every exchange-open session. QEO-129 uses the immutable ticker-session attestation above instead.

## PR #356 release-gate hardening

`rebuildAdjustedDailyRange(...)` now requires an independent expected RAW coverage attestation:

- `expectedRawSessionCount`
- `expectedRawSessionIdentityHash`

The rebuild:

1. reads only QEO-132 `market_ohlcv_raw_daily` through the canonical RAW loader;
2. rejects duplicate/out-of-range canonical RAW sessions;
3. computes SHA-256 over the ordered canonical RAW session identities;
4. rejects before any adjusted-row or rollout write unless count and identity hash exactly match the expected attestation;
5. still requires exact QEO-124 run/lineage and persisted adjusted readback before `shadow` status.

The rebuild does **not** read `market_ohlcv_history` to obtain OHLCV or to infer RAW basis.

TDD evidence during this hardening:

- first RED: sparse canonical RAW range was incorrectly accepted (`Missing expected rejection`);
- second RED: exchange-calendar equality incorrectly rejected a valid retained ticker identity case;
- current contract replaces exchange-calendar equality with explicit retained-session attestation.

## Provider/source-operation gate

### Yahoo / VCI / TitanLabs

Observed VHM histories are adjusted-basis. They are ineligible as QEO-124 RAW input.

**Forbidden:** inverse-adjust those histories and relabel the reconstructed values as provider RAW evidence.

### StockBiz

Bounded technical probes show separate RAW OHLC and adjusted close, including the required VHM anchors. This establishes technical RAW-basis evidence only.

Production bulk ingestion remains **HOLD** because automated bulk-use permission, terms applicability, rate-limit expectations, and operational/backfill suitability have not been approved. The public StockBiz site exposes links for `Điều khoản sử dụng`, `Bản quyền`, and contact information, but that alone is not authorization for automated bulk ingestion.

Until source-operation approval exists, StockBiz remains bounded/manual fixture/corroboration evidence only.

## Merge acceptance that is still missing

PR #356 remains blocked until all of the following are true:

- production `market_ohlcv_raw_daily` contains the retained VHM RAW range backed by append-only QEO-132 RAW evidence;
- canonical RAW session count and session-identity hash exactly match the independently recorded retained-range attestation;
- every canonical RAW row has explicit `price_basis='RAW'` and auditable provider provenance;
- the acquisition source is operationally approved for the ingestion pattern actually used;
- QEO-124 VHM factor run is materialized with exact lineage;
- QEO-129 shadow rebuild passes persisted readback and golden adjusted benchmark checks;
- legacy VHM row count, session identity, OHLCV checksum, and evidence checksum remain unchanged after rebuild;
- no Chart/Wyckoff/AI Council consumer is cut over by QEO-129.

Until then, the correct status is **BLOCKED / NOT DONE / DO NOT MERGE PR #356**.
