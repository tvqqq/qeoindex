# Insights Homepage architecture

Last updated: 2026-08-22

`/insights` is the public QeoIndex market/research overview. It deliberately does **not** require a Supabase user session. Detailed `/research/*` workspaces keep their existing server-auth boundaries.

## Public read flow

```text
GET /insights
  -> server Insights read model
     -> VNIndex/index snapshot cache
     -> Supabase anon client + public-read RLS -> insights_stock_ratings
     -> cached Notion research overview
     -> cached Notion Wyckoff Daily Scan
     -> cached Notion Signal UI projection
     -> current FA research snapshot
  -> server-rendered public dashboard
```

The page does not call browser-facing protected market APIs such as `/api/market/indexes`. Index data is loaded server-side through the same bounded `market-indexes-v1` cache/read path so anonymous visitors do not need the `market_board` entitlement.

## Modules

### VNIndex overview

Source: `fetchTradingViewIndexes()` through the shared index UI cache.

The module presents:

- VNINDEX value, absolute change and percentage change;
- traded value when available;
- advances / declines / unchanged breadth when the upstream source supplies them;
- VN30 / HNXINDEX / UPCOMINDEX summary cards when available.

Missing upstream fields remain visibly unavailable. The public page does not fabricate breadth or index values.

### Stock Rating table

Canonical table: `public.insights_stock_ratings`.

Schema migration: `20260822084500_insights_stock_ratings.sql`.

Important fields include:

- `as_of_date`, `ticker`, `sector`, `exchange`;
- `price`, `price_change_pct`;
- `composite_score`;
- `score_4m`, `canslim_score`;
- `stock_rs_score`, `sector_rs_score`;
- `stock_rrg_state`, `sector_rrg_state`;
- `source`, `source_url`, `raw_payload`, `fetched_at`.

The page reads only the newest available `as_of_date`, sorted by composite score. When no snapshot exists, it shows an explicit pipeline-pending state instead of demo/fake scores.

### Research-derived cards

The public homepage reuses bounded UI projections rather than reimplementing research logic:

- **Wyckoff Radar**: latest Daily Scan rows from Notion, ranked for display by Bull Probability and confidence.
- **Signal Monitor**: current Open recommendations and recent signal events from Notion.
- **Thesis Pulse**: recent Stock Thesis rows plus pending-review count from the canonical Notion research hub.
- **FA Breadth**: valuation distribution from the current FA research snapshot.

The cards are summaries. Links to `/research/scanner`, `/research/signals`, `/research`, and `/research/fa` still enter the authenticated research workspace.

## Rating ingestion contract

The third-party rating integration is intentionally separated from the homepage implementation. The future daily job should:

1. fetch the upstream rating payload server-side;
2. validate ticker and numeric score ranges before persistence;
3. normalize the source into the `insights_stock_ratings` columns;
4. upsert idempotently on `(as_of_date, ticker, source)`;
5. retain the normalized source URL/raw payload only when appropriate for debugging/evidence;
6. invalidate the `insights-ratings` UI cache after a successful batch.

Write access is **service-role/server job only**. `anon` and `authenticated` receive `SELECT` only; neither browser role receives INSERT/UPDATE/DELETE grants.

## Security model

Public access is intentional for this route.

- `AppAuthGate` bypasses only `/insights` and descendants.
- `app/research/layout.tsx` remains server-session protected.
- The rating page read uses `lib/supabase/public-server.ts`, which is built from the publishable/anon key; it never uses `SUPABASE_SERVICE_ROLE_KEY` to bypass RLS.
- `insights_stock_ratings` has RLS enabled with a public SELECT policy and no public write policy/grant.
- Existing protected market/research APIs retain their current feature/session checks.

Do not broaden the public exception to `/research/*`, `/api/market/*`, or user-owned tables merely because `/insights` is public.

## Caching and degradation

- Index snapshots: same session-aware cache as the existing market index read model; short TTL during live market hours.
- Rating snapshots: 5-minute UI cache around the latest daily Supabase snapshot.
- Research/scanner/signal modules: reuse their existing bounded Notion UI caches.
- Each upstream group is loaded with `Promise.allSettled`, so one unavailable source does not blank the entire dashboard.
- Empty/error states remain explicit. Public Insights should degrade by module, never replace missing canonical data with synthetic values.

## UI implementation

Typography is Plus Jakarta Sans through the existing `font-ticker` token. The page reuses the QeoIndex dark/neon color system and Lucide icon set.

Shadcn-compatible local primitives currently used:

- `components/ui/card.tsx`
- `components/ui/badge.tsx`
- `components/ui/table.tsx`

SmoothUI-inspired behavior is implemented locally and dependency-light:

- `ShineText`: clipped gradient sweep inspired by SmoothUI Shine Text;
- `GlowCard`: pointer-following radial glow inspired by SmoothUI Glow Hover Card.

Both respect `prefers-reduced-motion`. The implementation intentionally does not add a continuous Motion/GSAP runtime to this data-dense page; pointer glow updates CSS variables directly without React state churn.

## Validation

Minimum checks before merge:

```text
pnpm test:insights
pnpm test:core
pnpm lint:touched
pnpm typecheck
pnpm build
pnpm scan:secrets
```

For Supabase schema changes, also run Security and Performance Advisors. `unused_index` notices immediately after creating an empty rating table are informational; reassess them after the daily ingestion job has real query history.

Visual QA should cover desktop/tablet/mobile, horizontal rating-table scrolling, anonymous access to `/insights`, and authenticated navigation into the protected research sub-pages.
