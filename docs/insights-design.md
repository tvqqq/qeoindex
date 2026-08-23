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
| Cổ phiếu / Ngành | 20% | Identity, rank/count, logo, ticker, sector with sector icon (company name removed in table row), chevron + sector icon in expandable view |
| Giá / Biến động | 8% | Giá và thay đổi ngày ở dòng cổ phiếu theo style bảng điện; `MarketChangePill` compact; không hiển thị giá trung bình ngành ở dòng cha |
| CANSLIM | 8% | Emerald/green score pill with glow & target icon |
| 4M | 7% | Amber/yellow score pill with glow & bolt icon |
| Tiềm năng giá | 9% | Direction text/icon |
| RSs | 6% | Cyan/neon score pill with zap icon and accessible tooltip |
| RSm | 6% | Violet score pill with radar icon and accessible tooltip |
| RRG cổ phiếu/ngành | 10% | State badge with icon and label |
| Biến động tuần | 8% | Signed green/red percent |
| Biến động tháng | 8% | Signed green/red percent |
| Rating tổng hợp | 10% | Strong score badge and detail affordance |

The first column receives the most space because identity and context are more important than maximizing numeric density.

## Responsive behavior

- Desktop (1440px / 1563px and 1920px) is the primary target; all 11 columns fit without horizontal scroll.
- Typography scale: headers use `text-xs font-extrabold uppercase`, stock ticker uses `font-ticker text-[16px] font-extrabold`, price uses `font-mono text-[14px] font-bold`, and sector tag uses `text-[11px] font-bold uppercase`.
- Numeric values use monospace/tabular figures for stable column alignment.
- A sector group view normally has about 31 rows; Top 100 has 100 rows. Child stock rows expand smoothly under their parent sector.

## Interaction contract

### Filters, sector grouping, and sorting

- Default universe is **Top 100**.
- **Tất cả** shows expandable sector parent rows when sector is “Tất cả ngành” and search is blank.
- Each sector parent row features an expand/collapse chevron, sector-specific icon, summary metadata, aggregates for CANSLIM, 4M, RSs, RSm, RRG, weekly/monthly changes, and composite rating. Average price is removed (`—`) on sector parent rows.
- Expanding a sector row renders its child stock rows directly underneath with indentation and connector line styling. Sorting configuration is preserved across parent sectors and child stock rows.
- Detail read-model notes: the children represent currently loaded detailed rows (top 500 composite + Top 100 canonical), not an exhaustive full-exchange roster.
- Selecting an individual sector in the dropdown or entering a search query switches to the flat detailed stock row view.
- Every visible column is sortable; the active direction is visible and keyboard-operable.

### Hover and click

- Stock identity hover opens an accessible summary tooltip with company, sector, capitalization, volume, and market classification context.
- Metric info affordances explain definition and provenance.
- Clicking a stock row opens the detail dialog. Enter and Space perform the same action.
- Clicking a sector parent row or chevron toggles its expand/collapse state with `aria-expanded` and keyboard navigation.

### Detail dialog

- Maximum visual width is approximately 1,440px on large screens and remains within the viewport height without overflowing the screen.
- **Header styled like Orderbook popup**: `StockLogo` (size 36) → Mã cổ phiếu (`font-ticker text-2xl font-extrabold italic bg-gradient-to-br`) → Tên công ty (`text-sm font-medium text-slate-300`) → Exchange tag (`HOSE` in rounded glass pill) → Top 100 badge. Right-side score badge is removed for clean minimalism.
- **3 Top priority summary cards**:
  1. **Sức mạnh dòng tiền (RS)**: RSs & RSm, RRG state, 7D/30D deltas (cyan neon glow).
  2. **Mô hình CANSLIM & 4M**: CANSLIM & 4M scores, P/E, P/B, Vốn hóa (emerald/amber glow).
  3. **Rating tổng hợp & Trạng thái**: Composite rating /100, Heuristic market state, Tiềm năng, RSI, Beta (violet glow).
- **Liquid glass navigation tabs**: Menu navbar style with backdrop blur, active gradient glow, and smooth animations.
- **3 Top-level navigation tabs**:
  1. **Tổng quan & Động lượng**: Git-commit history style **Accumulation & Market State Heatmap** (5 dimensions × snapshot dates with color intensity blocks and trend curve), 4 score progress cards (CANSLIM, 4M, RSs, RSm), 5-axis state radar (BULL, ACC, RISK, HEAT, SUST), and 5 dimension delta cards.
  2. **Chỉ số cổ phiếu**: Sub-tabs with top border active indicators (`border-t border-fuchsia-400 shadow-[inset_0_2px_0_rgba(217,70,239,.8)]`) and distinct icons for all 9 KFSP groups (`Gauge`, `Building2`, `BadgePercent`, `FileText`, `Activity`, `Maximize2`, `Droplets`, `LineChart`, `Sparkles`).
  3. **Lịch sử Rating**: Snapshot history line chart and historical snapshot timeline table.
- **Stable modal container**: Modal body utilizes a stable height (`min-h-[580px] max-h-[75vh]`) so toggling between tabs preserves vertical cursor stability without jumpy layout resizing.
- Compact footer: transparent QeoIndex disclaimer and direct link to research module.

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
