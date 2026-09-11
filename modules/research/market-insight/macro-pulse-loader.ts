import "server-only"

import {
  buildCompactMacroPulse,
  parseTradingViewMacroScan,
  parseVietcombankUsdVndXml,
  type CompactMacroPulseData,
  type TradingViewMacroQuote,
  type VietcombankUsdVndQuote,
} from "@/modules/research/market-insight/macro-pulse"
import { readThroughUiCache } from "@/modules/shared/cache/ui-data-cache"

const VIETCOMBANK_XML_URL = "https://portal.vietcombank.com.vn/Usercontrols/TVPortal.TyGia/pXML.aspx?b=10"
const TRADINGVIEW_GLOBAL_SCAN_URL = "https://scanner.tradingview.com/global/scan"
const DXY_SYMBOL = "TVC:DXY"
const WTI_SYMBOL = "NYMEX:CL1!"

function isVietcombankUsdVndQuote(value: unknown): value is VietcombankUsdVndQuote {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const quote = value as Partial<VietcombankUsdVndQuote>
  return quote.source === "Vietcombank"
    && typeof quote.transferBuy === "number"
    && Number.isFinite(quote.transferBuy)
    && quote.transferBuy > 0
    && typeof quote.sell === "number"
    && Number.isFinite(quote.sell)
    && quote.sell > 0
    && (quote.asOf == null || typeof quote.asOf === "string")
}

async function fetchVietcombankUsdVnd(): Promise<VietcombankUsdVndQuote> {
  const response = await fetch(VIETCOMBANK_XML_URL, {
    headers: {
      accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
      "user-agent": "QeoIndex/1.0 macro-pulse",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok) throw new Error(`Vietcombank FX request failed (${response.status})`)
  const quote = parseVietcombankUsdVndXml(await response.text())
  if (!quote) throw new Error("Vietcombank FX response omitted a valid USD quote")
  return quote
}

function loadVietcombankUsdVndCached() {
  return readThroughUiCache<VietcombankUsdVndQuote>({
    namespace: "market-macro-vcb",
    key: "usd-vnd",
    tag: "market-macro-vcb-usd-vnd",
    name: "Market macro VCB USD/VND",
    ttlSeconds: 300,
    validate: isVietcombankUsdVndQuote,
    load: fetchVietcombankUsdVnd,
  })
}

async function fetchTradingViewMacro(): Promise<{
  dxy: TradingViewMacroQuote | null
  wti: TradingViewMacroQuote | null
}> {
  const retrievedAt = new Date().toISOString()
  const response = await fetch(TRADINGVIEW_GLOBAL_SCAN_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": "QeoIndex/1.0 macro-pulse",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(7_000),
    body: JSON.stringify({
      symbols: {
        tickers: [DXY_SYMBOL, WTI_SYMBOL],
        query: { types: [] },
      },
      columns: ["close", "change", "change_abs", "update_mode"],
    }),
  })
  if (!response.ok) throw new Error(`TradingView macro scan failed (${response.status})`)
  return parseTradingViewMacroScan(await response.json(), retrievedAt)
}

export async function loadCompactMacroPulse(): Promise<CompactMacroPulseData> {
  const now = new Date()
  const [fxResult, marketResult] = await Promise.allSettled([
    loadVietcombankUsdVndCached(),
    fetchTradingViewMacro(),
  ])

  const market = marketResult.status === "fulfilled"
    ? marketResult.value
    : { dxy: null, wti: null }

  return buildCompactMacroPulse({
    now,
    usdVnd: fxResult.status === "fulfilled" ? fxResult.value : null,
    dxy: market.dxy,
    wti: market.wti,
  })
}
