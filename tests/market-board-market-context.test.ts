import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import {
  coveredTop200ForeignTotals,
  currentSessionIndexMetrics,
  orderedImpactBars,
  parseVnindexImpactPayload,
  selectCurrentSessionImpact,
} from "../modules/market/board/market-context-contract.ts"

const boardSource = readFileSync(new URL("../components/live-market-board.tsx", import.meta.url), "utf8")
const stripSource = readFileSync(new URL("../components/market-board/market-context-strip.tsx", import.meta.url), "utf8")
const serverSource = readFileSync(new URL("../modules/market/board/market-context-server.ts", import.meta.url), "utf8")
const contractSource = readFileSync(new URL("../modules/market/board/market-context-contract.ts", import.meta.url), "utf8")
const routeSource = readFileSync(new URL("../app/api/market/board-context/route.ts", import.meta.url), "utf8")
const finhayProviderSource = readFileSync(new URL("../modules/market/providers/finhay/live.ts", import.meta.url), "utf8")
const finhayRouteSource = readFileSync(new URL("../app/api/finhay/market-context/route.ts", import.meta.url), "utf8")

test("VNINDEX impact uses provider basketInfluence, keeps only finite rows, and totals only displayed bars", () => {
  const baseSeconds = Math.floor(Date.parse("2026-10-02T07:00:00.000Z") / 1000)
  const rows = [
    ...Array.from({ length: 10 }, (_, index) => ({
      symbol: `P${String(index).padStart(2, "0")}`,
      basketInfluence: 1 - index * 0.05,
      time: { seconds: baseSeconds + index, nanos: 0 },
    })),
    ...Array.from({ length: 10 }, (_, index) => ({
      symbol: `N${String(index).padStart(2, "0")}`,
      basketInfluence: -1 + index * 0.05,
      time: { seconds: baseSeconds + 20 + index, nanos: 0 },
    })),
    { symbol: "OMIT", time: { seconds: baseSeconds + 60, nanos: 0 } },
    { symbol: "NULL", basketInfluence: null, time: { seconds: baseSeconds + 61, nanos: 0 } },
  ]

  const parsed = parseVnindexImpactPayload(rows)
  assert.ok(parsed)
  assert.equal(parsed.providerRows, 22)
  assert.equal(parsed.finiteRows, 20)
  assert.equal(parsed.positive.length, 5)
  assert.equal(parsed.negative.length, 5)
  assert.equal(parsed.positive[0]?.symbol, "P00")
  assert.equal(parsed.negative[0]?.symbol, "N00")
  assert.equal(parsed.positive.some((entry) => entry.symbol === "OMIT"), false)
  assert.equal(parsed.negative.some((entry) => entry.symbol === "OMIT"), false)
  assert.equal(parsed.positive.some((entry) => entry.symbol === "NULL"), false)
  assert.equal(parsed.negative.some((entry) => entry.symbol === "NULL"), false)

  const displayed = [...parsed.positive, ...parsed.negative].reduce((sum, entry) => sum + entry.contribution, 0)
  assert.ok(Math.abs(parsed.displayedNetTotal - displayed) < 1e-9)
  assert.ok(Math.abs(parsed.displayedNetTotal) < 1e-9)
  assert.equal(parsed.scope, "VNINDEX")
  assert.match(parsed.source, /basket-influence/)
})

test("impact chart keeps strongest gain at left and strongest negative at far right", () => {
  const parsed = parseVnindexImpactPayload([
    { symbol: "VIC", basketInfluence: 4.76 },
    { symbol: "MWG", basketInfluence: 0.24 },
    { symbol: "LPB", basketInfluence: -2.47 },
    { symbol: "VHM", basketInfluence: -0.63 },
    { symbol: "MBB", basketInfluence: -1.16 },
  ])
  assert.ok(parsed)
  const originalNegative = parsed.negative.map((entry) => entry.symbol)
  const entries = orderedImpactBars(parsed)
  assert.deepEqual(entries.map((entry) => entry.symbol), ["VIC", "MWG", "VHM", "MBB", "LPB"])
  assert.deepEqual(parsed.negative.map((entry) => entry.symbol), originalNegative)
  assert.equal(
    entries.reduce((sum, entry) => sum + entry.contribution, 0).toFixed(3),
    parsed.displayedNetTotal.toFixed(3),
  )
})

test("worker index-impact rows retain provider age and fresh WebSocket data wins over later REST", () => {
  const websocketFrame = {
    T: "index-impact",
    symbol: "VNINDEX",
    providerAsOf: "2026-10-05T02:23:05.664Z",
    rows: [
      { symbol: "HPG", basketInfluence: 0.42, time: { seconds: 1_791_166_985, nanos: 664_143_789 } },
      { symbol: "VIC", basketInfluence: -0.12, time: { seconds: 1_791_166_985, nanos: 664_143_789 } },
    ],
  }
  const websocket = parseVnindexImpactPayload(websocketFrame)
  const rest = parseVnindexImpactPayload([
    { symbol: "HPG", basketInfluence: 0.2, time: { seconds: 1_791_167_045, nanos: 0 } },
  ])
  assert.ok(websocket)
  assert.ok(rest)
  assert.equal(websocket.asOf, "2026-10-05T02:23:05.664Z")
  assert.equal(websocket.providerRows, 2)

  const nowMs = Date.parse("2026-10-05T02:23:30.000Z")
  const freshSelection = selectCurrentSessionImpact(rest, websocket, "2026-10-05", nowMs)
  assert.equal(freshSelection.source, "websocket")
  assert.equal(freshSelection.impact, websocket)

  const staleSelection = selectCurrentSessionImpact(rest, websocket, "2026-10-05", nowMs + 121_000)
  assert.equal(staleSelection.source, "rest")
  assert.equal(staleSelection.impact, rest)
})

test("HOSE index liquidity requires a current provider source timestamp and preserves provider zero", () => {
  const sessionDate = "2026-10-05"
  const receivedOnly = currentSessionIndexMetrics({
    updatedAt: "2026-10-05T02:23:30.000Z",
    volume: 67_014_841,
    valueTraded: 1_630_070_727_140,
  }, sessionDate)
  assert.deepEqual(receivedOnly, { asOf: "", volume: undefined, valueTraded: undefined })

  const providerZero = currentSessionIndexMetrics({
    sourceAsOf: "2026-10-05T02:23:05.664Z",
    updatedAt: "2026-10-05T02:24:00.000Z",
    volume: 0,
    valueTraded: 0,
  }, sessionDate)
  assert.deepEqual(providerZero, { asOf: "2026-10-05T02:23:05.664Z", volume: 0, valueTraded: 0 })
})

test("Top-200 foreign flow stays unavailable without coverage but preserves a covered zero snapshot", () => {
  assert.equal(coveredTop200ForeignTotals({ buy: 0, sell: 0, covered: 0 }), null)
  assert.deepEqual(coveredTop200ForeignTotals({ buy: 0, sell: 0, covered: 1 }), { buy: 0, sell: 0, net: 0 })
  assert.equal(coveredTop200ForeignTotals({ buy: 10, sell: 5, covered: 1.5 })?.net, 5)
  assert.equal(coveredTop200ForeignTotals({ buy: Number.NaN, sell: 0, covered: 1 }), null)
})


test("market context backend requests only provider VNINDEX influence; old index chart bootstrap is retired", () => {
  assert.match(serverSource, /basket-influence\?type=VNINDEX/)
  assert.doesNotMatch(serverSource, /chart-api\/v2\/ohlcs|fetchMarketContextIndexSeries/)
  assert.doesNotMatch(contractSource, /MARKET_CONTEXT_INDEX_SYMBOLS|MarketContextIndexSeries|upsertObservedIndexPoint/)
  assert.match(contractSource, /\.slice\(0, 5\)/)
  assert.match(serverSource, /fetchVnindexImpactSnapshot/)
  assert.match(routeSource, /hasUsableContext/)
})

test("single-row responsive layout combines indices, leaves flow realtime, removes depth and horizontal scroll", () => {
  assert.match(boardSource, /<MarketContextStrip/)
  assert.match(boardSource, /useState<BoardView>\("classic"\)/)
  assert.match(stripSource, /data-market-context-single-row/)
  assert.match(stripSource, /grid-cols-1 items-stretch.*sm:grid-cols-2 xl:grid-cols-/)
  assert.match(stripSource, /title="VN-Index \/ VN30"/)
  assert.match(stripSource, /<IndexedSummary label="VN-Index"/)
  assert.match(stripSource, /<IndexedSummary label="VN30"/)
  assert.match(stripSource, /title="Thanh khoản HOSE"/)
  assert.match(stripSource, /title="Mua bán nước ngoài"/)
  assert.match(stripSource, /title="Tác động VNINDEX"/)
  assert.doesNotMatch(stripSource, /MarketDepthCard|MARKET_DEPTH_BUCKETS|buildMarketDepthSnapshot|data-market-context-depth-card/)
  assert.doesNotMatch(stripSource, /ContextLineChart|IndexContextCard|DualLineChart|overflow-x-auto|min-w-\[570px\]/)
  assert.match(stripSource, /currentSessionIndexMetrics\(quote, day\)/)
  assert.match(stripSource, /quote\?\.advances/)
  assert.match(stripSource, /quote\?\.declines/)
})

test("combined index card exposes an explicit chart button using the existing realtime modal", () => {
  assert.ok(stripSource.includes('headerRight={'))
  assert.ok(stripSource.includes('onClick={onOpenIndexChart}'))
  assert.ok(stripSource.includes('aria-label="Mở biểu đồ realtime VN-Index và VN30F1M"'))
  assert.ok(stripSource.includes('<ChartNoAxesCombined'))
  assert.ok(stripSource.includes('onOpen={onOpenIndexChart}'))
  assert.ok(boardSource.includes('onOpenIndexChart={openIndexChart}'))
  assert.ok(boardSource.includes('const openIndexChart = useCallback(() => setIndexChartOpen(true), [])'))
  assert.ok(boardSource.includes('<IndexChartModal open={indexChartOpen} onOpenChange={setIndexChartOpen} />'))
})

test("realtime comparison reuses only observed source-scoped same-session data", () => {
  assert.match(stripSource, /previousMetricHistory/)
  assert.match(stripSource, /readMetricHistory/)
  assert.match(stripSource, /writeMetricHistory/)
  assert.match(stripSource, /metricHistoryPrefix\("liquidity", liquiditySeriesSource\)/)
  assert.match(stripSource, /metricHistoryPrefix\("foreign", foreignSeriesSource\)/)
  assert.match(stripSource, /vietnamDateKey\(new Date\(point.minute\)\.toISOString\(\)\) === day/)
  assert.match(stripSource, /minuteOfSession/)
  assert.match(stripSource, /ComparisonLineChart/)
  assert.match(stripSource, /previousLiquidity\?\.points/)
  assert.match(stripSource, /previousForeign\?\.points/)
  assert.match(stripSource, /previous: true/)
  assert.match(stripSource, /Chưa có phiên trước/)
  assert.match(stripSource, /Finhay full HOSE/)
  assert.match(stripSource, /Top 200 partial/)
  assert.match(stripSource, /foreignSeriesSource = hasFinhayForeign \? "finhay-vnindex" : "top200-partial"/)
  assert.match(stripSource, /liquiditySeriesSource = hasFinhayLiquidity \? "finhay-vnindex" : "index-quote"/)
  assert.doesNotMatch(stripSource, /volume \* price|volume \* close/)
})

test("compact contributors show provider top-5 entries and verified-only tooltip, no synthetic fields", () => {
  const entries = parseVnindexImpactPayload([
    ...Array.from({ length: 12 }, (_, i) => ({ symbol: `P${i + 10}`, basketInfluence: 1 - i * 0.02 })),
    ...Array.from({ length: 12 }, (_, i) => ({ symbol: `N${i + 10}`, basketInfluence: -1 + i * 0.02 })),
  ])
  assert.ok(entries)
  assert.equal(entries.positive.length + entries.negative.length, 10)
  assert.equal(orderedImpactBars(entries).length, 10)
  assert.match(stripSource, /impactTooltip\(entry, quotes\[entry.symbol\], day\)/)
  assert.match(stripSource, /foreignBuyVolume/)
  assert.match(stripSource, /foreignSellVolume/)
  assert.match(stripSource, /formatVndValue\(current\?\.valueTraded\)/)
  assert.match(stripSource, /formatChange\(current\?\.changePercent\)/)
  assert.match(stripSource, /motion-safe:transition-\[top,height\]/)
  assert.match(stripSource, /motion-safe:animate-pulse/)
  assert.match(stripSource, /observedAtMs - sourceMs <= 120_000/)
  assert.match(stripSource, /}, 60_000\)/)
})

test("market context API remains authenticated and cached with impact-only bootstrap", () => {
  assert.match(routeSource, /requireApiFeature\("market_board"\)/)
  assert.match(routeSource, /readThroughUiCache/)
  assert.match(routeSource, /session\.isLiveSession \? 10/)
  assert.match(routeSource, /shouldCache: hasUsableContext/)
  assert.match(routeSource, /market-board-context-v3/)
  assert.match(stripSource, /if \(disposed \|\| inFlight \|\| document.visibilityState === "hidden"\) return/)
  assert.match(stripSource, /vietnamDateKey\(previous.impact\?\.asOf \?\? ""\)/)
  assert.match(stripSource, /impactSelection.source === "websocket"/)
  assert.match(stripSource, /Chậm/)
  assert.match(stripSource, /LIVE/)
})

test("Finhay flow stays independent, and DNSE Top-200 fallback remains partial", () => {
  assert.match(finhayProviderSource, /getFinhayIndexForeignTrading/)
  assert.match(finhayProviderSource, /getFinhayIndexMarketContext/)
  assert.match(finhayProviderSource, /get_index_foreign_trading/)
  assert.match(finhayProviderSource, /list_indices/)
  assert.match(finhayProviderSource, /trading_value/)
  assert.match(finhayProviderSource, /callFinhayTools/)
  assert.match(finhayProviderSource, /constituent_count/)
  assert.match(finhayRouteSource, /requireApiFeature\("finhay_live"\)/)
  assert.match(finhayRouteSource, /getActiveFinhayAccessToken/)
  assert.match(finhayRouteSource, /getFinhayIndexMarketContext\(accessToken, "VNINDEX"\)/)
  assert.match(stripSource, /\/api\/finhay\/market-context/)
  assert.match(stripSource, /finhayForeign\.sessionDate === contextSessionDate/)
  assert.match(stripSource, /vietnamDateKey\(finhayLiquidity\.sourceUpdatedAt\) === contextSessionDate/)
  assert.match(stripSource, /if \(hasFinhayForeign \|\| foreignSnapshot.covered === 0/)
})
