# QEO-132 Raw Daily Basis — Approved Design

Date: 2026-09-07
Status: Approved in chat
Parent: QEO-121
Blocks: QEO-129 VHM production shadow acceptance

## Problem

QEO-106 intentionally normalized legacy Daily history onto an adjusted-close basis inside `market_ohlcv_history`. QEO-121 later approved the final architecture:

`provider/raw Daily OHLCV + canonical corporate actions -> QeoIndex adjustment engine -> canonical adjusted Daily`.

Production VHM proves that `market_ohlcv_history` is not a safe raw-factor input: nearly all retained VHM rows are adjusted-basis. Feeding them into QEO-124 would double-adjust history.

QEO-132 must restore a distinct, auditable raw Daily input boundary without changing the legacy chart basis before the later canonical adjusted cutover.

## Verified provider evidence

- DNSE: unavailable in GitHub Actions because credentials are not configured there; this is not a data-quality rejection.
- SSI iBoard: prior production-like cloud probe returned HTTP 403 `Security Check - SSI`.
- VCI native `ONE_DAY`: technically available but VHM is corporate-action adjusted (`2026-06-26 close=78.003`, `2026-08-05 close=76.5`).
- TitanLabs: technically available but VHM is corporate-action adjusted (`78.0`, `76.5`; golden week H/L `63.32/55.18`).
- StockBiz bounded historical pages expose raw OHLC and adjusted close independently. Cloud probe reproduced the QEO-124 raw regression carrier exactly:
  - `2025-10-13..17` raw H/L `131.5 / 114.6`
  - `2026-06-26` raw close `162.0`, adjusted close `78.0`
  - `2026-08-05` raw close `153.0`, adjusted close `76.5`

StockBiz is therefore a technical raw-basis evidence source for bounded validation, but broad automated production ingestion remains HOLD until terms/rate-limit/bulk suitability are explicitly established.

## Non-goals

QEO-132 does not:

- mutate `market_ohlcv_history` from adjusted to raw;
- change Chart/Wyckoff/AI Council consumer basis;
- activate QEO-124 factor runs;
- create QEO-129 adjusted shadow rows;
- wire StockBiz into EOD v4 or automatic canonical-200 refresh;
- infer raw basis from provider name, price unit, or a numerically plausible value;
- inverse-adjust VCI/Yahoo/TitanLabs data and relabel the result as provider raw evidence.

## Architecture

### 1. Append-only raw evidence

Create `market_ohlcv_raw_daily_evidence` as service-owned evidence storage.

Each row records one observed provider Daily bar and its provenance:

- `id uuid`
- `ticker`
- `session_date`
- raw `open/high/low/close/volume` in canonical QeoIndex Daily units (prices in VND thousands, volume in shares)
- `price_basis='RAW'`
- `provider`
- `provider_detail`
- `source_url`
- `source_price_unit`
- `normalization_version`
- `raw_evidence_hash` (64-char lowercase SHA-256)
- `fetched_at`
- `created_at`

Evidence identity must preserve corrections and repeated observations. The same exact source observation is idempotent; a changed observation creates a new evidence identity rather than rewriting the old row.

No authenticated/public role may directly insert, update, or delete evidence.

### 2. Canonical raw Daily selection

Create `market_ohlcv_raw_daily` with exactly one selected raw row per `(ticker, session_date)`.

Fields include:

- ticker/session date
- canonical raw OHLCV copied from the selected evidence
- `evidence_id` FK to append-only evidence
- provider/provenance mirror needed for cheap readback
- `raw_evidence_hash`
- `selected_at`, `updated_at`

Canonical selection never destroys prior evidence. A correction changes which evidence row is selected.

Selection is explicit and service-only in QEO-132. There is no hidden provider-name precedence. Automatic multi-provider authority ranking is deliberately deferred until a raw provider contract is operationally approved.

### 3. Atomic service persistence

Provide one service-role-only RPC that:

1. validates the complete input bar and provenance;
2. requires explicit `price_basis='RAW'`;
3. validates canonical price unit and normalization metadata;
4. inserts the evidence idempotently by exact evidence identity;
5. optionally selects that exact evidence row as canonical raw for the session;
6. returns evidence/canonical identifiers for exact readback.

The RPC must fail atomically. Invalid OHLC, invalid volume, invalid hash, missing provenance, or any non-RAW basis cannot partially persist.

Existing evidence rows are immutable. Canonical selection may be updated only by the service-owned RPC.

### 4. StockBiz bounded parser/pilot adapter

Implement a server-only StockBiz parser/fetcher as a bounded validation adapter, not an EOD provider.

Requirements:

- parse the historical table by semantic column meaning;
- extract raw Open/High/Low/Close separately from `Đóng cửa ĐC`;
- never substitute adjusted close into raw OHLC;
- canonicalize `dd/mm/yyyy` session dates deterministically;
- preserve adjusted close only as parser/audit evidence when useful, not in canonical raw OHLC;
- strict OHLC/volume validation;
- bounded request count/range, request timeout, explicit User-Agent;
- malformed/ambiguous table fails closed;
- no automatic universe refresh or frontend dependency.

### 5. Raw read boundary

Expose a dedicated server-side loader for canonical raw Daily bars. It must read only `market_ohlcv_raw_daily` and return provenance indicating explicit RAW basis.

QEO-129 will later rebase onto QEO-132 and consume this loader. QEO-129 must no longer treat legacy `market_ohlcv_history` as raw input.

## Data invariants

1. `market_ohlcv_history` is untouched by QEO-132.
2. Raw evidence is append-only and service-only.
3. Canonical raw has one row per ticker/session and references exact evidence.
4. Every canonical raw row is backed by evidence explicitly marked RAW.
5. Provider name alone cannot establish raw basis.
6. Raw OHLC must satisfy `high >= max(open, close, low)` and `low <= min(open, close, high)`; all prices > 0; volume >= 0.
7. Source observation hash/provenance is deterministic and auditable.
8. No adjusted-close field can silently enter canonical raw OHLC.
9. Production pilot cannot mutate the legacy adjusted history or chart consumers.

## Migration ordering

Use `20260906169000_qeo132_raw_daily_basis.sql`.

This follows QEO-124 `20260906165000` and leaves QEO-129 `20260906170000` later in dependency order. No repository migration currently owns `20260906169000`.

## VHM acceptance fixture

The bounded VHM pilot must reproduce provider raw evidence without inverse reconstruction:

| Session | Raw requirement |
| --- | ---: |
| 2025-10-14 high | 131.5 |
| 2025-10-17 low | 114.6 |
| 2026-06-26 close | 162.0 |
| 2026-08-05 close | 153.0 |

The five sessions 2025-10-13..17 must have raw weekly H/L exactly `131.5 / 114.6`.

After QEO-129 is rebased and QEO-124 factors are applied, the downstream adjusted benchmark should reproduce approximately `63.31 / 55.18` without weekly special cases. That downstream shadow check belongs to QEO-129; QEO-132 only guarantees the raw boundary.

## Rollout

1. Implement and verify storage contracts locally/preprod.
2. Verify StockBiz parser against frozen VHM fixtures and bounded live probe.
3. Promote schema only after zero-to-latest replay, generated types, DB contracts, and exact persistence/readback pass.
4. Production raw data ingestion remains bounded/manual until source terms and operational suitability are explicitly accepted.
5. Canonical-200 scale-out later uses bounded backfill plus EOD delta; never full-history refetch on every EOD.

## Evidence that would change this design

- A higher-authority provider with explicit documented raw Daily semantics and adequate retention may replace StockBiz as the acquisition source without changing the raw evidence/canonical storage boundary.
- If a provider only exposes adjusted history, it remains ineligible for QEO-124 raw-factor input regardless of brand or numerical overlap.
- If StockBiz terms do not permit the intended automated use, StockBiz stays fixture/corroboration-only; storage architecture remains valid and waits for another approved raw source.
