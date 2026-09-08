# QEO-139 Design Self-Review Corrections

This note is normative and must be read together with `2026-09-07-qeo-139-trade-size-calculator-design.md`.

The initial design review found two implementation ambiguities that must be resolved before planning.

## 1. Account Equity operational definition

`Account Equity` is a QeoIndex product implementation term. QEO-139 must not continue treating `portfolios.initial_capital` as if it were current equity.

For the calculator's default portfolio-derived value:

```text
Account Equity =
  Initial Capital
  + Total Realized P&L
  + Total Unrealized P&L
```

All monetary terms are full VND at the calculator boundary. The existing AVCO engine remains the accounting authority for realized/unrealized P&L.

Important implementation rule: do not recompute Total Realized P&L by reducing only the current `positions` array. `computePortfolioPositions()` already exposes portfolio-level `totalRealizedPnl`, including tickers that are fully closed; QEO-139 must consume that portfolio-level result so closed-position realized P&L is not silently dropped.

### Market-price completeness

Unrealized P&L requires current prices. The existing P&L engine may fall back to average cost when a current price is absent; that fallback is acceptable for legacy display continuity but must not be presented as fully current market evidence for sizing.

The calculator context therefore carries Account Equity provenance/completeness:

```ts
type AccountEquityContext = {
  valueVnd: number
  source: "portfolio_mark_to_market" | "portfolio_partial" | "manual"
  missingPriceTickers: string[]
}
```

Rules:

- all open-position prices available → `portfolio_mark_to_market`;
- one or more open-position prices missing → `portfolio_partial` and list missing tickers;
- user edits Account Equity → `manual`;
- partial market data never silently claims a fully current Account Equity;
- the user may still size a Trade using an explicit manual Account Equity when market data is partial/unavailable.

This is a QEO-139 product operationalization and must be explained by tooltip/help copy; it is not a verbatim McDowell formula definition.

## 2. Regular-lot convention wording

Repository inspection found no existing broker/exchange order-size helper that QEO-139 can reuse as an authoritative venue rule.

Therefore the design's `100 shares` rule must be implemented and documented narrowly as a **QeoIndex calculator product default**, not as a claim that every connected venue/provider requires the same lot size.

```ts
export const DEFAULT_REGULAR_LOT_SHARES = 100
```

The pure calculator always accepts `lotSizeShares` as an input. UI uses `DEFAULT_REGULAR_LOT_SHARES` for QEO-139. A future broker/venue adapter may supply a different deterministic lot size without changing the sizing formula.

Acceptance tests must prove:

- default UI context uses 100 shares;
- calculator rounding works for an injected lot size;
- odd-lot capacity is not used to exceed the selected regular-lot sizing convention;
- tooltip identifies the lot rounding rule as a product execution convention, not a McDowell rule.

## Self-review outcome

With these corrections, the design has no remaining known placeholder, source-fidelity contradiction, or unresolved unit/account-equity ambiguity. Implementation remains scoped to QEO-139; full portfolio Active Risk/drawdown guardrails stay in QEO-141.
