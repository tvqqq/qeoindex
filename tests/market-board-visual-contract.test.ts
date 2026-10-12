import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import {
  DNSE_NORMAL_USER_CHANNEL_LIMIT,
  buildDnseBoardSubscriptionPlan,
  rewriteDnseBoardSubscriptionMessage,
  synthesizeDnseOhlcFromTickMessage,
} from "../modules/market/board/dnse-subscriptions.ts"
import {
  defaultStockFilterCriteria,
  filterBoardTickers,
  isValidDailyFilterCache,
  mergeStockFilterIntoSettings,
  normalizeStockFilterCriteria,
  stockFilterHash,
} from "../modules/market/board/stock-filter.ts"

const boardSource = readFileSync(new URL("../components/live-market-board.tsx", import.meta.url), "utf8")
const dnseMarketFrameSource = readFileSync(new URL("../modules/market/board/dnse-market-frame.ts", import.meta.url), "utf8")
const stockSource = readFileSync(new URL("../components/live-market-stock.tsx", import.meta.url), "utf8")
const sparklineSource = readFileSync(new URL("../components/sparkline.tsx", import.meta.url), "utf8")
const pageSource = readFileSync(new URL("../app/board/page.tsx", import.meta.url), "utf8")
const perfCssSource = readFileSync(new URL("../app/market-board-performance.module.css", import.meta.url), "utf8")
const cssSource = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8")
const intradayRouteSource = readFileSync(new URL("../app/api/market/intraday/route.ts", import.meta.url), "utf8")
const boardTransitionSource = readFileSync(new URL("../components/smoothui/market-board-transition/index.tsx", import.meta.url), "utf8")
const orderbookSource = readFileSync(new URL("../components/orderbook/live-orderbook-panel.tsx", import.meta.url), "utf8")
const largeTradeNoticeSource = readFileSync(new URL("../components/orderbook/large-trade-notice.tsx", import.meta.url), "utf8")
const pillSource = readFileSync(new URL("../components/market-change-pill.tsx", import.meta.url), "utf8")
const marketStreamSource = readFileSync(new URL("../modules/market/providers/dnse/market-stream.ts", import.meta.url), "utf8")
const marketRuntimeSource = readFileSync(new URL("../modules/market/providers/dnse/market-runtime.ts", import.meta.url), "utf8")
const priceboardSource = readFileSync(new URL("../components/market-board/industry-priceboard.tsx", import.meta.url), "utf8")
const contextStripSource = readFileSync(new URL("../components/market-board/market-context-strip.tsx", import.meta.url), "utf8")
const screenshotSource = readFileSync(new URL("../modules/shared/media/screenshot.ts", import.meta.url), "utf8")



test("orderbook popup places vertical activity navigation beside responsive content", () => {
  const depthCard = orderbookSource.indexOf("data-orderbook-depth-card")
  const depthBar = orderbookSource.indexOf("data-orderbook-depth-progress")
  const layout = orderbookSource.indexOf("data-orderbook-activity-layout")
  const nav = orderbookSource.indexOf("data-orderbook-activity-nav", layout)
  const tabs = orderbookSource.indexOf("data-orderbook-activity-tabs", nav)
  const pane = orderbookSource.indexOf("data-orderbook-activity-pane", tabs)
  const tradesGrid = orderbookSource.indexOf("@min-[620px]:grid-cols-[1.18fr_1fr]", pane)
  const tradeCard = orderbookSource.indexOf("data-orderbook-trade-card", tradesGrid)
  const filters = orderbookSource.indexOf("data-orderbook-trade-filters", tradeCard)
  const tradeHeading = orderbookSource.indexOf("<span>Thời gian</span>", filters)
  const tradeRows = orderbookSource.indexOf("{visibleTrades.length ? <div", tradeHeading)
  const foreignCard = orderbookSource.indexOf("<ForeignRealtimeCard foreign=", tradeRows)

  assert.ok(depthCard >= 0 && depthCard < depthBar && depthBar < layout)
  assert.ok(layout < nav && nav < tabs && tabs < pane && pane < tradesGrid)
  assert.ok(tradesGrid < tradeCard && tradeCard < filters && filters < tradeHeading && tradeHeading < tradeRows && tradeRows < foreignCard)
  assert.match(orderbookSource, /data-orderbook-activity-layout className="flex min-h-0 flex-1 px-2 py-2"/)
  assert.match(orderbookSource, /data-orderbook-activity-nav aria-label="Loại giao dịch" className="relative z-10 w-\[88px\] shrink-0 self-stretch rounded-l-xl bg-\[#0c1015\] py-1 pl-1"/)
  assert.match(orderbookSource, /data-orderbook-activity-tabs className="flex flex-col gap-1"/)
  assert.match(orderbookSource, /data-orderbook-activity-pane className=\{\`@container relative z-0 flex min-w-0 flex-1 flex-col rounded-r-xl border/)
  assert.match(orderbookSource, /grid grid-cols-1 items-start gap-2\.5 @min-\[620px\]:grid-cols-\[1\.18fr_1fr\]/)
  assert.match(orderbookSource, /grid grid-cols-2 gap-2\.5 @min-\[580px\]:grid-cols-4/)
  assert.match(orderbookSource, /relative flex min-h-14 w-full flex-col items-center justify-center gap-1/)
  assert.match(orderbookSource, /z-20 -mr-px rounded-l-md rounded-r-none \$\{ACTIVITY_TAB_STYLES\[tab\]\.selected\}/)
  assert.match(orderbookSource, /data-orderbook-selected-seam aria-hidden="true" className="pointer-events-none absolute -right-\[2px\] inset-y-0 w-\[3px\] bg-inherit"/)
  assert.equal((orderbookSource.match(/ACTIVITY_TAB_STYLES\[activityTab\]\.border/g) ?? []).length, 1)
  for (const [tab, color] of [["trades", "emerald"], ["foreign", "sky"], ["profile", "violet"], ["putthrough", "amber"]] as const) {
    assert.ok(orderbookSource.includes(`${tab}: { border: "border-${color}-400/60", selected: "bg-${color}-500/20 text-${color}-300", icon: "text-${color}-400/70" }`))
    assert.ok(orderbookSource.includes(`["${tab}",`))
  }
  const navShell = orderbookSource.slice(nav, tabs)
  assert.doesNotMatch(navShell, /border border-r-0|ACTIVITY_TAB_STYLES\[activityTab\]\.border/)
  const selectedButton = orderbookSource.slice(orderbookSource.indexOf("data-orderbook-activity-tab={tab}", tabs), pane)
  assert.doesNotMatch(selectedButton, /border border-r-0|border-\$\{theme\}/)
  assert.match(selectedButton, /rounded-l-md rounded-r-none \$\{ACTIVITY_TAB_STYLES\[tab\]\.selected\}/)
  assert.match(orderbookSource, /data-orderbook-activity-tab=\{tab\}/)
  assert.doesNotMatch(orderbookSource, /bg-\$\{theme\}|border-\$\{theme\}|text-\$\{theme\}/)
  assert.match(orderbookSource, /<Icon className=\{\`size-4 shrink-0 \$\{activityTab === tab \? "" : ACTIVITY_TAB_STYLES\[tab\]\.icon\}\`/)
  assert.match(orderbookSource, /<span className="whitespace-nowrap">\{label\}<\/span>/)
  assert.match(orderbookSource, /aria-pressed=\{activityTab === tab\}/)
  assert.match(orderbookSource, /disabled=\{!isWsReady\}/)
  assert.match(orderbookSource, /onClick=\{\(\) => setActivityTab\(tab\)\}/)
  assert.match(orderbookSource, /tab === "putthrough" && stream\.putThroughDeals\.length > 0/)
  assert.doesNotMatch(orderbookSource.slice(depthCard, layout), /data-orderbook-activity-nav/)
  assert.match(orderbookSource, /data-orderbook-trade-filters className="grid w-full grid-cols-3 gap-0\.5 border-b/)
  assert.equal((orderbookSource.slice(filters, tradeHeading).match(/flex min-w-0 w-full items-center justify-center/g) ?? []).length, 3)
  const depthSides = orderbookSource.indexOf("data-orderbook-depth-sides", depthCard)
  const depthHeader = orderbookSource.indexOf('grid-cols-[minmax(0,1fr)_80px_60px_80px_minmax(0,1fr)]', depthSides)
  const depthRows = orderbookSource.indexOf("OrderBookDepthRow key={rowIndex}", depthHeader)
  const balance = orderbookSource.indexOf("data-orderbook-depth-balance", depthRows)
  const buyPill = orderbookSource.indexOf("data-orderbook-buy-metrics", balance)
  const sellPill = orderbookSource.indexOf("data-orderbook-sell-metrics", buyPill)
  const auction = orderbookSource.indexOf("data-orderbook-auction-meta", sellPill)
  assert.ok(depthCard < depthSides && depthSides < depthHeader && depthHeader < depthRows && depthRows < balance && balance < depthBar && depthBar < buyPill && buyPill < sellPill && sellPill < layout)
  assert.match(orderbookSource, /grid-cols-\[minmax\(0,1fr\)_80px_60px_80px_minmax\(0,1fr\)\] gap-x-1 text-xs font-bold/)
  assert.equal((orderbookSource.match(/grid-cols-\[minmax\(0,1fr\)_80px_60px_80px_minmax\(0,1fr\)\] gap-x-1/g) ?? []).length, 2)
  assert.doesNotMatch(orderbookSource, /grid-cols-\[minmax\(0,1fr\)_80px_104px_80px_minmax\(0,1fr\)\]/)
  assert.match(orderbookSource, /<span className="text-right px-1">Giá Mua<\/span>/)
  assert.match(orderbookSource, /<span className="text-left px-1">Giá Bán<\/span>/)
  assert.match(orderbookSource, /text-right font-bold px-1 rounded transition-colors \$\{getPriceColorClass\(bid\?\.price/)
  assert.match(orderbookSource, /text-left font-bold px-1 rounded transition-colors \$\{getPriceColorClass\(ask\?\.price/)
  assert.match(orderbookSource, /data-orderbook-depth-sides className="relative"/)
  assert.match(orderbookSource, /className="relative mt-0\.5 space-y-0\.5 font-mono text-\[13px\]"/)
  assert.doesNotMatch(orderbookSource, /data-orderbook-balance-label|>Tỷ lệ<\/span>/)
  assert.match(orderbookSource.slice(depthHeader, depthRows), /<span aria-hidden="true" \/>/)
  assert.match(orderbookSource, /data-orderbook-depth-balance className="pointer-events-none absolute inset-y-0 left-1\/2 z-10 w-\[60px\] -translate-x-1\/2/)
  assert.match(orderbookSource, /data-orderbook-depth-progress[\s\S]*?role="progressbar"[\s\S]*?aria-label="Tỷ lệ khối lượng Mua và Bán"/)
  assert.match(orderbookSource, /aria-valuenow=\{Math\.round\(buyPct\)\}/)
  assert.ok(orderbookSource.includes('Mua ${buyPct.toFixed(1)}%, Bán ${sellPct.toFixed(1)}%'))
  assert.match(orderbookSource, /className="absolute inset-y-0 left-1\/2 w-1\.5 -translate-x-1\/2 overflow-hidden rounded-full border border-white\/20"/)
  assert.match(orderbookSource, /linear-gradient\(to bottom, #22c98a/)
  assert.doesNotMatch(orderbookSource, /linear-gradient\(to right, #10b981/)
  assert.equal(orderbookSource.split("data-orderbook-depth-progress").length - 1, 1)
  const centerRail = orderbookSource.slice(balance, orderbookSource.indexOf("\n                  </div>\n                </div>\n              </div>", sellPill))
  assert.ok(centerRail.length > 0)
  assert.match(centerRail, /data-orderbook-buy-metrics className="absolute left-1\/2 top-1\/4 z-20 inline-flex -translate-x-1\/2 -translate-y-1\/2/)
  assert.match(centerRail, /data-orderbook-sell-metrics className="absolute left-1\/2 top-3\/4 z-20 inline-flex -translate-x-1\/2 -translate-y-1\/2/)
  assert.equal((centerRail.match(/>\{(?:buyPct|sellPct)\.toFixed\(1\)\}%<\/span>/g) ?? []).length, 2)
  assert.match(centerRail, /<span className="sr-only">Mua <\/span>\{buyPct\.toFixed\(1\)\}%/)
  assert.match(centerRail, /<span className="sr-only">Bán <\/span>\{sellPct\.toFixed\(1\)\}%/)
  assert.match(centerRail, /rounded-\[4px\] border border-emerald-400\/45 bg-\[#102e29\]\/95/)
  assert.match(centerRail, /rounded-\[4px\] border border-rose-400\/45 bg-\[#351d24\]\/95/)
  assert.doesNotMatch(centerRail, /formatCompactVolume|>KL |<span>Mua |<span>Bán /)
  assert.ok(orderbookSource.includes("const buyPct = depthTotal > 0 ? (bidTotal / depthTotal) * 100 : 50"))
  const depthRowSection = orderbookSource.slice(orderbookSource.indexOf("function OrderBookDepthRow("), orderbookSource.indexOf("export function LiveOrderBookPanel("))
  assert.match(depthRowSection, /grid-cols-\[minmax\(0,1fr\)_80px_60px_80px_minmax\(0,1fr\)\] gap-x-1/)
  assert.match(depthRowSection, /<span aria-hidden="true" className="relative" \/>/)
  assert.ok(auction > sellPill && auction < layout)
  assert.match(orderbookSource, /sessionCountdown \? <div data-orderbook-auction-meta className="mt-1\.5 flex flex-col items-center justify-center gap-1 border-t/)
  assert.match(orderbookSource, /activeAuctionExpected \? formatPrice\(activeAuctionExpected\.price\) : "—"/)
  for (const filter of ["all", "large", "whale"]) {
    assert.ok(orderbookSource.includes(`aria-pressed={tradeFilter === "${filter}"}`))
  }
  const filterContent = orderbookSource.slice(filters, tradeHeading)
  for (const label of ["Tất cả", "Cá con", "Cá mập"]) {
    assert.ok(filterContent.includes(`<span>${label}</span>`))
  }
  for (const count of ["clusteredTrades.length", "largeTradeCount", "whaleTradeCount"]) {
    assert.ok(filterContent.includes(`>{${count}}</span>`))
  }
  assert.match(filterContent, /title=\{`Cá con ≥10K:/)
  assert.match(filterContent, /title=\{`Cá mập \$\{whaleLabel\}:/)
  assert.doesNotMatch(filterContent, /<span>Tất cả \(/)
  assert.doesNotMatch(filterContent, /<span>Cá con ≥10K<\/span>/)
  assert.doesNotMatch(filterContent, /<span>Cá mập \{whaleLabel\}<\/span>/)
  assert.match(orderbookSource, /\{visibleTrades\.length \? <div[\s\S]*?"Không có lệnh thỏa mãn bộ lọc\."/)
  for (const marker of ["data-orderbook-activity-nav", "data-orderbook-activity-tabs", "data-orderbook-activity-layout", "data-orderbook-activity-pane", "data-orderbook-trade-card", "data-orderbook-trade-filters"]) {
    assert.equal(orderbookSource.split(marker).length - 1, 1)
  }
})

test("orderbook large trades use a bounded two-second lightweight notice without row tags or Lottie", () => {
  assert.match(orderbookSource, /import \{ useLargeTradeNotice, LargeTradeNotice \} from "@\/components\/orderbook\/large-trade-notice"/)
  assert.match(orderbookSource, /<LargeTradeNotice notice=\{largeTradeNotice\.notice\} \/>/)
  assert.match(orderbookSource, /isRecentLarge = largeTradeNotice\.notice\?\.tradeId === trade\.id/)
  assert.match(orderbookSource, /\$\{isRecentLarge \|\| isAto \|\| isAtc \?/)
  assert.doesNotMatch(orderbookSource, /10K\+|30K\+|50K\+|🐋|tagBadgeClass|isWhaleGlow|ConfettiOverlay|useWhaleConfetti/)
  assert.match(orderbookSource, /if \(!newest\) newest = t/)
  assert.match(orderbookSource, /if \(largeTradeNotice\.fire\(/)
  assert.match(orderbookSource, /if \(t\.volume < LARGE_TRADE_MIN_VOLUME \|\| isAtoTradeTime/)
  assert.match(largeTradeNoticeSource, /const NOTICE_DURATION_MS = 2_000/)
  assert.match(largeTradeNoticeSource, /if \(timerRef\.current !== null\) return false/)
  assert.match(largeTradeNoticeSource, /window\.setTimeout\(\(\) => \{[\s\S]*?setNotice\(null\)[\s\S]*?\}, NOTICE_DURATION_MS\)/)
  assert.match(largeTradeNoticeSource, /window\.clearTimeout\(timerRef\.current\)/)
  assert.match(largeTradeNoticeSource, /data-orderbook-large-trade-notice/)
  assert.match(largeTradeNoticeSource, /pointer-events-none absolute/)
  assert.doesNotMatch(largeTradeNoticeSource, /Lottie|lottie-react|animate-|backdrop-blur|transition-all|requestAnimationFrame/)
})
test("compact priceboard keeps fixed anchors, packs industries into lanes, and exposes a stable row hover", () => {
  assert.match(priceboardSource, /data-industry-column="watchlist" data-market-board-industry-column/)
  assert.match(priceboardSource, /data-industry-column="vn30" data-market-board-industry-column/)
  assert.match(priceboardSource, /industryLanes\.map\(\(lane, laneIndex\)/)
  assert.match(priceboardSource, /lane\.industries\.map\(\(industry\)/)
  assert.match(priceboardSource, /data-market-board-industry-lane/)
  assert.match(priceboardSource, /hover:border-white\/35/)
  assert.match(priceboardSource, /hover:brightness-110/)
  assert.doesNotMatch(priceboardSource, /transition-all/)
  assert.match(priceboardSource, /data-market-board-screenshot-rail/)
  assert.match(priceboardSource, /min-h-\[62px\]/)
  assert.match(boardSource, /mode === "sector" && boardView === "industry"/)
})

test("classic Bảng điện remains the default with the original six sector grid and chart rows", () => {
  assert.match(boardSource, /const \[boardView, setBoardView\] = useState<BoardView>\("classic"\)/)
  assert.match(boardSource, /grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6/)
  assert.match(boardSource, /data-market-board-sector-column/)
  assert.match(boardSource, /h-\[72px\]/)
  assert.match(boardSource, /<LiveStockRow[\s\S]*?history=\{priceHistoryCloses\[stock\.ticker\] \?\? EMPTY_HISTORY\}[\s\S]*?showChart=\{marketUiPhase !== "ATO"\}/)
  assert.match(boardSource, /<WatchlistSection/)
  assert.match(boardSource, /Bảng điện/)
  assert.match(boardSource, /Bảng ngành/)
})

test("intraday hour ticks use undistorted CSS-pixel sans font in both compact charts", () => {
  assert.ok(contextStripSource.includes('data-market-intraday-time-axis'))
  assert.ok(contextStripSource.includes('font-sans text-[11px] font-medium leading-none tracking-normal tabular-nums text-zinc-400'))
  assert.ok(contextStripSource.includes('left: `${100 * x(tick.minute) / width}%`'))
  assert.ok(contextStripSource.includes('"translateX(-50%)"'))
  assert.ok(contextStripSource.includes('preserveAspectRatio="none"'))
  assert.equal(contextStripSource.includes('<text key={tick.minute}'), false)
  assert.ok(contextStripSource.includes('09:00'))
  assert.ok(contextStripSource.includes('15:00'))
  assert.ok(contextStripSource.includes('<ComparisonLineChart series={['))
  assert.ok(contextStripSource.includes('<ComparisonLineChart zeroReference series={['))
})

test("market card cleanup preserves one-row desktop fit, visible breadth and expanded impact", () => {
  const summary = contextStripSource.split("function IndexedSummary(")[1]?.split("function ContextCard(")[0] ?? ""
  const impact = contextStripSource.split("function ImpactChart(")[1]?.split("export function MarketContextStrip")[0] ?? ""
  assert.ok(summary.includes("data-index-breadth-progress"))
  assert.ok(summary.includes('relative flex w-full overflow-hidden rounded-full bg-zinc-800'))
  assert.ok(summary.includes('relative mt-1 w-full font-sans font-bold tabular-nums'))
  assert.ok(summary.includes('style={{ left: `${progress.centers[0]}%` }}'))
  assert.ok(summary.includes('style={{ left: `${progress.centers[1]}%` }}'))
  assert.ok(summary.includes('style={{ left: `${progress.centers[2]}%` }}'))
  assert.ok(summary.includes('motion-safe:transition-[left]'))
  assert.ok(summary.includes('rounded-full border px-2 py-1'))
  assert.ok(impact.includes('grid h-[80px]'))
  assert.equal(impact.includes('Tổng điểm kéo tăng và kéo giảm của các mã hiển thị'), false)
  assert.equal(contextStripSource.includes("Top 200 partial</span>"), false)
  assert.ok(contextStripSource.includes('không phải tổng toàn HOSE'))
  assert.ok(contextStripSource.includes('md:h-[156px]'))
  assert.ok(contextStripSource.includes("market-header-sheen"))
})

test("combined index breadth stays bottom-aligned with direction icon before the level", () => {
  const summary = contextStripSource.split("function IndexedSummary(")[1]?.split("function ContextCard(")[0] ?? ""
  assert.ok(summary.includes('flex min-h-0 min-w-0 flex-1 flex-col'))
  assert.ok(summary.includes('mt-auto min-w-0'))
  assert.ok(summary.includes('font-extrabold leading-none tabular-nums'))
  assert.ok(summary.includes('INDEX_FORMATTER.format(value)'))
  assert.ok(summary.includes("trendIcon"))
  assert.ok(summary.includes('{finite(value) ? ('))
  assert.ok(summary.includes('>{INDEX_FORMATTER.format(value)}</strong>'))
  assert.ok(summary.includes('{finite(change) ? ('))
  assert.ok(summary.includes('<span key={change}'))
  assert.equal(summary.includes("N/A"), false)
  assert.ok(summary.includes('gap-x-3 gap-y-0.5 tabular-nums text-zinc-400'))
  assert.ok(summary.includes("<ArrowUpRight"))
  assert.ok(summary.includes("<ArrowDownRight"))
  assert.ok(summary.includes("<ArrowRight"))
  assert.ok(summary.includes('market-breadth-count-tick'))
  assert.ok(summary.includes('data-index-breadth-progress'))
  assert.ok(contextStripSource.includes('className="h-full md:h-[156px]"'))
})

test("market context numbers, chart traces, and headers honor motion reduction", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8")
  assert.ok(css.includes("@keyframes market-header-fresh-tick"))
  assert.ok(css.includes("@keyframes market-realtime-value-tick"))
  assert.ok(css.includes("@keyframes market-chart-latest-segment"))
  assert.ok(css.includes(".market-header-sheen"))
  assert.ok(css.includes(".market-realtime-number"))
  assert.ok(css.includes(".market-chart-trace"))
  assert.ok(css.includes("@keyframes market-breadth-count-change"))
  assert.ok(css.includes("@keyframes market-breadth-progress-sweep"))
  assert.ok(css.includes(".market-breadth-change-sweep"))
  assert.ok(css.includes("  .market-breadth-change-sweep,"))
  assert.ok(css.includes("@keyframes market-impact-bar-change"))
  assert.ok(css.includes("@keyframes market-impact-value-change"))
  assert.ok(css.includes(".market-breadth-count-tick"))
  assert.ok(css.includes(".market-impact-bar-tick"))
  assert.ok(css.includes(".market-impact-value-tick"))
  assert.ok(css.includes("@media (prefers-reduced-motion: reduce)"))
  assert.ok(contextStripSource.includes('pathLength={1}'))
  assert.ok(contextStripSource.includes('strokeDasharray="1"'))
  assert.ok(contextStripSource.includes('motion-safe:animate-pulse'))
  assert.ok(contextStripSource.includes('motion-safe:transition-[width]'))
  assert.ok(contextStripSource.includes('motion-safe:duration-700 motion-safe:ease-in-out'))
  assert.ok(contextStripSource.includes('motion-safe:transition-[left]'))
  assert.ok(contextStripSource.includes('key={breadthSweepRevision}'))
  assert.ok(contextStripSource.includes('key={hasBreadth ? breadth[0] : "missing"}'))
  assert.ok(contextStripSource.includes('key={entry.contribution}'))
  assert.ok(contextStripSource.includes('market-impact-bar-tick'))
  assert.ok(contextStripSource.includes('role="img"'))
  assert.equal(contextStripSource.includes('cursor-help'), false)
})

test("after 15:00 and before 09:00 metrics retain exact last trading session observations", () => {
  assert.ok(contextStripSource.includes("displayedMarketMetricDay(new Date(observedAtMs))"))
  assert.ok(contextStripSource.includes("loadRetainedFlow(metricDisplayDay)"))
  assert.ok(contextStripSource.includes("metricDisplayDay !== \"\""))
  assert.ok(contextStripSource.includes("value: last.value"))
  assert.ok(contextStripSource.includes("buy: last.buy, sell: last.sell"))
  assert.ok(contextStripSource.includes("foreignCandidate = fullForeign ?? partialForeign"))
  assert.ok(contextStripSource.includes("liquidityCandidate?.volume"))
  assert.ok(contextStripSource.includes("writeRetainedMetric(localStorage"))
  assert.ok(contextStripSource.includes('metricHistoryPrefix("liquidity", liquiditySeriesSource)'))
  assert.ok(contextStripSource.includes('metricHistoryPrefix("foreign", foreignSeriesSource)'))
  assert.ok(contextStripSource.includes("Chưa ghi nhận phiên trước"))
})

test("compact intraday flow charts keep accessible timestamps and fit original cards", () => {
  assert.ok(contextStripSource.includes('className="h-full md:h-[156px]"'))
  assert.ok(contextStripSource.includes('className="absolute inset-0 h-full w-full touch-pan-y"'))
  const plot = contextStripSource.split("function ComparisonLineChart(")[1]?.split("function MarketSessionClock(")[0] ?? ""
  assert.ok(plot.includes('className="relative flex min-h-[72px] min-w-0 flex-1 flex-col"'))
  assert.ok(plot.includes('className="relative min-h-0 flex-1"'))
  assert.ok(plot.includes('className="pointer-events-none relative h-[14px] shrink-0'))
  assert.equal(plot.includes('h-[69px]'), false)
  const liquidityCard = contextStripSource.split('title="Thanh khoản"')[1]?.split('title="Mua bán nước ngoài"')[0] ?? ""
  const foreignCard = contextStripSource.split('title="Mua bán nước ngoài"')[1]?.split('title="Tác động VNINDEX"')[0] ?? ""
  assert.equal(contextStripSource.includes('headerDetails='), false)
  assert.ok(liquidityCard.includes('formatVndValue(liquidityValue)'))
  assert.ok(liquidityCard.includes('formatCompactVolume(liquidityVolume)'))
  assert.ok(liquidityCard.includes('data-market-liquidity-value'))
  assert.ok(liquidityCard.includes('finite(liquidityValue) && liquidityValue >= 0'))
  assert.ok(liquidityCard.includes('finite(liquidityVolume) && liquidityVolume > 0'))
  assert.equal(liquidityCard.includes('>—</span>'), false)
  assert.equal(contextStripSource.includes('title="Thanh khoản HOSE"'), false)
  assert.ok(liquidityCard.includes('>KL</span>'))
  assert.ok(liquidityCard.includes('So với ${verifiedPreviousLiquidity.day}'))
  assert.ok(foreignCard.includes('formatSignedVndValue(todayForeignNet)'))
  assert.equal(foreignCard.includes('formatVndValue(todayForeignBuy)'), false)
  assert.equal(foreignCard.includes('formatVndValue(todayForeignSell)'), false)
  assert.ok(liquidityCard.includes('bodyClassName="px-2.5 pb-1 pt-0.5"'))
  assert.ok(foreignCard.includes('bodyClassName="px-2.5 pb-1 pt-0.5"'))
  assert.ok(liquidityCard.includes('flex min-h-0 min-w-0 flex-1 flex-col'))
  assert.ok(foreignCard.includes('relative flex min-h-0 min-w-0 flex-1 flex-col'))
  assert.equal(liquidityCard.includes('mt-auto'), false)
  assert.equal(foreignCard.includes('mt-auto'), false)
  assert.ok(contextStripSource.includes('preserveAspectRatio="none"'))
  assert.ok(contextStripSource.includes("(localX - left) / (width - left - right)"))
  assert.ok(contextStripSource.includes('label: "Nay"'))
  assert.ok(contextStripSource.includes('label: "Trước"'))
  assert.ok(contextStripSource.includes('label: "Ròng"'))
  assert.ok(contextStripSource.includes('onPointerMove={(event) =>'))
  assert.ok(contextStripSource.includes('onPointerLeave={() => setHoveredMinute(null)}'))
  assert.ok(contextStripSource.includes('displayedForeignBuy - displayedForeignSell'))
  assert.equal(foreignCard.includes('>Mua '), false)
  assert.equal(foreignCard.includes('>Bán '), false)
})

test("market context places ICT next to the title and removes all four bottom annotation strips", () => {
  assert.ok(contextStripSource.includes("headerInfo={chartActive ? null : <MarketSessionClock />}"))
  assert.ok(contextStripSource.includes('data-market-session-status'))
  assert.ok(contextStripSource.includes('title={`Thị trường: ${marketStatus}'))
  assert.equal(contextStripSource.includes('DNSE basketInfluence ·'), false)
  assert.equal(contextStripSource.includes('━ Hôm nay　┄ Phiên trước'), false)
  assert.equal(contextStripSource.includes('━ Ròng hôm nay'), false)
  assert.equal(contextStripSource.includes('Top 200 partial</span>'), false)
  assert.ok(contextStripSource.includes('không phải tổng toàn HOSE'))
  assert.ok(contextStripSource.includes('md:h-[156px]'))
  assert.ok(contextStripSource.includes("getMarketCardActivity({"))
  assert.equal(contextStripSource.includes("function LivePulse("), false)
})

test("market context fits one desktop row and preserves the board-view controls", () => {
  assert.match(contextStripSource, /data-market-context-single-row/)
  assert.match(contextStripSource, /sm:grid-cols-2.*md:grid-cols-\[minmax\(0,1fr\)_minmax\(0,1fr\)_minmax\(0,1\.8fr\)\] xl:grid-cols-\[/)
  assert.match(contextStripSource, /min-h-\[31px\]/)
  assert.match(contextStripSource, /minmax\(0,2\.15fr\)/)
  assert.match(contextStripSource, /title="VN-Index \/ VN30"/)
  assert.match(contextStripSource, /Tác động VNINDEX/)
  assert.match(contextStripSource, /<ImpactChart impact=\{impact\}/)
  assert.doesNotMatch(contextStripSource, /MarketDepthCard|Độ sâu thị trường|overflow-x-auto/)
  assert.match(boardSource, /const ViewIcon = view === "chart" \? ChartNoAxesCombined : view === "classic" \? Table2 : PanelsTopLeft/)
  assert.match(boardSource, /role="tablist" aria-label="Chế độ xem thị trường"/)
  assert.doesNotMatch(boardSource, />Tổng KL</)
  assert.doesNotMatch(boardSource, />Tổng GT</)
  assert.doesNotMatch(boardSource, />Khối ngoại</)
})

test("laptop market context uses four non-overflowing columns at tablet widths", () => {
  const layout = contextStripSource.split('data-market-context-strip')[1]?.split('data-market-context-single-row')[0] ?? ""
  assert.ok(layout.includes("sm:grid-cols-2"))
  assert.ok(layout.includes("md:grid-cols-["))
  assert.ok(layout.includes("minmax(0,2.15fr)_minmax(0,1.35fr)_minmax(0,1.25fr)_minmax(0,1.75fr)"))
  assert.equal((contextStripSource.match(/md:h-\[156px\]/g) ?? []).length, 4)
})

test("VNIndex Chart is the first board tab and replaces board-only content without a modal", () => {
  const workspaceSource = readFileSync(new URL("../components/index-chart/index-chart-workspace.tsx", import.meta.url), "utf8")
  const modalSource = readFileSync(new URL("../components/index-chart/index-chart-modal.tsx", import.meta.url), "utf8")
  assert.match(boardSource, /const BOARD_VIEW_TABS: readonly BoardView\[\] = \["chart", "classic", "industry"\]/)
  assert.match(boardSource, /stored === "chart" \|\| stored === "industry" \? stored : "classic"/)
  assert.match(boardSource, /BOARD_VIEW_TABS\.map\(\(view\) =>/)
  assert.match(boardSource, /const label = view === "chart" \? "Chart 1m"/)
  assert.match(boardSource, /BOARD_VIEW_TABS\[\(index \+ 1\) % BOARD_VIEW_TABS\.length\]/)
  assert.match(boardSource, /aria-labelledby={`market-board-view-\$\{boardView\}-tab`}/)
  assert.match(boardSource, /boardView === "chart" \? \(\s*<IndexChartWorkspace showContextSummary=\{showMarketContext\} \/>/)
  assert.match(boardSource, /boardView !== "chart" \? <div className="flex flex-wrap items-center justify-end/)
  assert.match(boardSource, /boardView !== "chart" && streamState !== "LIVE"/)
  assert.doesNotMatch(boardSource, /<IndexChartModal|setIndexChartOpen/)
  assert.match(workspaceSource, /useIndexCandles\(true, "1"\)/)
  assert.match(workspaceSource, /<IndexChartContent/)
  assert.match(workspaceSource, /data-market-board-index-chart/)
  assert.doesNotMatch(workspaceSource, /VN Market · Multi-timeframe|DNSE HISTORY|DNSE LIVE|<header/)
  assert.match(workspaceSource, /onRefresh=\{refresh\}/)
  assert.match(workspaceSource, /isRefreshing=\{isRefreshing\}/)
  assert.match(modalSource, /onRefresh\?: \(\) => void/)
  assert.match(modalSource, /aria-label="Làm mới dữ liệu biểu đồ"/)
  assert.match(modalSource, /export function IndexChartContent\(/)
  assert.match(modalSource, /<ChartCard symbol="VNINDEX"/)
  assert.match(modalSource, /<ChartCard symbol="VN30F1M"/)
})

test("compact Chart 1m places each source-backed market summary in its chart header", () => {
  const workspace = readFileSync(new URL("../components/index-chart/index-chart-workspace.tsx", import.meta.url), "utf8")
  const sharedChart = readFileSync(new URL("../components/index-chart/index-chart-modal.tsx", import.meta.url), "utf8")
  const card = contextStripSource.split("const indexSummaryCard = (")[1]?.split("  return (")[0] ?? ""
  assert.ok(boardSource.includes('chartActive={boardView === "chart"}'))
  assert.ok(boardSource.includes("showContext={showMarketContext}"))
  assert.ok(boardSource.includes("<IndexChartWorkspace showContextSummary={showMarketContext} />"))
  assert.ok(contextStripSource.includes('window.matchMedia("(max-width: 1279px)")'))
  assert.ok(contextStripSource.includes("chartActive && showContext && compactScreen && chartSummaryTarget !== null"))
  assert.ok(contextStripSource.includes('document.getElementById("market-board-chart-vnindex-header")'))
  assert.ok(contextStripSource.includes('document.getElementById("market-board-chart-vn30-header")'))
  assert.ok(contextStripSource.includes("createPortal(vn30Summary, chartSummaryTarget.vn30)"))
  assert.ok(contextStripSource.includes("chartSummaryTarget.vnindex"))
  assert.ok(contextStripSource.includes('label={moveIndexSummary ? "VN30 (cơ sở)" : "VN30"}'))
  assert.ok(contextStripSource.includes("chartHeader={moveIndexSummary}"))
  assert.ok(contextStripSource.includes("const vnindexSummary = ("))
  assert.ok(contextStripSource.includes("const vn30Summary = ("))
  assert.ok(card.includes("{vnindexSummary}") && card.includes("{vn30Summary}"))
  assert.ok(card.includes("headerInfo={chartActive ? null : <MarketSessionClock />}"))
  assert.ok(workspace.includes("showContextSummary={showContextSummary}"))
  assert.ok(sharedChart.includes('market-board-chart-vnindex-header'))
  assert.ok(sharedChart.includes('market-board-chart-vn30-header'))
  assert.ok(sharedChart.includes('compact && showContextSummary ? "hidden xl:flex" : "flex"'))
  assert.ok(sharedChart.includes('data-market-chart-spot-summary'))
  assert.ok(sharedChart.includes('showContextSummary={showContextSummary}'))
  assert.ok(sharedChart.includes('h-[160px]'))
  assert.ok(sharedChart.includes("onClick={onRefresh}"))
  assert.equal(sharedChart.includes('id="market-board-chart-index-summary"'), false)
})

test("compact Chart 1m widens impact while retaining the original four-card desktop row", () => {
  const card = contextStripSource.split("const indexSummaryCard = (")[1]?.split("  return (")[0] ?? ""
  assert.ok(contextStripSource.includes("chartActive && showContext ?"))
  assert.ok(contextStripSource.includes("md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.8fr)]"))
  assert.ok(contextStripSource.includes("xl:grid-cols-[minmax(0,2.15fr)_minmax(0,1.35fr)_minmax(0,1.25fr)_minmax(0,1.75fr)]"))
  assert.ok(contextStripSource.includes("moveIndexSummary && chartSummaryTarget ?"))
  assert.ok(contextStripSource.includes("createPortal("))
  assert.ok(card.includes("headerInfo={chartActive ? null : <MarketSessionClock />}"))
  assert.equal(card.includes("headerRight="), false)
  assert.equal(card.includes("ChartNoAxesCombined"), false)
})

test("Chart 1m compact headers are equal-height and footer owns ICT and one refresh", () => {
  const chart = readFileSync(new URL("../components/index-chart/index-chart-modal.tsx", import.meta.url), "utf8")
  const header = chart.split('data-market-chart-spot-summary={symbol === "VNINDEX" ? "VNINDEX" : "VN30"}')[0] ?? ""
  const footer = chart.split('<footer className="flex shrink-0')[1]?.split("</footer>")[0] ?? ""
  const summary = contextStripSource.split("function IndexedSummary(")[1]?.split("function ContextCard(")[0] ?? ""

  assert.ok(chart.includes('id={symbol === "VNINDEX" ? "market-board-chart-vnindex-header" : "market-board-chart-vn30-header"}'))
  assert.ok(chart.includes('className="relative h-[160px] min-w-0 border-b border-emerald-400/20 bg-[#111511] xl:hidden"'))
  assert.ok(chart.includes('className="h-full min-w-0"'))
  assert.ok(summary.includes('chartHeader ? "h-[160px] px-4 py-3"'))
  assert.ok(summary.includes('chartHeader ? "text-base"'))
  assert.ok(summary.includes('chartHeader ? "text-[clamp(20px,2vw,27px)]"'))
  assert.ok(summary.includes('chartHeader ? "text-[clamp(16px,1.45vw,20px)]"'))
  assert.ok(summary.includes('chartHeader ? "mt-2 text-xs"'))
  assert.ok(summary.includes('chartHeader ? "h-[18px] text-xs leading-[18px]"'))
  assert.ok(footer.includes('id="market-board-chart-ict-clock"'))
  assert.ok(footer.includes('onClick={onRefresh}'))
  assert.ok(footer.includes('disabled={isRefreshing}'))
  assert.ok(footer.includes("Làm mới hai biểu đồ realtime"))
  assert.ok(footer.includes("<span>Refresh</span>"))
  assert.ok(contextStripSource.includes('document.getElementById("market-board-chart-ict-clock")'))
  assert.ok(contextStripSource.includes('chartActive && chartSummaryTarget ? createPortal(<MarketSessionClock />, chartSummaryTarget.clock)'))
  assert.ok(contextStripSource.includes('headerInfo={chartActive ? null : <MarketSessionClock />}'))
  assert.equal(header.includes("onClick={onRefresh}"), false)
  assert.equal(chart.includes("History theo timeframe từ DNSE"), false)
})

test("Chart 1m, Bảng điện and Bảng ngành have distinct selected tab icons and tones", () => {
  assert.ok(boardSource.includes('const label = view === "chart" ? "Chart 1m"'))
  assert.ok(boardSource.includes('const ViewIcon = view === "chart" ? ChartNoAxesCombined : view === "classic" ? Table2 : PanelsTopLeft'))
  assert.ok(boardSource.includes('const selectedTone = view === "chart"'))
  for (const tone of ["cyan-400/45", "emerald-400/45", "amber-400/45"]) {
    assert.ok(boardSource.includes(tone))
  }
  assert.ok(boardSource.includes('const selectedIconTone = view === "chart"'))
  assert.ok(boardSource.includes("isSelected ? selectedTone"))
  assert.ok(boardSource.includes("isSelected ? selectedIconTone"))
})

test("inline Chart 1m hides timeframe and OHLCV chrome but retains chart and refresh", () => {
  const workspace = readFileSync(new URL("../components/index-chart/index-chart-workspace.tsx", import.meta.url), "utf8")
  const sharedChart = readFileSync(new URL("../components/index-chart/index-chart-modal.tsx", import.meta.url), "utf8")
  assert.ok(workspace.includes('useIndexCandles(true, "1")'))
  assert.ok(workspace.includes('resolution="1"'))
  assert.ok(workspace.includes("compact"))
  assert.doesNotMatch(workspace, /onResolutionChange=|setResolution/)
  assert.ok(sharedChart.includes("{!compact ? ("))
  assert.ok(sharedChart.includes("{!compact && current ? ("))
  assert.ok(sharedChart.includes("{!compact && sessionCount > 1 ?"))
  assert.ok(sharedChart.includes("{!compact ? <span"))
  assert.ok(sharedChart.includes("market-board-chart-ict-clock"))
  assert.ok(sharedChart.includes("compact={compact}"))
  assert.ok(sharedChart.includes("<IndexMinuteChart symbol={symbol} data={bars} resolution={resolution}"))
})

test("market context can be collapsed beside Bảng ngành without unmounting its realtime state", () => {
  assert.match(boardSource, /const MARKET_CONTEXT_VISIBILITY_KEY = "qeoindex:market-context-visible:v1"/)
  assert.match(boardSource, /const marketContextVisibilityStorageKey = `\$\{MARKET_CONTEXT_VISIBILITY_KEY\}:\$\{userId\}`/)
  assert.match(boardSource, /localStorage\.getItem\(marketContextVisibilityStorageKey\) !== "false"/)
  assert.match(boardSource, /localStorage\.setItem\(marketContextVisibilityStorageKey, String\(showMarketContext\)\)/)
  assert.match(boardSource, /id="market-board-context-panel" hidden=\{!showMarketContext\}[\s\S]*?<MarketContextStrip/)
  assert.match(boardSource, /type="checkbox"[\s\S]*?checked=\{showMarketContext\}[\s\S]*?aria-controls="market-board-context-panel"/)
  assert.match(boardSource, /Ẩn chỉ số/)
  assert.match(boardSource, /Hiện chỉ số/)
  assert.match(boardSource, /<ChevronUp/)
  assert.match(boardSource, /<ChevronDown/)
})

test("Bảng ngành exposes a persisted Price/KL compact-mode toggle beside market-context visibility", () => {
  assert.match(boardSource, /const INDUSTRY_PRICE_VOLUME_VISIBILITY_KEY = "qeoindex:industry-price-volume-visible:v1"/)
  assert.match(boardSource, /const industryPriceVolumeStorageKey = `\$\{INDUSTRY_PRICE_VOLUME_VISIBILITY_KEY\}:\$\{userId\}`/)
  assert.match(boardSource, /localStorage\.getItem\(industryPriceVolumeStorageKey\) !== "false"/)
  assert.match(boardSource, /localStorage\.setItem\(industryPriceVolumeStorageKey, String\(showIndustryPriceVolume\)\)/)
  assert.match(boardSource, /boardView === "industry" \? \([\s\S]*?Ẩn Giá\/KL[\s\S]*?Hiện Giá\/KL/)
  assert.match(boardSource, /<EyeOff/)
  assert.match(boardSource, /<Eye /)
  assert.match(boardSource, /<IndustryPriceboard[\s\S]*?showPriceVolume=\{showIndustryPriceVolume\}/)
  assert.match(priceboardSource, /pr-8 \[scrollbar-color:/)
})

test("board screenshots expand the cloned industry rail without changing visible scroll state", () => {
  assert.match(screenshotSource, /createExpandedBoardClone/)
  assert.match(screenshotSource, /originalRail\.scrollWidth/)
  assert.match(screenshotSource, /column\.scrollHeight/)
  assert.match(screenshotSource, /cloneScroll\.style\.overflow = "visible"/)
  assert.match(screenshotSource, /cleanup\(\)/)
  assert.match(priceboardSource, /data-market-board-screenshot-rail/)
})

test("stock row keeps clipping guards and hides rank", () => {
  assert.match(stockSource, /grid min-h-\[58px\].*grid-cols-\[46px_minmax\(38px,1fr\)_68px\]/)
  assert.match(stockSource, /flex min-w-0 items-center justify-center overflow-hidden/)
  assert.match(stockSource, /max-w-full truncate font-mono text-\[13px\]/)
  assert.doesNotMatch(stockSource, /stock\.rank/)
})

test("daily performance stays anchored to reference price, never session open", () => {
  assert.match(boardSource, /STOCK_REFERENCE_KEYS/)
  assert.match(dnseMarketFrameSource, /INDEX_REFERENCE_KEYS/)
  assert.match(dnseMarketFrameSource, /verifiedReference\?\.sessionDate === currentSessionDate/)
  assert.match(boardSource, /parseDnseMarketIndexFrame\(data, verifiedReference\)/)
  assert.match(boardSource, /dailyReferences\.current\[symbol\] = history\.reference/)
  assert.doesNotMatch(boardSource, /OPEN_PRICE_KEYS|INDEX_OPEN_KEYS|openingReferences|indexOpeningReferences/)
  assert.match(stockSource, /giá tham chiếu \(đóng cửa phiên trước\)/)
})

test("orderbook session bootstrap never treats today's open as reference price", () => {
  assert.match(marketRuntimeSource, /const explicitRef = fastOverview\?\.refPrice \?\? latestQuote\?\.reference \?\? null/)
  assert.match(marketRuntimeSource, /const explicitCeil = fastOverview\?\.ceiling \?\? latestQuote\?\.ceiling \?\? null/)
  assert.match(marketRuntimeSource, /const explicitFloor = fastOverview\?\.floor \?\? latestQuote\?\.floor \?\? null/)
  assert.doesNotMatch(marketRuntimeSource, /refPrice = firstBarOpen \?\? firstTradePrice \?\? matchPrice/)
  assert.match(marketRuntimeSource, /latestQuote\.reference = refPrice \?\? latestQuote\.reference/)
  assert.match(orderbookSource, /if \(normPrice > ref\) return "text-up font-bold"/)
  assert.match(orderbookSource, /if \(normPrice < ref\) return "text-down font-bold"/)
})

test("strong gainer highlight is static and therefore reduced-motion safe", () => {
  assert.match(stockSource, /changePercent \?\? 0\) >= 3/)
  assert.match(stockSource, /strong-gainer border-up\/60/)
  assert.match(cssSource, /\.strong-gainer\s*\{\s*border-color:/)
  assert.doesNotMatch(cssSource, /\.strong-gainer\s*\{\s*animation:/)
})

test("after-close fallback still feeds both visible price and mini chart", () => {
  assert.match(boardSource, /history\.at\(-1\)\?\.close \?\? stock\.lastClose/)
  assert.match(boardSource, /displayQuotes=\{displayQuotes as Record<string, LiveStockQuote \| undefined>\}/)
  assert.match(boardSource, /history=\{priceHistoryCloses\[stock\.ticker\] \?\? EMPTY_HISTORY\}/)
  assert.match(priceboardSource, /formatPrice\(quote\?\.price\)/)
  assert.match(stockSource, /<Sparkline data=\{chart\}/)
  assert.match(stockSource, /formatBoardPrice\(quote\?\.price\)/)
})

test("Supabase realtime frames use animation-frame buffering without retaining closures", () => {
  assert.match(boardSource, /let messageQueue: string\[\] = \[\]/)
  assert.match(boardSource, /window\.requestAnimationFrame\(flushMessageQueue\)/)
  assert.match(boardSource, /window\.cancelAnimationFrame\(messageFrame\)/)
  assert.match(boardSource, /subscribeDnseMarketFrames\(\(frame\) =>[\s\S]*?scheduleMessage\(JSON\.stringify\(frame\)\)/)
  assert.match(boardSource, /subscribeDnseMarketStreamState/)
  assert.match(boardSource, /for \(const raw of queued\)/)
  assert.match(boardSource, /clearMessageQueue\(\)[\s\S]*?unsubscribeFrames\(\)[\s\S]*?unsubscribeState\(\)/)
  assert.doesNotMatch(boardSource, /socket\.onmessage/)
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

test("industry and mover ordering refresh independently from 250ms price paints", () => {
  assert.match(boardSource, /setOrderingQuotes\(latestCommittedQuotesRef\.current\)/)
  assert.match(boardSource, /compareByPerformance\(a, b, orderingQuotes\)/)
  assert.match(boardSource, /<IndustryPriceboard[\s\S]*?orderingQuotes=\{orderingQuotes\}/)
  assert.match(priceboardSource, /sortIndustryStocksByPerformance\(visibleUniverse[\s\S]*?orderingQuotes\)/)
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

test("SmoothUI entrance visibly staggers indexes and selected board columns only once on load", () => {
  assert.match(pageSource, /MarketBoardTransition/)
  assert.match(boardTransitionSource, /LazyMotion/)
  assert.match(boardTransitionSource, /domAnimation/)
  assert.match(boardTransitionSource, /useAnimate/)
  assert.match(boardTransitionSource, /useReducedMotion/)
  assert.match(boardTransitionSource, /stagger\(0\.065/)
  assert.match(boardTransitionSource, /MARKET_CONTEXT_CARD_SELECTOR = "\[data-market-context-card\]"/)
  assert.match(boardTransitionSource, /PRICEBOARD_COLUMN_SELECTOR = "\[data-market-board-sector-column\], \[data-market-board-industry-column\]"/)
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

test("line-only market-board sparklines split green above and red below reference", () => {
  assert.match(stockSource, /<Sparkline[^>]*fill=\{false\}/)
  assert.match(sparklineSource, /const REFERENCE_UP_COLOR = "#22c98a"/)
  assert.match(sparklineSource, /const REFERENCE_DOWN_COLOR = "#ff4757"/)
  assert.match(sparklineSource, /const splitAtReference = !fill && ref != null && refY != null/)
  assert.match(sparklineSource, /clipPath id=\{`spark-above-\$\{uid\}`\}/)
  assert.match(sparklineSource, /clipPath id=\{`spark-below-\$\{uid\}`\}/)
  assert.match(sparklineSource, /stroke=\{REFERENCE_UP_COLOR\}/)
  assert.match(sparklineSource, /stroke=\{REFERENCE_DOWN_COLOR\}/)
})

test("market-board sparkline capacity preserves 48 five-minute points plus one live endpoint", () => {
  assert.match(stockSource, /const MAX_BOARD_SPARK_POINTS = 48/)
  assert.match(sparklineSource, /const MAX_SPARKLINE_POINTS = 49/)
})

test("intraday API prefers today's cached snapshot before expensive provider fan-out", () => {
  assert.match(intradayRouteSource, /getCachedIntraday5mSnapshot/)
  assert.match(intradayRouteSource, /cacheLayer = snapshot \? "cache" : "provider"/)
  assert.match(intradayRouteSource, /getIntraday5mSnapshot/)
  assert.doesNotMatch(intradayRouteSource, /fetchSnapshot/)
})

test("09:00 session reset clears board and every open orderbook atomically", () => {
  assert.match(boardSource, /const resetForNewTradingSession = useCallback/)
  assert.match(boardSource, /const activeSessionDayRef = useRef\(vietnamSessionDay\(\)\)/)
  assert.match(boardSource, /shouldResetForNewTradingDay\(activeSessionDayRef\.current, now\)/)
  assert.match(boardSource, /if \(needsTradingDayReset\)[\s\S]*resetForNewTradingSession\(now, nextPhase === "ATO"\)/)
  assert.match(boardSource, /activeSessionDayRef\.current = nextSessionDay/)
  assert.match(boardSource, /const isTradingDayRollover = activeSessionDayRef\.current !== nextSessionDay/)
  assert.match(boardSource, /const reference = isTradingDayRollover && current\.price > 0[\s\S]*dailyReferences\.current\[symbol\]/)
  assert.match(boardSource, /ceiling: isTradingDayRollover \? undefined : current\.ceiling/)
  assert.match(boardSource, /floor: isTradingDayRollover \? undefined : current\.floor/)
  assert.match(boardSource, /setQuoteReloadKey\(\(key\) => key \+ 1\)/)
  assert.match(boardSource, /fetch\("\/api\/market\/quotes",[\s\S]*method: "POST"/)
  assert.match(boardSource, /activeSessionDayRef\.current !== requestedSessionDay/)
  assert.match(boardSource, /hasNewerLiveQuote[\s\S]*existingUpdatedAt > requestedAt/)
  assert.match(boardSource, /ceiling: quote\.ceiling === null \? undefined : \(quote\.ceiling \?\? existing\?\.ceiling\)/)
  assert.match(boardSource, /floor: quote\.floor === null \? undefined : \(quote\.floor \?\? existing\?\.floor\)/)
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

test("DNSE normalUser board subscription stays within the 200-channel budget for canonical Top 200", () => {
  const symbols = Array.from({ length: 200 }, (_, index) => `S${String(index + 1).padStart(3, "0")}`)
  const plan = buildDnseBoardSubscriptionPlan(symbols)

  assert.equal(plan.realtimeSymbols.length, 200)
  assert.deepEqual(plan.overflowSymbols, [])
  assert.equal(plan.channels.length, 1)
  assert.equal(plan.channels[0]?.name, "tick.G1.json")
  assert.ok(plan.subscriptionCount <= DNSE_NORMAL_USER_CHANNEL_LIMIT, `subscriptionCount=${plan.subscriptionCount}`)
})

test("central realtime bus preserves the provider budget and tick-driven mini charts", () => {
  const symbols = Array.from({ length: 200 }, (_, index) => `S${String(index + 1).padStart(3, "0")}`)
  const legacy = JSON.stringify({
    action: "subscribe",
    channels: [
      { name: "tick.G1.json", symbols },
      { name: "top_price.G1.json", symbols },
      { name: "ohlc.1.json", symbols: [...symbols, "VN30F1M"] },
      { name: "foreign.G1.json", symbols },
      { name: "market_index.VNINDEX.json" },
      { name: "market_index.VN30.json" },
      { name: "market_index.HNX.json" },
      { name: "market_index.UPCOM.json" },
    ],
  })
  const rewritten = rewriteDnseBoardSubscriptionMessage(legacy)
  assert.equal(typeof rewritten, "string")
  const parsed = JSON.parse(String(rewritten)) as { channels: Array<{ name: string; symbols?: string[] }> }
  assert.deepEqual(parsed.channels, [{ name: "tick.G1.json", symbols }])

  const synthetic = synthesizeDnseOhlcFromTickMessage(JSON.stringify({ T: "t", symbol: "VCB", matchPrice: 61_500, time: 1_788_921_000 }))
  assert.ok(synthetic)
  assert.deepEqual(JSON.parse(synthetic!), { T: "b", symbol: "VCB", matchPrice: 61_500, time: 1_788_921_000, close: 61_500 })

  assert.match(boardSource, /subscribeDnseMarketFrames/)
  assert.match(boardSource, /subscribeDnseMarketStreamState/)
  assert.doesNotMatch(boardSource, /new WebSocket\(/)
  assert.doesNotMatch(boardSource, /\/api\/market\/stream-auth/)
  assert.match(marketStreamSource, /market_realtime_bus/)
  assert.match(marketStreamSource, /subscribeMarketRelay/)
  assert.doesNotMatch(marketStreamSource, /postgres_changes|\.channel\(/)
  assert.match(marketStreamSource, /synthesizeDnseOhlcFromTickMessage/)
})

test("HOSE liquidity and foreign mini-charts compress lunch to one dashed boundary", () => {
  const plot = contextStripSource.split("function ComparisonLineChart(")[1]?.split("function MarketSessionClock(")[0] ?? ""
  assert.ok(plot.includes("compactMarketMinute(minute) / MARKET_COMPACT_DURATION_MINUTES"))
  assert.ok(plot.includes("tradingMinuteAtCompactOffset(compactOffset)"))
  assert.ok(plot.includes("marketTradingSession(vietnamSessionMinute(point.minute))"))
  assert.ok(plot.includes("splitTradingSessionObservations(ordered)"))
  assert.ok(plot.includes("const paths = observedAreaPaths(sessionPoints, x, y, zeroY)"))
  assert.equal((plot.match(/data-market-session-divider/g) ?? []).length, 1)
  assert.ok(plot.includes('strokeDasharray="2 3" pointerEvents="none"'))
  assert.ok(plot.includes('{ minute: 780, label: "13:00" }'))
  assert.equal(plot.includes('label: "12:00"'), false)
  assert.equal(plot.includes('(minute - 540) / 360'), false)
  assert.ok(plot.includes('aria-hidden="true"'))
  const liquidity = contextStripSource.split('title="Thanh khoản"')[1]?.split('title="Mua bán nước ngoài"')[0] ?? ""
  const foreign = contextStripSource.split('title="Mua bán nước ngoài"')[1]?.split('title="Tác động VNINDEX"')[0] ?? ""
  assert.ok(liquidity.includes("<ComparisonLineChart series={["))
  assert.ok(foreign.includes("<ComparisonLineChart zeroReference series={["))
})
