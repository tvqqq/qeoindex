# QEO-129 engineering readiness gate — 2026-09-07

## Scope

This note records source/CI readiness only. It is **not** production VHM RAW-range acceptance and does not authorize PR #356 merge.

## Canonical boundary hardening completed

- QEO-129 rebuild consumes only QEO-132 `market_ohlcv_raw_daily` canonical RAW rows.
- Sparse RAW ranges fail closed using `expectedRawSessionCount` plus ordered RAW session-identity SHA256 before any adjusted/shadow write.
- `loadAdjustedDailyRange()` derives expected per-ticker session identities from QEO-132 canonical RAW rather than assuming one bar for every exchange-open session.
- Legacy `market_ohlcv_history` is immutable adjusted/provider compatibility history only; it is never QEO-129 RAW input.
- Yahoo / VCI / TitanLabs adjusted histories are not eligible RAW input and must not be inverse-adjusted then relabeled as provider RAW.
- StockBiz remains bounded/manual evidence only while QEO-133 source-operation approval is unresolved.

## Generated Database type reconciliation

The DB Drift verifier generates types with:

```bash
supabase gen types typescript --local --schema public
```

A first one-shot sync omitted `--schema public` and incorrectly included `graphql_public`. That output was rejected by DB Drift.

The corrected one-shot run then:

1. replayed migrations from zero;
2. generated with exact `--schema public` parity;
3. ran `pnpm db:types:verify` successfully before commit;
4. committed the exact verifier-compatible public Database types.

Temporary one-shot workflows were removed from the branch after use.

## Production mutation guard re-read

A fresh read-only production check after source hardening still reports:

| Store | VHM rows | Range |
| --- | ---: | --- |
| `market_ohlcv_raw_daily_evidence` | **0** | none |
| `market_ohlcv_raw_daily` | **0** | none |
| `market_ohlcv_adjusted_daily` | **0** | none |
| legacy `market_ohlcv_history` / `1D` | **1,998** | `2018-08-27 -> 2026-09-04` |

Pinned legacy mutation guards remain unchanged:

- ordered session identity SHA256: `13dd4a37df57229bf033a22c6f616a4e136bf99200714cfca9c4dbb96cdb3dbe`
- ordered `session|OHLCV` SHA256: `341b9b453a337c01d8e0ef9044038665d74476df866eb370a2a0f34fbe9b9292`
- ordered `session|OHLCV|provider|provider_detail` SHA256: `6545a25ce22d8fb6d4616e25732434f5ada2f6c42640eb60db0f5bc755559c41`

These legacy hashes are mutation guards only and do not classify legacy OHLCV as RAW.

## Exact-head source acceptance required

Before source engineering can be considered GREEN, the human-authored head containing this note must independently pass:

- Verify;
- DB Drift Reconciliation, including zero-to-latest replay and `Verify generated Database types`;
- QEO-123/QEO-129 Preprod Rehearsal, including QEO-129 exact persistence/readback and DB lint;
- EOD v4.

Even after all four are GREEN, PR #356 remains draft/unmerged until QEO-133 resolves an approved RAW acquisition source, production receives the retained VHM QEO-132 canonical RAW range, QEO-124 VHM factors are materialized, and QEO-129 VHM shadow/golden/mutation acceptance passes.
