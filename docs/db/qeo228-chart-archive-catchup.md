# QEO-228 chart 1m archive catch-up

Production evidence on 2026-09-15 showed a throughput regression in the existing verified HOT/COLD lifecycle, not a checksum or prune-authority failure.

## Root cause

- Canonical raw `1m` HOT retention remains protected by the per-ticker five-newer-trading-session proof.
- One full canonical session can make roughly 198–200 ticker/session partitions eligible for archive.
- The existing EOD `RETENTION_CLEANUP` intentionally processes at most 48 global archive partitions per invocation.
- The 2026-09-14 retention run considered 48 partitions, archived/pruned all 48 successfully, and reported zero archive failures or fail-closed deferrals.
- Therefore steady-state archive capacity was below the rate at which eligible ticker/session partitions accumulated.

## Recovery contract

QEO-228 keeps the existing immutable `.ndjson.gz` object, SHA-256/readback, canonical content identity, derived-cache and correction-safe prune authority unchanged.

A dedicated post-EOD workflow now:

1. freezes the current canonical universe;
2. processes tickers in bounded batches;
3. runs the existing targeted archive lifecycle independently per ticker;
4. archives and prunes only through the existing verified fail-closed path;
5. isolates one ticker's failure from unrelated tickers;
6. records aggregate archive/prune and database-capacity metrics.

The scheduler target is `15:35 ICT` on trading weekdays. The HTTP route only authenticates and dispatches the durable workflow; archive work does not run inside the request lifetime.

This change does **not** authorize unverified deletion, does not change Daily `market_ohlcv_history`, and does not weaken the five-session retention proof. The legacy bounded EOD cleanup remains useful as an additional small archive pass; the dedicated workflow supplies the missing canonical-universe throughput.

## Production rollout gate

Before enabling production scheduling, CI/DB gates must pass and the migration must be applied through the approved Supabase release path. Production acceptance must then confirm that old HOT rows gain verified cold coverage before prune and that physical database/HOT-table size decreases without HOT/COLD/mixed read regressions.
