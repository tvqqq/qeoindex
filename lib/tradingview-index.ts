export type MarketIndexQuote = {
  symbol: string
  value: number
  change: number
  changePercent: number
  updatedAt: string
}

const TICKERS: Record<string, string> = {
  "HOSE:VNINDEX": "VNINDEX",
  "HOSE:VN30": "VN30",
  "HNX:HNXINDEX": "HNXINDEX",
}

type TradingViewPayload = { data?: Array<{ s?: unknown; d?: unknown[] }> }

export function parseTradingViewIndexes(payload: TradingViewPayload, updatedAt = new Date().toISOString()) {
  const quotes: Record<string, MarketIndexQuote> = {}
  for (const row of payload.data ?? []) {
    const source = String(row.s ?? "")
    const symbol = TICKERS[source]
    const value = Number(row.d?.[0])
    const changePercent = Number(row.d?.[1])
    const change = Number(row.d?.[2])
    if (!symbol || !Number.isFinite(value) || value <= 0 || !Number.isFinite(changePercent) || !Number.isFinite(change)) continue
    quotes[symbol] = { symbol, value, change, changePercent, updatedAt }
  }
  return quotes
}

export async function fetchTradingViewIndexes() {
  const response = await fetch("https://scanner.tradingview.com/vietnam/scan", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "StockOS/1.0 market-board" },
    body: JSON.stringify({
      symbols: { tickers: Object.keys(TICKERS), query: { types: [] } },
      columns: ["close", "change", "change_abs"],
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`TradingView index scan failed (${response.status}): ${text.slice(0, 160)}`)
  const quotes = parseTradingViewIndexes(JSON.parse(text) as TradingViewPayload)
  if (!quotes.VNINDEX || !quotes.VN30) throw new Error("TradingView index scan omitted VNINDEX or VN30")
  return quotes
}
