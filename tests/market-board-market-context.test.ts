import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import { parseVpsIndexBreadth } from "../modules/market/providers/tradingview/index.ts"

import {
  coveredTop200ForeignTotals,
  currentSessionIndexMetrics,
  indexBreadthProgress,
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
const tradingviewSource = readFileSync(new URL("../modules/market/providers/tradingview/index.ts", import.meta.url), "utf8")

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
  assert.match(stripSource, /sourceBreadth\?\.advances/)
  assert.match(stripSource, /sourceBreadth\?\.declines/)
})

test("VNINDEX/VN30 breadth uses same-day full universe data and refreshes without overwriting websocket price", () => {
  assert.ok(finhayProviderSource.includes("advancers,decliners,unchanged"))
  assert.ok(finhayProviderSource.includes('VNINDEX: normalizeFinhayIndexBreadth(liquidityRaw, "VNINDEX")'))
  assert.ok(finhayProviderSource.includes('VN30: normalizeFinhayIndexBreadth(liquidityRaw, "VN30")'))
  assert.ok(finhayRouteSource.includes("foreign, liquidity, breadth"))
  assert.ok(finhayRouteSource.includes("      breadth,"))
  assert.ok(stripSource.includes('fetch("/api/market/indexes"'))
  assert.ok(stripSource.includes("window.setInterval(() => void loadBreadth(), 30_000)"))
  assert.ok(stripSource.includes('setFinhayBreadth(data.breadth ?? {})'))
  assert.ok(stripSource.includes("vietnamDateKey(value.sourceUpdatedAt) !== sessionDay"))
  assert.ok(stripSource.includes("sessionDay !== vietnamDateKey(now.toISOString())"))
  assert.ok(stripSource.includes('source: "Finhay"'))
  assert.ok(stripSource.includes('source: "VPS snapshot"'))
  assert.ok(stripSource.includes('breadth={selectMarketBreadth("VNINDEX", contextSessionDate, finhayBreadth, vpsBreadth)}'))
  assert.ok(stripSource.includes('breadth={selectMarketBreadth("VN30", contextSessionDate, finhayBreadth, vpsBreadth)}'))
  assert.ok(stripSource.includes("Number.isSafeInteger(count) && count >= 0"))
  assert.doesNotMatch(stripSource, /canonicalUniverse.*advances|Top.?200.*advances/)
  assert.ok(tradingviewSource.includes("parseVpsIndexBreadth"))
})

test("VPS ot parser retains genuine zero counts and rejects missing, negative and malformed values", () => {
  assert.deepEqual(parseVpsIndexBreadth("a|b|c|120|0|80"), { advances: 120, declines: 0, unchanged: 80 })
  assert.deepEqual(parseVpsIndexBreadth("a|b|c|0|0|0"), { advances: 0, declines: 0, unchanged: 0 })
  assert.equal(parseVpsIndexBreadth("a|b|c|1||5"), null)
  assert.equal(parseVpsIndexBreadth("a|b|c|1|-1|5"), null)
  assert.equal(parseVpsIndexBreadth("a|b|c|1|NaN|5"), null)
  assert.equal(parseVpsIndexBreadth(null), null)
  assert.equal(parseVpsIndexBreadth("x"), null)
})

test("VNINDEX point badges stay near the zero axis, show points with direction and no hover help", () => {
  const impact = stripSource.split("function ImpactChart(")[1]?.split("export function MarketContextStrip")[0] ?? ""
  assert.ok(impact.includes('max(0px, calc(${zeroPct}% - 17px))'))
  assert.ok(impact.includes('Math.abs(entry.contribution).toFixed(2)'))
  assert.equal(impact.includes("điểm</span>"), false)
  assert.ok(impact.includes("điểm VNINDEX"))
  assert.ok(impact.includes('role="img"'))
  assert.ok(impact.includes('aria-label={`${entry.symbol}:'))
  assert.ok(impact.includes('font-sans text-[10px] font-extrabold'))
  assert.ok(impact.includes("sm:text-[11px]"))
  assert.ok(impact.includes("text-emerald-200"))
  assert.ok(impact.includes("text-rose-200"))
  assert.ok(impact.includes('entry.contribution > 0 ? "+" : "−"'))
  assert.equal(/title=|cursor-help|tabIndex=|impactTooltip/.test(impact), false)
  assert.equal(stripSource.includes('titleHint={impact?.source}'), false)
})

test("market headers omit LIVE/Chậm and partial labels without losing provenance or animation", () => {
  const marker = stripSource.split("function MarketHeaderActivity(")[1]?.split("function IndexedSummary(")[0] ?? ""
  assert.ok(marker.includes("data-market-live-state={state}"))
  assert.ok(marker.includes('state === "live"'))
  assert.ok(marker.includes('market-header-sheen'))
  assert.ok(marker.includes('motion-safe:animate-pulse'))
  assert.equal(marker.includes('const label = state'), false)
  assert.equal(marker.includes('>{label}</span>'), false)
  assert.ok(stripSource.includes("data-index-breadth-progress"))
  assert.ok(stripSource.includes("mã Top 200; không phải tổng toàn HOSE"))
  assert.equal(stripSource.includes("Top 200 partial</span>"), false)
})

test("breadth progress places labels below exact proportion centers, keeping narrow labels separate", () => {
  const example = indexBreadthProgress([52, 56, 230])
  assert.equal(example.total, 338)
  assert.equal(example.shares.length, 3)
  assert.ok(Math.abs(example.shares.reduce((a, b) => a + b, 0) - 100) < 1e-9)
  assert.ok(Math.abs(example.centers[0] - (100 * 26 / 338)) < 1e-9)
  assert.ok(Math.abs(example.centers[1] - (100 * (52 + 28) / 338)) < 1e-9)
  assert.ok(Math.abs(example.centers[2] - (100 * (52 + 56 + 115) / 338)) < 1e-9)

  const vn30 = indexBreadthProgress([4, 3, 23])
  assert.equal(vn30.total, 30)
  assert.ok(vn30.centers[0] >= 7 && vn30.centers[2] <= 93)
  assert.ok(vn30.centers[1] - vn30.centers[0] >= 13 - 1e-9)
  assert.ok(vn30.centers[2] - vn30.centers[1] >= 13 - 1e-9)

  for (const counts of [[0, 0, 30], [1, 1, 998], [998, 1, 1], [0, 0, 0], [0, 25, 0]] as [number, number, number][]) {
    const result = indexBreadthProgress(counts)
    assert.ok(result.shares.every(Number.isFinite))
    assert.ok(result.centers.every(Number.isFinite))
    assert.ok(result.centers[0] >= 7 && result.centers[2] <= 93)
    assert.ok(result.centers[1] - result.centers[0] >= 13 - 1e-9)
    assert.ok(result.centers[2] - result.centers[1] >= 13 - 1e-9)
  }
  assert.deepEqual(indexBreadthProgress([0, 0, 0]), { total: 0, shares: [0, 0, 0], centers: [16, 50, 84] })
  assert.deepEqual(indexBreadthProgress([Number.NaN, -1, 0]).shares, [0, 0, 0])
})

test("combined indices use smaller levels, larger point changes, colored percent pills and segment-following breadth labels", () => {
  const summary = stripSource.split("function IndexedSummary(")[1]?.split("function ContextCard(")[0] ?? ""
  assert.ok(summary.includes("text-[clamp(12px,1.05vw,17px)]"))
  assert.ok(summary.includes("text-[clamp(12px,1.05vw,15px)]"))
  assert.ok(summary.includes("rounded-full border px-1.5 py-0.5"))
  assert.ok(summary.includes('font-sans text-[12px] font-extrabold'))
  assert.ok(summary.includes("pillTone"))
  assert.ok(summary.includes("border-emerald-400/35"))
  assert.ok(summary.includes("border-rose-400/35"))
  assert.ok(summary.includes("border-amber-400/35"))
  assert.ok(summary.includes('data-index-breadth-progress'))
  assert.ok(summary.includes("Mã tăng ${breadth[0]}, ngang ${breadth[1]}, giảm ${breadth[2]}"))
  assert.ok(summary.includes("h-[8px] w-full"))
  assert.ok(summary.includes("total > 0"))
  assert.ok(summary.includes("indexBreadthProgress([breadth[0] ?? 0, breadth[1] ?? 0, breadth[2] ?? 0])"))
  assert.ok(summary.includes("progress.shares[0]"))
  assert.ok(summary.includes("progress.shares[1]"))
  assert.ok(summary.includes("progress.shares[2]"))
  assert.ok(summary.includes("relative mt-1 h-[14px]"))
  assert.ok(summary.includes("progress.centers[0]"))
  assert.ok(summary.includes("progress.centers[1]"))
  assert.ok(summary.includes("progress.centers[2]"))
  assert.ok(summary.includes("motion-safe:transition-[left]"))
  assert.ok(summary.includes('hasBreadth ? breadth[0] : "—"'))
  assert.equal(summary.includes('data-index-breadth-inline'), false)
  assert.equal(summary.includes('mt-0.5 flex justify-between gap-1 text-[9px]'), false)
})

test("combined index trend icon replaces leading dash, percentage pill is larger and breadth stays at bottom", () => {
  const summary = stripSource.split("function IndexedSummary(")[1]?.split("function ContextCard(")[0] ?? ""
  assert.ok(stripSource.includes("ArrowUpRight"))
  assert.ok(stripSource.includes("ArrowRight"))
  assert.ok(stripSource.includes("ArrowDownRight"))
  assert.ok(summary.includes('className="flex min-h-0 min-w-0 flex-1 flex-col px-2.5 py-1.5"'))
  assert.ok(summary.includes('className="mt-auto min-w-0 pt-1"'))
  assert.ok(summary.includes('aria-label={!finite(trend) ? "Chưa xác định xu hướng"'))
  assert.ok(summary.includes('trend > 0 ? "Chỉ số tăng" : trend < 0 ? "Chỉ số giảm"'))
  assert.ok(summary.includes("trendIcon"))
  assert.ok(summary.includes("font-sans text-[12px] font-extrabold"))
  assert.ok(summary.includes("data-index-breadth-progress"))
  assert.ok(summary.includes("progress.centers[0]"))
  assert.ok(summary.includes("progress.centers[2]"))
})

test("VNINDEX impact uses header +/- totals to give stock bars more height", () => {
  const chart = stripSource.split("function ImpactChart(")[1]?.split("export function MarketContextStrip")[0] ?? ""
  assert.ok(chart.includes('grid h-[80px]'))
  assert.equal(chart.includes('h-[55px]'), false)
  assert.equal(chart.includes('Tổng điểm kéo tăng và kéo giảm của các mã hiển thị'), false)
  assert.equal(chart.includes('sumAbs'), false)
  assert.ok(stripSource.includes("impact.displayedPositiveTotal.toFixed(2)"))
  assert.ok(stripSource.includes("impact.displayedNegativeTotal"))
  assert.ok(stripSource.includes("Tổng 5 mã kéo tăng"))
  assert.ok(chart.includes("role=\"group\""))
  assert.ok(chart.includes("orderedImpactBars(impact)"))
})

test("all four market cards animate only source-backed ticks, not polling or idle status", () => {
  assert.equal((stripSource.match(/activitySources=\{/g) ?? []).length, 4)
  assert.ok(stripSource.includes('activitySources={[indexQuotes.VNINDEX?.sourceAsOf, indexQuotes.VN30?.sourceAsOf]}'))
  assert.ok(stripSource.includes('activitySources={[liquidityUpdatedAt]}'))
  assert.ok(stripSource.includes('activitySources={[hasFinhayForeign ? finhayForeign?.sourceUpdatedAt : foreignSnapshot.asOf]}'))
  assert.ok(stripSource.includes('activitySources={[impact?.asOf]}'))
  assert.ok(stripSource.includes('activityCanStream={impactSelection.source === "websocket"}'))
  assert.ok(stripSource.includes('getMarketCardActivity({'))
  assert.ok(stripSource.includes('const timer = window.setInterval(refresh, 15_000)'))
  assert.ok(stripSource.includes('window.clearInterval(timer)'))
  assert.ok(stripSource.includes('data-market-live-state={state}'))
  assert.ok(stripSource.includes('state === "live"'))
  assert.ok(stripSource.includes('key={revision}'))
  assert.ok(stripSource.includes('market-header-sheen'))
  assert.ok(stripSource.includes('market-realtime-number'))
  assert.ok(stripSource.includes('market-chart-trace'))
  assert.ok(stripSource.includes('key={`${latest.minute}:${latest.value}`}'))
  assert.ok(stripSource.includes('!line.previous && prior && latest'))
  assert.ok(stripSource.includes('animate={isTodaySession && isFresh(liquidityUpdatedAt)}'))
  assert.ok(stripSource.includes('animate={isTodaySession && isFresh(hasFinhayForeign ? finhayForeign?.sourceUpdatedAt : foreignSnapshot.asOf)}'))
  assert.equal(stripSource.includes('requestAnimationFrame'), false)
})

test("market cards remove bottom annotation rows but preserve source integrity", () => {
  const stripSection = stripSource.split('title="VN-Index / VN30"')[1] ?? ""
  const liquidity = stripSection.split('title="Thanh khoản HOSE"')[1]?.split('title="Mua bán nước ngoài"')[0] ?? ""
  const foreign = stripSection.split('title="Mua bán nước ngoài"')[1]?.split('title="Tác động VNINDEX"')[0] ?? ""
  const impactChart = stripSource.split("function ImpactChart(")[1]?.split("export function MarketContextStrip")[0] ?? ""
  assert.ok(stripSource.includes("headerInfo={<MarketSessionClock />}"))
  assert.ok(stripSource.includes('title={`Thị trường: ${marketStatus} · Giờ Việt Nam (ICT, UTC+7)`}'))
  assert.equal(stripSource.includes('className="mt-0.5 flex h-[20px]'), false)
  assert.equal(stripSource.includes('border-t border-white/[0.07] pt-1 font-ticker'), false)
  assert.equal(liquidity.includes("━ Hôm nay"), false)
  assert.equal(foreign.includes("━ Ròng hôm nay"), false)
  assert.ok(liquidity.includes("So với ${verifiedPreviousLiquidity.day}"))
  assert.equal(foreign.includes("Top 200 partial</span>"), false)
  assert.ok(foreign.includes("mã Top 200; không phải tổng toàn HOSE"))
  assert.ok(foreign.includes("${foreignSnapshot.covered}/${canonicalUniverse.length}"))
  assert.equal(impactChart.includes("DNSE basketInfluence ·"), false)
  assert.equal(impactChart.includes("LivePulse"), false)
  assert.equal(impactChart.includes("điểm</span>"), false)
  assert.ok(impactChart.includes("điểm VNINDEX"))
  assert.ok(stripSource.includes('activityCanStream={impactSelection.source === "websocket"}'))
  assert.ok(stripSource.includes('animate={isTodaySession && isFresh(liquidityUpdatedAt)}'))
  assert.ok(stripSource.includes('animate={isTodaySession && isFresh(hasFinhayForeign ? finhayForeign?.sourceUpdatedAt : foreignSnapshot.asOf)}'))
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


test("VN-Index / VN30 shows a client-only ICT market status without new data requests", () => {
  assert.ok(stripSource.includes("function MarketSessionClock()"))
  assert.ok(stripSource.includes("getMarketSessionDisplay(new Date(now))"))
  assert.ok(stripSource.includes("data-market-session-status"))
  assert.ok(stripSource.includes("Thị trường: ${marketStatus}"))
  assert.ok(stripSource.includes("<MarketSessionClock />"))
  assert.ok(stripSource.includes("window.setInterval(refresh, 15_000)"))
  assert.ok(stripSource.includes("window.clearInterval(timer)"))
  assert.ok(stripSource.includes('window.addEventListener("focus", refresh)'))
  assert.ok(stripSource.includes('document.addEventListener("visibilitychange", refresh)'))
  assert.ok(stripSource.includes("useState<number | null>(null)"))
  assert.ok(stripSource.includes("Giờ Việt Nam (ICT, UTC+7)"))
  assert.ok(stripSource.includes("headerInfo={<MarketSessionClock />}"))
  assert.ok(stripSource.includes('title={`Thị trường: ${marketStatus}'))
  assert.ok(stripSource.includes("inline-flex shrink-0 items-center whitespace-nowrap"))
  assert.ok(stripSource.includes("onClick={onOpenIndexChart}"))
  const clockComponent = stripSource.split("function MarketSessionClock()")[1]?.split("function IndexedSummary")[0] ?? ""
  assert.equal(clockComponent.includes("fetch("), false)
})

test("realtime comparison reuses only observed source-scoped same-session data", () => {
  assert.match(stripSource, /previousMetricHistory/)
  assert.match(stripSource, /readMetricHistory/)
  assert.match(stripSource, /writeMetricHistory/)
  assert.match(stripSource, /metricHistoryPrefix\("liquidity", liquiditySeriesSource\)/)
  assert.match(stripSource, /metricHistoryPrefix\("foreign", foreignSeriesSource\)/)
  assert.match(stripSource, /vietnamDateKey\(new Date\(point.minute\)\.toISOString\(\)\) === day/)
  assert.match(stripSource, /vietnamSessionMinute/)
  assert.match(stripSource, /ComparisonLineChart/)
  assert.match(stripSource, /verifiedPreviousLiquidity\?\.points/)
  assert.doesNotMatch(stripSource, /previousForeign\?\.points/)
  assert.match(stripSource, /previous: true/)
  assert.match(stripSource, /Chưa ghi nhận phiên trước/)
  assert.match(stripSource, /Finhay: giao dịch nước ngoài toàn HOSE/)
  assert.match(stripSource, /mã Top 200; không phải tổng toàn HOSE/)
  assert.match(stripSource, /foreignSeriesSource = hasFinhayForeign \? "finhay-vnindex" : "top200-partial"/)
  assert.match(stripSource, /liquiditySeriesSource = hasFinhayLiquidity \? "finhay-vnindex" : "index-quote"/)
  assert.doesNotMatch(stripSource, /volume \* price|volume \* close/)
})

test("HOSE chart compares exactly the preceding session at matching ICT minutes", () => {
  assert.ok(stripSource.includes("previousTradingSessionDateKey(day)"))
  assert.ok(stripSource.includes("days.includes(previous)"))
  assert.ok(stripSource.includes("observedValueAtMinute(line.points, hoveredMinute)"))
  assert.ok(stripSource.includes("vietnamSessionMinute(point.minute)"))
  assert.ok(stripSource.includes("So với ${verifiedPreviousLiquidity.day}"))
  assert.ok(stripSource.includes("verifiedPreviousLiquidity?.points ?? []"))
  assert.ok(stripSource.includes("strokeDasharray={line.previous ?"))
  assert.ok(stripSource.includes('label: "Trước"'))
  assert.equal(stripSource.includes("━ Hôm nay　┄ Phiên trước"), false)
  assert.ok(stripSource.includes("const isTodaySession"))
  assert.ok(stripSource.includes("todayLiquidityPoints = isTodaySession ? liquidityPoints : []"))
})

test("foreign flow charts signed cumulative net today only, not prior session buy/sell", () => {
  assert.ok(stripSource.includes("intradayForeignNet(foreignPoints)"))
  assert.ok(stripSource.includes("<ComparisonLineChart zeroReference"))
  assert.ok(stripSource.includes('label: "Ròng"'))
  assert.ok(stripSource.includes("todayForeignNetPoints = isTodaySession"))
  assert.ok(stripSource.includes("todayForeignBuy = isTodaySession"))
  assert.ok(stripSource.includes("todayForeignSell = isTodaySession"))
  assert.ok(stripSource.includes("todayForeignNet = isTodaySession"))
  assert.ok(stripSource.includes("zeroReference && ("))
  assert.equal(stripSource.includes("━ Ròng hôm nay"), false)
  assert.equal(stripSource.includes("previousForeign"), false)
  assert.equal(stripSource.includes("previousForeign?.points"), false)
})

test("compact contributors keep provider top-5 and realtime provenance without tooltip", () => {
  const entries = parseVnindexImpactPayload([
    ...Array.from({ length: 12 }, (_, i) => ({ symbol: `P${i + 10}`, basketInfluence: 1 - i * 0.02 })),
    ...Array.from({ length: 12 }, (_, i) => ({ symbol: `N${i + 10}`, basketInfluence: -1 + i * 0.02 })),
  ])
  assert.ok(entries)
  assert.equal(entries.positive.length + entries.negative.length, 10)
  assert.equal(orderedImpactBars(entries).length, 10)
  assert.equal(stripSource.includes("function impactTooltip("), false)
  assert.ok(stripSource.includes("motion-safe:transition-[top,height]"))
  assert.ok(stripSource.includes("motion-safe:animate-pulse"))
  assert.ok(stripSource.includes("observedAtMs - sourceMs <= 120_000"))
  assert.ok(stripSource.includes("}, 60_000)"))
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
