# Insights architecture

Last updated: 2026-09-04.

`/insights` is the authenticated market-intelligence surface. This document describes the current architecture; provider-level collection details live in `insights-handover.md`, formulas in `insights-rating-model.md`, and UI behavior in `insights-design.md`.

## Source-of-truth boundaries

- **Operational storage:** Supabase Postgres. Browser reads use published, RLS-safe read models only.
- **Market/sector evidence:** KFSP market-insight collection is staged and atomically published; missing/partial required evidence fails closed and never replaces the last healthy snapshot.
- **Stock ratings/TTAI:** KFSP-derived daily/quarterly evidence is normalized server-side and persisted to Supabase. Provider credentials, token cache, staging data and diagnostics remain service-role only.
- **Canonical stock universe:** use the latest published `vn_top_stocks` membership, capped at 200. Do not hard-code Top 100 membership or use a legacy Notion universe as an operational source.
- **Research/analytical context:** downstream research systems may enrich analysis, but cannot rewrite published operational market evidence.

## Canonical workflow

Daily ratings refresh independently at its owned schedule. The trading-session EOD path participates in the canonical `supabase-first-eod-v4-dag`:

```text
KFSP_RATING_REFRESH
  -> TTAI_REFRESH + MARKET_CLOSE_COLLECT
  -> EOD_READY
  -> HISTORY_REFRESH
  -> WYCKOFF_BUILD
  -> SUPABASE_VALIDATE
  -> SUPABASE_PUBLISH
  -> deterministic AI Council
  -> market synthesis / selective LLM / retention / analytical summary
  -> COMPLETE
```

`MARKET_CLOSE_COLLECT` owns the final market/sector snapshot used by Insights. Scheduler dispatch is not success; inspect durable run/phase evidence.

## Rating and metric semantics

- Visible provider metrics keep provider meaning after documented unit normalization. Missing values remain `null` and render as `—`; do not synthesize history or fill one metric from another.
- `kfsp_composite_score` is a legacy DB column name. The value is the **Qeo composite**, derived from available KFSP 4M, CANSLIM, stock RS-S and sector RS-S values. Product copy must not present it as a proprietary KFSP composite model.
- `modules/research/insights/rating-model.ts` owns the tested Qeo state/radar heuristic. If formulas or thresholds change, update its tests and `insights-rating-model.md` in the same change.
- RRG state labels are categorical unless the provider supplies real coordinates. Do not invent RS-Ratio/RS-Momentum coordinates.
- Historical UI uses persisted published snapshots only; missing dates are not interpolated.

## Universe semantics

Any component that means “the QeoIndex canonical stock set” must resolve current published `vn_top_stocks` membership. A component may deliberately use another dataset when its product semantics require it—for example a provider-wide sector snapshot or a liquidity-filtered bubble view—but it must label that scope and must not call it the canonical universe.

The bubble view may return fewer than 200 names after its explicit liquidity/data-quality filters. That is not a universe integrity failure.

## Security

- `/insights` requires the authenticated application boundary.
- Client code receives only browser-safe published columns.
- Machine sync endpoints and provider credentials stay server-side.
- No bearer token, provider password/JWT, Vault value, or secret-bearing URL belongs in source, logs, docs, or client bundles.
- Partial provider data must not be published merely to keep the UI fresh.

## UI contract

- Metric guide copy teaches the reading order and explicitly states that scores support comparison rather than acting as buy/sell commands.
- Sorting/filtering must operate on the loaded dataset without fabricating absent values.
- Stock detail uses the four-domain information architecture documented in `insights-design.md`: Tổng quan, Thông tin doanh nghiệp, Phân tích TA, TTAI.
- Material chart/table changes must follow `UI_LESSONS_LEARNED.md`: avoid persistent expensive blur/filter layers, keep dense interactions bounded, and perform real-browser QA.

## Failure behavior

- Missing required provider secrets/configuration: fail with an explicit configuration error.
- Provider auth expiry: use the bounded refresh/re-login behavior owned by the server collector.
- Provider contract drift: fail/diagnose rather than silently remap unknown semantics into a known metric.
- Partial/invalid snapshot: leave the previous healthy published snapshot untouched.
- Missing optional field/history: render `—` or an explicit insufficient-history state.

## Verification

For a material Insights change, run at minimum the repository PR gate plus the relevant domain tests and build:

```bash
pnpm verify:pr
pnpm test:council
pnpm build
```

When collection/storage changes, also run the targeted market-insight/DB tests and the DB gates required by `HANDOVER.md`. Material UI changes require real-browser desktop/mobile verification; source-contract tests are not pixel QA.

Production acceptance checks actual current snapshot dates, row/sector coverage, representative provider values, browser errors, and the relevant EOD phase evidence. HTTP 200 or scheduler dispatch alone is insufficient.
