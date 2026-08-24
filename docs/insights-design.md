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
| Cổ phiếu / Ngành | 20% | Identity, rank/count, logo, ticker, sector with sector icon |
| Giá / Biến động | 8% | Giá và thay đổi ngày theo style bảng điện |
| CANSLIM | 8% | Emerald score pill |
| 4M | 7% | Amber score pill |
| Tiềm năng giá | 9% | Direction text/icon |
| RSs | 6% | Cyan score pill |
| RSm | 6% | Violet score pill |
| RRG cổ phiếu/ngành | 10% | State badge with icon and label |
| Biến động tuần | 8% | Signed green/red percent |
| Biến động tháng | 8% | Signed green/red percent |
| Rating tổng hợp | 10% | Strong score badge and detail affordance |

## Rating table interaction & Metric Explainability

- Default universe is **Top 100**.
- **Tất cả** shows expandable sector parent rows when sector is “Tất cả ngành” and search is blank.
- Sector parents expose aggregates for CANSLIM, 4M, RSs, RSm, RRG, weekly/monthly changes, and composite rating.
- Selecting an individual sector or entering a search query switches to the flat detailed stock row view.
- Every visible column is sortable; active direction is visible and keyboard-operable.
- Stock identity hover opens an accessible summary tooltip.
- Clicking a stock row opens the detail dialog. Enter and Space perform the same action.
- **Metric Guide Dialog (`Hiểu các chỉ số`)**:
  - Entry points: Primary header button `Hiểu các chỉ số`, pulse card info buttons, column header info icons, and `ScorePill` tooltip action `Xem hướng dẫn chi tiết`.
  - Progressive disclosure: "Bắt đầu trong 60 giây" highlights the 4-step quick read. 4 categorized tabs ("Tất cả", "Chất lượng DN", "Sức mạnh & Luân chuyển", "Rủi ro & Định giá").
  - Deep-linking & smooth scroll: Opening the dialog with a `metricKey` automatically switches to the matching tab, smoothly scrolls the target metric card into view, and highlights it with a cyan pulsing ring for 2 seconds.
  - Semantic tooltips: All metric labels and score pills render instant tooltip definitions with purpose, typical ranges, and explicit anti-meanings (e.g. RSs != RSI != RRG).

## Stock detail dialog — grouped dashboard IA

The detail popup uses **one navigation level only**. Company reference data and FA metrics share one coherent business-information surface, leaving four semantic tabs:

```text
Tổng quan | Thông tin doanh nghiệp | Phân tích TA | TTAI
```

`TTAI` is the product-facing name for the provider analytical layer. Storage/provider names such as `KFSP_GROUPS`, `kfsp_*` columns, Supabase payloads, and ingestion contracts remain unchanged.

### Header

The header stays compact and always visible:

- stock logo, ticker, company name;
- exchange, sector, snapshot date;
- current price and daily change;
- Composite Rating;
- Top 100 badge when applicable.

The Wyckoff deep-analysis action is not part of the draggable header or a footer. It occupies a dedicated action area on the right side of the modal navigation row.

The former three persistent summary cards above the tabs are removed. Their useful information is promoted into the `Tổng quan` dashboard so content is not duplicated and the popup spends less vertical space before analysis begins.

### 1. Tổng quan

Purpose: answer the first-pass investor questions in roughly 5–10 seconds.

Primary KPI row:

1. **Composite Rating** + QeoIndex state.
2. **CANSLIM / 4M** with compact progress bars.
3. **RS Momentum** using RSs/RSm and 7D/30D changes.
4. **Market state** using RRG, RSI, Beta, and SMA alignment count.

Dashboard modules:

- **Left column**: vertically balanced, equal-height **FA quick read** and **TA quick read** widgets.
- **Right column**: QeoIndex state radar, compact performance bars, and range/liquidity context.
- **Accumulation/state matrix**: always visible; no dropdown/progressive-disclosure wrapper.
- **Rating theo thời gian**: a standalone sibling module beside the accumulation/state matrix, never nested inside it.

Historical analytical UI must use published snapshots only. Do not synthesize fake dates/scores when history is sparse. Missing provider fields remain `—`.

### 2. Thông tin doanh nghiệp

This tab combines company/reference data and FA analysis:

- company name;
- charter capital;
- market capitalization;
- shares outstanding;
- website;
- Free Float;
- foreign ownership room remaining.

FA groups in the same tab:

- valuation and per-share metrics;
- latest financial snapshot;
- growth drivers;
- profitability.

`GDNN ròng` and `GDTD ròng` are intentionally **not** treated as company metadata even though the provider currently places them in the `general` group. They are displayed under TA as trading-flow information.

FA is grouped by analytical purpose instead of raw provider sub-tabs.

**Định giá**

- EPS-TTM and growth;
- P/E-TTM;
- BVPS-TTM and growth;
- P/B-TTM.

**Financial snapshot**

- latest financial period;
- net revenue TTM;
- net income TTM.

**Tăng trưởng**

- revenue growth;
- net income growth;
- EPS growth;
- BVPS growth.

**Khả năng sinh lời**

- net margin;
- ROA;
- ROE.

Provider-derived fair value / price-potential semantics must not be relabeled as an independent QeoIndex intrinsic valuation model.

### 3. Phân tích TA

TA combines the former price volatility, price range, liquidity, technical, and trading-flow views.

**Momentum**

- 1D → 1Y performance bars.

**Trend**

- zero-centered price-vs-SMA10/20/50/100/200 bars;
- derived summary `giá trên N/5 SMA`, clearly presented as a QeoIndex view of provider inputs.

**Oscillators**

- RSI on a 0–100 band with 30/70 reference zones;
- MACD vs Signal state;
- Bollinger position.

**Price range**

- 10D / 20D / 50D / 52W range width and provider position text;
- distance to 52W high and low.

Do not infer a graphical position from a provider text label when the underlying numeric position is unavailable.

**Liquidity & flow**

- volume today vs 10D/20D/50D averages;
- traded value today vs 10D/20D/50D averages;
- volume/value vs previous session;
- net foreign trading;
- net proprietary trading;
- Beta as risk/volatility context.

### 4. TTAI

TTAI preserves KFSP provider semantics while presenting the data as history-oriented dashboards:

- **RS-S stock vs sector**: two-line daily history chart;
- **RRG cổ phiếu**: categorical quadrant-state trajectory;
- **RRG ngành**: categorical quadrant-state trajectory;
- **Điểm 4M**: quarterly score history plus latest component radar;
- **Điểm CANSLIM**: quarterly score history plus latest component radar.

Do not conflate provider `RS-S` scores with the TA `RSs/RSm` terminology. The daily provider pipeline currently maps `rs_short` to stock RS-S for compatibility, but TTAI explicitly labels the stock/sector provider scores.

Current snapshots expose RRG state labels but do not expose raw two-dimensional RRG coordinates. The TTAI RRG visualization must therefore remain explicitly categorical and must not invent provider RS-Ratio/RS-Momentum values.

4M/CANSLIM component tooltips explain the provider criterion meaning where supported, but must not claim a weighting formula that the provider response does not disclose.

See `docs/insights-ttai-history.md` for storage, parsing, sync trigger, and RLS details.

## Data-to-presentation mapping

| Provider/storage group | Presentation |
| --- | --- |
| `overview` | Selected first-pass metrics in Tổng quan |
| `general` company/reference fields | Thông tin doanh nghiệp |
| `general` trading-flow fields | Phân tích TA |
| `valuation` | Thông tin doanh nghiệp |
| `fundamentals` | Thông tin doanh nghiệp |
| `price_volatility` | Phân tích TA |
| `price_range` | Phân tích TA |
| `liquidity` | Phân tích TA |
| `technical` | Phân tích TA |
| `kfsp` | TTAI current snapshot metrics |
| `kfsp_ttai_quarterly_history` | TTAI 4M/CANSLIM quarterly history |
| daily `insights_stock_ratings` history | TTAI RS-S/RRG history + Tổng quan Rating/State history |

The UI regrouping does not rewrite the provider contract. TTAI quarterly history adds a dedicated normalized table because the provider chart endpoint returns historical score/component data that is not present in the daily snapshot contract.

## Typography and density

- Plus Jakarta Sans is the main application font.
- Headings are large, bold, and short; body copy remains readable at normal zoom.
- Financial values use tabular/monospace figures for stable alignment.
- Compact labels require accessible tooltips or full names.
- Vietnamese labels are used in product UI; stable English keys remain in code/storage.

## Motion

- Use existing SmoothUI/motion patterns for entry, progress, and modal transitions.
- Motion communicates state change rather than decorating every data update.
- Honor `prefers-reduced-motion`.
- Avoid animated row reordering in market tables.

## Accessibility checklist

- Dialog has an accessible title/description and restores focus through the shadcn primitive.
- Tab navigation exposes `tablist`, `tab`, `aria-selected`, `aria-controls`, and `tabpanel` relationships.
- Rows activated by pointer also support Enter/Space.
- Sort controls expose column and direction.
- Tooltips are supplemental; essential information is available without hover.
- Color is reinforced by text/icon meaning.
- Verify zoom, reduced motion, and keyboard-only navigation before release.

## Empty, loading, and error states

- Missing field: `—`.
- Missing history: no synthetic history; show the explicit insufficient-history state.
- Quarterly history schema unavailable: keep daily RS-S/RRG usable and label the quarterly-history gap.
- Backend unavailable/no published snapshot: keep the existing labeled degradation behavior.
- Partial provider batches never reach the UI because publish fails closed.

## Visual QA matrix

For changes to the table or detail dialog, verify at minimum:

1. Top 100 default, sector filter, search, and column sorting.
2. `Tất cả` sector groups and expand/collapse behavior.
3. Positive, negative, zero, and missing values.
4. All RRG states and long Vietnamese labels.
5. Detail dialog with one snapshot and multiple snapshots.
6. All four detail tabs with no nested metric-tab navigation.
7. TTAI daily history with one/many points and quarterly history with one/many periods.
8. Keyboard open/close, focus restoration, tooltip alternatives, reduced motion.
9. Viewports near 390, 768, 1440, 1920; record horizontal overflow.
10. Browser console and network errors.
