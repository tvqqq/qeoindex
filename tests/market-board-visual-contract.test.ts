import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { BOARD_SECTOR_GROUPS } from "../lib/market-sectors.ts"

const boardSource = readFileSync(new URL("../components/live-market-board-v2.tsx", import.meta.url), "utf8")
const stockSource = readFileSync(new URL("../components/live-market-stock.tsx", import.meta.url), "utf8")
const cssSource = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8")

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
  assert.match(boardSource, /history=\{\(priceHistory\[stock\.ticker\] \?\? \[\]\)\.map/)
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

test("realtime market state is buffered outside React and committed at a bounded UI rate", () => {
  assert.match(boardSource, /const MARKET_UI_COMMIT_MS = 100/)
  assert.match(boardSource, /const quotesRef = useRef\(quotes\)/)
  assert.match(boardSource, /const priceHistoryRef = useRef\(priceHistory\)/)
  assert.match(boardSource, /const updateLiveQuotes = useCallback/)
  assert.match(boardSource, /const updateLiveHistory = useCallback/)
  assert.match(boardSource, /setQuotes\(quotesRef\.current\)/)
  assert.match(boardSource, /setPriceHistory\(priceHistoryRef\.current\)/)
  assert.doesNotMatch(boardSource, /setLastMessageAt\(receivedAt\)/)
})
