# QEO-17 — Production Security & Performance Advisor Baseline

As-of: 2026-09-02 ICT

This is evidence for the QEO-17 database refactor safety gate. It is not an instruction to mechanically apply every advisor suggestion.

## Security

### P0 warning — SECURITY DEFINER exposure

`public.qeo_prune_orderbook_after_universe_publish()` is `SECURITY DEFINER` and production privilege checks currently return:

| Role | EXECUTE |
|---|---|
| `anon` | **true** |
| `authenticated` | **true** |
| `service_role` | true |

This is the material security blocker. If the function is intended to be service-only, revoke execute from `public`, `anon`, and `authenticated`, retain `service_role`, and add a regression assertion.

### RLS enabled with no policy

Supabase advisor reports 20 public tables with RLS enabled and no policy. Effective privilege verification shows **all 20 currently have no anon/authenticated DML access and service_role has SELECT access**.

Verified tables:

- `eod_archive_checkpoints`
- `kfsp_manual_dispatch_runs`
- `kfsp_provider_tokens`
- `kfsp_rating_staging`
- `kfsp_rating_sync_runs`
- `kfsp_ttai_sync_runs`
- `kfsp_ttai_sync_state`
- `kfsp_universe_candidate_snapshots`
- `market_ai_conclusions`
- `market_insight_snapshot_staging`
- `market_ohlcv_archive_ranges`
- `market_ohlcv_bootstrap_state`
- `market_ohlcv_history`
- `market_universe_memberships`
- `market_universe_runs`
- `system_audit_log`
- `system_job_phases`
- `system_job_runs`
- `system_settings`
- `wyckoff_scan_runs`

Classification: **KEEP private/service-role boundary** unless a product contract explicitly requires client access. Do not add permissive policies merely to silence the INFO lint.

### Auth warning

Supabase advisor reports leaked-password protection disabled. This is an account/auth hardening task, not a schema-deletion task.

---

## Performance

### Foreign keys without covering indexes

Advisor currently reports 10 candidates:

1. `market_insight_daily.sync_run_id`
2. `market_insight_indexes.sync_run_id`
3. `market_insight_leaders.sync_run_id`
4. `market_insight_sectors.sync_run_id`
5. `portfolio_transactions.portfolio_id`
6. `system_audit_log.actor_user_id`
7. `system_job_runs.actor_user_id`
8. `system_settings.updated_by`
9. `wyckoff_analysis_snapshots.run_id`
10. `wyckoff_chart_series.run_id`

Classification: **BENCHMARK in QEO-22**. Add only when representative SELECT/delete/cascade plans show benefit.

### Unused-index candidates

Advisor currently reports:

- `watchlist_items_watchlist_owner_idx`
- `ai_council_confirmations_trigger_run_idx`
- `ai_council_agent_stats_latest_idx`
- `ai_council_llm_evidence_context_hash_idx`
- `ai_council_llm_research_contexts_prompt_identity_idx`

Classification: **NEEDS_EVIDENCE**. Never drop solely because the short-horizon usage counter is zero. QEO-22 must inspect workload/query plans and provide rollback SQL before any index removal.

---

## QEO-17 implications

- Security-definer exposure is a real P0 blocker to a clean database boundary.
- The 20 no-policy RLS lints are currently consistent with service-role-only tables based on effective grants.
- Performance advisor output feeds QEO-22; it does not authorize index creation/removal during QEO-17.
- No destructive DDL is authorized by this baseline.
