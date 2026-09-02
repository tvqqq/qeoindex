# QEO-21 — Safe Retention Policy

Date: 2026-09-02
Production project: `glwhhrmejlonhyorvtzm`

## Decision

Safe telemetry/staging retention is an independent lifecycle from raw market-history retention.

`public.qeo_run_safe_retention_cleanup(p_reference_at)` may prune only bounded terminal telemetry or orphan staging. It must never age-prune `market_ohlcv_history` until Plan C cold-history archive coverage, checksum, hydration, and restore have been proven end-to-end.

The function is `SECURITY DEFINER`, transaction-scoped, protected by an advisory lock, and executable only by `service_role` (plus the function owner `postgres`). Any SQL exception rolls back the whole cleanup call.

## Retention matrix

| Table | TTL | Eligible rows | Canonical-data guard |
|---|---:|---|---|
| `kfsp_rating_staging` | 7d | staging owned by `completed` / `failed` runs | running runs preserved |
| `market_insight_snapshot_staging` | 7d | staging owned by `completed` / `failed` / `skipped` runs | running runs preserved |
| `ai_council_llm_evidence` | 10d | `captured_at` older than cutoff | preserve ticker/run while debate is `pending` |
| `ai_council_llm_research_contexts` | 10d | `captured_at` older than cutoff | preserve ticker/run while debate is `pending` |
| `ai_council_llm_debates` | 10d | `completed` / `partial` / `failed` | `pending` preserved |
| `wyckoff_scan_runs` | 30d | terminal `published` / `partial` / `failed` orphan runs | delete only when no snapshots and no chart series exist |
| `ai_council_runs` | 45d | orphan deterministic runs | delete only when no outcomes, confirmations, votes, LLM debates/evidence/research exist |
| `kfsp_rating_sync_runs` | 30d | terminal orphan runs | preserve while staging or bounded raw evidence references the run id |
| `kfsp_ttai_sync_runs` | 30d | `completed` / `failed` | TTAI quarterly history is independent canonical history and is not deleted |
| `market_insight_sync_runs` | 30d | terminal runs with no staging | canonical snapshot FKs use `SET NULL`; canonical snapshots remain |
| `system_job_runs` | 30d | `succeeded` / `failed` / `skipped` | queued/running preserved; phases cascade only with eligible terminal parent |
| `system_job_phases` | 30d | cascade with eligible `system_job_runs` | never independently prune a live parent lifecycle |
| `kfsp_rating_raw_evidence` | publisher-owned | monitor `expires_at < referenceAt` only | QEO-27 publisher remains the single deletion owner |
| `market_ohlcv_history` | disabled | none | no DELETE/TRUNCATE in QEO-21 |

## Explicit exclusions

QEO-21 does not delete:

- `market_ohlcv_history`;
- `eod_archive_checkpoints`;
- sync-state tables;
- `ai_council_market_benchmarks`;
- AI Council outcomes/calibration evidence;
- `kfsp_ttai_quarterly_history`;
- `system_audit_log` (requires a separate explicit audit-retention policy).

`ai_council_agent_stats` is calibration state, not TTL telemetry. The historical clean-rebuild migration is immutable; any future clean-rebuild reset policy for agent stats must be introduced through a new migration/contract rather than editing applied history.

## Schema correctness fixed by QEO-21

Legacy retention code used `created_at` for `ai_council_llm_evidence` and `ai_council_llm_research_contexts`. Production schema uses `captured_at`; the safe RPC uses the schema-correct column for both tables.

## Production rollout evidence

Production ledger mapping:

- repository replay version: `20260902130000_qeo21_safe_retention_cleanup.sql`
- production ledger version: `20260902061549 qeo21_safe_retention_cleanup`

The RPC was invoked twice immediately after migration. Both calls returned `status=succeeded`, every `deletedRows` value was `0`, expired KFSP raw evidence was `0`, and the second call completed in about 14 ms. This demonstrates an idempotent no-op on the current dataset.

Permissions after rollout:

- `postgres`: EXECUTE
- `service_role`: EXECUTE
- `anon`: none
- `authenticated`: none

## Atomic before/after baseline

A single SQL statement materialized the baseline, invoked the cleanup, and then measured the same tables again. Cleanup duration was 15 ms and no row/size changed.

| Table | Before rows | After rows | Bytes before | Bytes after |
|---|---:|---:|---:|---:|
| `market_ohlcv_history` | 357,834 | 357,834 | 143,532,032 | 143,532,032 |
| `kfsp_rating_raw_evidence` | 600 | 600 | 1,867,776 | 1,867,776 |
| `market_insight_snapshot_staging` | 770 | 770 | 1,171,456 | 1,171,456 |
| `kfsp_rating_staging` | 0 | 0 | 589,824 | 589,824 |
| `system_job_phases` | 138 | 138 | 155,648 | 155,648 |
| `market_insight_sync_runs` | 47 | 47 | 114,688 | 114,688 |
| `system_job_runs` | 50 | 50 | 114,688 | 114,688 |
| `kfsp_rating_sync_runs` | 4 | 4 | 81,920 | 81,920 |
| `kfsp_ttai_sync_runs` | 6 | 6 | 49,152 | 49,152 |
| `ai_council_runs` | 0 | 0 | 40,960 | 40,960 |
| `ai_council_llm_evidence` | 0 | 0 | 32,768 | 32,768 |
| `ai_council_llm_research_contexts` | 0 | 0 | 32,768 | 32,768 |
| `ai_council_llm_debates` | 0 | 0 | 32,768 | 32,768 |
| `wyckoff_scan_runs` | 0 | 0 | 24,576 | 24,576 |

At the same checkpoint, `system_job_runs` still contained one `running` row, proving the current cleanup did not collapse the active lifecycle.

## Runtime behavior

`lib/qeoindex-eod-archive.ts::runEodRetentionCleanup()` calls the safe retention RPC even when Notion/Drive archive checkpoints are incomplete. Those archive checkpoints are relevant to future raw-history deletion, not to bounded telemetry cleanup.

A successful safe cleanup returns the EOD retention phase as completed while explicitly carrying `rawHistoryRetention.status = blocked`. Thus an intentionally disabled raw-history policy no longer makes the EOD job partial by itself.

## Verification contract

QEO-21 regression tests enforce:

- safe cleanup runs independently from raw retention;
- no active code/migration deletes or truncates `market_ohlcv_history`;
- AI Council evidence/research use `captured_at`;
- `pending` LLM work is preserved;
- Wyckoff/AI parent deletion is orphan-only when FK cascades could remove canonical evidence;
- staging cleanup is terminal-run scoped;
- per-table metrics contain cutoff, deleted rows, oldest retained row, and duration;
- `kfsp_rating_raw_evidence` is monitored, not double-deleted.
