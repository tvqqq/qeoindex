# Top Stocks 200 Canonical Universe Design

Date: 2026-09-01
Status: Approved architecture, pending written-spec review
Branch: `feat/top-stocks-200-universe`

## 1. Goal

Replace every operational Top 100 stock universe in QeoIndex with one canonical, monthly-refreshed **Top Stocks 200** universe. The same published membership must drive Bubbles, Bảng điện, Wyckoff Chart, AI Council, Qeo Composite and all general stock-list consumers.

The hard maximum universe size is **200**.

## 2. Canonical selection rule

Default selector:

```text
average_volume_50_sessions > 250000
AND market_cap_billion > 10
ORDER BY market_cap_billion DESC,
         average_volume_50_sessions DESC,
         ticker ASC
LIMIT 200
```

Rules:

- `average_volume_50_sessions`: shares.
- `market_cap_billion`: billion VND.
- Thresholds use strict `>`.
- Do not restrict membership to HOSE; preserve the provider exchange.
- Do not pad the list. If only 167 stocks qualify, publish 167 and show `167 / 200` in Admin.
- Market cap is the primary rank; Avg50 and ticker are deterministic tie-breakers.
- Maximum 200 is a read-only code safety contract.

## 3. Data source and monthly lifecycle

The selector reads the latest successfully published KFSP snapshot from `insights_stock_ratings`, using normalized ticker, company, exchange, sector, `average_volume_50_sessions`, `market_cap_billion`, detail metrics and source date.

KFSP detail/rating data remains daily. **Membership changes only when a universe refresh successfully publishes.** Daily KFSP updates cannot silently alter membership.

Create system job:

```text
market.universe_monthly
```

Default schedule:

```text
07:10 Asia/Ho_Chi_Minh on day 1 of every month
```

If day 1 is not a trading day, use the latest successfully published KFSP snapshot available at execution time.

The job must:

1. load current Admin selector settings;
2. resolve latest valid KFSP snapshot;
3. filter, sort and cap candidates deterministically;
4. verify detail identity/evidence;
5. ensure every selected ticker has an object in Supabase `stock-logo`;
6. stage the run and memberships;
7. atomically publish the run;
8. invalidate universe caches;
9. record system-job telemetry.

A failed run never partially replaces the current universe; the previous published run remains active.

## 4. Persistence

### 4.1 `market_universe_runs`

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

Canonical key:

```text
vn_top_stocks
```

### 4.2 `market_universe_memberships`

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
- `logo_path text not null`
- `logo_kind text not null` constrained to `official`, `generated_fallback`
- `detail_complete boolean not null default false`
- `created_at timestamptz not null default now()`

Prevent duplicate ticker and duplicate rank within one run. A database read model/RPC resolves exactly one current published run and returns memberships by rank.

## 5. Runtime service and cache

Replace static Top 100 imports with a server-side `getCanonicalUniverse()` boundary returning current run metadata plus stocks.

Each stock includes ticker, rank, company, exchange, sector, market cap, Avg50, logo path and source date.

Caching rules:

- use semantic namespace `market-universe:v1`, not `top100:*` or `top200:*`;
- cache current published snapshot/ticker list;
- invalidate only after successful publish;
- on cache failure, read the current published database snapshot;
- never execute the selector during page render;
- Edge Functions read the same Supabase universe read model/RPC, never a duplicated ticker array.

## 6. Root Admin

### 6.1 Editable selector settings

Add:

```text
market.universe_min_market_cap_billion = 10
market.universe_min_avg_volume_50d = 250000
```

Use existing Root Admin CAS, same-origin mutation validation, mandatory change reason and audit log. A setting change affects the **next refresh**, not the current membership.

Keep:

```text
market.universe_size = 200
```

read-only.

### 6.2 `/admin/universe`

Add navigation tab `Top Stocks 200`.

Show:

- selected count / 200;
- current run ID;
- KFSP source date;
- last successful update;
- next scheduled update;
- filters used by current run;
- filters configured for next run;
- warning when selected count < 200;
- detail completeness;
- logo coverage.

Table:

```text
Rank | Logo | Ticker | Company | Exchange | Sector | Market Cap | Avg Vol 50D | Detail | Source Date
```

Maximum 200 rows allows client-side search/filter.

## 7. Supabase `stock-logo` is the canonical logo store

Project:

```text
glwhhrmejlonhyorvtzm
```

Bucket:

```text
stock-logo
```

Canonical object contract:

```text
stock-logo/{TICKER}.png
```

Requirements:

- **every published universe member must have a real object in this bucket**;
- bucket is intended public-read for non-sensitive company-logo assets; writes remain service-role only;
- implementation must inspect current bucket configuration and enforce public-read/service-role-write without exposing credentials;
- membership persists `logo_path` and `logo_kind`;
- UI resolves the Supabase Storage/CDN URL from `logo_path`;
- `public/logos` is not the long-term source of truth.

### 7.1 Official logo discovery

Preserve current priority:

1. Ruatichsan JPEG/PNG/JPG;
2. 24hMoney JPG/PNG;
3. Vietstock image endpoint;
4. rank by square/near-square ratio, preferred source, then usable resolution/file size.

The resolver receives the canonical membership list and contains no static ticker list.

### 7.2 Guaranteed 100% bucket coverage

Before the first new-universe publish:

1. upload every valid existing `public/logos/{TICKER}.png` asset for selected tickers;
2. for missing assets, run official discovery and upload the selected candidate;
3. if no official candidate can be resolved, generate a deterministic branded ticker PNG and upload it as `stock-logo/{TICKER}.png` with `logo_kind = generated_fallback`.

Therefore a published membership never depends on a missing Storage object. Admin distinguishes official vs generated fallback so official logos can be improved later.

After all runtime consumers use Supabase Storage and verification passes, obsolete local logo files/static logo indexes may be removed from the repository in the cleanup phase.

## 8. Detail completeness

Every published member must open a usable detail popup.

Membership selection requires ticker, market cap and Avg50. Detail identity requires ticker, source date and company identity; exchange is preserved when provided.

The detail popup uses the newest valid daily KFSP record for that ticker. If the latest day is missing, it may use the latest previous successfully published detail row for the **same ticker**. Never substitute another ticker or synthesize fundamentals.

## 9. Consumer migration

### Bảng điện / orderbook

- SSR quotes, 5m snapshots, EOD shares, market sync and realtime/orderbook membership use the current canonical universe.
- Remove static ticker copies from Edge Functions/scripts.

### Bubbles

Delete the separate membership rule `average_volume_50_sessions > 300000` + volume ranking. Bubbles can reorder current members for display but cannot add a stock outside the canonical universe.

### Qeo Composite / rating / popup

Use canonical membership. Qeo Composite score can control presentation ranking but not membership.

### Wyckoff

Replace current operational `hose_top100` membership with `vn_top_stocks`.

Expected snapshots become:

```text
expected_snapshots = universe_count * timeframe_count
```

With five timeframes, the maximum is 1000 for 200 stocks. Keep execution in bounded batches. Remove runtime assumptions such as `Universe Count = 100`, `Snapshot Expected = 500`, `.slice(0, 100)` and exact 100-ticker readiness checks.

Historical Wyckoff runs preserve their original universe key/count; do not rewrite history.

### AI Council

AI Council evidence/readiness uses canonical membership. The candidate pool may grow to 200, but LLM-specific ticker caps remain independent cost controls. Do not create 200 LLM calls.

### Repository-wide audit

Audit runtime references to:

- `CANONICAL_TOP100_TICKERS`
- `UNIVERSE_SIZE = 100`
- `is_top100`
- `top100_rank`
- `hose_top100`
- universe-specific `.limit(100)` / `.slice(0, 100)`
- exact `length !== 100`
- `top100:*` cache keys
- static Top 100 arrays
- Top 100 product copy

Do not modify unrelated `100` values such as score scales, percentages, batch APIs or string truncation.

## 10. Rating schema migration

Do **not** create long-term `is_top200` / `top200_rank` fields.

Use generic semantics where needed:

```text
is_universe
universe_rank
universe_key
universe_effective_date
```

A compatibility migration may temporarily keep `is_top100` / `top100_rank`. Final cleanup removes them only after runtime code and tests have zero active references. The current `top100_rank between 1 and 100` constraint cannot survive final cutover.

## 11. Guarded legacy database/data cleanup

The user requires obsolete database data to be removed after new-universe cutover.

This is a separate destructive phase after a successful new-universe publish and consumer verification.

### 11.1 Deletion gate

Delete a legacy object/data set only when all are true:

1. runtime code has zero active references;
2. current tests/read models no longer require compatibility;
3. a new `vn_top_stocks` run is successfully published;
4. Bảng điện, Bubbles, Qeo Composite, Wyckoff and AI Council read the new membership;
5. database preflight finds no active FK/read-model dependency;
6. historical evidence required for audit/post-analysis is preserved.

### 11.2 Expected cleanup targets

Where confirmed obsolete:

- `is_top100` / `top100_rank` columns, constraints and indexes;
- legacy **current-membership** materializations keyed only by `hose_top100` after replacement;
- abandoned legacy staging/current-universe rows with no audit value;
- persisted compatibility caches or cache metadata using `top100:*` if stored in database-backed cache infrastructure;
- duplicate current-universe materializations that are no longer read;
- obsolete database functions/views/RPCs whose only purpose is the old Top 100 contract.

Do **not** delete historical market, rating, AI Council, Wyckoff, telemetry, audit, thesis or analysis records just because they were produced during the Top 100 era. Historical evidence remains historically accurate.

### 11.3 Cleanup mechanics

Use an explicit migration/maintenance operation with:

- preflight object/row counts;
- exact targets;
- transactional DDL/DML where supported;
- post-cleanup counts;
- rollback on transactional failure;
- logged summary of deleted and intentionally preserved objects/data.

No blanket truncate of shared history tables.

## 12. Full refresh after implementation and cleanup

After schema, runtime consumers, Admin UI, Storage logos and guarded cleanup pass verification, run one complete fresh universe cycle.

Required sequence:

1. confirm latest KFSP detail/rating snapshot is published;
2. manually execute `market.universe_monthly` through the authorized job path;
3. verify status `published`;
4. verify every member satisfies strict filters;
5. verify count `<= 200` and ranks are deterministic market-cap-descending;
6. verify detail completeness = selected count;
7. verify `stock-logo` object coverage = selected count;
8. invalidate and read back runtime universe cache;
9. refresh dependent board/orderbook/insights data needed by the new membership;
10. run EOD/readiness verification proving Wyckoff and AI Council accept the new contract;
11. smoke-test Bảng điện, Bubbles, Qeo Composite, Wyckoff Chart, AI Council and `/admin/universe` against the same current universe run.

The new universe is live only after this cycle succeeds.

## 13. Failure behavior

- no valid KFSP snapshot: fail refresh, preserve previous universe;
- zero candidates: fail closed, preserve previous universe;
- fewer than 200 qualifying candidates: publish that qualifying set and warn in Admin;
- database publish failure: preserve previous current run;
- cache invalidation failure: database current run remains authoritative;
- external official-logo discovery failure: generate/upload deterministic fallback PNG; do not publish with a missing bucket object;
- one downstream ticker refresh failure does not alter canonical membership; downstream jobs use their bounded retry/skip semantics.

## 14. Security and performance

- Root Admin keeps existing `ROOT_ADMIN_USER_IDS` authorization.
- Settings keep current CAS, same-origin and audit protections.
- Storage writes are service-role only; no browser write credentials.
- Universe/manual refresh endpoints use existing machine/admin authorization.
- Never run selector on page render.
- Never fetch 200 provider details serially in a browser request.
- SSR and realtime consumers receive cached membership and keep bounded provider concurrency.
- All UI work obeys `AGENTS.md` chart/realtime/dense-table performance invariants.

## 15. Acceptance criteria

### Selector

- exactly 250000 volume is excluded;
- exactly 10 billion VND market cap is excluded;
- both thresholds above boundary are required;
- deterministic market-cap/Avg50/ticker ordering;
- hard maximum 200;
- no padding below thresholds.

### Monthly semantics

- daily KFSP changes do not mutate membership;
- failed refresh leaves previous current run unchanged;
- Admin filter changes affect next refresh only.

### Consumer consistency

- Bảng điện, Bubbles, Qeo Composite, Wyckoff and AI Council use the same current membership;
- no product consumer adds a ticker outside it;
- every member opens detail;
- every member has `stock-logo/{TICKER}.png` in Supabase Storage.

### Wyckoff

- dynamic universe up to 200;
- expected snapshot count = `universe_count * 5` under current five-timeframe contract;
- no runtime exact-100/exact-500 readiness assumption.

### Cleanup

- removed legacy DB columns/views/functions/data have zero runtime references;
- no active read model breaks after cleanup;
- historical evidence remains intact.

### Full refresh

- fresh `market.universe_monthly` run publishes successfully;
- cache returns the same run/member ordering;
- Admin last/next update metadata is correct;
- logo and detail coverage both equal selected count;
- all required product surfaces point to the same current run.

## 16. Rollout order

1. add generic universe persistence/read model without deleting compatibility fields;
2. add selector tests and universe service/cache;
3. add Admin selector settings and `/admin/universe`;
4. backfill/generate/upload all selected logos into `stock-logo` and switch logo resolution;
5. migrate Bảng điện/orderbook/general consumers;
6. migrate Insights/Bubbles/Qeo Composite/detail;
7. migrate Wyckoff membership/snapshot/readiness contracts;
8. migrate AI Council/EOD readiness;
9. publish and verify a new `vn_top_stocks` snapshot;
10. run comprehensive code-search/tests/smoke checks;
11. execute guarded legacy DB/data cleanup;
12. run the final full `market.universe_monthly` refresh and dependent readiness verification;
13. update canonical handoff documents;
14. merge the approved feature branch to `main` once, producing one Vercel Git-triggered production deployment.

Supabase migrations and changed Edge Functions must be deployed to production according to `AGENTS.md`. Do not manually duplicate the Vercel production deployment for the same release.

## 17. Rollback

Before destructive cleanup, rollback can restore the previous published current run/read model and revert consumers.

After destructive cleanup, restore required compatibility only via forward migrations; do not edit already-applied production migrations.

Prior published universe runs and historical analysis evidence remain preserved so universe changes never rewrite historical outcomes.

## 18. Documentation / handoff deliverables

Update:

- `docs/HANDOVER.md`;
- market-board docs;
- Insights handover/rating docs;
- Wyckoff unified-data docs and external staging contract/prompt;
- Root Admin docs;
- final Top Stocks 200 implementation handoff containing schema/migrations, runtime interfaces, Storage logo behavior, cron/manual commands, cleanup evidence, verification results and known limitations.

## 19. Non-goals

- no Qeo Composite formula redesign;
- no editable maximum above 200;
- no 200-ticker LLM fan-out;
- no synthetic KFSP accounting/detail values;
- no rewriting historical analysis/AI Council/Wyckoff outcomes;
- no deletion of unrelated historical data solely because it predates Top Stocks 200.
