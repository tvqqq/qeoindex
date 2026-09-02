# KFSP Rating Storage Refactor Design

**Issue:** QEO-27  
**Related audit:** QEO-8  
**Date:** 2026-09-02

## 1. Goal

Refactor `public.insights_stock_ratings` into a smaller canonical KFSP read model without changing the semantic role of `public.market_universe_memberships`.

The refactor must:

- preserve `market_universe_memberships` as versioned Top Stocks membership/selection evidence;
- remove duplicate legacy rating aliases from `insights_stock_ratings`;
- remove `industry_group` while the provider supplies no distinct industry taxonomy;
- remove provider `raw_payload` from the indefinitely retained hot rating row;
- preserve normalized `kfsp_metrics` used by Insights and AI Council;
- retain bounded, traceable raw provider evidence for operational debugging;
- avoid a production compatibility window where old application code references columns already dropped;
- preserve canonical-200 publication and all KFSP/TTAI scheduler behavior.

## 2. Verified production baseline

Production was inspected read-only on 2026-09-02.

### 2.1 Table semantics and row integrity

`market_universe_memberships` currently has 200 rows / 200 distinct tickers in one `vn_top_stocks` run. It has no duplicate `(run_id,ticker)` groups and no duplicate `(run_id,rank)` groups.

`insights_stock_ratings` currently has 200 rows / 200 distinct tickers for `as_of_date=2026-09-02`, `source='kfsp'`, all published. It has no duplicate `(as_of_date,ticker,source)` groups.

The current ticker sets overlap 200/200. This is intentional: the rating publisher is scoped to the canonical Top Stocks 200. It is not evidence that the two tables should be merged.

### 2.2 Cross-table metadata overlap

For the current 200 tickers, these values are identical in both tables:

- `company_name`: 200/200
- `exchange`: 200/200
- `sector`: 200/200
- `market_cap_billion`: 200/200
- `average_volume_50d` / `average_volume_50_sessions`: 200/200

They still have different semantics. Membership market cap/liquidity is frozen selection evidence for a universe run. Rating market cap/liquidity is provider data attached to a daily analytics snapshot. This design therefore does not remove membership evidence or merge the tables.

### 2.3 Duplicate semantics inside `insights_stock_ratings`

The following legacy/generic columns equal their canonical KFSP columns for all 200 current rows, including null equality:

| Legacy column | Canonical column |
| --- | --- |
| `composite_score` | `kfsp_composite_score` |
| `score_4m` | `kfsp_score_4m` |
| `canslim_score` | `kfsp_canslim_score` |
| `stock_rs_score` | `kfsp_stock_rs_score` |
| `sector_rs_score` | `kfsp_sector_rs_score` |
| `stock_rrg_state` | `kfsp_stock_rrg_state` |
| `sector_rrg_state` | `kfsp_sector_rrg_state` |

The current `publish_kfsp_rating_snapshot(...)` function explicitly copies each `kfsp_*` value into both the canonical and legacy columns.

`industry_group` is also duplicate today: it is populated for 200/200 rows and equals `sector` for 200/200 rows. The Edge normalizer currently assigns both `sector` and `industry_group` from the provider `sector` metric.

### 2.4 Storage baseline

Current `insights_stock_ratings` physical size for only 200 rows is approximately:

- heap: 98 KB
- TOAST: 3.26 MB
- indexes: 5.49 MB
- total: 8.88 MB

Average logical row size is ~6.5 KB. `raw_payload` averages ~2.15 KB and `kfsp_metrics` ~3.91 KB, so these two JSONB values account for roughly 93% of the logical row payload.

The current index footprint is larger than expected for 200 rows because the table previously held a much larger history before the canonical-200 clean rebuild. `n_dead_tup=0` does not imply physical index files have shrunk.

## 3. Architecture decision

### 3.1 Keep the two existing domain boundaries

`market_universe_memberships` remains unchanged. It answers:

> Which securities belonged to a specific canonical universe run, at what rank, using what frozen selection evidence?

`insights_stock_ratings` remains the published analytics read model. It answers:

> What normalized KFSP analytics were published for this ticker on this date?

No foreign key from ratings to the current universe membership is introduced because historical ratings and membership runs have different temporal lifecycles.

### 3.2 Canonical hot rating row

After the destructive migration, `insights_stock_ratings` retains normalized/public read fields, including:

- identity/provenance: `id`, `as_of_date`, `ticker`, `source`, `source_url`, `sync_run_id`, `fetched_at`, `created_at`, `updated_at`, `is_published`;
- security metadata used directly by the rating snapshot: `company_name`, `sector`, `exchange`;
- market values: `price`, `price_change_pct`, `average_volume_50_sessions`, `market_cap_billion`;
- canonical KFSP scalar fields: `kfsp_composite_score`, `kfsp_score_4m`, `kfsp_canslim_score`, `kfsp_price_potential`, `kfsp_stock_rs_score`, `kfsp_sector_rs_score`, `kfsp_stock_rrg_state`, `kfsp_sector_rrg_state`;
- normalized detailed metrics: `rs_short`, `rs_medium`, `rsi_14`, `weekly_change_pct`, `monthly_change_pct`, `beta`, `pe_ttm`, `pb_ttm`, `kfsp_metrics`, `kfsp_contract_version`.

The following columns are dropped only after runtime consumers have been deployed without them:

- `composite_score`
- `score_4m`
- `canslim_score`
- `stock_rs_score`
- `sector_rs_score`
- `stock_rrg_state`
- `sector_rrg_state`
- `industry_group`
- `raw_payload`

### 3.3 Bounded raw evidence table

Create a private service-role-only table:

`public.kfsp_rating_raw_evidence`

Proposed columns:

```sql
sync_run_id uuid not null,
ticker text not null,
as_of_date date not null,
raw_payload jsonb not null,
fetched_at timestamptz not null,
expires_at timestamptz not null,
created_at timestamptz not null default now(),
primary key (sync_run_id, ticker)
```

Constraints:

- `ticker` uses the same canonical ticker format check;
- `raw_payload` must be a JSON object;
- `expires_at >= fetched_at`;
- index `expires_at` for bounded pruning;
- RLS/service-role boundary matches existing private KFSP staging/telemetry tables; no `anon`/`authenticated` read grant.

Retention is **30 days**. This is intentionally a bounded operational evidence window, not a new long-term data warehouse.

At 200 rows/day and the observed ~2.15 KB average raw payload, 30 days is roughly 6,000 rows / ~13 MB logical JSON before table/index overhead, which is acceptable as an isolated operational evidence store and prevents unbounded growth of the hot read model.

No object-storage dependency is added in QEO-27. Long-term raw archive can be added later only if a concrete audit/regulatory requirement appears.

## 4. Publisher data flow

The Edge function continues to normalize provider records and write `raw_payload` into `kfsp_rating_staging`. The Edge request/response contract does not need to change.

`publish_kfsp_rating_snapshot(...)` changes transactionally:

1. Validate the running sync run and staged row count as today.
2. Validate rows have at least one score as today.
3. Insert raw evidence from staging into `kfsp_rating_raw_evidence` keyed by `(sync_run_id,ticker)`.
4. Set `expires_at = fetched_at + interval '30 days'`.
5. Delete/replace the current date `source='kfsp'` published snapshot as today.
6. Insert only canonical normalized columns into `insights_stock_ratings`; do not copy KFSP values into generic aliases; do not insert `industry_group`; do not insert `raw_payload`.
7. Mark the sync run completed.
8. Clear the staging rows.
9. Prune `kfsp_rating_raw_evidence where expires_at < now()` inside the successful daily publish transaction.

Raw evidence insertion must be idempotent for the same `(sync_run_id,ticker)`. A replay of the same deterministic manual run must not create a second evidence row.

## 5. Consumer migration

Repository audit shows active runtime consumers already use canonical `kfsp_*` fields for scores/RRG. `lib/insights-data.ts` is the active consumer that still selects `industry_group`; its mapping already falls back to `sector`.

Runtime changes therefore include:

- remove `industry_group` from `RatingRow`/selection/mapping in `lib/insights-data.ts` and use `sector` as the current industry grouping label;
- ensure AI Council, LLM evidence, EOD archive, Insights UI and metric semantics continue to use `kfsp_*` canonical fields;
- add a regression scan that fails if production runtime code reintroduces the dropped generic aliases or `industry_group` from `insights_stock_ratings`;
- update documentation that still describes legacy aliases as current storage.

Historical migrations remain immutable. The regression scan must distinguish historical migration text from current runtime/schema contracts.

## 6. Index strategy

Dropping `composite_score` requires replacing two indexes that currently depend on it:

- `insights_stock_ratings_date_score_idx`
- `insights_stock_ratings_published_date_score_idx`

They are recreated with `kfsp_composite_score` in the same position. Their existence is preserved in QEO-27 even though the non-partial date-score index has low recent scan count; QEO-27 does not remove an index solely from short-window usage counters.

The following remain conceptually unchanged:

- unique `(as_of_date,ticker,source)`;
- `(ticker,as_of_date desc)`;
- published sector/KFSP-score index;
- PK.

After the destructive migration, perform a production-safe physical maintenance step to reclaim old index pages. Prefer concurrent reindexing where the runtime/tooling supports it. Do not use `VACUUM FULL` unless a later benchmark proves its blocking rewrite is necessary.

Measure heap/TOAST/index/total bytes before and after maintenance and record them in QEO-27.

## 7. Deployment sequencing

The critical compatibility rule is: **new readers before destructive schema**.

### Phase A — application compatibility deployment

1. Add tests that require canonical-only runtime consumption.
2. Update `lib/insights-data.ts` and any discovered runtime consumer to stop selecting `industry_group` or generic aliases.
3. Merge and deploy the application to Vercel while the old DB schema is still a superset.
4. Verify production app/Admin routes are READY.

The new application works against the old DB because all canonical columns already exist.

### Phase B — database contraction

Only after Phase A production is READY:

1. Apply the ordered Supabase migration that creates `kfsp_rating_raw_evidence`.
2. Backfill the current published raw evidence where `sync_run_id` is present, so the current provider payload is not silently lost during contraction.
3. Replace `publish_kfsp_rating_snapshot(...)` with the canonical-only + bounded-evidence implementation.
4. Recreate score indexes on `kfsp_composite_score`.
5. Drop the seven generic aliases, `industry_group`, and `raw_payload` from `insights_stock_ratings`.
6. Re-establish intended column/table grants after the contraction.

This order avoids the unsafe state where the old application selects a dropped `industry_group` column.

### Phase C — production acceptance and maintenance

1. Run a one-shot Rating recovery smoke through the existing QEO-14 dispatcher.
2. Require exactly 200 canonical published ratings, 0 noncanonical ratings, and the same 200 ticker set as the latest canonical universe.
3. Require one raw evidence row per published ticker for the smoke sync run, with 30-day expiry.
4. Confirm scheduled Rating/TTAI crons remain 07:00/07:10 ICT and no temporary cron exists.
5. Reclaim index bloat with the safest supported reindex operation.
6. Measure and record post-migration storage.

## 8. Error handling and failure boundaries

- If raw evidence persistence fails, publishing fails closed; normalized ratings must not be marked completed without their bounded raw evidence for that run.
- If the normalized snapshot insert fails, the transaction rolls back raw evidence insertion and sync-run completion together.
- Evidence pruning failure is part of the same publisher transaction; the sync does not claim completion if retention maintenance fails unexpectedly.
- A failed production smoke leaves the previous published snapshot semantics unchanged except where the existing publisher already replaces the target date transactionally.
- No secrets, provider tokens or request headers are stored in `kfsp_rating_raw_evidence`; only the existing provider record payload currently held under staging `raw_payload` is retained.

## 9. Testing contract

Add focused regression coverage for:

1. Runtime code does not select/use the seven generic aliases from `insights_stock_ratings`.
2. Runtime code does not select/use `industry_group` from `insights_stock_ratings`.
3. Migration creates private `kfsp_rating_raw_evidence` with `(sync_run_id,ticker)` PK and 30-day bounded retention.
4. Publisher copies staging `raw_payload` into evidence but not into published ratings.
5. Publisher writes only canonical KFSP score/RRG columns.
6. Score indexes use `kfsp_composite_score`, not dropped `composite_score`.
7. Migration drops all nine obsolete hot-row columns only after compatibility code is present in the same change set.
8. Existing canonical-200 KFSP regression remains green.
9. Core tests, EOD-v3 tests, lint, TypeScript and production build remain green.

## 10. Production acceptance

QEO-27 is complete only when all are true:

- Vercel production is READY on the merged application commit before destructive DB migration.
- DB migration applied successfully.
- `insights_stock_ratings` no longer contains the seven generic aliases, `industry_group`, or `raw_payload`.
- Current published rating snapshot contains exactly 200 canonical tickers and 0 noncanonical tickers.
- Manual Rating smoke reaches actual provider `succeeded` lifecycle through QEO-14 telemetry.
- Raw evidence for the smoke run has exactly the expected ticker count, is traceable by `sync_run_id`, and has bounded 30-day expiry.
- `market_universe_memberships` schema and current 200-row membership remain unchanged.
- Rating/TTAI cron schedules remain active and unchanged.
- Physical storage before/after is recorded; no `VACUUM FULL` was used without explicit evidence.
- Linear QEO-27 contains CI, deploy, smoke, data-integrity and storage evidence before moving to Done.

## 11. Alternatives rejected

### Merge `market_universe_memberships` and `insights_stock_ratings`

Rejected because membership/versioning and daily analytics have different grains and retention lifecycles. Identical current metadata does not make the records semantically equivalent.

### Keep aliases as generated columns

Rejected because it preserves two names for one metric indefinitely, complicates schemas and indexes, and provides no current compatibility benefit after consumer migration.

### Introduce a global `stock_securities` master in this refactor

Deferred. Static metadata normalization is reasonable eventually, but it is not the dominant storage problem and would widen QEO-27 into a separate master-data migration. QEO-27 stays focused on rating semantics and hot storage.

### Move raw payload directly to object storage

Deferred. A private 30-day evidence table is sufficient for the current operational/debugging requirement, is transactionally coupled to publish, and avoids adding a new external archive/hydration dependency.