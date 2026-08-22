# Insights homepage

`/insights` is the market-intelligence landing page for every signed-in user. It requires Supabase Auth but no separate feature entitlement. Anonymous users remain behind the existing login gate; the feature does not weaken the auth boundary of `/`, `/research/*`, or any write/operational API.

## Data ownership

- VNIndex: existing bounded server-side TradingView/VPS snapshot plus DNSE five-minute history.
- Daily KFSP ratings: Supabase Postgres is canonical. Signed-in users may select only published, browser-safe columns through RLS and column grants. Provider credentials, cached tokens, staging rows, raw payloads, and sync diagnostics remain service-role only.
- Research context: existing Notion read-models remain canonical for theses, Scanner, Signals, FA, and research summaries. KFSP high-frequency snapshots are intentionally not duplicated into Notion.
- Until the first complete provider snapshot is published, the UI shows an explicitly labelled preview dataset.

## Rating UX

- The desktop table uses a dense market-board layout with horizontal scrolling and a sticky stock column. It defaults to the Top 100 universe, exposes sectors through a compact dropdown, and supports ascending/descending sorting on every visible column.
- Visible metrics include price, 4M, CANSLIM, price potential, liquidity, capitalization, RS/RSI, both stock and sector RRG states, price changes, valuation, and composite rating.
- Hovering a stock opens an accessible profile tooltip. Hovering a metric label or score explains its definition and provenance.
- Clicking or keyboard-activating a row opens a shadcn dialog. The dialog exposes nine groups matching the observed KFSP contract: Tổng quát, Thông tin chung, Định giá, Cơ bản, Biến động giá, Phạm vi giá, Thanh khoản, Chỉ báo kỹ thuật, and KFSP.
- Missing provider fields display `—`; the pipeline never fabricates live values. The chart is a current score profile, not a historical time series.

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

## Rollout status (2026-08-22)

Migration `20260822112420_kfsp_rating_pipeline.sql`, the Edge Function, the nine-group catalog, and the interactive UI are live in production. The 2026-08-22 initialization published 1,752 distinct tickers, including exactly 100 canonical Top 100 rows; the daily 07:00 ICT cron remains enabled. Future releases should re-check both the sync-run counts and representative rendered values because a successful provider request alone does not prove field aliases or units are correct.
