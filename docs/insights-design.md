# Insights design specification

## Design intent

Insights uses the information density of a Vietnamese market board without sacrificing readability. The visual language is dark, calm, and analytical: large Plus Jakarta Sans headings, high-contrast data, restrained neon accents, shadcn/ui primitives, Lucide icons, and reduced-motion-safe transitions.

## Layout

- Page route: `/insights`; authenticated application shell and top navigation remain unchanged.
- Content maximum: 1,880px with responsive page gutters.
- Main sequence: VNIndex overview → market pulse → rating table → research module cards.
- Rating table: fixed 11-column layout with percentage widths totaling 100%.

| Column | Width | Semantic treatment |
| --- | ---: | --- |
| Cổ phiếu / Ngành | 20% | Identity, rank/count, company/sector metadata |
| Giá | 8% | Price and daily change |
| CANSLIM | 8% | Emerald/green quality badge |
| 4M | 7% | Amber/yellow quality badge |
| Tiềm năng giá | 9% | Direction text/icon |
| RSs | 6% | Cyan/neon short relative strength |
| RSm | 6% | Violet medium relative strength |
| RRG cổ phiếu/ngành | 10% | State badge with icon and label |
| Biến động tuần | 8% | Signed green/red percent |
| Biến động tháng | 8% | Signed green/red percent |
| Rating tổng hợp | 10% | Strong score badge and detail affordance |

The first column receives the most space because identity and context are more important than maximizing numeric density.

## Responsive behavior

- Desktop is the primary target; all 11 columns fit without a forced `min-width` or horizontal scroll.
- Header and cell labels use compact typography; numbers use tabular/monospace treatment.
- At narrow widths the table currently compresses. Future responsive work should prioritize identity, price, rating, and RRG, then expose secondary columns through row expansion. Do not silently remove data without an accessible alternative.
- A sector group view normally has about 31 rows; Top 100 has 100 rows. Virtualization is unnecessary at current sizes but should be reconsidered for a full-sector detailed endpoint.

## Interaction contract

### Filters and sorting

- Default universe is **Top 100**.
- **Tất cả** shows sector groups only when sector is “Tất cả ngành” and search is blank.
- Selecting a sector or searching switches to detailed stock rows.
- Every visible column is sortable; the active direction is visible and keyboard-operable.
- Sector-group sorting uses the corresponding aggregate: sum for market cap, average for numeric signals, dominant value for RRG, and count/share where explicitly labeled.

### Hover and click

- Stock identity hover opens an accessible summary tooltip with company, sector, capitalization, volume, and market classification context.
- Metric info affordances explain definition and provenance.
- Clicking a stock row opens the detail dialog. Enter and Space must perform the same action.
- Clicking a sector group applies that sector filter; the footer must describe this as a drill-down into the currently loaded detailed universe until the full-sector endpoint exists.

### Detail dialog

- Maximum visual width is approximately 1,500px on large screens and remains within the viewport.
- Header: identity, latest date/provider, price/change, and composite rating.
- State panel: explicit QeoIndex heuristic label, state, and plain-language explanation.
- Radar: BULL, ACC, RISK, HEAT, SUST; current snapshot is visually primary and 1D/7D/30D are secondary overlays when available.
- Dimension cards: score, progress, 1D/7D/30D deltas, icon, and description.
- History chart: only renders when at least two real snapshots exist.
- Raw data: nine provider-aligned tabs/groups remain available so the derived model never hides source observations.

## Color and icon system

Color is reinforced by icon and text; it is never the only carrier of meaning.

| Meaning | Color family | Icon examples |
| --- | --- | --- |
| CANSLIM / positive quality | emerald | Hexagon/target |
| 4M / attention | amber | Badge/medal |
| RSs | cyan/neon | Zap/activity |
| RSm | violet | Radar |
| Dẫn dắt | emerald | Rocket |
| Phục hồi | sky | RefreshCw |
| Suy yếu | amber | TrendingDown |
| Đội sổ | rose | CircleAlert |
| Positive return | green | ArrowUp/plus text |
| Negative return | rose/red | ArrowDown/minus text |

The same semantic pairing applies in the table, tooltip, dialog, radar labels, and delta cards. Avoid introducing a second color meaning for the same metric.

## Typography and density

- Plus Jakarta Sans is the main application font.
- Headings should be large, bold, and short; body copy must remain readable at normal zoom.
- Financial values use tabular figures/monospace styling for stable alignment.
- Table labels may be compact but require tooltips or full accessible names when abbreviated.
- Use Vietnamese labels in product UI; stable English keys are reserved for code and storage.

## Motion

- Use existing SmoothUI/motion patterns for entry, progress, and modal transitions.
- Motion should communicate state change, not decorate every data update.
- Honor `prefers-reduced-motion`; no essential information may depend on animation.
- Avoid animated row reordering that makes market data difficult to track.

## Accessibility checklist

- Dialog has an accessible title/description and traps/restores focus through the shadcn primitive.
- Rows activated by pointer are also focusable and support Enter/Space.
- Sort controls expose column and direction.
- Tooltips are supplemental; essential information is available without hover.
- Icons that are decorative are hidden from assistive technology; meaningful controls have labels.
- Contrast must remain sufficient against the dark background, especially muted text and amber/violet accents.
- Verify zoom, reduced motion, and keyboard-only navigation before release.

## Empty, loading, and error states

- Loading uses the existing Insights skeleton; do not flash preview data as if it were live.
- Missing field: `—`.
- Missing history: no synthetic overlay; show `—` for the window.
- Backend unavailable/no published snapshot: explicitly labeled UI preview may render, always stating it is sample data and not advice.
- Partial provider batches never reach the UI because publish fails closed.

## Visual QA matrix

For changes to the table or dialog, verify at minimum:

1. Top 100 default, industry dropdown, search, every column sort.
2. `Tất cả` sector groups, aggregate formatting, sector RRG, and group click.
3. Positive, negative, zero, and missing values.
4. All four RRG states and long Vietnamese company/sector names.
5. Dialog with one snapshot and with multiple snapshots.
6. Keyboard open/close, focus restoration, tooltip alternatives, reduced motion.
7. Viewports near 390, 768, 1440, 1920; explicitly record any horizontal overflow.
8. Browser console and network errors.

