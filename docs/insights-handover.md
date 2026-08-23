# Insights engineering and operations handover

## Start here

Read in this order:

1. `AGENTS.md`
2. `docs/HANDOVER.md`
3. `docs/insights-homepage.md`
4. `docs/insights-plan.md`
5. `docs/insights-rating-model.md`
6. `docs/insights-design.md`

## Architecture map

| Area | Canonical implementation |
| --- | --- |
| Route/authenticated layout | `app/insights/page.tsx`, `app/insights/layout.tsx` |
| Server read-model | `lib/insights-data.ts` |
| Pure rating/state model | `lib/insights-rating-model.ts` |
| Main UI | `components/insights/insights-dashboard.tsx` |
| Provider field catalog | `supabase/functions/_shared/kfsp-catalog.ts` |
| Daily ingestion | `supabase/functions/kfsp-rating-sync/index.ts` |
| Schema/auth/publish/cron | Insights migrations under `supabase/migrations/` |
| Model tests | `tests/insights-rating-model.test.ts` |
| Security/UI/schema contracts | `tests/insights-schema.test.ts` |

## Source-of-truth boundaries

- Supabase: daily KFSP-derived stock ratings, published history, and sync lifecycle.
- Notion: theses, research overview, Scanner, Signals, and research narrative.
- Existing market feeds: VNIndex quote and five-minute history.
- Canonical Top 100 membership: shared QeoIndex universe; do not create an Insights-only hard-coded list.
- The browser reads only published, browser-safe Supabase columns using the signed-in user's client.

## Read path

1. Find latest `is_published = true`, `source = 'kfsp'` date.
2. Load top 500 composite-ranked detailed rows and exact Top 100, then de-duplicate by ticker.
3. Load two lean pages (0–999, 1000–1999) for all-sector aggregation.
4. Find the latest real snapshot date on or before the 1D/7D/30D targets.
5. Load historical metrics for detailed tickers in chunks of 100.
6. In parallel, load VNIndex, scanner, signals, and Notion research modules with `Promise.allSettled` so one optional module does not blank the page.

Important: the sector aggregate covers all 1,752 current rows, while detailed rows are currently capped at top 500 plus exact Top 100. Preserve this distinction in UI copy and future changes.

## Write and publish path

1. Cron calls the machine-only Edge Function with `X-KFSP-Sync-Secret` read from Supabase Vault.
2. The function compares the secret in constant time.
3. It reuses or refreshes a service-role-only provider token.
4. Primary filter data and bounded supplemental CANSLIM/4M batches are fetched with provider timeouts.
5. Records are joined by ticker, normalized, validated, and inserted into staging under one sync-run UUID.
6. `publish_kfsp_rating_snapshot` locks the run, validates minimum row count and score presence, replaces only the same provider/date, inserts the complete batch, marks the run completed, and clears staging in one transaction.
7. A failed/incomplete run leaves the previous published snapshot readable.

## Auth and security invariants

- `/insights` requires login but no special user feature.
- `anon` has no table grant.
- `authenticated` has column-level select on published rows only; no insert/update/delete.
- RLS policy targets `authenticated` and requires `is_published`.
- Sync runs, provider tokens, staging, raw payloads, and diagnostics are service-role only.
- Never expose provider credentials, provider JWT, Supabase service role, sync secret, or Vault values through `NEXT_PUBLIC_*`, logs, docs, or browser bundles.
- Do not solve read errors by broadening RLS or adding `SECURITY DEFINER`. Diagnose grants, policy, client session, and published status separately.

## Units and data rules

- Provider live price arrives in VND; stored/displayed `price` is thousands of VND after exactly one division by 1,000.
- Price-potential comparison is calculated before display conversion so both operands use the same unit.
- `market_cap_billion` is billions of VND.
- RS aliases are stable: provider stock `rs_s`, `rs_m`, `rs_l` map to the read-model's short/medium/long semantics; currently the homepage exposes RSs and RSm.
- Missing provider values remain null. Never infer zero.
- Unknown provider fields live under `kfsp_metrics.unmapped`; known English keys must stay stable across contract versions.

## Operations runbook

### Healthy daily run

Check all of the following, not only HTTP success:

- latest `kfsp_rating_sync_runs.status = 'completed'`;
- `published_row_count` equals the expected/staged count;
- latest published date is coherent for ICT;
- distinct tickers equal row count;
- exact Top 100 count is 100;
- sector count and representative sector totals are plausible;
- representative price, CANSLIM, 4M, RS, RRG, weekly/monthly, and rating values render correctly;
- browser console is clean and authenticated `/insights` shows `Supabase live`.

Useful read-only SQL shape (run from a protected session; never paste secrets):

```sql
select as_of_date, count(*) as rows, count(distinct ticker) as tickers,
       count(*) filter (where is_top100) as top100,
       count(distinct sector) as sectors
from public.insights_stock_ratings
where source = 'kfsp' and is_published
group by as_of_date
order by as_of_date desc
limit 7;

select id, as_of_date, status, staged_row_count, published_row_count,
       error_message, started_at, completed_at
from public.kfsp_rating_sync_runs
order by started_at desc
limit 10;
```

### Failed run triage

1. Inspect the latest run status/error and Edge Function logs.
2. Classify: missing configuration, provider auth, timeout, primary contract drift, supplemental failure, invalid rows, or publish failure.
3. Confirm the previous published date is still visible.
4. Never lower `KFSP_MINIMUM_ROWS` merely to force a partial publish.
5. If credentials were rotated, update Edge Function secrets and the matching Vault sync secret without committing values.
6. Run one bounded machine sync, confirm database counts, then smoke actual UI fields.

Supplemental CANSLIM/4M failure is intentionally non-fatal when the primary snapshot remains valid; missing components stay null. Primary data failure is fatal.

### Contract drift

- Compare provider response keys with `kfsp-catalog.ts`.
- Add stable English mappings and tests; keep unknown keys under `unmapped` during investigation.
- Verify parallel provider arrays are aligned by ticker, not merely by position after filtering.
- Recheck units with representative raw-to-published values.
- Increment/define contract version semantics when a stored contract changes materially.

## Deployment protocol

- Database migration changed: `npx supabase db push` immediately after validation.
- Edge Function changed: `npx supabase functions deploy kfsp-rating-sync --no-verify-jwt` immediately after validation.
- Web release: merge one validated change to `main`; Vercel Git Integration creates the only production deployment.
- Do not run a manual Vercel production deployment for the same release.
- Documentation-only changes should pass build-impact checks and do not justify a runtime deployment.

## Validation matrix

For runtime Insights changes run:

```bash
pnpm test:core
pnpm lint:touched
pnpm typecheck
pnpm scan:secrets
pnpm exec next build --webpack
git diff --check
```

Then perform authenticated browser QA from `docs/insights-design.md`. For docs-only changes, run at least `pnpm test:build-impact`, `pnpm scan:secrets`, link/path checks, and `git diff --check`.

## Current production baseline

- Final verified web commit: `b635a4d`.
- Production Insights release initialized with snapshots for 2026-08-22 and 2026-08-23, each containing 1,752 rows and 31 sectors; each snapshot has exactly 100 Top 100 rows.
- 1D comparisons are available. 7D/30D remain `—` until sufficient real history exists.
- This baseline is time-specific. Re-query production before reporting it as current.

## First follow-up recommendation

Implement a bounded, authenticated full-sector detail read path. It resolves the most important semantic mismatch: all-stock aggregate counts versus top-500-ranked drill-down rows. Do not expand the initial page payload to all detailed metrics for every stock; load a selected sector on demand and paginate.

