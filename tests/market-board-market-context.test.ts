import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import { parseVnindexImpactPayload } from "../modules/market/board/market-context-contract.ts"

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
  assert.match(stripSource, /Top mã hiển thị/)
  assert.match(stripSource, /points\.length < 2/)
  assert.match(stripSource, /vietnamDateKey\(quote\.updatedAt\) !== series\.sessionDate/)
  assert.match(stripSource, /liquidityData\.length >= 2/)
  assert.match(stripSource, /<DualLineChart points=\{foreignPoints\}/)
  assert.match(stripSource, /text-red-300/)
  assert.match(stripSource, /#ef4e53/)
  assert.doesNotMatch(stripSource, /quote\?\.advances|quote\?\.declines/)
  assert.doesNotMatch(stripSource, /formatVndValue\(quote\?\.valueTraded\)/)
  assert.match(stripSource, /formatCompactVolume\(liquidityVolume\)/)
  assert.match(stripSource, /hasFinhayLiquidity && finite\(finhayLiquidity\?\.volume\)/)
  assert.match(stripSource, /vietnamDateKey\(vnindexQuote\?\.updatedAt \?\? ""\) === contextSessionDate/)
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
  assert.match(stripSource, /HOSE · Top 200 partial/)
  assert.match(stripSource, /"Top 200 partial/)

  assert.doesNotMatch(stripSource, /valueChangePercent/)
  assert.doesNotMatch(providerSource, /vndirect|yV \* yC|tV \* tC|valueChangePercent/i)
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
