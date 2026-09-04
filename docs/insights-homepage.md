# Insights homepage

This is the architecture overview. Supporting documents:

- Delivery status, limits, and roadmap: `docs/insights-plan.md`
- Exact formulas and state thresholds: `docs/insights-rating-model.md`
- UX, visual language, responsive and accessibility contract: `docs/insights-design.md`
- Engineering and operations runbook: `docs/insights-handover.md`
- Planned metric explainability and AI Council semantic-grounding handoff: `docs/insights-explainability-ai-council-handoff.md`
- Researched end-of-day market snapshot, collection, and complete UI plan: `docs/insights-market-close-plan.md`

`/insights` is the market-intelligence landing page for every signed-in user. It requires Supabase Auth but no separate feature entitlement. Anonymous users remain behind the existing login gate; the feature does not weaken the auth boundary of `/`, `/research/*`, or any write/operational API.

## Data ownership

- VNIndex: existing bounded server-side TradingView/VPS snapshot plus DNSE five-minute history.
- Daily KFSP ratings: Supabase Postgres is canonical. Signed-in users may select only published, browser-safe columns through RLS and column grants. Provider credentials, cached tokens, staging rows, raw payloads, and sync diagnostics remain service-role only.
- Research context: existing Notion read-models remain canonical for theses, Scanner, Signals, FA, and research summaries. KFSP high-frequency snapshots are intentionally not duplicated into Notion.
- Until the first complete provider snapshot is published, the UI shows an explicitly labelled preview dataset.

## Rating UX & Metric Explainability

- The desktop table uses an 11-column, full-width market-board layout that fits without a forced horizontal minimum width. It defaults to Top 100; selecting `Tất cả` shows a sector read-model with stock count, Top 100 count, summed capitalization, averaged scores/returns, and dominant sector RRG. Sector aggregates use the full current snapshot; clicking a sector filters the ranked detailed read-model, currently capped at the top 500 composite rows plus the exact Top 100. See the plan for the full-sector drill-down follow-up.
- Visible stock metrics are price, CANSLIM, 4M, price potential, RSs, RSm, stock RRG, weekly/monthly change, and composite rating. Every visible column remains sortable; icon/color semantics are shared with the detail dialog.
- **Progressive Disclosure & Semantic Guide**: The page header exposes a `Hiểu các chỉ số` action and reading order guide (`Đọc theo thứ tự: thị trường → ngành → cổ phiếu. Điểm cao giúp so sánh, không phải lệnh mua.`). Clicking any market card, column header, or score pill deep-links directly into the `MetricGuideDialog` with search, category filtering, 60s learning path, and anti-confusion warnings (e.g. RSs vs RSI vs RRG).
- **AI Council Semantic Grounding V2**: AI Council LLM debates consume point-in-time Packet V2 (`INSIGHTS_METRIC_GUIDE_VERSION = "metric-guide-v1"`), structured metric dictionary, 10 mandatory grounding rules, and validate 1–4 structured `evidenceRefs` against actual observed packet values. Raw evidence is opt-in server-only and not leaked into client page bundles.
- Daily snapshots are retained. The read-model selects the latest real snapshot on or before 1D, 7D, and 30D targets; missing history displays `—` and is never interpolated. Radar overlays, per-dimension deltas, and the rating timeline expand automatically as cron history accumulates.

## QeoIndex state model

`modules/research/insights/rating-model.ts` owns the pure, tested calculation. All outputs are clamped to 0–100:

- **Trend:** RSs/RSm, weekly/monthly returns, price potential, and stock RRG.
- **Accumulation:** CANSLIM/4M quality, RS/RRG support, and a preference for controlled rather than extreme heat.
- **Risk:** beta, downside returns, weak composite score, and adverse stock/sector RRG.
- **Heat:** weekly/monthly momentum, RSI, RSs, and price potential.
- **Sustainability:** CANSLIM, 4M, composite rating, RSm, sector RRG, and inverse risk.

The state label follows explicit thresholds in that module. Exact formulas, normalization, missing-value behavior, aggregation, and state precedence are documented in `docs/insights-rating-model.md`. Changes require updating its unit tests and that document.

## Daily ingestion pipeline

`supabase/functions/kfsp-rating-sync/index.ts` is a machine-only Edge Function:

1. Verify `X-KFSP-Sync-Secret` with constant-time comparison.
2. Reuse a still-valid provider token from the service-role-only `kfsp_provider_tokens` table, or log in with Edge Function secrets and rotate the cache.
3. Call the KFSP filter endpoint with an eight-second provider timeout, then request the watchlist CANSLIM supplemental endpoint in bounded ticker batches. Supplemental failures are non-fatal so the primary daily snapshot can still publish.
4. Merge supplemental records by `mack`, then normalize the provider's parallel arrays by ticker into English-keyed metric groups using `supabase/functions/_shared/kfsp-catalog.ts`.
5. Validate tickers, duplicate rows, batch size, and score ranges; stage the complete snapshot under one sync-run UUID.
6. Call `publish_kfsp_rating_snapshot`, which replaces that day's KFSP rows and marks them published in one database transaction.

The QeoIndex composite score is the arithmetic mean of the available KFSP 4M, CANSLIM, stock RS-S, and sector RS-S values. This is a QeoIndex comparison score, not a provider recommendation. The canonical Top 100 array is shared with the market-board universe.

The live filter contract currently sends `gia_hien_tai` in VND, while QeoIndex displays and stores the browser-safe `price` column in thousands of VND. The sync normalizes that unit once before publishing. Price-potential ratios are calculated before that display conversion so estimated value and market price remain in the same unit. It also aliases provider `rs_s_co_phieu`, `rs_m_co_phieu`, and `rs_l_co_phieu` into the stable `rs_short`, `rs_medium`, and `rs_long` read model. Missing 4M/CANSLIM components stay nullable in storage; the UI uses the composite score as the documented visual fallback instead of converting SQL `null` to zero.

Supabase Cron runs at `0 0 * * *` UTC, equivalent to 07:00 Asia/Ho_Chi_Minh. It reads the request secret from Vault key `kfsp_sync_secret`. An incomplete batch fails closed and leaves the last published snapshot untouched.

## Production configuration

Set the following Edge Function secrets without committing their values:

```bash
npx supabase secrets set KFSP_USERNAME=... KFSP_PASSWORD=... KFSP_SYNC_SECRET=... KFSP_MINIMUM_ROWS=50
```

Create or rotate the matching Vault secret from a protected SQL session:

```sql
select vault.create_secret('<same-random-sync-secret>', 'kfsp_sync_secret');
```

If `kfsp_sync_secret` already exists, update that secret instead of creating a duplicate name. Never paste the provider JWT into source, Vercel variables, documentation, or browser code; the Edge Function owns login and token renewal.

Deploy resource changes according to repository invariants:

```bash
npx supabase db push
npx supabase functions deploy kfsp-rating-sync --no-verify-jwt
```

Then invoke one authenticated machine sync and confirm `published_count`, latest `kfsp_rating_sync_runs.status = 'completed'`, and visible `/insights` values. The user-provided `script.md` was treated as provider-contract evidence only; any credential-like content in it is not copied into the repository.

## Failure handling

- Missing secrets: Edge Function returns a configuration error; cron cannot publish partial data.
- Provider auth expiry: one forced login/refresh is attempted after HTTP 401/403.
- Contract drift: unknown provider keys are retained under hashed English-neutral keys in `kfsp_metrics.unmapped`; known output keys remain stable.
- Partial/invalid snapshot: the run is marked failed, staging is not published, and the previous good date remains readable.
- The signed-in UI reads only the latest published `source = 'kfsp'` date and never mixes dates.

## Rollout status (2026-08-23)

Migration `20260822112420_kfsp_rating_pipeline.sql`, the Edge Function, the nine-group catalog, and the interactive UI are live in production. Both 2026-08-22 and 2026-08-23 published 1,752 distinct tickers across 31 sectors, including exactly 100 canonical Top 100 rows. The daily 07:00 ICT cron remains enabled. This count is a time-specific baseline, not a permanent invariant; future releases must re-query sync counts and representative rendered values because a successful provider request alone does not prove field aliases or units are correct.
