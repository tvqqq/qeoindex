# Insights design specification

Last updated: 2026-09-04.

This is the active UX contract for `/insights`. Data/source semantics are owned by `insights-homepage.md` and `insights-handover.md`; mandatory performance rules are owned by `UI_LESSONS_LEARNED.md`.

## Design intent

Insights keeps the information density of a Vietnamese market board while remaining readable and calm. Use high-contrast data, restrained accents, bounded shadows/gradients, clear Vietnamese labels, keyboard-accessible controls and reduced-motion-safe transitions.

Persistent backdrop blur/filter layers are prohibited around chart-heavy or dense-table surfaces unless profiling proves them safe.

## Canonical-universe behavior

- Any stock view labelled as the QeoIndex canonical universe uses the latest published `vn_top_stocks`, capped at 200.
- Do not hard-code “Top 100”, `hose_top100`, or a fixed 100-row badge/acceptance rule.
- `Tất cả` or provider-wide/sector views may contain a different number of rows when that is the explicit product scope; label the scope honestly.
- Missing metrics stay `—`; sorting/filtering must not turn `null` into zero.

## Layout

- Route: `/insights` within the authenticated application shell.
- Desktop content remains a wide market-intelligence dashboard with responsive gutters and no unnecessary forced horizontal page width.
- Main information flow: market state → sector context → stock comparison → stock detail/research.
- Rating table keeps a compact 11-column analytical layout: identity, price/change, CANSLIM, 4M, price potential, RSs, RSm, RRG, weekly change, monthly change, Qeo composite.
- Every sortable column exposes the active sort direction and remains keyboard-operable.

## Metric explainability

`Hiểu các chỉ số` is the primary help entry point. Metric labels/tooltips must explain:

- what the metric measures;
- provider/Qeo ownership;
- normal scale or state labels when known;
- important anti-confusions such as RS-S vs RSI vs RRG;
- that comparison scores are evidence, not trading commands.

Deep links may focus a metric inside the guide, but motion must respect `prefers-reduced-motion`.

## Stock detail information architecture

Use one navigation level:

```text
Tổng quan | Thông tin doanh nghiệp | Phân tích TA | TTAI
```

The header keeps stock identity, exchange/sector, snapshot date, price/change and Qeo composite concise. If canonical-universe membership is shown, use current published membership semantics rather than a legacy Top-100 badge.

### Tổng quan

Answer the first-pass questions quickly:

- Qeo composite and Qeo state;
- CANSLIM / 4M;
- relative-strength/momentum evidence;
- market/trend/risk context;
- compact FA/TA summaries;
- state/rating history from real published snapshots only.

Do not synthesize historical points when persisted history is sparse.

### Thông tin doanh nghiệp

Group company reference and fundamental metrics by investor purpose:

- identity/reference information;
- valuation/per-share metrics;
- latest financial snapshot;
- growth;
- profitability.

Provider fair-value/price-potential fields must not be relabelled as an independent Qeo intrinsic-valuation model.

### Phân tích TA

Group:

- multi-horizon price performance;
- price vs SMA trend evidence;
- RSI/MACD/Bollinger signals when supplied;
- range context;
- liquidity;
- foreign/proprietary flow;
- beta/risk context.

Do not infer numeric positions or states from text labels when the underlying numeric evidence is unavailable.

### TTAI

Preserve provider semantics and provenance:

- RS-S stock/sector history;
- categorical stock/sector RRG history;
- 4M history/components;
- CANSLIM history/components.

Do not invent RRG coordinates when the provider exposes only quadrant/state labels. Do not claim undisclosed component weighting formulas.

## Data-to-presentation rule

Storage/provider grouping does not dictate UI tabs. Regroup fields by investor question, while keeping stable source keys and provenance in code/storage. Trading-flow fields belong in TA even when an upstream payload groups them under general metadata.

## Typography and density

- Prefer short headings and tabular figures for numeric stability.
- Compact labels need accessible definitions.
- Vietnamese product labels are preferred; stable English keys stay in code/storage.
- Avoid decorative effects that increase repaint/compositing cost without analytical value.

## Motion and performance

- Transition only properties that need animation; do not use `transition-all` on dense/realtime surfaces.
- Honor `prefers-reduced-motion`.
- Avoid animated row reordering.
- Keep chart/container dimensions stable to prevent resize/repaint loops.
- Dense ticker links should follow the repository intent-prefetch rules.

## Accessibility

- Dialogs expose accessible title/description and restore focus.
- Tabs use correct tablist/tab/tabpanel relationships.
- Pointer-activated rows also support keyboard activation.
- Sort state is announced.
- Color is reinforced by text/icon meaning.
- Tooltips are supplemental; essential meaning is available without hover.

## Empty/loading/error states

- Missing field: `—`.
- Missing history: explicit insufficient-history state; no synthetic dates/scores.
- Backend unavailable/no healthy published snapshot: explicit degraded/unavailable state.
- Partial provider batches never masquerade as a healthy published snapshot.

## Visual QA matrix

For material table/detail changes verify at minimum:

1. canonical published universe, sector/provider-wide scope, search and sorting;
2. positive, negative, zero and missing values;
3. long Vietnamese labels and all supported RRG states;
4. stock detail with sparse and rich history;
5. all four detail tabs without nested metric-tab sprawl;
6. keyboard open/close, focus restoration, tooltip alternatives and reduced motion;
7. representative mobile/tablet/desktop/wide viewports (around 390, 768, 1440, 1920);
8. no unintended document overflow, console errors or request storms.

Source-contract tests do not replace real-browser visual QA.
