# QEO-22 — Index / Constraint Review Evidence

Captured against Supabase production project `glwhhrmejlonhyorvtzm` on 2026-09-02 after the QEO-25/QEO-26 safety gates.

## Default watchlist correctness

Preflight before the migration:

- `watchlists`: 1 row.
- default rows: 1.
- users with more than one default: 0.
- `watchlists_one_default_per_user` did not exist.

Production migration `20260902052650_qeo22_watchlist_default_invariant`:

1. ranks existing default rows by `(sort_order, created_at, id)` per user;
2. deterministically demotes every ranked row after the first;
3. creates `watchlists_one_default_per_user` as a partial unique index on `(user_id) WHERE is_default = true`.

Postflight:

- `watchlists`: 1 row.
- default rows: 1.
- users with more than one default: 0.
- partial unique invariant index: present.
- `watchlists` RLS remains enabled.
- authenticated SELECT/INSERT/UPDATE/DELETE ownership policies remain present.
- table grants remain unchanged for `authenticated` and `service_role`.

The API already has a race-safe loser path: when the default insert loses a unique conflict, `ensureDefaultWatchlist()` fetches the winner with a single-row fallback query. No runtime rewrite is required.

Emergency rollback for the invariant only:

```sql
drop index if exists public.watchlists_one_default_per_user;
```

This rollback intentionally reopens the concurrent-default race and is not a normal operating state.

## Measured FK/index review

Supabase Performance Advisor still reports ten foreign keys without a dedicated covering index. Current production cardinality and relation size are small:

| FK child | Live rows | Total size | Delete action | Decision |
| --- | ---: | ---: | --- | --- |
| `market_insight_daily.sync_run_id` | 5 | 264 kB | SET NULL | defer |
| `market_insight_indexes.sync_run_id` | 20 | 48 kB | SET NULL | defer |
| `market_insight_leaders.sync_run_id` | 50 | 104 kB | SET NULL | defer |
| `market_insight_sectors.sync_run_id` | 149 | 344 kB | SET NULL | defer |
| `portfolio_transactions.portfolio_id` | 1 | 48 kB | CASCADE | defer |
| `system_audit_log.actor_user_id` | 0 | 24 kB | SET NULL | defer |
| `system_job_runs.actor_user_id` | 43 | 112 kB | SET NULL | defer |
| `system_settings.updated_by` | 0 | 16 kB | SET NULL | defer |
| `wyckoff_analysis_snapshots.run_id` | 0 | 32 kB | CASCADE | defer |
| `wyckoff_chart_series.run_id` | 0 | 16 kB | CASCADE | defer |

Representative read-only `EXPLAIN (FORMAT JSON)` results on current production data:

| Path | Planner result | Total cost | Decision |
| --- | --- | ---: | --- |
| latest-run `market_insight_sectors.sync_run_id` lookup | Seq Scan | 40.66 | no new index |
| latest-run `market_insight_daily.sync_run_id` lookup | Seq Scan | 16.05 | no new index |
| latest-run `market_insight_leaders.sync_run_id` lookup | Seq Scan | 9.42 | no new index |
| latest-run `market_insight_indexes.sync_run_id` lookup | Seq Scan | 6.05 | no new index |
| `portfolio_transactions.portfolio_id` lookup | Index Only Scan using existing `portfolio_transactions_user_idx` | 4.69 | no dedicated index |
| default watchlist lookup after invariant restore | Seq Scan | 2.02 | index exists for correctness, not current read speed |

At current scale there is no measured evidence that adding the four market-insight FK indexes improves the representative plans. The portfolio path is already satisfied by the planner using the existing composite index. Therefore QEO-22 intentionally adds no speculative FK index.

## Unused-index review

Advisor `unused_index` counters remain informational only. No index is dropped in QEO-22 because a short observation window with `idx_scan = 0` is not evidence of zero meaningful consumers. Any future drop requires a representative monitoring cycle, query-plan comparison, and explicit rollback SQL.

## Security/advisor postflight

Security Advisor shows no new watchlist warning after the DDL. Existing informational notices for private service-role tables and the existing hosted-Auth leaked-password-protection warning are unrelated to QEO-22 and remain unchanged.
