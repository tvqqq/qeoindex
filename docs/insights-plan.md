# Insights delivery plan

This document is the delivery roadmap for `/insights`. It separates shipped behavior from follow-up work so implementation state is never inferred from a mockup.

## Product boundary

- Audience: every authenticated Supabase user. There is no additional Insights entitlement.
- Anonymous access: denied by the existing application auth gate and by database permissions.
- Purpose: a readable market-intelligence landing page that combines VNIndex context, daily stock ratings, and entry points into `/research/*`.
- Non-goal: trade execution, personalized advice, or reproduction of proprietary KFSP scoring logic.

## Shipped vertical slice

### Data and operations

- Supabase is canonical for daily KFSP-derived snapshots; Notion remains canonical for research/thesis modules.
- The `kfsp-rating-sync` Edge Function authenticates to the provider, normalizes the response, stages a complete batch, and atomically publishes it.
- Supabase Cron runs at 07:00 ICT (`0 0 * * *` UTC).
- Published daily snapshots are retained for real 1D/7D/30D comparisons. Missing dates are not interpolated.
- The initialization snapshot contained 1,752 stocks, 100 canonical Top 100 stocks, and 31 sectors.

### Rating experience

- Default view is Top 100.
- All 11 visible columns are sortable.
- Industry filter, search, hover profile tooltip, keyboard row activation, and stock detail dialog are implemented.
- `Tất cả` with no search/sector selection renders one aggregated row per sector.
- The detail dialog contains the five-axis QeoIndex model, state classification, snapshot deltas, rating history, and nine provider metric groups.
- The desktop table fits all 11 columns without a forced horizontal minimum width.

## Known limits

1. Sector aggregates use all current snapshot rows, but the detailed stock read-model is limited to the 500 highest composite scores plus the exact Top 100. Clicking a sector therefore drills into that ranked detailed subset, not necessarily every stock in the sector.
2. The 1D/7D/30D series uses the latest real snapshot on or before each target. A daily history younger than 7 or 30 days correctly shows `—`.
3. The state model is a deterministic QeoIndex heuristic. It has unit coverage but has not been statistically calibrated as a forecasting model.
4. The table is optimized for wide desktop screens. It compresses at narrow widths; a mobile card/table-priority design remains future work.
5. The radar and history chart use native SVG. This keeps bundle cost low but does not provide chart-library features such as zoom or crosshair.
6. Provider field availability may vary. Null values remain null and display as `—`; the UI must not turn missing values into zero.

## Roadmap

### P0 — Preserve production correctness

- Monitor the daily sync run, published row count, exact Top 100 count, sector count, field units, and representative rendered values.
- Alert on failed or abnormally small snapshots instead of silently serving a partial date.
- Keep provider credentials and raw diagnostics service-role only.
- Maintain calculation tests whenever weights, thresholds, aliases, or units change.

Acceptance: the latest completed run has a coherent date and counts, the previous good snapshot survives a failed run, and the authenticated page renders real values.

### P1 — Complete sector drill-down

- Add a bounded server endpoint or server action that loads all rows for one selected sector.
- Paginate or virtualize when the result is large.
- Preserve the existing aggregated sector read-model and clearly show result count.

Acceptance: the stock count after opening a sector equals the sector aggregate count and does not require loading all 1,752 detailed payloads on initial render.

### P1 — Model calibration and explainability

- Backtest each dimension and state against forward 5/20/60-session return, drawdown, and volatility.
- Version weights and thresholds; store the model version with derived observations if results become persisted.
- Add contribution breakdowns so users can see which inputs moved a state.
- Require product approval before wording any state as a predictive signal.

Acceptance: calibration dataset, methodology, benchmark, sample size, leakage controls, and change log are documented.

### P2 — Responsive rating views

- Define priority columns for tablet/mobile and offer an accessible row expansion or cards.
- Add viewport screenshots at approximately 390, 768, 1440, and 1920 pixels.
- Verify focus order, tooltip/dialog alternatives, contrast, and reduced motion.

### P2 — Historical analytics

- Add explicit date range and snapshot freshness indicators.
- Consider sparklines only after enough daily history exists.
- Add retention/archival policy based on measured storage and query cost.

### P3 — Operational hardening

- Add structured contract-drift metrics for mapped/unmapped fields.
- Add a restore/replay runbook for a specific provider date.
- Consider a materialized sector snapshot only if live aggregation becomes a measured bottleneck.

## Change gates

- Schema or SQL change: create a migration, review RLS/grants, run tests, and immediately apply with `npx supabase db push`.
- Edge Function change: test provider timeout/failure behavior and immediately deploy with `npx supabase functions deploy kfsp-rating-sync --no-verify-jwt`.
- UI/model change: update the relevant design/model document and regression tests.
- Production release: feature branch → validation → one merge to `main` → one Git-triggered Vercel deployment. Never create a second manual deployment for the same release.

