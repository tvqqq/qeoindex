import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import {
  coveredTop200ForeignTotals,
  currentSessionIndexMetrics,
  mergeObservedIndexSeries,
  orderedImpactBars,
  parseVnindexImpactPayload,
  selectCurrentSessionImpact,
  upsertObservedIndexPoint,
  type MarketContextIndexSeries,
} from "../modules/market/board/market-context-contract.ts"

const boardSource = readFileSync(new URL("../components/live-market-board.tsx", import.meta.url), "utf8")
const stripSource = readFileSync(new URL("../components/market-board/market-context-strip.tsx", import.meta.url), "utf8")
const serverSource = readFileSync(new URL("../modules/market/board/market-context-server.ts", import.meta.url), "utf8")
const contractSource = readFileSync(new URL("../modules/market/board/market-context-contract.ts", import.meta.url), "utf8")
const providerSource = readFileSync(new URL("../modules/market/providers/tradingview/index.ts", import.meta.url), "utf8")
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
  assert.equal(parsed.positive.length, 8)
  assert.equal(parsed.negative.length, 8)
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

test("observed index points accept equal-time corrections, reject older frames, and merge after completed REST candles", () => {
  const sessionDate = "2026-10-05"
  const first = upsertObservedIndexPoint(undefined, "VNINDEX", sessionDate, "2026-10-05T09:15:10+07:00", 1750.61)
  assert.ok(first)
  const older = upsertObservedIndexPoint(first, "VNINDEX", sessionDate, "2026-10-05T09:15:09+07:00", 1749.99)
  assert.equal(older, first)
  const correction = upsertObservedIndexPoint(first, "VNINDEX", sessionDate, "2026-10-05T09:15:10+07:00", 1750.62)
  assert.equal(correction?.points[0]?.value, 1750.62)

  const rest: MarketContextIndexSeries = {
    symbol: "VNINDEX",
    sessionDate,
    points: [
      { time: Date.parse("2026-10-05T09:15:00+07:00") / 1000, value: 1750.5 },
      { time: Date.parse("2026-10-05T09:16:00+07:00") / 1000, value: 1750.7 },
    ],
    asOf: "2026-10-05T02:16:00.000Z",
    source: "DNSE REST 1m history",
  }
  const observed: MarketContextIndexSeries = {
    ...first,
    points: [
      { time: Date.parse("2026-10-05T09:15:10+07:00") / 1000, value: 1749.9 },
      { time: Date.parse("2026-10-05T09:16:10+07:00") / 1000, value: 1750.8 },
      { time: Date.parse("2026-10-05T09:17:10+07:00") / 1000, value: 1750.9 },
    ],
    asOf: "2026-10-05T02:17:10.000Z",
  }
  const merged = mergeObservedIndexSeries(rest, observed, sessionDate)
  assert.deepEqual(merged?.points, [
    rest.points[0],
    rest.points[1],
    observed.points[2],
  ])
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

test("market context bootstrap uses actual index candles and provider contribution endpoint", () => {
  assert.match(serverSource, /chart-api\/v2\/ohlcs/)
  assert.match(serverSource, /\$\{baseUrl\}\/index/)
  assert.match(serverSource, /"VNINDEX", "VN30"/)
  assert.doesNotMatch(serverSource, /HNXINDEX|UPCOMINDEX/)
  assert.match(serverSource, /indexSymbols\.map\(\(symbol\) => fetchMarketContextIndexSeries\(symbol, now\)\)/)
  assert.match(contractSource, /MARKET_CONTEXT_INDEX_SYMBOLS = \["VNINDEX", "VN30"\] as const/)
  assert.doesNotMatch(contractSource, /HNXINDEX|UPCOMINDEX/)
  assert.match(serverSource, /basket-influence\?type=VNINDEX/)
  assert.match(contractSource, /basketInfluence/)
  assert.doesNotMatch(serverSource, /constituent.*average|changePercent.*weight/i)
})

test("top strip is honest about partial liquidity and foreign history instead of drawing synthetic comparisons", () => {
  assert.match(boardSource, /<MarketContextStrip/)
  assert.match(boardSource, /useState<BoardView>\("classic"\)/)
  assert.match(stripSource, /history phiên trước chưa verified/)
  assert.match(stripSource, /Finhay full HOSE/)
  assert.match(stripSource, /VND verified/)
  assert.match(stripSource, /liquiditySeriesSource = hasFinhayLiquidity \? "finhay-vnindex" : "index-quote"/)
  assert.match(stripSource, /Top 200 partial/)
  assert.match(stripSource, /Top mã:/)
  assert.match(stripSource, /points\.length < 2/)
  assert.match(stripSource, /vietnamDateKey\(quote\.sourceAsOf\) !== series\.sessionDate/)
  assert.match(stripSource, /liquidityData\.length >= 2/)
  assert.match(stripSource, /<DualLineChart points=\{foreignPoints\}/)
  assert.match(stripSource, /text-red-300/)
  assert.match(stripSource, /#ef4e53/)
  assert.doesNotMatch(stripSource, /quote\?\.advances|quote\?\.declines/)
  assert.doesNotMatch(stripSource, /formatVndValue\(quote\?\.valueTraded\)/)
  assert.match(stripSource, /formatCompactVolume\(liquidityVolume\)/)
  assert.match(stripSource, /hasFinhayLiquidity && finite\(finhayLiquidity\?\.volume\)/)
  assert.match(stripSource, /currentSessionIndexMetrics\(vnindexQuote, contextSessionDate\)/)
  assert.match(contractSource, /const asOf = quote\?\.sourceAsOf \?\? ""/)
  assert.doesNotMatch(contractSource, /quote\?\.sourceAsOf \?\? quote\?\.updatedAt/)
  assert.doesNotMatch(stripSource, /indexQuotes\.HNXINDEX|indexQuotes\.UPCOMINDEX/)
  const topRow = stripSource.split("data-market-context-index-row>")[1]?.split("data-market-context-impact-row")[0]
  assert.ok(topRow)
  assert.equal((topRow.match(/<IndexContextCard\b/g) ?? []).length, 2)
  assert.equal((topRow.match(/<ContextCard\b/g) ?? []).length, 2)
  assert.match(topRow, /label="VNINDEX"[\s\S]*title="Thanh khoản HOSE"[\s\S]*label="VN30"[\s\S]*title="Mua bán nước ngoài"/)
  assert.doesNotMatch(topRow, /label="HNX"|label="UPCOM"/)
  assert.match(stripSource, /data-market-context-index-row/)
  assert.match(stripSource, /data-market-context-impact-row/)
  assert.match(stripSource, /lg:grid-cols-\[minmax\(0,3fr\)_minmax\(0,2fr\)\]/)
  assert.match(stripSource, /data-market-context-depth-card/)
  assert.match(stripSource, /buildMarketDepthSnapshot\(canonicalUniverse, stockQuotes, contextSessionDate, vietnamDateKey\)/)
  assert.match(stripSource, /MARKET_DEPTH_BUCKETS\.map/)
  assert.match(stripSource, /Top 200 partial · Có giá/)

  assert.doesNotMatch(stripSource, /valueChangePercent/)
  assert.doesNotMatch(providerSource, /vndirect|yV \* yC|tV \* tC|valueChangePercent/i)
})

test("compact context cards preserve provider time and let the worker stream drive fresh impact", () => {
  assert.ok(stripSource.includes("xl:h-[144px]"))
  assert.ok(stripSource.includes("h-[55px]"))
  assert.ok(stripSource.includes("min-h-[75px]"))
  assert.ok(stripSource.includes("orderedImpactBars(impact)"))
  assert.ok(stripSource.includes("motion-safe:transition-[top,height]"))
  assert.ok(stripSource.includes("motion-safe:transition-[height,opacity]"))
  assert.ok(stripSource.includes("motion-safe:animate-pulse"))
  assert.ok(stripSource.includes("return sessionOpen"))
  assert.ok(stripSource.includes("observedAtMs - sourceMs <= 120_000"))
  assert.ok(stripSource.includes("}, 60_000)"))
  assert.ok(stripSource.includes('if (disposed || inFlight || document.visibilityState === "hidden") return'))
  assert.ok(stripSource.includes('document.addEventListener("visibilitychange"'))
  assert.ok(stripSource.includes('window.addEventListener("focus"'))
  assert.ok(stripSource.includes("vietnamDateKey(previous.generatedAt) === vietnamDateKey(data.generatedAt)"))
  assert.ok(stripSource.includes("vietnamDateKey(previous.impact?.asOf ?? \"\") === vietnamDateKey(data.generatedAt)"))
  assert.ok(stripSource.includes("const contextSessionDate = [quoteSessionDate, chartSessionDate, liveImpactDate]"))
  assert.ok(stripSource.includes('impactSelection.source === "websocket"'))
  assert.ok(stripSource.includes("Chậm"))
  assert.ok(stripSource.includes("LIVE"))
  assert.ok(!stripSource.includes("setInterval(() => void load(), 30_000)"))
})

test("market context API is authenticated, cached, and refreshes faster during the live session", () => {
  assert.match(routeSource, /requireApiFeature\("market_board"\)/)
  assert.match(routeSource, /readThroughUiCache/)
  assert.match(routeSource, /session\.isLiveSession \? 10/)
  assert.match(routeSource, /shouldCache: hasUsableContext/)
  assert.match(routeSource, /market-board-context-v2/)
})


test("foreign flow upgrades to Finhay full-HOSE data when OAuth is available and otherwise stays explicit Top-200 partial", () => {
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
  assert.match(stripSource, /Finhay full HOSE/)
  assert.match(stripSource, /Top 200 partial/)
  assert.match(stripSource, /foreignSeriesSource = hasFinhayForeign \? "finhay-vnindex" : "top200-partial"/)
  assert.match(stripSource, /if \(hasFinhayForeign\) return/)
  assert.match(stripSource, /finhayForeign\.sessionDate === contextSessionDate/)
  assert.match(stripSource, /vietnamDateKey\(finhayLiquidity\.sourceUpdatedAt\) === contextSessionDate/)
})
