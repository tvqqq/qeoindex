# Insights homepage

`/insights` is the market-intelligence landing page for every signed-in user. It requires Supabase Auth but no separate feature entitlement. Anonymous users remain behind the existing login gate; the feature does not weaken the auth boundary of `/`, `/research/*`, or any write/operational API.

## Data ownership

- VNIndex: existing bounded server-side TradingView/VPS snapshot plus DNSE five-minute history.
- Daily KFSP ratings: Supabase Postgres is canonical. Signed-in users may select only published, browser-safe columns through RLS and column grants. Provider credentials, cached tokens, staging rows, raw payloads, and sync diagnostics remain service-role only.
- Research context: existing Notion read-models remain canonical for theses, Scanner, Signals, FA, and research summaries. KFSP high-frequency snapshots are intentionally not duplicated into Notion.
- Until the first complete provider snapshot is published, the UI shows an explicitly labelled preview dataset.

## Rating UX

- The desktop table uses a dense market-board layout with horizontal scrolling, a sticky stock column, Top 100 and sector filters, search, price, 4M, CANSLIM, price potential, liquidity, capitalization, RS/RSI, price changes, valuation, and composite rating.
- Hovering a stock opens an accessible profile tooltip. Hovering a metric label or score explains its definition and provenance.
- Clicking or keyboard-activating a row opens a shadcn dialog. The dialog exposes nine groups matching the observed KFSP contract: Tổng quát, Thông tin chung, Định giá, Cơ bản, Biến động giá, Phạm vi giá, Thanh khoản, Chỉ báo kỹ thuật, and KFSP.
- Missing provider fields display `—`; the pipeline never fabricates live values. The chart is a current score profile, not a historical time series.

## Daily ingestion pipeline

`supabase/functions/kfsp-rating-sync/index.ts` is a machine-only Edge Function:

1. Verify `X-KFSP-Sync-Secret` with constant-time comparison.
2. Reuse a still-valid provider token from the service-role-only `kfsp_provider_tokens` table, or log in with Edge Function secrets and rotate the cache.
3. Call the KFSP filter endpoint with an eight-second provider timeout.
4. Normalize the provider's parallel arrays by ticker into English-keyed metric groups using `supabase/functions/_shared/kfsp-catalog.ts`.
5. Validate tickers, duplicate rows, batch size, and score ranges; stage the complete snapshot under one sync-run UUID.
6. Call `publish_kfsp_rating_snapshot`, which replaces that day's KFSP rows and marks them published in one database transaction.

The QeoIndex composite score is the arithmetic mean of the available KFSP 4M, CANSLIM, stock RS-S, and sector RS-S values. This is a QeoIndex comparison score, not a provider recommendation. The canonical Top 100 array is shared with the market-board universe.

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

Migration `20260822112420_kfsp_rating_pipeline.sql`, the Edge Function, the nine-group catalog, and the interactive UI are implemented in this checkout. Production requires the three KFSP secrets plus the matching Vault secret before the first live sync can succeed.
