# QeoIndex engineering handover

Last updated: 2026-09-04.

This document is the canonical fast-start for the active production architecture. Historical architecture is preserved in Git history and explicitly historical design/plan documents; when historical material conflicts with this file, this file wins.

Read `AGENTS.md` first and `docs/README.md` for the complete documentation map. Linear owns current work status; this file owns durable architecture and operations, not mutable task/branch state.

## Production

- Product: QeoIndex.
- Production domain: `https://qeoindex.qeoqeo.com`.
- Vercel project: `tvqqq/stockos`.
- Supabase project: `qeoindex` (`glwhhrmejlonhyorvtzm`, Singapore).
- Canonical stock universe: latest published `vn_top_stocks`, maximum 200 tickers.
- Canonical EOD scheduler: Supabase `pg_cron` job `qeoindex-eod-pipeline-1515-ict` (`15 8 * * 1-5`, 15:15 ICT).

Scheduler dispatch is not execution success; use `system_job_runs` and `system_job_phases` for durable EOD evidence.

## Active Wyckoff contract — 1D + 1W only

Wyckoff operational analysis supports exactly two completed-bar timeframes:

- `1D`: canonical raw timeframe.
- `1W`: deterministic weekly aggregation derived from raw Daily bars.

`1H`, `4H`, and `1M` are not active Wyckoff persistence contracts. They must not be written to active Wyckoff snapshots, chart-series read models, UI tabs, watchlist columns, or EOD expected-count calculations.

For `N` canonical stocks:

```text
expected Wyckoff snapshots = N × 2
```

At the current maximum universe of 200 tickers this is 400 snapshots per healthy EOD run.

### Raw OHLCV storage

Persistent Wyckoff raw OHLCV stores `1D` only in `market_ohlcv_history`. Weekly bars are derived from Daily.

A ticker with genuine listing history shorter than the normal bootstrap horizon must transition to bounded Daily delta refresh after a successful full bootstrap rather than repeating a full-history request every EOD. `market_ohlcv_bootstrap_state` records that bootstrap completion state.

The DNSE Daily bootstrap keeps the 366-day fast request window for normal tickers. Retry splitting is limited to transient network/timeout/408/425/429/5xx failures and does not recursively retry auth/permission or explicit non-transient 4xx failures.

See `docs/wyckoff-chart-unified-data.md` for the domain-specific storage/read contract.

## EOD v4 DAG contract

Current-session dependency flow:

1. `KFSP_RATING_REFRESH` refreshes rating data and freezes the exact canonical universe identity.
2. `TTAI_REFRESH` and `MARKET_CLOSE_COLLECT` run as bounded sibling branches.
3. `EOD_READY` verifies exact frozen membership and same-session rating/final-market evidence.
4. `HISTORY_REFRESH` persists Daily-only history in bounded batches/concurrency.
5. Verified no-trade Daily repair runs when required.
6. `WYCKOFF_BUILD` produces exactly `universeCount × 2` 1D/1W snapshots; current-session failures are ticker-isolated where the v4 fault-isolation contract permits it.
7. `SUPABASE_VALIDATE` and `SUPABASE_PUBLISH` verify/publish the canonical operational read model.
8. `AI_COUNCIL_DETERMINISTIC` consumes the healthy published session.
9. `MARKET_SYNTHESIS` runs downstream of deterministic Council.
10. `AI_COUNCIL_LLM` runs selectively/cost-bounded; deterministic Council remains authority.
11. `RETENTION_CLEANUP` runs Supabase-only safe retention and never age-prunes canonical raw Daily history.
12. Notion receives one downstream analytical/audit summary; it is not operational state.
13. `COMPLETE` closes the parent run with `architecture = supabase-first-eod-v4-dag`.

Run key format:

`WYCKOFF-YYYY-MM-DD-EOD-v4`

Historical backfills remain Supabase-only. They verify persistent historical rating/OHLCV evidence and never substitute today's provider market data for a past session.

### EOD invariants

- READY and market-close retry behavior remain fail-closed.
- Exact universe identity/membership matters; count-only equality is insufficient.
- `HISTORY_REFRESH` accounts for every requested ticker and persists Daily only.
- Wyckoff expected count is exactly `universeCount × 2`.
- Operational publication is Supabase-first.
- Google Drive is not part of the active EOD graph.
- Per-ticker Notion operational archive is not part of the active EOD graph.
- Notion analytical summary is downstream and cannot rewrite already-published operational evidence.

See `docs/automation/CRON_WORKFLOW_TOP_STOCKS_200.md` for the canonical EOD runbook.

## Storage lifecycle

Supabase is the operational hot store. Notion is a compact analytical/audit sink only.

Raw Daily retention is intentionally fail-closed while Weekly analysis is derived from Daily and no independently verified cold-history hydration/restore path is part of the active architecture.

The active retention implementation only calls approved Supabase cleanup RPCs for transient/terminal evidence such as telemetry, staging, expired raw evidence and build artifacts. It must not delete `market_ohlcv_history` Daily bars merely by age.

Legacy archive-ledger concepts such as `eod_archive_checkpoints`, `market_ohlcv_archive_ranges`, Drive manifests/SHA coverage and per-ticker Notion archive status are not active retention authority. Under QEO-65 they may be physically dropped only after zero-consumer repository + production dependency proof and a no-`CASCADE` migration.

## Database migration safety

Database changes must preserve these gates:

- migration drift reconciliation;
- clean local replay;
- generated Supabase type parity;
- destructive recovery rehearsal where applicable;
- no unexplained production/repository ledger divergence;
- no `CASCADE` for QEO-65 legacy-object deletion.

Important existing migration contracts include:

- `20260901190000_wyckoff_daily_weekly_storage_cutover.sql`: active raw `1D`, active Wyckoff `1D/1W`, bootstrap state and storage constraints.
- `20260901193000_clean_rebuild_top_stocks_200.sql`: approved one-shot rebuild of rebuildable operational state; its production ledger timestamp is reconciled through `supabase/migration-equivalence.json`.
- `20260902011529_clean_rebuild_market_snapshot_trigger.sql`: service-role-only bootstrap of fresh canonical market snapshots after destructive rebuild.

Do not replay SQL merely to make timestamps look identical. `pnpm db:drift:verify` is the reviewed reconciliation gate.

## Clean-rebuild acceptance sequence

After an explicitly approved one-shot rebuild:

1. trigger and verify a new published canonical universe;
2. verify exact membership;
3. bootstrap fresh canonical market snapshots;
4. verify exact same-session snapshot coverage;
5. dispatch EOD only after READY prerequisites exist;
6. verify Daily-only persistent history;
7. verify `universeCount × 2` Wyckoff snapshots;
8. verify downstream phases report their real status.

Do not bypass or weaken `EOD_READY` to make a rebuild appear healthy.

## Manual EOD acceptance

A current-session manual smoke is accepted only when evidence shows:

- `EOD_READY`: exact canonical universe complete for the session;
- `MARKET_CLOSE_COLLECT`: healthy same-session evidence;
- `HISTORY_REFRESH`: complete accounting for every requested ticker;
- persistent raw OHLCV contains `1D` only after a clean rebuild;
- Wyckoff expected count = `universeCount × 2`;
- `SUPABASE_PUBLISH`: same validation hash and exact ticker set;
- deterministic AI Council completes for the healthy canonical universe;
- market synthesis / LLM / retention / analytical summary report their real states;
- `COMPLETE` closes the parent run without hidden skipped critical phases and records `supabase-first-eod-v4-dag`.

For fast troubleshooting, inspect `system_job_runs`, `system_job_phases`, latest `market_universe_runs`, `stock_orderbook_snapshots`, `wyckoff_scan_runs`, `market_ohlcv_history`, and `market_ohlcv_bootstrap_state` before interpreting UI state.

## Required release gates

For normal source/docs changes:

- `pnpm test:manifest`
- `pnpm test:current`
- `pnpm lint:touched`
- `pnpm typecheck`
- `pnpm build`

`pnpm verify:pr` runs the PR-level secret scan, manifest/current tests, touched lint and typecheck as one command.

For DB-changing releases, additionally run:

- `pnpm db:drift:verify`
- `pnpm db:replay:verify`
- `pnpm db:types:verify`
- DB safety tests/rehearsal required by the touched migration class.

Production acceptance requires the verified GitHub head to be green, the Vercel production deployment to reach READY, and runtime smoke evidence from the deployed architecture.

## Documentation lifecycle

- `docs/HANDOVER.md` is the sole repo-wide architecture handover.
- `docs/README.md` is the navigation/lifecycle index.
- Domain docs may own detailed contracts, but must link back to the canonical architecture rather than duplicate mutable task status.
- Linear owns current task/priority/blocker state. Git history and explicit historical specs/plans preserve old implementation context.
- Do not create `NEXT_AGENT_HANDOFF.md`, `HANDOVER-LEGACY.md`, or similar competing repo-wide status snapshots.
- When architecture changes, update the affected Active docs in the same PR; do not rewrite historical plans to make them look current.
