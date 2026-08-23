# TTAI history dashboard and KFSP quarterly sync

## Scope

The stock detail dialog exposes `TTAI` as the presentation name for the KFSP analytical layer. The provider/storage contract remains KFSP; the rename is UI-only.

TTAI contains:

- RS-S stock versus RS-S sector daily history;
- stock and sector RRG state history;
- quarterly 4M score history plus the latest 4M component radar;
- quarterly CANSLIM score history plus the latest CANSLIM component radar.

## Overview layout

The Overview tab is decision-first:

1. top KPI strip;
2. QeoIndex state radar in the larger left column;
3. compact Performance + Range/Liquidity stack in the smaller right column;
4. FA/TA quick reads;
5. accumulation/state matrix always visible;
6. `Rating theo thời gian` is embedded under that matrix and replaces the duplicate mini Composite trend.

## KFSP fourm/canslim response normalization

The provider endpoint is configured by `KFSP_FUNDAMENTAL_HISTORY_URL` and defaults to:

`https://api.kfsp.vn/api/stocks/chart/fourm-canslim-point-chart`

Authentication uses the existing KFSP login credentials and cached provider token. Tokens are never committed or copied from browser curl commands.

Only analytical data is stored. ECharts presentation configuration (`backgroundColor`, `grid`, `visualMap`, line colors, etc.) is deliberately discarded.

Normalized table: `public.kfsp_ttai_quarterly_history`.

Each `(ticker, period)` row stores:

- `fourm_score`;
- `canslim_score`;
- `fourm_components` JSON object;
- `canslim_components` JSON object;
- normalized year/quarter;
- provider/fetch metadata.

### Important provider shape discovered from the VHM sample

The CANSLIM component table has 30 quarter headers and 30 values per criterion. The 4M component table has 30 quarter headers but only 28 values per criterion in the supplied sample. The final 4M criterion values match the provider's current radar and current Q2.26 point, so 4M component rows must be **right-aligned** to the period headers rather than left-aligned.

The sync parser applies right alignment per criterion row:

`periodOffset = headerPeriodCount - valueCount`

This avoids incorrectly assigning the latest 4M components to Q4.25 instead of Q2.26.

The provider's explicit history chart arrays are authoritative for quarterly aggregate score history. Top-level `fourm_point` and `canslim_point` overwrite the latest period score when present. Current radar series are authoritative for the latest period component snapshot.

## Sync trigger

`kfsp-ttai-history-sync` runs from pg_cron hourly at minute 17, but it does **not** call the provider every hour for every stock.

The worker compares the latest `kfsp_metrics.fundamentals.financial_period` from the daily rating snapshot with `kfsp_ttai_sync_state.financial_period`. Only tickers whose financial period changed, or which have never been backfilled, are provider-call candidates.

Why hourly instead of a hard-coded quarterly date:

- Vietnamese issuers publish financial statements on different dates;
- a fixed calendar date would either miss early releases or lag late releases;
- the daily rating pipeline already provides the observed financial period;
- an hourly lightweight database check lets history update shortly after the new report appears while actual provider calls remain quarterly per ticker.

Backfill is throttled with `KFSP_TTAI_MAX_PER_RUN` (default 12) and bounded concurrency to avoid a provider burst after first deployment.

## RRG history limitation

Current daily KFSP snapshots expose stock/sector RRG **state labels** (`Phục hồi`, `Dẫn dắt`, `Suy yếu`, `Đội sổ`) but do not expose the raw two-dimensional RRG coordinates used by the provider chart.

QeoIndex therefore renders a categorical quadrant trajectory. It does not invent RS-Ratio/RS-Momentum values. The UI explicitly labels this as a state projection. If KFSP later exposes raw X/Y coordinates, store them as separate numeric fields and replace the categorical projection with the real trajectory.

## RS history

The detail endpoint reads up to 180 published daily KFSP snapshots for the selected ticker and returns:

- stock RS-S;
- sector RS-S;
- RSm (retained for diagnostics);
- stock RRG state;
- sector RRG state.

The UI draws stock and sector RS-S as separate lines and uses only the selected ticker's history. This keeps the main `/insights` page payload small.

## Security

- `/api/insights/stock-history` requires a verified server user session via `requireApiUser()`.
- It does not accept or trust a client `user_id`.
- Browser requests use the user-scoped Supabase client and RLS.
- `kfsp_ttai_quarterly_history` is authenticated read-only.
- sync state/run tables are service-role only.
- the Edge Function uses the same constant-time `X-KFSP-Sync-Secret` pattern as the daily KFSP pipeline.
- provider credentials and tokens remain server-side only.

## Release order

1. deploy `kfsp-ttai-history-sync`;
2. apply `20260823104000_kfsp_ttai_history.sql` so the cron target exists when scheduled;
3. invoke the worker manually once for smoke/backfill validation;
4. verify history rows, RLS, and the stock-history endpoint;
5. merge the web UI branch after GitHub Verify and visual QA.
