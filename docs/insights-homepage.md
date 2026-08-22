# Insights homepage

`/insights` is the market-intelligence landing page for every signed-in user. It requires Supabase Auth but no separate feature entitlement. It does not change the auth boundary of `/`, `/research/*`, or any write/operational API.

## Data flow

- VNIndex: existing bounded server-side TradingView/VPS snapshot plus DNSE 5-minute history.
- Rating table: `public.insights_stock_ratings` in Supabase. Only `authenticated` can select rows marked `is_published`; `anon` receives no table or column grant. Trusted cron ingestion uses the server-only service role. Until the first cron snapshot exists, the UI displays an explicitly labelled preview dataset.
- Research modules: authenticated, bounded summaries built server-side from the same cached Notion read-models used by Scanner, Signals, and Research. FA uses the existing dated Top 100 snapshot.
- No Notion token, Supabase service-role key, provider credential, write control, or raw research record is sent to the browser.

## Rating interaction

- The table exposes technical, momentum, money-flow, fundamental, and overall score pills when viewport width allows; smaller screens retain the core stock/price/rating columns.
- Hovering a ticker opens an accessible shadcn tooltip with the company profile and market snapshot.
- Clicking or keyboard-activating a row opens an accessible shadcn dialog with score structure, market metrics, provenance, and a link to the protected ticker research page.
- The modal chart is explicitly a current score profile. Do not label it as historical time series until the daily rating cron has accumulated and the read model returns dated history.

## Rating ingestion contract

The future daily job should normalize the third-party response and upsert by `(as_of_date, ticker, source)`. Validate ticker, composite/component scores `0..100`, non-negative price, and provider provenance before setting `is_published = true`. The current component mapping is: technical = `score_4m`, momentum = `stock_rs_score`, money flow = `sector_rs_score`, and fundamental = `canslim_score`; missing component values fall back to `composite_score`. Write with `SUPABASE_SERVICE_ROLE_KEY`; never expose it in `NEXT_PUBLIC_*`.

Recommended sequence: fetch with a bounded timeout, validate the complete batch, upsert unpublished rows, verify counts/ranges, then publish the completed date. The homepage always reads the latest published date and never mixes snapshots from different dates.

## Rollout status (2026-08-22)

Production migration history was fetched and reconciled into this checkout. The existing empty `insights_stock_ratings` table is reused. `20260822092848_require_auth_for_insights_stock_ratings.sql` is applied in production: anonymous reads are denied, authenticated reads are limited to published rows, and `is_published` provides the atomic batch boundary for the future cron.
