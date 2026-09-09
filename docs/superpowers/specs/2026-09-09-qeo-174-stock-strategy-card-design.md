# QEO-174 — Stock Strategy Card UI Revamp Design

Date: 2026-09-09
Issue: QEO-174 — Revamp UI trang `/insights/[ticker]`
Status: Approved by explicit implementation request

## 1. Goal

Revamp `/insights/[ticker]` from a dark workstation with a conventional stock header into a more memorable stock **strategy-card** experience while preserving the existing chart, AI Council, watchlist, ticker switching, keyboard shortcuts, data contracts and financial semantics.

The target balance is approximately **70% serious financial workstation / 30% strategy-card gamification**. The page should feel like each ticker is a collectible tactical card, but every displayed metric must remain factual and traceable to the existing `StockDetailData` model.

## 2. Reference research

The SoSanhThe reference is used for information architecture and product presentation rather than visual cloning. Useful patterns observed across its product detail, ranking and comparison surfaces:

- one primary product object receives strong identity and visual prominence;
- important metrics are presented in compact, scannable groups before long-form detail;
- rankings/badges make relative position easy to notice;
- scenario-oriented sections explain how to interpret the product rather than dumping every field at once;
- cards and comparison rows use clear hierarchy, rounded surfaces and concise supporting copy;
- detailed information stays available below the primary summary rather than competing with it.

QeoIndex keeps its own dark market-terminal identity and Vietnam market up/down colors.

## 3. Guardrails

QEO-174 must not:

- change chart data, OHLCV aggregation, realtime or corporate-action behavior;
- change AI Council signal/consensus semantics;
- change `/api/insights/*` contracts;
- add a new financial score, recommendation formula, rarity tier or probability;
- infer institutional intent or stock quality from visual presentation;
- refetch data inside presentation components;
- remove existing chart maximize or watchlist keyboard-navigation behavior;
- add a new animation dependency.

Gamification is presentation only. Labels such as `Legendary`, `Power`, `Attack`, `Defense`, stars or synthetic ratings are forbidden unless a later ticket defines canonical semantics.

## 4. Information architecture

The existing three-column workstation remains authoritative:

1. left: AI Council / Quick AI Assistant;
2. center: ticker identity, chart and detailed tabs;
3. right: watchlist/scouting list.

The center header becomes the primary **Stock Strategy Card** and is the main visual change in QEO-174.

### 4.1 Stock Strategy Card

Required factual content:

- ticker + company identity;
- exchange + sector;
- current price + absolute/percent change;
- optional existing ranking when `rank` exists;
- P/E;
- P/B;
- ROE;
- EPS;
- volume;
- market cap;
- watchlist/share actions.

It may use strategy-card vocabulary only as secondary copy, e.g. `STOCK CARD`, `CARD STATS`, `PRICE ARENA`.

### 4.2 Price Arena rail

A compact factual range visualization uses only existing values:

- floor;
- session low;
- reference;
- current;
- session high;
- ceiling.

The rail visualizes location only. It must not imply probability, target or support/resistance.

### 4.3 Workstation atmosphere

The page root may gain subtle radial/linear gradients and a low-contrast grid texture. Content surfaces remain readable and chart contrast must not be reduced.

The left AI Council and right watchlist remain functionally unchanged in this ticket. Their existing card-like structure already supports the strategy-board framing; QEO-174 should avoid unnecessary rewrites of those high-interaction components.

## 5. Motion

Use existing `motion/react` only.

Allowed:

- one-shot hero reveal;
- subtle hover lift/glow on the strategy card;
- light decorative sheen;
- small state/action transitions.

Required:

- `useReducedMotion()` disables non-essential movement;
- no looping pulse around price or signal;
- no animation that implies bullish/bearish direction.

## 6. Responsive behavior

Desktop:

- preserve current 3-column layout and chart maximize mode;
- hero card keeps identity/price visually dominant;
- stat cells form a compact row/grid.

Tablet/mobile:

- hero card stacks identity, price and stats cleanly;
- actions remain reachable;
- Price Arena remains horizontally readable without forcing the whole page wider than the viewport.

## 7. Component boundaries

Create presentation-only primitives under:

`components/stock-detail/revamp/`

Planned files:

- `stock-card-metrics.ts` — pure helpers for safe formatting and price-range position;
- `stock-price-arena.tsx` — factual price-range visualization;
- `stock-card-stat.tsx` — reusable factual metric cell.

Modify:

- `components/stock-detail/stock-company-header.tsx` — becomes the strategy-card hero while preserving the exported `StockCompanyHeader` contract;
- `components/stock-detail/stock-detail-workstation.tsx` — atmosphere/background only, preserving orchestration and existing component boundaries.

Keeping the `StockCompanyHeader` export avoids regressions in existing stock-detail contracts and tests.

## 8. Acceptance criteria

- `/insights/[ticker]` still uses `StockDetailWorkstation`, `StockAiSidebar`, `StockTradingViewChartData`, `StockTabsPanel` and `StockWatchlistSidebar`.
- `StockCompanyHeader` remains the center-header integration point.
- Strategy card shows only factual existing data.
- Rank is optional and omitted when unavailable.
- Price Arena is bounded and safe when floor/ceiling values are missing or degenerate.
- Motion honors reduced-motion preference.
- Existing chart maximize and keyboard ticker switching remain unchanged.
- Dedicated QEO-174 UI contract passes along with typecheck.
