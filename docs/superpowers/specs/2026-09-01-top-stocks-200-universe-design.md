# Top Stocks 200 Canonical Universe Design

Date: 2026-09-01
Status: Approved architecture, pending written-spec review
Branch: `feat/top-stocks-200-universe`

## 1. Goal

Replace every operational Top 100 stock universe in QeoIndex with one canonical, monthly-refreshed **Top Stocks 200** universe. The universe is selected from the latest successfully published KFSP stock snapshot, persisted as an immutable monthly membership snapshot, cached for fast runtime reads, used consistently by Bubbles, Bảng điện, Wyckoff Chart, AI Council, Qeo Composite and related stock-list consumers, and managed from a new Root Admin universe screen.

The maximum universe size is fixed at **200**.

## 2. Canonical selection rule

The default selector is:

```text
average_volume_50_sessions > 250000
AND market_cap_billion > 10
ORDER BY market_cap_billion DESC,
         average_volume_50_sessions DESC,
         ticker ASC
LIMIT 200
```

Rules:

- `average_volume_50_sessions` is stock volume, unit shares.
- `market_cap_billion` is market capitalization, unit billion VND.
- Threshold semantics are strict `>` to match the product requirement.
- Membership is not restricted to HOSE. Any supported Vietnamese listed stock in the KFSP snapshot may qualify; the original exchange is preserved.
- The selector does not pad the list with stocks that fail the configured thresholds. If 167 stocks qualify, the published universe contains 167 stocks and Admin shows `167 / 200` with a warning.
- Sorting is deterministic. Market capitalization is the primary ranking field; average 50-session volume and ticker are deterministic tie-breakers.
- The maximum size of 200 is a code-level safety contract and is not editable from Admin.

## 3. Source of truth and refresh cadence

### 3.1 Source

The selector reads the latest successfully published KFSP rating/detail snapshot in `insights_stock_ratings`. It uses normalized fields already produced by the KFSP pipeline, including ticker, company name, exchange, sector, `average_volume_50_sessions`, `market_cap_billion`, and `kfsp_metrics`.

The KFSP source remains a daily data source. **Universe membership is monthly.** Daily rating/detail refreshes must not mutate membership between monthly universe publishes.

### 3.2 Monthly publish

Create a monthly system job with key:

```text
market.universe_monthly
```

Default schedule:

```text
07:10 Asia/Ho_Chi_Minh on day 1 of every month
```

If day 1 is a non-trading day, the job uses the latest successfully published KFSP snapshot available at execution time.

The monthly job must:

1. load the current admin selector configuration;
2. resolve the latest valid KFSP snapshot date;
3. select candidates using the canonical rule;
4. deterministically rank and cap at 200;
5. verify required detail fields are resolvable for every selected ticker;
6. ensure a canonical logo object exists in Supabase Storage for every ticker, allowing the controlled text badge only as an application rendering fallback if external logo discovery fails;
7. stage the membership snapshot and metadata;
8. atomically publish the run;
9. invalidate universe-related runtime caches;
10. record system job telemetry and audit-relevant summary fields.

A failed run must not partially replace the current universe. The previously published universe remains active.

## 4. Persistence model

Create two canonical tables.

### 4.1 `market_universe_runs`

One row per universe refresh attempt.

Required fields:

- `id uuid primary key`
- `universe_key text not null`
- `status text not null` constrained to `running`, `published`, `failed`
- `source text not null default 'kfsp'`
- `source_as_of_date date not null`
- `max_size smallint not null default 200`
- `min_market_cap_billion numeric not null`
- `min_average_volume_50d bigint not null`
- `candidate_count integer not null`
- `selected_count integer not null`
- `started_at timestamptz not null`
- `published_at timestamptz null`
- `error_code text null`
- `error_message text null`
- `created_at timestamptz not null default now()`

Canonical universe key:

```text
vn_top_stocks
```

### 4.2 `market_universe_memberships`

Immutable membership rows tied to a run.

Required fields:

- `run_id uuid references market_universe_runs(id) on delete cascade`
- `universe_key text not null`
- `ticker text not null`
- `rank smallint not null check (rank between 1 and 200)`
- `company_name text null`
- `exchange text null`
- `sector text null`
- `market_cap_billion numeric not null`
- `average_volume_50d bigint not null`
- `source_as_of_date date not null`
- `logo_path text null`
- `detail_complete boolean not null default false`
- `created_at timestamptz not null default now()`
- primary/unique constraints that prevent duplicate ticker or rank inside a run

A database read model/RPC must resolve exactly one current published run and return memberships ordered by rank.

## 5. Runtime universe service and cache

Replace static Top 100 aliases with one server-side service boundary, for example:

```ts
export interface CanonicalUniverseStock {
  ticker: string
  rank: number
  companyName: string | null
  exchange: string | null
  sector: string | null
  marketCapBillion: number
  averageVolume50d: number
  logoPath: string | null
  sourceAsOfDate: string
}

export interface CanonicalUniverseSnapshot {
  key: "vn_top_stocks"
  runId: string
  updatedAt: string
  sourceAsOfDate: string
  selectedCount: number
  maxSize: 200
  filters: {
    minMarketCapBillion: number
    minAverageVolume50d: number
  }
  stocks: CanonicalUniverseStock[]
}
```

Runtime consumers call a cached `getCanonicalUniverse()` service rather than importing a static ticker array.

Caching rules:

- cache the current published snapshot and ticker list;
- use a semantic namespace such as `market-universe:v1`, never `top100:*` or `top200:*`;
- cache invalidation occurs only after successful monthly publish;
- cache failures fail open to the current published database snapshot;
- no page dynamically re-runs the membership selector.

For Edge Functions that cannot import the Next.js server module, membership must come from the same Supabase read model/RPC rather than from a duplicated ticker constant.

## 6. Root Admin configuration and UI

### 6.1 Editable settings

Add two runtime-safe settings to the existing Root Admin settings catalog:

```text
market.universe_min_market_cap_billion = 10
market.universe_min_avg_volume_50d = 250000
```

Constraints:

- market cap must be a positive numeric value with a sensible bounded maximum;
- volume must be a positive integer with a sensible bounded maximum;
- settings use the existing optimistic-lock/CAS mutation path, same-origin protection, mandatory change reason, and audit log;
- changing a selector setting does **not** immediately change the current membership;
- the next universe refresh reads the new settings.

Keep the code-level inventory item:

```text
market.universe_size = 200
```

read-only.

### 6.2 `/admin/universe`

Add a Root Admin navigation tab named `Top Stocks 200`.

The page shows:

- current selected count and maximum 200;
- current published universe run ID;
- source KFSP snapshot date;
- last successful update timestamp;
- next scheduled update timestamp;
- selector values that created the current snapshot;
- selector values currently configured for the next run;
- warning if selected count is below 200;
- detail completeness count;
- logo availability count.

Membership table columns:

```text
Rank | Logo | Ticker | Company | Exchange | Sector | Market Cap | Avg Vol 50D | Detail | Source Date
```

The table may filter/search client-side because the hard maximum is 200 rows.

## 7. Canonical logo storage

### 7.1 Supabase bucket

Use the existing Supabase Storage bucket:

```text
project: glwhhrmejlonhyorvtzm
bucket: stock-logo
```

This bucket becomes the **canonical source of truth for all stock logos used by the universe**.

Target storage contract:

```text
stock-logo/{TICKER}.png
```

Requirements:

- every current universe ticker must have an attempted canonical object in the bucket;
- write/update access is service-role only;
- stock logos are non-sensitive assets and the intended runtime model is public-read for maximum UI performance; implementation must verify the current bucket accessibility and enforce the intended public-read/service-role-write policy without exposing write credentials;
- membership stores `logo_path`, not a hardcoded external provider URL;
- the UI resolves the Supabase Storage asset URL from `logo_path`;
- the existing branded ticker badge remains the final rendering fallback if a logo object cannot be loaded.

### 7.2 Logo discovery

Preserve the current source-priority logic as the canonical discovery strategy:

1. Ruatichsan JPEG/PNG/JPG;
2. 24hMoney JPG/PNG;
3. Vietstock image endpoint;
4. rank candidates by square/near-square ratio, preferred source, then usable resolution/file size.

The discovery job takes the current universe ticker list as input. It must not contain its own static stock list.

For existing repository assets under `public/logos`, backfill every valid asset into `stock-logo` before the cutover. For universe tickers missing locally, run external discovery and upload the chosen object to Supabase Storage.

After cutover, `public/logos` is no longer the canonical runtime source. It may remain temporarily as a compatibility fallback only until all consumers are migrated and verified; the cleanup phase removes obsolete local-logo data and static logo indexes when no runtime reference remains.

## 8. Detail completeness contract

Every published universe member must resolve a detailed KFSP record for popup/detail usage.

The detailed UI uses the latest valid daily data for the ticker while membership remains monthly.

If the latest daily detail row is unavailable, the detail loader may use the latest previous successfully published row for that same ticker. The UI must not silently substitute a different ticker or synthetic fundamentals.

The monthly universe run records detail completeness. A ticker without minimally required identity and filter evidence cannot be published as a member.

Minimum selection evidence is:

- ticker;
- market cap;
- average volume 50D.

Minimum detail identity is:

- ticker;
- company name or an explicit canonical ticker fallback;
- exchange if provided by the source;
- source snapshot date.

## 9. Consumer migration

The following product areas must use the same current published membership.

### 9.1 Bảng điện

- SSR batch quotes use current universe tickers.
- 5m snapshot requests use current universe tickers.
- EOD share/market sync uses current universe tickers.
- realtime/orderbook ingestion validates against current membership.
- Edge Functions do not carry a static copy of the ticker list.

### 9.2 Bubbles

Remove the independent Bubbles membership rule based on `average_volume_50_sessions > 300000` and volume ranking. Bubbles receives the canonical universe and may sort/present that membership differently for visualization, but cannot add a ticker outside the current universe.

### 9.3 Qeo Composite and stock rating surfaces

The Qeo Composite table, sector stock rows, stock-detail popup and any general Top Stocks disclosure operate on canonical universe membership. Presentation sorting can use Qeo Composite score but does not alter membership.

### 9.4 Wyckoff Chart and scanner

Replace legacy `hose_top100` operational membership with `vn_top_stocks`.

The required snapshot count is dynamic:

```text
expected_snapshots = universe_count * timeframe_count
```

With five current timeframes and 200 members, the maximum expected count is 1000. Bounded scanning/ingestion batches remain small enough to respect provider/runtime limits.

Do not preserve `Universe Count = 100`, `Snapshot Expected = 500`, `.slice(0, 100)`, or equivalent assumptions in runtime contracts.

Historical run records retain their historical universe key/count. Do not rewrite old historical Wyckoff outcomes as though they were generated for the new universe.

### 9.5 AI Council

AI Council evidence selection and EOD readiness use canonical universe membership. The candidate pool may grow to 200, but the existing LLM-specific ticker limits remain independent cost controls. The migration must not cause 200 LLM calls.

### 9.6 Other list consumers

Audit all runtime code for static Top 100 references, including:

- `CANONICAL_TOP100_TICKERS`;
- `UNIVERSE_SIZE = 100`;
- `is_top100`;
- `top100_rank`;
- `hose_top100`;
- `.limit(100)` or `.slice(0, 100)` where the literal is a universe contract;
- exact `length !== 100` readiness checks;
- `top100:*` cache namespaces;
- static Top 100 arrays in Edge Functions/scripts;
- user-facing copy that claims Top 100 where the operational universe is now Top Stocks 200.

Not every literal `100` in the repository is a universe contract; unrelated limits, percentages, portfolio batch limits, telemetry truncation, and score scales must not be modified just because they contain `100`.

## 10. Rating schema migration

Do not introduce `is_top200` or `top200_rank` as the new long-term schema.

Normalize universe semantics to generic fields/read models such as:

```text
is_universe
universe_rank
universe_key
universe_effective_date
```

The exact migration may temporarily retain `is_top100` and `top100_rank` for compatibility while consumers are migrated. Final cleanup removes the legacy columns, constraints and indexes only after code-search and automated tests prove no active runtime path uses them.

The `top100_rank between 1 and 100` database constraint must not survive the final cutover.

## 11. Legacy cleanup and destructive data removal

The user requires obsolete database data to be removed after the new universe is implemented.

Cleanup is a separate post-cutover phase, not part of the first schema migration.

### 11.1 Cleanup eligibility

A legacy object is eligible for deletion only when all are true:

1. current branch runtime has no references to the legacy object/column/key;
2. migrations/tests no longer require it for compatibility;
3. the new universe has a successfully published current snapshot;
4. Bảng điện, Bubbles, Qeo Composite, Wyckoff and AI Council successfully read the new universe;
5. a database preflight shows the legacy data is not referenced by active foreign keys or current read models;
6. historical records whose value is still required for audit/post-analysis are preserved.

### 11.2 Intended cleanup targets

Expected cleanup includes, where confirmed obsolete during implementation:

- `is_top100` and `top100_rank` columns/constraints/indexes from current rating tables;
- legacy current-membership rows identified only by `hose_top100` when the same current membership has been migrated to `vn_top_stocks`;
- stale compatibility/current-universe cache records whose namespace is `top100:*`;
- duplicate static/current universe materializations no longer used by any runtime path;
- obsolete local logo index/runtime data after Supabase Storage cutover;
- obsolete current-universe staging rows from failed/abandoned legacy runs where retention has no audit value.

Do **not** delete historical market, rating, AI Council, Wyckoff, job telemetry, audit, or analysis records solely because they were produced when the universe size was 100. Historical evidence must remain historically accurate.

### 11.3 Cleanup execution

Use an explicit migration or maintenance script with:

- preflight counts;
- transaction boundaries where supported;
- exact table/column/key targets;
- post-cleanup counts;
- failure rollback for transactional operations;
- logged summary of what was removed and what was intentionally preserved.

No blanket truncation of shared history tables is allowed.

## 12. Full refresh after cutover

After schema, runtime consumers, logo storage, Admin UI and cleanup pass verification, execute one complete fresh universe refresh.

Required sequence:

1. ensure latest KFSP rating/detail snapshot is successfully published;
2. run `market.universe_monthly` manually through the authorized system-job path using the default selector unless Admin settings have intentionally changed it;
3. verify run status `published`;
4. verify selected count is `<= 200` and every member satisfies the strict filter;
5. verify rank ordering is deterministic and market-cap descending;
6. verify detail completeness for every selected member;
7. verify `stock-logo` object coverage for every selected member or explicitly record controlled fallback failures;
8. invalidate/read back the runtime universe cache;
9. run dependent market/orderbook/insights refresh paths needed for the new membership;
10. run the EOD/readiness path that proves Wyckoff and AI Council accept the new membership contract;
11. smoke-test Bảng điện, Bubbles, Qeo Composite, Wyckoff Chart, AI Council and `/admin/universe` against the same run ID/member set.

The new universe is considered live only after this refresh and verification complete successfully.

## 13. Failure behavior

- No valid KFSP snapshot: fail the monthly run; keep previous published universe.
- Selector returns zero rows: fail closed; keep previous published universe.
- Selector returns fewer than 200 rows: publish the qualifying set and show Admin warning.
- Database stage/publish failure: do not mutate current universe.
- Cache invalidation failure: database snapshot is authoritative and runtime may fall back to it.
- External logo source failure for one ticker: retain controlled ticker-badge rendering fallback and surface logo coverage in Admin; do not replace the ticker with another stock.
- Supabase Storage upload failure: record the failed logo status and retry in the refresh workflow; membership publication may proceed only if product identity/detail remains usable and the failure is visible.
- One downstream ticker data refresh failure must not invalidate the entire membership; downstream jobs use bounded retries/skip semantics according to their own contracts while preserving the canonical member list.

## 14. Security

- Root Admin remains restricted by existing `ROOT_ADMIN_USER_IDS` server authorization.
- Universe settings mutations use existing same-origin validation, required change reason, CAS versioning and audit logging.
- Supabase Storage writes use service-role credentials only on the server/job side.
- No service-role key or Storage write credential is exposed to the browser.
- The logo bucket stores public company-logo assets only; no sensitive user data is stored there.
- Monthly/manual refresh endpoints use existing machine/admin authorization patterns.

## 15. Performance constraints

- Never run the universe selector on page render.
- Never fetch 200 detailed provider records serially in a browser request.
- SSR market board receives a cached ticker list and uses existing bounded quote/history services.
- Dense-table and realtime UI changes continue to obey `AGENTS.md` performance invariants: no broad persistent backdrop blur, no unbounded prefetch, stable chart dimensions, bounded network concurrency.
- Logo URLs resolve directly from Supabase Storage/CDN rather than proxying every image through a dynamic application route unless bucket configuration makes a proxy unavoidable.

## 16. Testing and acceptance criteria

The implementation is accepted only when automated and production verification cover all of the following.

### Selector

- strict volume boundary: exactly 250000 is excluded;
- strict market-cap boundary: exactly 10 is excluded;
- eligible rows above both thresholds are included;
- market-cap descending ordering;
- deterministic average-volume/ticker tie-breaks;
- hard cap at 200;
- fewer than 200 candidates are not padded.

### Monthly stability

- daily KFSP data changes do not alter membership without a monthly publish;
- a failed monthly refresh leaves the previous current run unchanged;
- changed Admin filters affect the next refresh, not the current snapshot.

### Consumers

- Bảng điện contains only current universe tickers;
- Bubbles contains only current universe tickers;
- Qeo Composite contains only current universe tickers;
- Wyckoff stock list contains only current universe tickers;
- AI Council candidate/evidence queries contain only current universe tickers;
- detail popup works for every current member;
- all selected tickers render a Supabase Storage logo or the controlled ticker fallback.

### Wyckoff

- universe count is dynamic and up to 200;
- expected snapshot count equals `universe_count * 5` for the current five-timeframe contract;
- no runtime readiness path requires exactly 100 tickers or 500 snapshots.

### Database cleanup

- active runtime code has zero references to removed legacy columns/keys;
- post-cleanup schema no longer contains obsolete current Top 100 constraints/materializations;
- historical audit/research records remain intact;
- no active read model breaks after cleanup.

### Full refresh

- a fresh `market.universe_monthly` run publishes successfully;
- runtime cache returns the same run/member ordering;
- Admin timestamps and next-run metadata are correct;
- current product surfaces use the same universe run.

## 17. Rollout sequence

Use this order to keep the system recoverable:

1. add generic universe persistence and read model without deleting legacy fields;
2. add selector tests and universe service/cache;
3. add Admin settings and `/admin/universe`;
4. migrate/backfill logos into Supabase `stock-logo` and switch logo resolution;
5. migrate Bảng điện/orderbook and general consumer paths;
6. migrate Insights/Bubbles/Qeo Composite/detail paths;
7. migrate Wyckoff membership/run/readiness contracts;
8. migrate AI Council and EOD readiness contracts;
9. publish and verify a new universe snapshot;
10. run comprehensive code-search/tests/smoke checks;
11. execute guarded legacy database/data cleanup;
12. run one final complete `market.universe_monthly` refresh plus dependent refresh verification;
13. update canonical engineering handoff documentation;
14. merge the approved feature branch to `main` once for the production Vercel deployment trigger.

Supabase migrations and Edge Function changes must be deployed to production according to the repository's `AGENTS.md` invariants during implementation. Do not create a duplicate manual Vercel production deployment for the same release.

## 18. Rollback

Before destructive cleanup, rollback is simply re-pointing the current published universe/read model to the previous valid run and reverting consumer code if needed.

After destructive cleanup, rollback must use forward migrations restoring only the required compatibility schema; do not edit already-applied production migrations. Historical records are preserved specifically so universe version changes do not erase prior evidence.

The monthly publication model always keeps prior published run rows available unless a later retention policy explicitly archives them. Current selection is a pointer/read-model decision, not destructive replacement of prior run history.

## 19. Documentation deliverables

Implementation must update:

- `docs/HANDOVER.md`;
- market-board documentation;
- Insights handover/rating documentation;
- Wyckoff unified-data documentation and external staging prompt/contract where applicable;
- Root Admin documentation;
- a dedicated final implementation handoff that lists migrations, runtime interfaces, cron/manual commands, cleanup executed, verification evidence, and remaining known limitations.

## 20. Non-goals

- Do not redesign the Qeo Composite formula.
- Do not make the Admin-selected universe maximum editable above 200.
- Do not call the LLM once per universe member.
- Do not replace KFSP accounting/detail data with synthetic values.
- Do not rewrite historical analyses or old Wyckoff/AI Council outcomes to pretend they used the new universe.
- Do not delete unrelated rows merely because they were created during the Top 100 era.
