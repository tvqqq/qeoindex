# Wyckoff Insight — Infographic UI redesign plan

## Objective

Redesign the standalone `/insights/wyckoff` page as an infographic decision workspace while preserving the existing lightweight-chart runtime, Supabase unified data contract, ticker-switch performance behavior, and embedded Wyckoff tab used elsewhere.

## Information architecture

1. **Identity + market context** — large stock identity, price, change, source, snapshot date, current timeframe.
2. **Four hero cards** — current Wyckoff phase, key decision zones, Bull/Base/Bear allocation, strongest evidenced signal.
3. **Price × Volume × Structure chart** — larger typography, shadcn Card shell, timeframe segmented control, OHLC strip, existing persistent Lightweight Charts canvas.
4. **Phase narrative** — three infographic blocks for Current / Observe next / Risk & invalidation.
5. **Decision map** — standalone Demand/Support, Supply/Resistance and Break → Hold → Test → Follow-through module.
6. **Evidence layer** — rulesTriggered + markers, technical context (RSI, relative volume, MA20, MA50), current Wyckoff state and what changed.
7. **Multi-horizon outlook** — three independent cards: 1D→week, 1W→month, 1M→long term; each shows Bull/Base/Bear distribution and the dominant conditional scenario with trigger/confirmation/invalidation.
8. **Watchlist** — shadcn Input/Button/Badge/Card, sector grouping, larger rows and readable phase badges.
9. **Methodology guardrail** — explicit conditional-scenario disclaimer.

## Visual system

- Page typography: `font-ticker`, already mapped to Plus Jakarta Sans with Vietnamese subset.
- Body copy: 14–16px; section titles: 20–24px; price: 36px; strong card values: 22–26px.
- Dark navy surfaces with restrained cyan / emerald / amber / purple / rose semantic accents.
- shadcn primitives: Card, CardHeader, CardContent, CardTitle, Badge, Button and Input.
- No new motion library, blur effect or chart remount. Keep the persistent canvas and current raster/flicker mitigations.

## Scope boundary

- Standalone page only. The existing `WyckoffStockWorkspace` remains unchanged for the stock modal/embedded use case.
- No schema changes and no new fabricated analytics. UI renders existing completed-bar studies, evidence, markers, scenarios and outlooks.
