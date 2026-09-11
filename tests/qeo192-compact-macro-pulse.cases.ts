import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const read = (relativePath: string) => fs.readFileSync(path.resolve(relativePath), "utf8")

async function loadMacroPulse() {
  const modulePath = path.resolve("modules/research/market-insight/macro-pulse.ts")
  assert.ok(fs.existsSync(modulePath), "QEO-192 must add a pure compact macro pulse helper")
  return import(pathToFileURL(modulePath).href)
}

test("QEO-192 parses Vietcombank USD transfer-buy/sell and source timestamp", async () => {
  const { parseVietcombankUsdVndXml } = await loadMacroPulse()
  const xml = `<?xml version="1.0" encoding="utf-8"?>
    <!--For reference only. Only one request every 5 minutes!-->
    <ExrateList>
      <DateTime>9/11/2026 7:35:00 AM</DateTime>
      <Exrate CurrencyCode="EUR" CurrencyName="EURO" Buy="30,000" Transfer="30,100" Sell="30,500" />
      <Exrate CurrencyName="US DOLLAR" Sell="26,450" Transfer="26,180" Buy="26,150" CurrencyCode="USD" />
      <Source>Joint Stock Commercial Bank for Foreign Trade of Vietnam - Vietcombank</Source>
    </ExrateList>`

  const result = parseVietcombankUsdVndXml(xml)
  assert.ok(result)
  assert.equal(result.transferBuy, 26180)
  assert.equal(result.sell, 26450)
  assert.equal(result.asOf, "2026-09-11T07:35:00+07:00")
  assert.equal(result.source, "Vietcombank")
})

test("QEO-192 marks Vietcombank quote fresh only on the same Vietnam calendar date", async () => {
  const { classifyVietcombankFreshness } = await loadMacroPulse()
  const now = new Date("2026-09-11T07:41:00+07:00")

  assert.equal(classifyVietcombankFreshness("2026-09-11T07:35:00+07:00", now), "fresh")
  assert.equal(classifyVietcombankFreshness("2026-09-10T17:00:00+07:00", now), "stale")
  assert.equal(classifyVietcombankFreshness(null, now), "unknown")
})

test("QEO-192 parses TradingView DXY and WTI snapshots with explicit update mode", async () => {
  const { parseTradingViewMacroScan } = await loadMacroPulse()
  const payload = {
    data: [
      { s: "TVC:DXY", d: [97.25, 0.31, 0.30, "streaming"] },
      { s: "NYMEX:CL1!", d: [66.42, -1.12, -0.75, "delayed_streaming_900"] },
    ],
  }

  const result = parseTradingViewMacroScan(payload, "2026-09-11T00:40:00.000Z")
  assert.deepEqual(result.dxy, {
    value: 97.25,
    changePct: 0.31,
    change: 0.30,
    updateMode: "streaming",
    retrievedAt: "2026-09-11T00:40:00.000Z",
  })
  assert.deepEqual(result.wti, {
    value: 66.42,
    changePct: -1.12,
    change: -0.75,
    updateMode: "delayed_streaming_900",
    retrievedAt: "2026-09-11T00:40:00.000Z",
  })
})

test("QEO-192 maps TradingView provider update mode to transparent freshness", async () => {
  const { classifyTradingViewFreshness } = await loadMacroPulse()

  assert.equal(classifyTradingViewFreshness("streaming"), "fresh")
  assert.equal(classifyTradingViewFreshness("delayed_streaming_900"), "delayed")
  assert.equal(classifyTradingViewFreshness("endofday"), "stale")
  assert.equal(classifyTradingViewFreshness(null), "unknown")
})

test("QEO-192 degrades metrics independently and keeps VND overnight rate explicitly unavailable", async () => {
  const { buildCompactMacroPulse } = await loadMacroPulse()
  const now = new Date("2026-09-11T07:41:00+07:00")
  const pulse = buildCompactMacroPulse({
    now,
    usdVnd: {
      transferBuy: 26180,
      sell: 26450,
      asOf: "2026-09-11T07:35:00+07:00",
      source: "Vietcombank",
    },
    dxy: null,
    wti: {
      value: 66.42,
      changePct: -1.12,
      change: -0.75,
      updateMode: "streaming",
      retrievedAt: "2026-09-11T00:40:00.000Z",
    },
  })

  assert.equal(pulse.status, "degraded")
  assert.equal(pulse.metrics.usdVnd.status, "ready")
  assert.equal(pulse.metrics.usdVnd.freshness, "fresh")
  assert.equal(pulse.metrics.dxy.status, "unavailable")
  assert.equal(pulse.metrics.wti.status, "ready")
  assert.equal(pulse.metrics.vndOvernight.status, "unavailable")
  assert.equal(pulse.metrics.vndOvernight.value, null)
  assert.match(pulse.metrics.vndOvernight.message, /overnight|O\/N|chưa.*xác minh/i)
})

test("QEO-192 loads macro sources in parallel at the Insights page boundary and renders one compact 4-metric pulse", () => {
  const loader = read("modules/research/market-insight/macro-pulse-loader.ts")
  const insightsPage = read("app/insights/page.tsx")
  const closeDashboard = read("components/insights/market-close-dashboard.tsx")
  const pulseView = read("components/insights/compact-macro-pulse.tsx")
  const canonicalMarketData = read("modules/research/market-insight/data.ts")
  const surface = `${loader}\n${insightsPage}\n${closeDashboard}\n${pulseView}`

  assert.match(loader, /portal\.vietcombank\.com\.vn[\s\S]*pXML\.aspx\?b=10/)
  assert.match(loader, /revalidate:\s*300/)
  assert.match(loader, /scanner\.tradingview\.com\/global\/scan/)
  assert.match(loader, /TVC:DXY/)
  assert.match(loader, /NYMEX:CL1!/)
  assert.match(loader, /Promise\.allSettled/)
  assert.match(insightsPage, /Promise\.all\([\s\S]*getInsightsDashboardData[\s\S]*loadVn30FuturesBasisPulseLatest[\s\S]*loadCompactMacroPulse/)
  assert.match(insightsPage, /Object\.assign\([\s\S]*data\.marketClose[\s\S]*macroPulse/)
  assert.match(closeDashboard, /data\.macroPulse/)
  assert.match(closeDashboard, /<CompactMacroPulse[\s\S]*pulse=\{data\.macroPulse/)
  assert.doesNotMatch(canonicalMarketData, /macroPulse/, "QEO-192 must stay outside canonical EOD MarketCloseDashboardData")
  assert.match(pulseView, /data-compact-macro-pulse/)
  assert.match(surface, /USD\/VND/)
  assert.match(surface, /VND O\/N|VND overnight/i)
  assert.match(surface, /DXY/)
  assert.match(surface, /WTI/)
  assert.match(surface, /fresh|stale|delayed|unavailable|chưa.*xác minh/i)
  assert.doesNotMatch(surface, /macro[^\n]*(buy|mua)|risk-on[^\n]*(buy|mua)|risk-off[^\n]*(sell|bán)|DXY[^\n]*(mua|bán)|WTI[^\n]*(mua|bán)/i)
})
