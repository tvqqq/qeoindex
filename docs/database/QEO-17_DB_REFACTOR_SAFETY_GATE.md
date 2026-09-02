# QEO-17 — Database Refactor Safety Gate

As-of: 2026-09-02 ICT
Parent: QEO-8
Scope: audit / consumer mapping / deletion manifest only. **No destructive DDL is authorized by this document.**

## 1. Operating rule

A table, column, index, function, or compatibility field may only move to `DROP` after all of the following are true:

1. A canonical replacement is identified.
2. Repository consumers have been migrated or proven absent.
3. Production SQL object dependencies have been migrated or proven absent.
4. Data parity/backfill assertions pass where applicable.
5. Functional smoke tests pass on the canonical path.
6. A recovery/rollback procedure exists and has been rehearsed for destructive changes.
7. Generated DB types, tests, grants/RLS, views, RPC signatures, and migrations are aligned.

`empty table`, `0 estimated rows`, or `unused index counter = 0` is not sufficient evidence for deletion.

---

## 2. Production ↔ repository migration drift

Production migration history and the current repository contain a systematic version-prefix mismatch for several recent logical migrations. The logical migration names match, but the timestamps differ.

| Logical migration | Production version | Repository file | Classification |
|---|---:|---|---|
| `market_universe_top_stocks` | `20260901011922` | `20260901090000_market_universe_top_stocks.sql` | Same logical migration, version drift |
| `market_universe_monthly_cron` | `20260901012315` | `20260901091000_market_universe_monthly_cron.sql` | Same logical migration, version drift |
| `top100_legacy_clean_slate` | `20260901024528` | `20260901100000_top100_legacy_clean_slate.sql` | Same logical migration, version drift |
| `market_universe_daily_activity_gate` | `20260901054004` | `20260901123000_market_universe_daily_activity_gate.sql` | Same logical migration, version drift |
| `eod_archive_checkpoints` | `20260901064844` | `20260901130000_eod_archive_checkpoints.sql` | Same logical migration, version drift |
| `fix_orderbook_trading_session_windows` | `20260901082239` | `20260901152000_fix_orderbook_trading_session_windows.sql` | Same logical migration, version drift |
| `prune_noncanonical_orderbook_snapshots` | `20260901093012` | `20260901162500_prune_noncanonical_orderbook_snapshots.sql` | Same logical migration, version drift |
| `wyckoff_daily_weekly_storage_cutover` | `20260901134640` | `20260901190000_wyckoff_daily_weekly_storage_cutover.sql` | Same logical migration, version drift |
| `clean_rebuild_top_stocks_200` | `20260901144121` | `20260901213000_clean_rebuild_top_stocks_200.sql` | Same logical migration, version drift |
| `kfsp_canonical_rating_candidate_split` | `20260901151138` | `20260901221500_kfsp_canonical_rating_candidate_split.sql` | Same logical migration, version drift |
| `kfsp_manual_dispatch_rpc` | `20260901153403` | `20260901224000_kfsp_manual_dispatch_rpc.sql` | Same logical migration, version drift |
| `fix_kfsp_manual_dispatch_rpc_ambiguity` | `20260901153527` | `20260901224500_fix_kfsp_manual_dispatch_rpc_ambiguity.sql` | Same logical migration, version drift |
| `kfsp_manual_recovery_lifecycle` | `20260901231054` | `20260902060000_kfsp_manual_recovery_lifecycle.sql` | Same logical migration, version drift |
| `clean_rebuild_market_snapshot_trigger` | **not recorded** | `20260901214500_clean_rebuild_market_snapshot_trigger.sql` | **Repo ahead of production** |

Production verification for `clean_rebuild_market_snapshot_trigger`:

- no migration ledger entry;
- `public.qeo_trigger_market_snapshot_bootstrap()` does not currently exist.

### Drift handling rule

Do **not** rename already-shipped historical migration files simply to match the production timestamp. That can cause a future replay/apply process to treat equivalent history as new migrations. Instead:

- preserve current repository history;
- record the equivalence mapping above;
- reconcile the repo-ahead migration explicitly;
- add schema/migration drift CI in QEO-23 so future divergence fails closed.

---

## 3. Current production baseline for destructive candidates

The following is a transient operational snapshot, not an invariant.

| Object | Current production state | Interpretation |
|---|---:|---|
| `market_universe_memberships` | 200 memberships | Canonical Top-200 source populated |
| `wyckoff_universe_memberships` | 0 memberships, ~24 kB | Empty now, but still has active code consumers |
| `kfsp_provider_tokens` | 1 row, ~32 kB | Runtime token cache still active |
| `insights_stock_ratings` | 200 rows, ~8.5 MB | Active published rating store |
| `portfolio_transactions` | 1 row, ~48 kB | Too little data to infer semantic redundancy from parity alone |
| `market_ai_conclusions` | 0 rows, ~32 kB | Empty now, but SQL lifecycle functions still reference legacy lease field |
| `market_ohlcv_archive_ranges` | 0 rows, ~24 kB | KEEP: archive foundation |
| `market_insight_snapshot_staging` | ~724 estimated rows, ~1.0 MB | KEEP: active staging lifecycle |
| `kfsp_rating_staging` | 0 estimated rows, ~576 kB | KEEP: staging lifecycle |
| `ai_council_confirmations` | 0 rows, ~32 kB | KEEP: pending workflow table |
| `ai_council_agent_stats` | ~25 rows, ~48 kB | KEEP: calibration aggregate |

---

## 4. Deletion manifest

### 4.1 Tables

#### `wyckoff_universe_memberships`

**Status: `DEPRECATE` — NOT SAFE TO DROP YET**

Canonical replacement: `market_universe_memberships`.

Current production data state:

- canonical memberships: 200;
- legacy memberships: 0.

No row migration is required for the current snapshot, but repository consumers remain active:

- `lib/wyckoff-unified-data.ts` — reads legacy membership dates;
- `lib/wyckoff-unified-runner.ts` — upserts legacy memberships;
- `lib/wyckoff-supabase-publish.ts` — upserts legacy memberships;
- `lib/wyckoff-notion-ingest.ts` — upserts legacy memberships;
- schema/runtime regression tests and documentation still encode the legacy contract.

Required before DROP:

1. migrate every reader/writer to `market_universe_memberships`;
2. remove legacy publication writes;
3. update tests/docs/types;
4. parity test the canonical Top-200 contract;
5. run full Wyckoff/EOD smoke on canonical membership source;
6. observe zero runtime consumer evidence before drop migration.

#### `kfsp_provider_tokens`

**Status: `DEPRECATE` — NOT SAFE TO DROP YET**

Intended replacement: Vault/secret-based token storage.

Active runtime consumers:

- `supabase/functions/kfsp-rating-sync/index.ts` — reads cached token and writes refreshed token;
- `supabase/functions/kfsp-ttai-history-sync/index.ts` — reads/writes cached token;
- `supabase/functions/market-insight-eod-sync/index.ts` — reads/writes cached token.

Production Vault currently contains the KFSP-related secret `kfsp_sync_secret`, but this is the dispatch/authentication secret. There is no verified Vault replacement for the provider access-token cache yet.

Required before DROP:

1. design the provider-token Vault/cache replacement;
2. cut over all three Edge Functions;
3. verify refresh, expiry, retry, and concurrent refresh behavior;
4. ensure access tokens never appear in logs/test artifacts;
5. smoke KFSP Rating + TTAI + Market Insight EOD;
6. prove zero reads/writes to `kfsp_provider_tokens`.

---

### 4.2 `insights_stock_ratings` legacy aliases

Current production parity on 200 rows:

| Legacy | Canonical | Mismatches |
|---|---|---:|
| `score_4m` | `kfsp_score_4m` | 0 |
| `canslim_score` | `kfsp_canslim_score` | 0 |
| `stock_rs_score` | `kfsp_stock_rs_score` | 0 |
| `sector_rs_score` | `kfsp_sector_rs_score` | 0 |
| `composite_score` | `kfsp_composite_score` | 0 |

Runtime application readers are already largely on the `kfsp_*` fields, but production function `publish_kfsp_rating_snapshot()` still references the four score aliases, and historical grant/index/migration contracts still contain legacy names.

- Four score aliases: **`DEPRECATE`**.
- `composite_score`: **`NEEDS_EVIDENCE` / deprecate candidate**. Current parity is encouraging, but index/grant semantics and naming history must be audited first.

Required before DROP:

1. rewrite `publish_kfsp_rating_snapshot()` to canonical fields only;
2. migrate any grants/indexes/views/queries that depend on legacy fields;
3. stop legacy writes;
4. rerun parity on the production snapshot immediately before destructive migration;
5. regenerate DB types and run KFSP/Insights/AI Council smoke.

---

### 4.3 `portfolio_transactions`

#### `target_price` / `stop_loss`

**Status: `DEPRECATE`**

Canonical replacements:

- `target_price_1/2/3`;
- `stop_loss_1/2/3`.

Current production has only one row and it is parity-compatible, but the API/runtime still exposes compatibility fields:

- `app/api/portfolio/[id]/transactions/route.ts` selects both old/new fields and returns compatibility aliases;
- `lib/portfolio/pnl.ts` types still include both generations.

Required before DROP:

1. define API compatibility policy;
2. remove DB reads/writes to legacy fields while preserving response compatibility in application code if needed;
3. backfill legacy-only rows if any appear before migration;
4. smoke create/edit/history/PnL.

#### `tags`

**Status: `NEEDS_EVIDENCE`**

The current UI writer deliberately stores:

`tags = setup_tags + mistake_tags`

and the current single production row matches that union. This is insufficient proof that `tags` never carries generic labels or older semantics.

Do not drop until historical usage and API/import/export semantics prove a lossless mapping.

---

### 4.4 `market_ai_conclusions.lease_until`

**Status: `DEPRECATE` — NOT SAFE TO DROP YET**

Canonical replacement: `lease_expires_at`.

Production SQL object dependencies still exist:

- `claim_market_ai_conclusion()` references both fields;
- `complete_market_ai_conclusion()` references both fields;
- tests encode both fields in the contract.

The table currently has zero rows. This does not prove the field is unused because the lifecycle functions are active dependencies.

Required before DROP:

1. rewrite claim/complete lifecycle to `lease_expires_at` only;
2. remove dual-write/dual-clear behavior;
3. update tests;
4. smoke acquire/renew/expiry/complete/unknown-completion lifecycle;
5. prove no SQL/application references remain.

---

## 5. Explicit KEEP guardrail

The following are **not deletion candidates merely because they are empty or lightly populated**:

- `market_ohlcv_archive_ranges`;
- `market_insight_snapshot_staging`;
- `kfsp_rating_staging`;
- `kfsp_ttai_sync_state` and other sync-state tables;
- `eod_archive_checkpoints`;
- `ai_council_confirmations`;
- `ai_council_agent_stats`;
- canonical audit/job/checkpoint evidence tables with defined lifecycle.

Retention/TTL may be implemented where specified by contract, but retention is different from schema deletion.

---

## 6. Rollback / recovery gate

Before QEO-18/QEO-19/QEO-20 execute a destructive migration:

### Columns

- capture schema definition and current data parity counts;
- define an inverse/recovery migration or a deterministic backfill from canonical fields;
- verify functions/views/grants/indexes before and after;
- rehearse restore on a non-production database or verified backup snapshot.

### Tables

- cut over application consumers first;
- keep the legacy table intact during an observation window;
- capture row counts/schema and a recovery export/snapshot where material;
- only drop after canonical functional smoke succeeds;
- provide a recreation/backfill procedure in the migration notes.

### Current limitation

The current execution environment exposes production SQL metadata but does not expose a direct backup/restore rehearsal operation. Therefore the QEO-17 acceptance item **“backup + restore rehearsal” remains pending** and QEO-17 must not be marked Done until that rehearsal is completed through an approved non-production/backup workflow.

---

## 7. Gate status

| Acceptance item | Status |
|---|---|
| Production ↔ repo drift identified/documented | **PARTIAL PASS** — systematic version drift mapped; repo-ahead snapshot-trigger migration identified |
| Consumer evidence for destructive candidates | **PASS for current manifest** — active blockers identified |
| Deletion manifest with canonical replacements | **PASS / reviewable** |
| Backup + restore rehearsal | **PENDING** |
| No destructive DROP executed in QEO-17 | **PASS** |

QEO-17 stays **In Progress** until the migration drift/repo-ahead state is reconciled and the rollback rehearsal requirement is satisfied.
