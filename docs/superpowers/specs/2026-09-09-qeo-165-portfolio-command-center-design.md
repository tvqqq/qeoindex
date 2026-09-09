# QEO-165 — Portfolio Command Center UI Revamp Design

Date: 2026-09-09
Issue: QEO-165 — Last: Revamp UI /portfolio
Status: Approved design, implementation not started

## 1. Goal

Revamp `/portfolio` from a dense form/table-first interface into a card-first, decision-first Portfolio Command Center while preserving the current dark purple/indigo identity and every authoritative Portfolio/Risk calculation, API, domain rule and persistence boundary.

The target visual balance is approximately 70% serious financial dashboard and 30% strategy-card gamification. Gamification is presentation only: no invented AI strength score, no fabricated bullish/bearish classification, no hidden risk formula, and no reinterpretation of existing portfolio accounting.

## 2. Product references and design principles

The inspiration from SoSanhThe is structural rather than a visual clone:

- one primary object gets strong visual prominence;
- the most decision-relevant metrics are shown before detailed rules;
- status/provenance badges are easy to scan;
- large cards and comparison/ranking patterns reduce cognitive load;
- dense details are progressively disclosed instead of displayed simultaneously;
- important text and numbers are materially larger than the current `text-xs`-heavy UI.

QEO-165 must retain the existing qeoindex brand palette, market up/down colors and current Portfolio domain semantics.

## 3. Non-goals

QEO-165 does not:

- change AVCO/accounting formulas;
- change QEO-139 sizing formulas;
- change QEO-141 Active Risk formulas;
- change QEO-142 scorecard formulas;
- change QEO-158 external-flow normalization;
- change QEO-159 concentration/diversification rules;
- add or modify DB migrations;
- add new Portfolio/Risk API behavior;
- create a recommendation engine;
- infer stock strength, attack/defense role, rarity or conviction from insufficient data;
- remove existing detailed tables/forms when they remain useful as drill-down views.

## 4. Information architecture

The five existing tabs remain authoritative navigation surfaces:

1. Tài sản
2. Nhật ký
3. Phân bổ vốn
4. Hiệu suất
5. Theo dõi

The sub-navigation remains sticky, but typography, spacing and action hierarchy become larger and easier to scan. The primary page header becomes a compact command header rather than a large marketing hero that repeats information already available in the dashboard.

### 4.1 Tài sản — Command Center / Đội hình

The Tài sản tab becomes the primary Command Center.

Order:

1. Portfolio command header + selector
2. Battle HUD summary metrics
3. Portfolio/Risk state strip
4. Tactical position-card grid
5. Allocation/concentration visualization
6. Collapsible detailed positions table

The tactical card grid becomes the default holding view. The existing detailed table remains available as `Chi tiết đội hình` for high-density inspection and sorting.

### 4.2 Nhật ký — Battle Log

Trade history is presented as a timeline/card stream first, with status chips such as OPEN, PARTIAL, CLOSED, WIN, LOSS or RISK UNKNOWN only when supported by authoritative Trade/outcome data.

Existing transaction/trade details remain available in drill-down form. No lifecycle semantics change.

### 4.3 Phân bổ vốn — War Room

The capital-allocation flow is visually reorganized into progressive stages:

1. Quân lực — Account Equity and current risk budget
2. Lệnh dự kiến — ticker, entry, stop and sizing inputs
3. Dàn quân — current exposure and concentration
4. Simulation — projected Active Risk and concentration after the planned trade
5. Command — local simulation or explicit planned Trade persistence / override audit

Advanced risk-plan forms remain accessible, but are not all visually dominant at once.

### 4.4 Hiệu suất — Campaign Results

Performance keeps all current calculations and filters while presenting the key story in this priority:

- portfolio vs VNINDEX;
- total/period performance;
- drawdown;
- equity progression;
- scorecard metrics;
- detailed ledger.

### 4.5 Theo dõi — Scouting Board

Watchlist is visually reframed as a scouting board using cards and stronger alert/tag hierarchy. It remains a watchlist, not a recommendation system.

## 5. Core visual components

New presentation components live under:

`components/portfolio/revamp/`

Planned boundaries:

- `portfolio-command-header.tsx`
- `portfolio-battle-hud.tsx`
- `portfolio-risk-state-strip.tsx`
- `tactical-position-card.tsx`
- `position-battle-rail.tsx`
- `portfolio-section-shell.tsx`
- `portfolio-command-actions.tsx`
- `tactical-status.ts`

`portfolio-page.tsx` remains the data/orchestration owner and should become smaller, not larger. New revamp components consume existing props/read models rather than refetching canonical Portfolio/Risk data independently.

## 6. Tactical position card

Each open position is represented by one card whose visual weight resembles a premium financial card, without copying any specific card artwork.

Required content when available:

- ticker as the strongest label;
- open quantity;
- current price;
- average cost;
- market value;
- unrealized P/L in VND and percent;
- target price;
- stop-loss;
- authoritative risk/concentration state where already exposed to the Portfolio UI;
- one clear `+ Lệnh` action.

Allowed badges are factual status labels such as:

- ĐANG LÃI
- ĐANG LỖ
- THIẾU STOP
- RISK WARNING
- BREACH
- UNKNOWN

QEO-165 must not introduce `Mạnh`, `Yếu`, `Tấn công`, `Phòng thủ`, rarity tiers or star ratings unless a future ticket defines deterministic source data and semantics for them.

### 6.1 Position battle rail

When stop and/or target data exists, the card may show a compact position rail:

`STOP ← CURRENT → TARGET`

The rail is a visualization of existing numeric values only. It must not imply probability of reaching either endpoint.

## 7. Battle HUD

The existing four summary concepts remain:

- NAV / market value
- unrealized P/L
- realized P/L
- number of open positions

Typography increases materially:

- principal NAV: approximately 32–40 px depending on viewport;
- key metric values: approximately 24–32 px;
- body/help text: normally 14–16 px;
- important supporting labels should not rely on 10–11 px text.

Financial metric names remain clear even if the card uses strategy-themed secondary labels such as `Quân lực`, `Diễn biến`, `Kết quả đã chốt` or `Quân số`.

## 8. Guidance dialog — Field Manual

The existing guidance popup is redesigned as a larger Field Manual.

Desktop:

- maximum width approximately `max-w-4xl` or `max-w-5xl`;
- larger title and body typography;
- chapter/sidebar navigation when space permits;
- formula and rule examples shown as clear panels rather than dense tiny text;
- scrollable content with a stable close/header area.

Mobile:

- near full-height/full-width sheet behavior;
- comfortable 14–16 px body text;
- sections remain directly tappable and readable.

All finance/risk guidance must remain consistent with current implementation. QEO-165 must not reintroduce universal silent defaults that later risk tickets intentionally removed.

## 9. Motion and interaction

Use the existing `motion` dependency; add no animation library.

Allowed motion:

- subtle card hover lift/glow on pointer devices;
- staggered first reveal;
- number/state transition where it improves comprehension;
- action success feedback;
- one-shot warning emphasis;
- subtle card perspective/tilt only on pointer-capable desktop devices.

Forbidden motion:

- continuous pulsing for normal states;
- looping decorative animation that distracts from prices/risk;
- animation that changes interpretation of market direction;
- motion that blocks interaction.

`prefers-reduced-motion` remains authoritative and disables non-essential animation.

## 10. Responsive behavior

Desktop:

- 3–4 tactical cards per row where width permits;
- summary metrics remain compact and scan-friendly;
- detailed table available below the card grid.

Tablet:

- 2 cards per row;
- command actions can wrap without clipping;
- advanced panels collapse progressively.

Mobile:

- one tactical card per row;
- no essential horizontal scrolling except intentionally dense detail tables;
- primary actions remain at least comfortable touch targets;
- status and P/L remain visible without opening details;
- dense tables become secondary, not the first viewport.

## 11. Data flow and architecture

QEO-165 is a presentation-layer refactor.

Canonical data flow remains:

- `PortfolioPage` owns portfolio selection, transactions and market prices;
- existing Portfolio/Risk contexts and APIs own risk, concentration, scorecard and planning data;
- revamp components receive typed data via props/context;
- no revamp component creates an alternate accounting/risk calculation source of truth.

Derived display-only values such as market value or unrealized P/L may continue using existing `computePortfolioPositions` outputs/current-price logic already present in the page/components.

If an authoritative risk field is unavailable at the position-card level, the card must omit that badge or show UNKNOWN only when the underlying domain explicitly defines unknown semantics. It must not reverse-engineer risk from unrelated values.

## 12. Accessibility

- interactive cards are not clickable containers unless they have a real single action;
- buttons and links remain semantic controls;
- keyboard focus states remain visible;
- status is never encoded only by color;
- tooltips/help remain keyboard accessible;
- reduced-motion is respected;
- body text and important financial labels are enlarged relative to current UI;
- contrast must remain suitable for the existing dark theme.

## 13. Error, empty and loading states

The revamp must preserve existing data-error semantics.

Required states:

- loading skeletons shaped like the new HUD/cards;
- empty portfolio has a clear first-action CTA instead of an empty table;
- missing current market price falls back only through the existing price logic;
- missing stop/risk classification remains explicit and never becomes a visual success state;
- API failures remain visible and do not silently retain stale cross-portfolio data.

## 14. Performance constraints

- no extra fetch per tactical card;
- no new per-card server request;
- memoize card-derived display data where useful;
- preserve existing dynamic imports where they materially reduce initial page cost;
- motion effects must use transform/opacity rather than expensive layout animation where possible;
- do not add heavyweight image assets solely for decorative gamification.

## 15. Testing strategy for QEO-165

Per the user instruction, full Playwright/UI acceptance from QEO-144 is postponed until after the revamp.

QEO-165 implementation still requires before merge:

- deterministic component/source contracts for the new information architecture;
- preservation tests for Portfolio/Risk boundaries;
- current regression suite;
- touched lint;
- TypeScript;
- production build;
- manual/preview visual review before production merge.

After QEO-165 lands, QEO-144 resumes and its browser acceptance targets the new UI instead of the old layout.

## 16. Acceptance criteria

QEO-165 is complete when:

1. `/portfolio` retains all five current product areas and existing behavior.
2. Tài sản defaults to tactical position cards instead of only a dense positions table.
3. The detailed positions table remains available as secondary drill-down.
4. Summary financial values use materially larger typography.
5. Guidance UI is materially larger and easier to read on desktop/mobile.
6. Phân bổ vốn exposes a progressive War Room structure without changing sizing/risk formulas.
7. Gamification uses only factual status/data and does not invent market judgments.
8. No DB migration or backend-domain behavior is introduced.
9. No per-card network fan-out is introduced.
10. Reduced-motion and keyboard interaction remain supported.
11. Existing Portfolio/Risk regressions, lint, typecheck and production build pass on the exact feature head.
12. QEO-144 browser acceptance can resume against the final QEO-165 UI without needing to reinterpret Portfolio/Risk semantics.
