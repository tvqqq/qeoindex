import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { BOARD_SECTOR_GROUPS } from "../modules/market/sectors.ts"
import {
  defaultStockFilterCriteria,
  filterBoardTickers,
  isValidDailyFilterCache,
  mergeStockFilterIntoSettings,
  normalizeStockFilterCriteria,
  stockFilterHash,
} from "../modules/market/board/stock-filter.ts"

const boardSource = readFileSync(new URL("../components/live-market-board.tsx", import.meta.url), "utf8")
const stockSource = readFileSync(new URL("../components/live-market-stock.tsx", import.meta.url), "utf8")
const sparklineSource = readFileSync(new URL("../components/sparkline.tsx", import.meta.url), "utf8")
const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8")
const perfCssSource = readFileSync(new URL("../app/market-board-performance.module.css", import.meta.url), "utf8")
const cssSource = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8")
const intradayRouteSource = readFileSync(new URL("../app/api/market/intraday/route.ts", import.meta.url), "utf8")
const boardTransitionSource = readFileSync(new URL("../components/smoothui/market-board-transition/index.tsx", import.meta.url), "utf8")
const orderbookSource = readFileSync(new URL("../components/orderbook/live-orderbook-panel.tsx", import.meta.url), "utf8")
const pillSource = readFileSync(new URL("../components/market-change-pill.tsx", import.meta.url), "utf8")

function boardColumnsAt(width: number) {
  if (width >= 1280) return 6
  if (width >= 1024) return 3
  if (width >= 640) return 2
  return 1
}

test("sector board keeps the documented 1/2/3/6 responsive grid", () => {
  assert.match(boardSource, /grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6/)
  assert.deepEqual([
    [390, boardColumnsAt(390)],
    [768, boardColumnsAt(768)],
    [1100, boardColumnsAt(1100)],
    [1279, boardColumnsAt(1279)],
    [1280, boardColumnsAt(1280)],
    [1440, boardColumnsAt(1440)],
    [1920, boardColumnsAt(1920)],
  ], [
    [390, 1],
    [768, 2],
    [1100, 3],
    [1279, 3],
    [1280, 6],
    [1440, 6],
    [1920, 6],
  ])
  assert.equal(BOARD_SECTOR_GROUPS.length, 6)
})

test("all six sector headers keep equal fixed height", () => {
  assert.match(boardSource, /<header className="[^"]*h-\[72px\][^"]*"/)
})

test("stock row keeps clipping guards and hides rank", () => {
  assert.match(stockSource, /grid min-h-\[58px\].*grid-cols-\[46px_minmax\(38px,1fr\)_68px\]/)
  assert.match(stockSource, /flex min-w-0 items-center justify-center overflow-hidden/)
  assert.match(stockSource, /max-w-full truncate font-mono text-\[13px\]/)
  assert.doesNotMatch(stockSource, /stock\.rank/)
})

test("daily performance stays anchored to reference price, never session open", () => {
  assert.match(boardSource, /STOCK_REFERENCE_KEYS/)
  assert.match(boardSource, /INDEX_REFERENCE_KEYS/)
  assert.match(boardSource, /dailyReferences\.current\[symbol\] = history\.reference/)
  assert.doesNotMatch(boardSource, /OPEN_PRICE_KEYS|INDEX_OPEN_KEYS|openingReferences|indexOpeningReferences/)
  assert.match(stockSource, /giá tham chiếu \(đóng cửa phiên trước\)/)
})

test("strong gainer highlight is static and therefore reduced-motion safe", () => {
  assert.match(stockSource, /changePercent \?\? 0\) >= 3/)
  assert.match(stockSource, /strong-gainer border-up\/60/)
  assert.match(cssSource, /\.strong-gainer\s*\{\s*border-color:/)
  assert.doesNotMatch(cssSource, /\.strong-gainer\s*\{\s*animation:/)
})

test("after-close fallback still feeds both visible price and mini chart", () => {
  assert.match(boardSource, /history\.at\(-1\)\?\.close \?\? stock\.lastClose/)
  assert.match(boardSource, /<LiveStockRow[^>]*quote=\{displayQuotes\[stock\.ticker\]/)
  assert.match(boardSource, /history=\{priceHistoryCloses\[stock\.ticker\] \?\? EMPTY_HISTORY\}/)
  assert.match(stockSource, /<Sparkline data=\{chart\}/)
  assert.match(stockSource, /formatBoardPrice\(quote\?\.price\)/)
})

test("DNSE websocket messages use animation-frame buffering without retaining closures", () => {
  assert.match(boardSource, /let messageQueue: string\[\] = \[\]/)
  assert.match(boardSource, /window\.requestAnimationFrame\(flushMessageQueue\)/)
  assert.match(boardSource, /window\.cancelAnimationFrame\(messageFrame\)/)
  assert.match(boardSource, /socket\.onmessage = \(event\) =>[\s\S]*?scheduleMessage\(event\.data\)/)
  assert.match(boardSource, /for \(const raw of queued\)/)
  assert.match(boardSource, /clearMessageQueue\(\)[\s\S]*?socket\.close\(1000, "board closed"\)/)
})

test("realtime market state uses a ref-backed store with slower React commits", () => {
  assert.match(boardSource, /const MARKET_UI_COMMIT_MS = 250/)
  assert.match(boardSource, /const MARKET_ORDERING_REFRESH_MS = 1000/)
  assert.match(boardSource, /const quotesRef = useRef<Record<string, LiveStockQuote \| IndexQuote>>\(\{ \.\.\.quotes \}\)/)
  assert.match(boardSource, /const priceHistoryRef = useRef<Record<string, IntradayPoint\[\]>>\(\{ \.\.\.priceHistory \}\)/)
  assert.match(boardSource, /const updateLiveQuote = useCallback/)
  assert.match(boardSource, /quotesRef\.current\[symbol\] = next/)
  assert.match(boardSource, /const quoteSnapshot = \{ \.\.\.quotesRef\.current \}/)
  assert.match(boardSource, /setQuotes\(quoteSnapshot\)/)
  assert.match(boardSource, /setPriceHistory\(\{ \.\.\.priceHistoryRef\.current \}\)/)
  assert.doesNotMatch(boardSource, /setLastMessageAt\(receivedAt\)/)
})

test("sector and mover ordering refresh independently from 250ms price paints", () => {
  assert.match(boardSource, /setOrderingQuotes\(latestCommittedQuotesRef\.current\)/)
  assert.match(boardSource, /compareByPerformance\(a, b, orderingQuotes\)/)
  assert.match(boardSource, /sectorQuotes = stocks[\s\S]*orderingQuotes\[stock\.ticker\]/)
  assert.doesNotMatch(boardSource, /sort\(\(a, b\) => compareByPerformance\(a, b, displayQuotes\)\)/)
})

test("browser intraday bootstrap can reuse sufficiently complete SSR history", () => {
  assert.match(boardSource, /const SSR_HISTORY_COVERAGE_MIN = 0\.95/)
  assert.match(boardSource, /const hasSufficientSsrHistory = useMemo/)
  assert.match(boardSource, /historyReloadKey === 0 && hasSufficientSsrHistory/)
})

test("dense board does not force one permanent GPU layer per stock row", () => {
  assert.match(pageSource, /market-board-performance\.module\.css/)
  assert.match(pageSource, /styles\.performanceSurface/)
  assert.doesNotMatch(cssSource, /\.board-stock-row\s*\{[^}]*translateZ\(0\)/)
  assert.match(perfCssSource, /contain: layout style/)
  assert.match(perfCssSource, /backdrop-filter: none !important/)
})

test("SmoothUI entrance visibly staggers indexes and sector columns only once on load", () => {
  assert.match(pageSource, /MarketBoardTransition/)
  assert.match(boardTransitionSource, /LazyMotion/)
  assert.match(boardTransitionSource, /domAnimation/)
  assert.match(boardTransitionSource, /useAnimate/)
  assert.match(boardTransitionSource, /useReducedMotion/)
  assert.match(boardTransitionSource, /stagger\(0\.065/)
  assert.match(boardTransitionSource, /INDEX_CARD_SELECTOR = ":scope > div > div:first-child > div"/)
  assert.match(boardTransitionSource, /SECTOR_PANEL_SELECTOR = "section"/)
  assert.match(boardTransitionSource, /translate3d\(0, -28px, 0\) scale\(0\.965\)/)
  assert.match(boardTransitionSource, /translate3d\(0, 48px, 0\) scale\(0\.975\)/)
  assert.match(boardTransitionSource, /from: "center", startDelay: 0\.16/)
  assert.match(boardTransitionSource, /duration: 0\.36/)
  assert.match(boardTransitionSource, /duration: 0\.4/)
  assert.match(boardTransitionSource, /hasPlayedRef\.current = true/)
  assert.match(boardTransitionSource, /data-market-board-transition="load-only"/)
  assert.doesNotMatch(boardTransitionSource, /AnimatePresence|layoutId|\blayout=/)
  assert.doesNotMatch(boardTransitionSource, /filter:|blur\(/)
  assert.doesNotMatch(boardTransitionSource, /will-change\s*:/)
  assert.doesNotMatch(stockSource, /from "motion\/react"/)
  assert.doesNotMatch(perfCssSource, /main section:hover/)
  assert.doesNotMatch(perfCssSource, /will-change\s*:/)
})

test("sparklines keep the pre-regression 5m history and live fallback pipeline", () => {
  assert.match(sparklineSource, /function sparklinePropsEqual/)
  assert.match(sparklineSource, /const stableLength = Math\.max\(0, a\.length - 1\)/)
  assert.match(sparklineSource, /memo\(function Sparkline[\s\S]*sparklinePropsEqual\)/)
  assert.match(stockSource, /const chart = showChart \? sparkData\(history, quote\?\.price\) : \[\]/)
  assert.match(boardSource, /nextHistory\[symbol\] = points\.slice\(-90\)/)
  assert.match(boardSource, /out\[ticker\] = pts\.map\(\(p\) => p\.close\)/)
})

test("intraday API prefers today's cached snapshot before expensive provider fan-out", () => {
  assert.match(intradayRouteSource, /getCachedIntraday5mSnapshot/)
  assert.match(intradayRouteSource, /cacheLayer = snapshot \? "cache" : "provider"/)
  assert.match(intradayRouteSource, /getIntraday5mSnapshot/)
  assert.doesNotMatch(intradayRouteSource, /fetchSnapshot/)
})

test("09:00 session reset clears board and every open orderbook atomically", () => {
  assert.match(boardSource, /const resetForNewTradingSession = useCallback/)
  assert.match(boardSource, /window\.dispatchEvent\(new CustomEvent\(MARKET_SESSION_RESET_EVENT/)
  assert.match(boardSource, /priceHistoryRef\.current = resetHistory/)
  assert.match(orderbookSource, /window\.addEventListener\(MARKET_SESSION_RESET_EVENT, resetSession\)/)
  assert.match(orderbookSource, /sessionOrderBookCache\.clear\(\)/)
  assert.match(orderbookSource, /depthRef\.current = \{ bids: \[\], asks: \[\] \}/)
  assert.match(orderbookSource, /setTrades\(\[\]\)/)
})

test("ATO hides mini charts and DNSE OHLC updates only one 5-minute bucket", () => {
  assert.match(boardSource, /showChart=\{marketUiPhase !== "ATO"\}/)
  assert.match(boardSource, /shouldAcceptRealtimeMiniChart\(timestampSeconds\)/)
  assert.match(stockSource, /const chart = showChart \? sparkData\(history, quote\?\.price\) : \[\]/)
  assert.match(orderbookSource, /const bucket = Math\.floor\(timestamp \/ 300\) \* 300/)
  assert.match(orderbookSource, /lastMiniChartBucket\.current === bucket/)
})

test("stock prices render in clean white with color-toned percentage pills", () => {
  assert.match(stockSource, /quote \? "text-white" : "text-muted-2"/)
  assert.match(pillSource, /text-\[12\.5px\]/)
  assert.match(pillSource, /text-emerald-400 bg-emerald-500/)
  assert.match(pillSource, /text-rose-400 bg-rose-500/)
  assert.match(pillSource, /text-amber-400 bg-amber-500/)
})

test("market board filter defaults to all exchanges and raw sectors", () => {
  const criteria = defaultStockFilterCriteria(["Ngân hàng", "Bất động sản"], "2026-09-03T07:00:00.000Z")
  assert.deepEqual(criteria.exchanges, ["HOSE", "HNX", "UPCOM"])
  assert.deepEqual(criteria.sectors, ["Bất động sản", "Ngân hàng"])
  assert.equal(criteria.minPriceVnd, null)
  assert.equal(criteria.minVolumeShares, null)
})

test("market board filter normalization removes unsupported values and zero thresholds", () => {
  const criteria = normalizeStockFilterCriteria({
    version: 1,
    exchanges: ["HNX", "INVALID", "HNX", "HOSE"],
    minPriceVnd: 0,
    minVolumeShares: "0",
    sectors: ["Ngân hàng", "Unknown", "Ngân hàng"],
    updatedAt: "stale",
  }, ["Ngân hàng", "Bất động sản"], "2026-09-03T07:00:00.000Z")

  assert.ok(criteria)
  assert.deepEqual(criteria.exchanges, ["HOSE", "HNX"])
  assert.deepEqual(criteria.sectors, ["Ngân hàng"])
  assert.equal(criteria.minPriceVnd, null)
  assert.equal(criteria.minVolumeShares, null)
  assert.equal(criteria.updatedAt, "2026-09-03T07:00:00.000Z")
  assert.equal(normalizeStockFilterCriteria({ exchanges: [], sectors: ["Ngân hàng"] }, ["Ngân hàng"]), null)
  assert.equal(normalizeStockFilterCriteria({ exchanges: ["HOSE"], sectors: [] }, ["Ngân hàng"]), null)
})

test("market board filter combines exchange price avg50 liquidity and KFSP sector", () => {
  const stocks = [
    { ticker: "VCB", exchange: "HOSE", kfspSector: "Ngân hàng", lastClose: 80, averageVolume50d: 1_500_000 },
    { ticker: "SHB", exchange: "HNX", kfspSector: "Ngân hàng", lastClose: 12, averageVolume50d: 900_000 },
    { ticker: "CEO", exchange: "HNX", kfspSector: "Bất động sản", lastClose: 18, averageVolume50d: 2_000_000 },
  ]
  const quotes = {
    VCB: { price: 81, volume: 10_000 },
    SHB: { price: 12.5, volume: 8_000_000 },
    CEO: { price: 19, volume: 9_000_000 },
  }
  const criteria = normalizeStockFilterCriteria({
    version: 1,
    exchanges: ["HOSE"],
    minPriceVnd: 20,
    minVolumeShares: 1_000_000,
    sectors: ["Ngân hàng"],
  }, ["Ngân hàng", "Bất động sản"], "2026-09-03T07:00:00.000Z")!

  assert.deepEqual(filterBoardTickers(stocks, quotes, criteria), ["VCB"])
})

test("market board filter uses last close for price only and rejects missing avg50 liquidity", () => {
  const stock = [{ ticker: "VCB", exchange: "HOSE", kfspSector: "Ngân hàng", lastClose: 80 }]
  const priceOnly = normalizeStockFilterCriteria({ exchanges: ["HOSE"], minPriceVnd: 70, sectors: ["Ngân hàng"] }, ["Ngân hàng"])!
  const withLiquidity = normalizeStockFilterCriteria({ exchanges: ["HOSE"], minPriceVnd: 70, minVolumeShares: 1, sectors: ["Ngân hàng"] }, ["Ngân hàng"])!

  assert.deepEqual(filterBoardTickers(stock, {}, priceOnly), ["VCB"])
  assert.deepEqual(filterBoardTickers(stock, {}, withLiquidity), [])
})

test("market board filter hash ignores updatedAt and daily cache validates full identity", () => {
  const a = normalizeStockFilterCriteria({ exchanges: ["HNX", "HOSE"], sectors: ["Ngân hàng"], updatedAt: "a" }, ["Ngân hàng"], "2026-09-03T07:00:00.000Z")!
  const b = normalizeStockFilterCriteria({ exchanges: ["HOSE", "HNX"], sectors: ["Ngân hàng"], updatedAt: "b" }, ["Ngân hàng"], "2026-09-03T08:00:00.000Z")!
  const filterHash = stockFilterHash(a)
  assert.equal(filterHash, stockFilterHash(b))

  const cache = {
    version: 1,
    userId: "user-1",
    vietnamDate: "2026-09-03",
    universeRunId: "run-1",
    filterHash,
    tickers: ["VCB"],
    resolvedAt: "2026-09-03T07:00:00.000Z",
  }
  const expected = { userId: "user-1", vietnamDate: "2026-09-03", universeRunId: "run-1", filterHash, universeSymbols: ["VCB", "FPT"] }
  assert.equal(isValidDailyFilterCache(cache, expected), true)
  assert.equal(isValidDailyFilterCache({ ...cache, userId: "user-2" }, expected), false)
  assert.equal(isValidDailyFilterCache({ ...cache, vietnamDate: "2026-09-04" }, expected), false)
  assert.equal(isValidDailyFilterCache({ ...cache, universeRunId: "run-2" }, expected), false)
  assert.equal(isValidDailyFilterCache({ ...cache, filterHash: "other" }, expected), false)
  assert.equal(isValidDailyFilterCache({ ...cache, tickers: ["GHOST"] }, expected), false)
})

test("market board filter preference merge preserves unrelated settings", () => {
  const criteria = defaultStockFilterCriteria(["Ngân hàng"], "2026-09-03T07:00:00.000Z")
  const merged = mergeStockFilterIntoSettings({ theme: "dark", marketBoard: { density: "compact" } }, criteria)
  assert.deepEqual(merged, {
    theme: "dark",
    marketBoard: {
      density: "compact",
      stockFilter: criteria,
    },
  })
})