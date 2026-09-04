export type PortfolioIntradayPayload = {
  histories?: Record<string, {
    price?: number | null
    points?: Array<{ close: number }>
  }>
}

export function extractPortfolioMarketPrices(payload: PortfolioIntradayPayload | null) {
  const prices: Record<string, number> = {}
  if (!payload?.histories) return prices

  for (const [ticker, quote] of Object.entries(payload.histories)) {
    const price = quote.price ?? quote.points?.at(-1)?.close
    if (typeof price === "number" && Number.isFinite(price) && price > 0) {
      prices[ticker] = price
    }
  }

  return prices
}
