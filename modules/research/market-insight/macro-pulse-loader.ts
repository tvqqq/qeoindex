import "server-only"

import {
  buildCompactMacroPulse,
  parseTradingViewMacroScan,
  parseVietcombankUsdVndXml,
  type CompactMacroPulseData,
  type TradingViewMacroQuote,
  type VietcombankUsdVndQuote,
} from "@/modules/research/market-insight/macro-pulse"

const VIETCOMBANK_XML_URL = "https://portal.vietcombank.com.vn/Usercontrols/TVPortal.TyGia/pXML.aspx"
const TRADINGVIEW_GLOBAL_SCAN_URL = "https://scanner.tradingview.com/global/scan"
const DXY_SYMBOL = "TVC:DXY"
const WTI_SYMBOL = "NYMEX:CL1!"

async function fetchVietcombankUsdVnd(): Promise<VietcombankUsdVndQuote | null> {
  const response = await fetch(VIETCOMBANK_XML_URL, {
    headers: {
      accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
      "user-agent": "QeoIndex/1.0 macro-pulse",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok) throw new Error(`Vietcombank FX request failed (${response.status})`)
  return parseVietcombankUsdVndXml(await response.text())
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
    fetchVietcombankUsdVnd(),
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
