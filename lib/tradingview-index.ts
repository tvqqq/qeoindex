export type MarketIndexQuote = {
  symbol: string
  value: number
  change: number
  changePercent: number
  volume?: number
  valueTraded?: number
  valueChangePercent?: number
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
    const volume = Number(row.d?.[3])
    if (!symbol || !Number.isFinite(value) || value <= 0 || !Number.isFinite(changePercent) || !Number.isFinite(change)) continue
    const quote: MarketIndexQuote = { symbol, value, change, changePercent, updatedAt }
    if (Number.isFinite(volume) && volume > 0) quote.volume = volume
    quotes[symbol] = quote
  }
  return quotes
}

const VPS_INDEX_MAP: Record<string, string> = {
  "10": "VNINDEX",
  "11": "VN30",
  "02": "HNXINDEX",
  "03": "UPCOMINDEX",
}

export async function fetchTradingViewIndexes() {
  const [tvResult, vpsResult, vndResult] = await Promise.allSettled([
    fetch("https://scanner.tradingview.com/vietnam/scan", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "StockOS/1.0 market-board" },
      body: JSON.stringify({
        symbols: { tickers: Object.keys(TICKERS), query: { types: [] } },
        columns: ["close", "change", "change_abs", "volume"],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    }).then(async (r) => {
      if (!r.ok) {
        const text = await r.text().catch(() => "")
        throw new Error(`TradingView index scan failed (${r.status}): ${text.slice(0, 160)}`)
      }
      return r.json() as Promise<TradingViewPayload>
    }),
    fetch("https://bgapidatafeed.vps.com.vn/getlistindexdetail/10,11,02,03", {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    }).then(async (r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch("https://dchart-api.vndirect.com.vn/dchart/history?resolution=D&symbol=VNINDEX&from=" + Math.floor(Date.now() / 1000 - 86400 * 10) + "&to=" + Math.floor(Date.now() / 1000), {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    }).then(async (r) => (r.ok ? r.json() : null)).catch(() => null),
  ])

  let quotes: Record<string, MarketIndexQuote> = {}
  if (tvResult.status === "fulfilled" && tvResult.value) {
    quotes = parseTradingViewIndexes(tvResult.value)
  }

  // Calculate value change % vs yesterday from VNDirect daily history
  let vnindexValueChangePercent: number | undefined
  const vndData = vndResult.status === "fulfilled" ? vndResult.value : null
  if (vndData?.t && Array.isArray(vndData.t) && vndData.t.length >= 2) {
    const vArr = vndData.v as number[]
    const cArr = vndData.c as number[]
    const n = vArr.length
    const yV = vArr[n - 2]
    const yC = cArr[n - 2]
    const tV = vArr[n - 1]
    const tC = cArr[n - 1]
    if (yV > 0 && yC > 0 && tV > 0 && tC > 0) {
      const yesterdayEstimatedVal = yV * yC
      const todayEstimatedVal = tV * tC
      vnindexValueChangePercent = Number((((todayEstimatedVal - yesterdayEstimatedVal) / yesterdayEstimatedVal) * 100).toFixed(1))
    }
  }

  // Enrich with official VPS index volume & value (in million VND)
  if (vpsResult.status === "fulfilled" && Array.isArray(vpsResult.value)) {
    for (const item of vpsResult.value) {
      if (!item || typeof item !== "object") continue
      const mc = String((item as any).mc ?? "")
      const symbol = VPS_INDEX_MAP[mc]
      if (!symbol) continue
      const vol = Number((item as any).vol)
      const val = Number((item as any).value) // in million VND
      const cIndex = Number((item as any).cIndex)
      const oIndex = Number((item as any).oIndex)

      if (quotes[symbol]) {
        if (Number.isFinite(vol) && vol > 0) quotes[symbol].volume = vol
        if (Number.isFinite(val) && val > 0) quotes[symbol].valueTraded = val * 1_000_000
        if (symbol === "VNINDEX" && vnindexValueChangePercent !== undefined) {
          quotes[symbol].valueChangePercent = vnindexValueChangePercent
        }
      } else if (Number.isFinite(cIndex) && cIndex > 0) {
        const change = Number.isFinite(oIndex) && oIndex > 0 ? cIndex - oIndex : 0
        const changePercent = Number.isFinite(oIndex) && oIndex > 0 ? (change / oIndex) * 100 : 0
        quotes[symbol] = {
          symbol,
          value: cIndex,
          change,
          changePercent,
          volume: Number.isFinite(vol) && vol > 0 ? vol : undefined,
          valueTraded: Number.isFinite(val) && val > 0 ? val * 1_000_000 : undefined,
          valueChangePercent: symbol === "VNINDEX" ? vnindexValueChangePercent : undefined,
          updatedAt: new Date().toISOString(),
        }
      }
    }
  }

  if (quotes.VNINDEX && vnindexValueChangePercent !== undefined && quotes.VNINDEX.valueChangePercent === undefined) {
    quotes.VNINDEX.valueChangePercent = vnindexValueChangePercent
  }

  if (!quotes.VNINDEX || !quotes.VN30) throw new Error("TradingView index scan omitted VNINDEX or VN30")
  return quotes
}
