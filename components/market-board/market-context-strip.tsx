"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Activity, ChartNoAxesCombined, Globe2, Landmark, Scale, WalletCards } from "lucide-react"
import { getMarketSessionDisplay, getMarketSessionStatus } from "@/modules/market/realtime/session-countdown"
import { getMarketCardActivity } from "@/modules/market/board/market-realtime-activity"

import { coveredTop200ForeignTotals, currentSessionIndexMetrics, indexBreadthProgress, orderedImpactBars, selectCurrentSessionImpact } from "@/modules/market/board/market-context-contract"
import { intradayForeignNet, observedValueAtMinute, previousTradingSessionDateKey, vietnamSessionMinute } from "@/modules/market/board/market-context-metrics"
import { displayedMarketMetricDay, readRetainedMetric, validSessionMetricTimestamp, writeRetainedMetric } from "@/modules/market/board/market-context-retention"
import type { RetainedLiquidity, RetainedForeign } from "@/modules/market/board/market-context-retention"
import { preferObservedReplay, type MarketBoardMetricReplay } from "@/modules/market/board/metric-replay"
import type {
  MarketBoardContextBootstrap,
  MarketImpactSnapshot,
} from "@/modules/market/board/market-context-contract"

type MarketContextIndexQuote = {
  symbol: string
  value: number
  reference?: number
  change?: number
  changePercent?: number
  volume?: number
  valueTraded?: number
  advances?: number
  declines?: number
  unchanged?: number
  sourceAsOf?: string
  updatedAt: string
}

type MarketContextStockQuote = {
  symbol: string
  price?: number
  volume?: number
  valueTraded?: number
  changePercent?: number
  foreignBuyVolume?: number
  foreignSellVolume?: number
  foreignBuyValue?: number
  foreignSellValue?: number
  foreignUpdatedAt?: string
  foreignSessionDate?: string
  foreignSource?: string
  updatedAt: string
}

type MarketContextUniverseStock = {
  ticker: string
  exchange?: string | null
}

type MarketContextStripProps = {
  indexQuotes: Record<string, MarketContextIndexQuote | undefined>
  stockQuotes: Record<string, MarketContextStockQuote | undefined>
  realtimeImpact: MarketImpactSnapshot | null
  canonicalUniverse: readonly MarketContextUniverseStock[]
  onOpenIndexChart: () => void
}

type MetricPoint = {
  minute: number
  value: number
}

type ForeignMetricPoint = {
  minute: number
  buy: number
  sell: number
}

type MarketContextApiResponse = MarketBoardContextBootstrap & { ok?: boolean }

type FinhayForeignSnapshot = {
  symbol: string
  sessionDate: string
  buy: { volume?: number; value?: number }
  sell: { volume?: number; value?: number }
  net: { volume?: number; value?: number }
  constituentCount?: number
  sourceUpdatedAt?: string
}

type FinhayLiquiditySnapshot = {
  symbol: string
  value: number
  volume?: number
  constituentCount?: number
  sourceUpdatedAt: string
}

type IndexBreadthSnapshot = {
  advances: number
  unchanged: number
  declines: number
  sourceUpdatedAt: string
}

type SelectedBreadth = IndexBreadthSnapshot & { source: "Finhay" | "VPS snapshot" }

type FinhayMarketContextResponse = {
  ok?: boolean
  state?: string
  provider?: string
  sampledAt?: string
  foreign?: FinhayForeignSnapshot
  liquidity?: FinhayLiquiditySnapshot
  breadth?: Record<string, IndexBreadthSnapshot | null>
}

type MarketIndexesResponse = {
  ok?: boolean
  quotes?: Record<string, {
    advances?: number
    unchanged?: number
    declines?: number
    updatedAt?: string
  }>
}


const MAX_LIVE_POINTS = 360
const GREEN = "#22c98a"
const PLATINUM = "#d4d4d8"
const RED = "#ff4757"

const INDEX_FORMATTER = new Intl.NumberFormat("vi-VN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const VALUE_FORMATTER = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 })
const VIETNAM_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Ho_Chi_Minh",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function vietnamDateKey(updatedAt: string) {
  const timestamp = Date.parse(updatedAt)
  if (!Number.isFinite(timestamp)) return null
  return VIETNAM_DATE_FORMATTER.format(new Date(timestamp))
}

function minuteBucket(updatedAt: string) {
  const timestamp = Date.parse(updatedAt)
  if (!Number.isFinite(timestamp)) return null
  return Math.floor(timestamp / 60_000) * 60_000
}

function upsertMetricPoint(current: MetricPoint[], updatedAt: string, value: number) {
  const minute = minuteBucket(updatedAt)
  if (minute === null || !Number.isFinite(value) || value < 0) return current
  const last = current.at(-1)
  if (last?.minute === minute) {
    if (last.value === value) return current
    return [...current.slice(0, -1), { minute, value }]
  }
  if (last && minute < last.minute) return current
  return [...current, { minute, value }].slice(-MAX_LIVE_POINTS)
}

function upsertForeignMetricPoint(current: ForeignMetricPoint[], updatedAt: string, buy: number, sell: number) {
  const minute = minuteBucket(updatedAt)
  if (minute === null || !Number.isFinite(buy) || !Number.isFinite(sell) || buy < 0 || sell < 0) return current
  const last = current.at(-1)
  if (last?.minute === minute) {
    if (last.buy === buy && last.sell === sell) return current
    return [...current.slice(0, -1), { minute, buy, sell }]
  }
  if (last && minute < last.minute) return current
  return [...current, { minute, buy, sell }].slice(-MAX_LIVE_POINTS)
}

function marketColor(changePercent?: number) {
  if (!finite(changePercent)) return PLATINUM
  if (changePercent > 0) return GREEN
  if (changePercent < 0) return RED
  return PLATINUM
}

function formatChange(value?: number) {
  if (!finite(value)) return "—"
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`
}

function formatVndValue(value?: number) {
  if (!finite(value) || value < 0) return "—"
  if (value >= 1_000_000_000_000) return `${VALUE_FORMATTER.format(value / 1_000_000_000_000)} nghìn tỷ`
  return `${VALUE_FORMATTER.format(value / 1_000_000_000)} tỷ`
}

function formatSignedVndValue(value?: number) {
  if (!finite(value)) return "—"
  const sign = value > 0 ? "+" : value < 0 ? "-" : ""
  return `${sign}${formatVndValue(Math.abs(value))}`
}

function formatCompactVolume(value?: number) {
  if (!finite(value) || value <= 0) return "—"
  if (value >= 1_000_000_000) return `${VALUE_FORMATTER.format(value / 1_000_000_000)} tỷ`
  if (value >= 1_000_000) return `${VALUE_FORMATTER.format(value / 1_000_000)} triệu`
  if (value >= 1_000) return `${VALUE_FORMATTER.format(value / 1_000)} nghìn`
  return VALUE_FORMATTER.format(value)
}

function validIndexBreadth(value: IndexBreadthSnapshot | null | undefined, sessionDay: string): value is IndexBreadthSnapshot {
  if (!value || !sessionDay || vietnamDateKey(value.sourceUpdatedAt) !== sessionDay) return false
  const timestamp = Date.parse(value.sourceUpdatedAt)
  return Number.isFinite(timestamp)
    && timestamp <= Date.now() + 5_000
    && [value.advances, value.unchanged, value.declines]
      .every((count) => Number.isSafeInteger(count) && count >= 0)
}

/** Same-session breadth never uses an unverified or prior-day DNSE quote count. */
function selectMarketBreadth(
  symbol: "VNINDEX" | "VN30",
  sessionDay: string,
  finhay: Readonly<Record<string, IndexBreadthSnapshot | null>>,
  vps: Readonly<Record<string, IndexBreadthSnapshot>>,
  now: Date = new Date(),
): SelectedBreadth | undefined {
  if (!sessionDay || sessionDay !== vietnamDateKey(now.toISOString())) return undefined
  const provider = finhay[symbol]
  if (validIndexBreadth(provider, sessionDay)) return { ...provider, source: "Finhay" }

  const phase = getMarketSessionStatus(now).phase
  // VPS only timestamps the *receipt* of the snapshot, not the underlying exchange event.
  // Suppress it before open or on non-trading days to avoid showing yesterday as today's breadth.
  const displayAfterOpen = phase === "MORNING" || phase === "LUNCH_BREAK" || phase === "AFTERNOON"
    || getMarketSessionDisplay(now).label === "Đã đóng cửa"
  const snapshot = vps[symbol]
  return displayAfterOpen && validIndexBreadth(snapshot, sessionDay)
    ? { ...snapshot, source: "VPS snapshot" }
    : undefined
}

function formatAsOf(value?: string | null) {
  if (!value) return "—"
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return "—"
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(timestamp))
}


type RetainedFlow = {
  day: string
  liquidityFull: RetainedLiquidity | null
  liquidityIndex: RetainedLiquidity | null
  foreignFull: RetainedForeign | null
  foreignPartial: RetainedForeign | null
}

function readLastLiquidity(key: string, source: RetainedLiquidity["source"], day: string): RetainedLiquidity | null {
  try {
    const persisted = readRetainedMetric(localStorage, "liquidity", source, day)
    if (persisted) return persisted
  } catch { /* Browser storage may be disabled. */ }
  // Migrate real source-scoped chart history written before EOD summary retention existed.
  const last = readMetricHistory<MetricPoint>(key, day).at(-1)
  const asOf = last && new Date(last.minute).toISOString()
  return asOf && validSessionMetricTimestamp(asOf, day)
    ? { day, source, asOf, value: last.value }
    : null
}

function readLastForeign(key: string, source: RetainedForeign["source"], day: string): RetainedForeign | null {
  try {
    const persisted = readRetainedMetric(localStorage, "foreign", source, day)
    if (persisted) return persisted
  } catch { /* Browser storage may be disabled. */ }
  const last = readMetricHistory<ForeignMetricPoint>(key, day).at(-1)
  const asOf = last && new Date(last.minute).toISOString()
  return asOf && validSessionMetricTimestamp(asOf, day)
    ? { day, source, asOf, buy: last.buy, sell: last.sell }
    : null
}

function loadRetainedFlow(day: string): RetainedFlow {
  return {
    day,
    liquidityFull: day ? readLastLiquidity(metricHistoryPrefix("liquidity", "finhay-vnindex"), "finhay-vnindex", day) : null,
    liquidityIndex: day ? readLastLiquidity(metricHistoryPrefix("liquidity", "index-quote"), "index-quote", day) : null,
    foreignFull: day ? readLastForeign(metricHistoryPrefix("foreign", "finhay-vnindex"), "finhay-vnindex", day) : null,
    foreignPartial: day ? readLastForeign(metricHistoryPrefix("foreign", "top200-partial"), "top200-partial", day) : null,
  }
}

type SessionHistory<T> = { day: string; points: T[] }
const OBSERVED_HISTORY_PREFIX = "qeoindex:board-metrics:v1"
const SESSION_HISTORY_LIMIT = 3

function metricHistoryPrefix(kind: "liquidity" | "foreign", source: string) {
  return `${OBSERVED_HISTORY_PREFIX}:${kind}:${source}`
}

function readMetricHistory<T extends MetricPoint | ForeignMetricPoint>(key: string, day: string): T[] {
  if (!day) return []
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(`${key}:${day}`) ?? "null")
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is T => {
      if (!item || typeof item !== "object") return false
      const point = item as Partial<ForeignMetricPoint> & Partial<MetricPoint>
      return finite(point.minute) && vietnamDateKey(new Date(point.minute).toISOString()) === day
        && (finite(point.value) && point.value >= 0
          || finite(point.buy) && point.buy >= 0 && finite(point.sell) && point.sell >= 0)
    }).slice(-MAX_LIVE_POINTS)
  } catch {
    return []
  }
}

function previousMetricHistory<T extends MetricPoint | ForeignMetricPoint>(key: string, day: string): SessionHistory<T> | null {
  try {
    const days: unknown = JSON.parse(localStorage.getItem(`${key}:days`) ?? "[]")
    const previous = previousTradingSessionDateKey(day)
    if (!previous || !Array.isArray(days) || !days.includes(previous)) return null
    const points = readMetricHistory<T>(key, previous)
    return points.length >= 2 ? { day: previous, points } : null
  } catch {
    return null
  }
}

function writeMetricHistory<T extends MetricPoint | ForeignMetricPoint>(key: string, day: string, points: T[]) {
  if (!day || !points.length) return
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(`${key}:days`) ?? "[]")
    const days = [...new Set([...(Array.isArray(stored) ? stored.filter((item): item is string => typeof item === "string") : []), day])].sort()
    const keep = days.slice(-SESSION_HISTORY_LIMIT)
    for (const expired of days.slice(0, -SESSION_HISTORY_LIMIT)) localStorage.removeItem(`${key}:${expired}`)
    localStorage.setItem(`${key}:days`, JSON.stringify(keep))
    localStorage.setItem(`${key}:${day}`, JSON.stringify(points.slice(-MAX_LIVE_POINTS)))
  } catch {
    // Storage is optional; realtime always works without browser persistence.
  }
}

type ComparisonSeries = { label: string; points: MetricPoint[]; color: string; previous?: boolean }

function ComparisonLineChart({
  series,
  zeroReference = false,
  animate = false,
}: {
  series: ComparisonSeries[]
  zeroReference?: boolean
  animate?: boolean
}) {
  const [hoveredMinute, setHoveredMinute] = useState<number | null>(null)
  const valid = series.filter((line) => line.points.length)
  if (!valid.length) {
    return <div className="flex h-[69px] items-center justify-center text-[9px] text-zinc-500">Chưa có mẫu realtime trong phiên</div>
  }

  const width = 320
  const height = 69
  const left = 7
  const right = 5
  const top = 3
  const bottom = 16
  const plotHeight = height - top - bottom
  const values = valid.flatMap((line) => line.points.map((point) => point.value))
  // Include zero for truthful signed net flow; keep a comparable zero-based cumulative liquidity scale.
  const minValue = Math.min(0, ...values)
  const maxValue = Math.max(0, ...values)
  const padding = Math.max((maxValue - minValue) * 0.08, Math.max(Math.abs(maxValue), Math.abs(minValue)) * 0.002, 1)
  const y = (value: number) => top + (maxValue + padding - value) / (maxValue - minValue + 2 * padding) * plotHeight
  const x = (minute: number) => left + Math.max(0, Math.min(1, (minute - 540) / 360)) * (width - left - right)
  const zeroY = y(0)
  const chartAt = hoveredMinute === null ? [] : series.map((line) => ({
    label: line.label,
    color: line.color,
    value: observedValueAtMinute(line.points, hoveredMinute),
  }))
  const timeLabel = hoveredMinute === null ? "" : `${String(Math.floor(hoveredMinute / 60)).padStart(2, "0")}:${String(hoveredMinute % 60).padStart(2, "0")}`
  const ticks = [
    { minute: 540, label: "09:00" },
    { minute: 630, label: "10:30" },
    { minute: 720, label: "12:00" },
    { minute: 810, label: "13:30" },
    { minute: 900, label: "15:00" },
  ]

  return (
    <div className="relative min-w-0">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-[69px] w-full touch-pan-y"
        role="img"
        aria-label={zeroReference ? "Giá trị mua ròng lũy kế trong phiên hôm nay, trục 0 thể hiện cân bằng mua bán" : "So sánh thanh khoản lũy kế hôm nay và phiên giao dịch trước tại cùng giờ Việt Nam"}
        onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect()
          if (!bounds.width) return
          const localX = (event.clientX - bounds.left) * width / bounds.width
          const minute = Math.round(540 + Math.max(0, Math.min(1, (localX - left) / (width - left - right))) * 360)
          setHoveredMinute(minute)
        }}
        onPointerLeave={() => setHoveredMinute(null)}
      >
        {[0.25, 0.5, 0.75].map((ratio) => (
          <line key={ratio} x1={left} x2={width-right} y1={top + plotHeight * ratio}
            y2={top + plotHeight * ratio} stroke="#525b61" strokeOpacity="0.28" strokeDasharray="3 4" />
        ))}
        {zeroReference && (
          <line x1={left} x2={width - right} y1={zeroY} y2={zeroY}
            stroke="#a1a1aa" strokeOpacity="0.8" strokeDasharray="3 3" />
        )}
        {valid.map((line, index) => {
          const ordered = [...line.points].sort((a, b) => a.minute - b.minute)
          // Disconnected observations are never interpolated across outages or lunch.
          const path = ordered.map((point, position) =>
            `${!position || point.minute - ordered[position - 1].minute > 180_000 ? "M" : "L"}${x(vietnamSessionMinute(point.minute)).toFixed(1)},${y(point.value).toFixed(1)}`,
          ).join(" ")
          const latest = ordered.at(-1)
          const prior = ordered.at(-2)
          const lastSegment = prior && latest && latest.minute - prior.minute <= 180_000
            ? `M${x(vietnamSessionMinute(prior.minute)).toFixed(1)},${y(prior.value).toFixed(1)} L${x(vietnamSessionMinute(latest.minute)).toFixed(1)},${y(latest.value).toFixed(1)}`
            : ""
          return <g key={index}>
            {ordered.length > 1 && (
              <path d={path} fill="none" stroke={line.color} strokeDasharray={line.previous ? "5 4" : undefined}
                strokeWidth={line.previous ? 1.8 : 2.4} strokeOpacity={line.previous ? 0.85 : 1} strokeLinecap="round" strokeLinejoin="round" />
            )}
            {animate && !line.previous && prior && latest && (
              <path
                key={`${latest.minute}:${latest.value}`}
                d={lastSegment}
                pathLength={1}
                strokeDasharray="1"
                stroke={line.color}
                strokeWidth="3"
                strokeLinecap="round"
                fill="none"
                className="pointer-events-none market-chart-trace"
                aria-hidden="true"
              />
            )}
            {latest && (
              <circle
                cx={x(vietnamSessionMinute(latest.minute))}
                cy={y(latest.value)}
                r={line.previous ? 1.7 : 2.4}
                fill={line.color}
                className={animate && !line.previous ? "motion-safe:animate-pulse" : undefined}
              />
            )}
          </g>
        })}
        {hoveredMinute !== null && (
          <g>
            <line x1={x(hoveredMinute)} x2={x(hoveredMinute)} y1={top} y2={top + plotHeight}
              stroke="#e4e4e7" strokeDasharray="2 3" strokeOpacity="0.8" />
            {chartAt.map((point, index) => point.value === undefined ? null : (
              <circle key={index} cx={x(hoveredMinute)} cy={y(point.value)} r="2.8" stroke="#101410" strokeWidth="0.8" fill={point.color} />
            ))}
          </g>
        )}
      </svg>
      {/* SVG paths stretch to card width; CSS-pixel ticks remain crisp and undistorted. */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[14px] font-sans text-[11px] font-medium leading-none tracking-normal tabular-nums text-zinc-400"
        aria-hidden="true"
        data-market-intraday-time-axis
      >
        {ticks.map((tick) => (
          <span
            key={tick.minute}
            className="absolute bottom-0 whitespace-nowrap"
            style={{
              left: `${100 * x(tick.minute) / width}%`,
              transform: tick.minute === 540 ? "translateX(0)" : tick.minute === 900 ? "translateX(-100%)" : "translateX(-50%)",
            }}
          >{tick.label}</span>
        ))}
      </div>
      {hoveredMinute !== null && (
        <div className="pointer-events-none absolute inset-x-1 top-0 z-20 flex flex-wrap justify-center gap-x-1 rounded bg-[#101410]/95 px-1 py-0.5 font-ticker text-[9px] tabular-nums">
          <span className="text-zinc-300">{timeLabel}</span>
          {chartAt.map((point, index) => (
            <span key={index} style={{ color: point.color }}>{point.label} {point.value === undefined ? "—" : formatSignedVndValue(point.value)}</span>
          ))}
        </div>
      )}
    </div>
  )
}

function MarketSessionClock() {
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    const refresh = () => setNow(Date.now())
    refresh()
    const timer = window.setInterval(refresh, 15_000)
    window.addEventListener("focus", refresh)
    document.addEventListener("visibilitychange", refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener("focus", refresh)
      document.removeEventListener("visibilitychange", refresh)
    }
  }, [])

  const display = now === null ? null : getMarketSessionDisplay(new Date(now))
  const color = display?.tone === "live"
    ? "text-emerald-300"
    : display?.tone === "paused"
      ? "text-amber-300"
      : "text-zinc-400"
  const marketStatus = display?.label ?? "Đang xác định…"

  return (
    <span
      data-market-session-status
      className={`inline-flex shrink-0 items-center whitespace-nowrap font-sans text-[10px] font-semibold tabular-nums ${color}`}
      title={`Thị trường: ${marketStatus} · Giờ Việt Nam (ICT, UTC+7)`}
      aria-label={`${display?.time ?? "--:--"} ICT · Thị trường: ${marketStatus}`}
    >
      {display?.time ?? "--:--"} ICT
    </span>
  )
}

function MarketHeaderActivity({
  sources,
  sessionDay,
  canStream = true,
}: {
  sources: readonly (string | null | undefined)[]
  sessionDay: string
  canStream?: boolean
}) {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    const refresh = () => setNow(Date.now())
    refresh()
    const timer = window.setInterval(refresh, 15_000)
    window.addEventListener("focus", refresh)
    document.addEventListener("visibilitychange", refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener("focus", refresh)
      document.removeEventListener("visibilitychange", refresh)
    }
  }, [])
  const state = now === null ? "unavailable" : getMarketCardActivity({
    sources,
    sessionDay,
    nowMs: now,
    canStream,
  })
  const revision = sources.map((source) => source ?? "").join("|")
  // Keep realtime motion, not a competing LIVE/Chậm badge or misleading stale indicator.
  // A hidden/non-live marker never pulses; the existing numeric/chart animations remain source-gated.
  return (
    <span
      data-market-live-state={state}
      aria-hidden="true"
      className={state === "live" ? "relative inline-flex h-2 w-2 shrink-0 items-center justify-center" : "hidden"}
    >
      {state === "live" && (
        <>
          <span key={revision} className="pointer-events-none absolute inset-0 rounded-full market-header-sheen" />
          <span className="relative h-1.5 w-1.5 rounded-full bg-emerald-400 motion-safe:animate-pulse" />
        </>
      )}
    </span>
  )
}

function IndexedSummary({ label, quote, day, breadth: sourceBreadth, onOpen, fresh = false, breadthFresh = false }: { label: string; quote?: MarketContextIndexQuote; day: string; breadth?: SelectedBreadth; onOpen?: () => void; fresh?: boolean; breadthFresh?: boolean }) {
  const value = finite(quote?.value) && quote!.value > 0 ? quote!.value : undefined
  const color = marketColor(quote?.changePercent)
  const change = quote?.change
  const metrics = currentSessionIndexMetrics(quote, day)
  const breadth = [sourceBreadth?.advances, sourceBreadth?.unchanged, sourceBreadth?.declines]
  const hasBreadth = Boolean(sourceBreadth)
  // An index may have untraded constituents; the colored shares apply only to classified stocks.
  const progress = indexBreadthProgress([breadth[0] ?? 0, breadth[1] ?? 0, breadth[2] ?? 0])
  const total = hasBreadth ? progress.total : 0
  const percent = quote?.changePercent
  const pillTone = !finite(percent)
    ? "border-zinc-600/40 bg-zinc-500/10 text-zinc-400"
    : percent > 0
      ? "border-emerald-400/35 bg-emerald-400/10 text-emerald-300"
      : percent < 0
        ? "border-rose-400/35 bg-rose-400/10 text-rose-300"
        : "border-amber-400/35 bg-amber-400/10 text-amber-300"
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col px-2.5 py-1.5">
      <div className="flex items-center justify-between gap-1.5">
        {onOpen ? (
          <button type="button" onClick={onOpen} className="truncate text-[11px] font-bold text-zinc-200 hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand" aria-label="Mở biểu đồ VN-Index">{label}</button>
        ) : <span className="truncate text-[11px] font-bold text-zinc-200">{label}</span>}
        <span key={`${percent ?? "missing"}`} className={`inline-flex shrink-0 rounded-full border px-1.5 py-0.5 font-sans text-[12px] font-extrabold leading-none tabular-nums ${pillTone} ${fresh ? "market-realtime-number" : ""}`}>{formatChange(percent)}</span>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 whitespace-nowrap">
        <strong key={finite(value) ? value : "missing"} className={`text-[clamp(12px,1.05vw,17px)] font-extrabold leading-tight tabular-nums text-zinc-100 ${fresh ? "market-realtime-number" : ""}`}>{finite(value) ? INDEX_FORMATTER.format(value) : "—"}</strong>
        <span key={finite(change) ? change : "missing"} className={`font-sans text-[clamp(12px,1.05vw,15px)] font-black leading-none tabular-nums ${fresh ? "market-realtime-number" : ""}`} style={{ color }}>{finite(change) ? `${change > 0 ? "+" : ""}${INDEX_FORMATTER.format(change)}` : "—"}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9px] tabular-nums text-zinc-400">
        <span>KL <b className="text-zinc-200">{formatCompactVolume(metrics.volume)}</b></span>
        <span>GT <b className="text-zinc-200">{formatVndValue(metrics.valueTraded)}</b></span>
      </div>
      <div
        className="mt-auto min-w-0 pt-1"
        aria-label={hasBreadth ? `Mã tăng ${breadth[0]}, ngang ${breadth[1]}, giảm ${breadth[2]}` : "Chưa có độ rộng hợp lệ trong phiên"}
        title={sourceBreadth ? `${sourceBreadth.source} · cập nhật ${formatAsOf(sourceBreadth.sourceUpdatedAt)} · chỉ số có thể chứa mã chưa giao dịch` : "Chưa có độ rộng hợp lệ trong phiên"}
        data-index-breadth-progress
      >
        <div className="flex h-[8px] w-full overflow-hidden rounded-full bg-zinc-800" aria-hidden="true">
          {hasBreadth && total > 0 ? <>
            <span className="bg-[#22c98a] motion-safe:transition-[width] motion-safe:duration-300" style={{ width: `${progress.shares[0]}%` }} />
            <span className="bg-amber-400 motion-safe:transition-[width] motion-safe:duration-300" style={{ width: `${progress.shares[1]}%` }} />
            <span className="bg-[#ff4757] motion-safe:transition-[width] motion-safe:duration-300" style={{ width: `${progress.shares[2]}%` }} />
          </> : null}
        </div>
        <div className="relative mt-1 h-[14px] w-full font-sans text-[9px] font-bold leading-[14px] tabular-nums" aria-hidden="true">
          <span className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-emerald-400 motion-safe:transition-[left] motion-safe:duration-300" style={{ left: `${progress.centers[0]}%` }}><span key={hasBreadth ? breadth[0] : "missing"} className={hasBreadth && breadthFresh ? "market-breadth-count-tick" : undefined}>▲{hasBreadth ? breadth[0] : "—"}</span></span>
          <span className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-amber-300 motion-safe:transition-[left] motion-safe:duration-300" style={{ left: `${progress.centers[1]}%` }}><span key={hasBreadth ? breadth[1] : "missing"} className={hasBreadth && breadthFresh ? "market-breadth-count-tick" : undefined}>–{hasBreadth ? breadth[1] : "—"}</span></span>
          <span className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-red-400 motion-safe:transition-[left] motion-safe:duration-300" style={{ left: `${progress.centers[2]}%` }}><span key={hasBreadth ? breadth[2] : "missing"} className={hasBreadth && breadthFresh ? "market-breadth-count-tick" : undefined}>▼{hasBreadth ? breadth[2] : "—"}</span></span>
        </div>
      </div>
    </div>
  )
}

function ContextCard({
  title,
  icon,
  accent = "platinum",
  children,
  className = "",
  titleHint,
  headerRight,
  headerInfo,
  activitySources,
  activitySessionDay = "",
  activityCanStream = true,
}: {
  title: string
  icon: ReactNode
  accent?: "green" | "purple" | "platinum"
  children: ReactNode
  className?: string
  titleHint?: string
  headerRight?: ReactNode
  headerInfo?: ReactNode
  activitySources?: readonly (string | null | undefined)[]
  activitySessionDay?: string
  activityCanStream?: boolean
}) {
  const accentClass = accent === "green"
    ? "border-emerald-400/20"
    : accent === "purple"
      ? "border-purple-400/20"
      : "border-white/[0.10]"

  return (
    <section
      className={`flex min-h-[128px] min-w-0 flex-col overflow-hidden rounded-[22px] border bg-[#111511] font-ticker ${accentClass} ${className}`}
      title={titleHint}
      data-market-context-card
    >
      <header className="relative flex min-h-[31px] items-center gap-1.5 overflow-hidden border-b border-white/[0.09] px-3 py-1 text-[11px] font-bold text-zinc-200">
        <span className="shrink-0 text-emerald-400">{icon}</span>
        <span className="min-w-0 truncate">{title}</span>
        {headerInfo ? <span className="inline-flex min-w-0 shrink items-center">{headerInfo}</span> : null}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {activitySources ? <MarketHeaderActivity sources={activitySources} sessionDay={activitySessionDay} canStream={activityCanStream} /> : null}
          {headerRight ? <span className="shrink-0 text-right">{headerRight}</span> : null}
        </span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col px-3 pb-2 pt-1.5">
        {children}
      </div>
    </section>
  )
}


function ImpactChart({ impact, live }: { impact: MarketImpactSnapshot; live: boolean }) {
  const entries = orderedImpactBars(impact)
  const maxUp = Math.max(0.2, ...impact.positive.map((entry) => entry.contribution)) * 1.15
  const maxDown = Math.max(0.2, ...impact.negative.map((entry) => -entry.contribution)) * 1.15
  const totalRange = maxUp + maxDown
  const zeroPct = (100 * maxUp) / totalRange
  const columns = { gridTemplateColumns: `repeat(${entries.length},minmax(0,1fr))` }
  return (
    <div className="min-w-0">
      <div className="min-w-0">
        <div className="min-w-0">
          <div
            className="relative grid h-[80px] border-b-0"
            style={columns}
            role="group"
            aria-label="Tác động VNINDEX: cột xanh kéo tăng ở trái, cột đỏ kéo giảm ở phải; mã âm mạnh nhất đứng ngoài cùng bên phải, chung trục 0"
          >
            <div className="pointer-events-none absolute inset-x-0 z-10 border-t border-zinc-400/70" style={{ top: `${zeroPct}%` }} />
            {entries.map((entry, index) => {
              const yPct = 100 * (maxUp - entry.contribution) / totalRange
              const barTop = Math.min(yPct, zeroPct)
              const barHeight = Math.abs(zeroPct - yPct)
              return (
                <div
                  key={entry.symbol}
                  role="img"
                  aria-label={`${entry.symbol}: ${entry.contribution > 0 ? "kéo tăng" : "kéo giảm"} ${Math.abs(entry.contribution).toFixed(2)} điểm VNINDEX`}
                  className={`relative min-w-0 ${index % 2 ? "bg-white/[0.025]" : "bg-white/[0.012]"}`}
                >
                  <div
                    className={`pointer-events-none absolute left-[20%] w-[60%] rounded-[2px] motion-safe:transition-[top,height] motion-safe:duration-500 motion-safe:ease-out motion-reduce:transition-none ${entry.contribution > 0 ? "bg-[#28b6a6]" : "bg-[#ef4e53]"}`}
                    style={{ top: `${barTop}%`, height: `${Math.max(1, barHeight)}%` }}
                  >
                    {live && (
                      <span
                        key={`${entry.symbol}:${entry.contribution}`}
                        className="pointer-events-none absolute inset-0 rounded-[2px] market-impact-bar-tick"
                        aria-hidden="true"
                      />
                    )}
                  </div>
                  <div className="pointer-events-none absolute inset-x-0 z-20 flex justify-center"
                    style={{ top: `max(0px, calc(${zeroPct}% - 17px))` }}
                  >
                    <span
                      className={`inline-flex max-w-full items-center rounded-[4px] border px-0.5 py-[2px] font-sans text-[10px] font-extrabold leading-none tracking-tight tabular-nums shadow-sm sm:text-[11px] ${entry.contribution > 0
                        ? "border-emerald-400/45 bg-[#102e29]/95 text-emerald-200"
                        : "border-rose-400/45 bg-[#351d24]/95 text-rose-200"}`}
                    >
                      <span key={entry.contribution} className={live ? "market-impact-value-tick" : ""}>{entry.contribution > 0 ? "+" : "−"}{Math.abs(entry.contribution).toFixed(2)}</span>
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="grid" style={columns}>
            {entries.map((entry) => (
              <span key={entry.symbol} className="truncate pt-0.5 text-center font-ticker text-[9px] font-semibold text-zinc-300">{entry.symbol}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function MarketContextStrip({
  indexQuotes,
  stockQuotes,
  canonicalUniverse,
  realtimeImpact,
  onOpenIndexChart,
}: MarketContextStripProps) {
  const [bootstrap, setBootstrap] = useState<MarketContextApiResponse | null>(null)
  const [loadError, setLoadError] = useState("")
  const [finhayForeign, setFinhayForeign] = useState<(FinhayForeignSnapshot & { sampledAt: string }) | null>(null)
  const [finhayLiquidity, setFinhayLiquidity] = useState<FinhayLiquiditySnapshot | null>(null)
  const [finhayBreadth, setFinhayBreadth] = useState<Record<string, IndexBreadthSnapshot | null>>({})
  const [vpsBreadth, setVpsBreadth] = useState<Record<string, IndexBreadthSnapshot>>({})
  const [liquiditySamples, setLiquiditySamples] = useState<{ key: string; points: MetricPoint[] }>({ key: "", points: [] })
  const [foreignSamples, setForeignSamples] = useState<{ key: string; points: ForeignMetricPoint[] }>({ key: "", points: [] })
  const [previousLiquidity, setPreviousLiquidity] = useState<SessionHistory<MetricPoint> | null>(null)
  const [serverReplay, setServerReplay] = useState<MarketBoardMetricReplay | null>(null)
  const [observedAtMs, setObservedAtMs] = useState(0)
  const [retainedFlow, setRetainedFlow] = useState<RetainedFlow>(() => ({
    day: "", liquidityFull: null, liquidityIndex: null, foreignFull: null, foreignPartial: null,
  }))

  // Switch the held session at 09:00 ICT on the next actual trading day even
  // if a provider stops polling, a tab stays open, or no new tick has arrived.
  useEffect(() => {
    const refresh = () => setObservedAtMs(Date.now())
    const timer = window.setInterval(refresh, 15_000)
    window.addEventListener("focus", refresh)
    document.addEventListener("visibilitychange", refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener("focus", refresh)
      document.removeEventListener("visibilitychange", refresh)
    }
  }, [])

  useEffect(() => {
    let disposed = false
    let inFlight = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const load = async () => {
      if (disposed || inFlight || document.visibilityState === "hidden") return
      inFlight = true
      setObservedAtMs(Date.now())
      try {
        const response = await fetch("/api/market/board-context", {
          cache: "no-store",
          credentials: "same-origin",
          signal: AbortSignal.timeout(15_000),
        })
        const data = await response.json() as MarketContextApiResponse
        if (disposed) return
        if (!response.ok || !data.ok) {
          setLoadError(data.errors?.join("; ") || "Market context unavailable")
          return
        }
        // A transient provider error must not blank a valid same-day snapshot.
        // Retained data becomes stale (never labelled LIVE) if the source stops updating.
        setBootstrap((previous) => ({
          ...data,
          impact: data.impact ?? (
            previous
              && vietnamDateKey(previous.generatedAt) === vietnamDateKey(data.generatedAt)
              && vietnamDateKey(previous.impact?.asOf ?? "") === vietnamDateKey(data.generatedAt)
              ? previous.impact
              : null
          ),
        }))
        setLoadError(data.errors?.join("; ") ?? "")
      } catch (error) {
        if (!disposed) setLoadError(error instanceof Error ? error.message : "Market context unavailable")
      } finally {
        inFlight = false
      }
    }

    const schedule = () => {
      timer = setTimeout(async () => {
        await load()
        if (!disposed) schedule()
      }, 60_000)
    }
    const onVisible = () => {
      if (document.visibilityState === "visible") void load()
    }

    void load()
    schedule()
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("focus", onVisible)
    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("focus", onVisible)
    }
  }, [])

  useEffect(() => {
    if (realtimeImpact?.asOf) setObservedAtMs(Date.now())
  }, [realtimeImpact])

  // Reuse the cached authenticated market-index snapshot only for breadth, never to overwrite DNSE live index price.
  useEffect(() => {
    let disposed = false
    let inFlight = false
    const loadBreadth = async () => {
      if (disposed || inFlight || document.visibilityState === "hidden") return
      inFlight = true
      try {
        const response = await fetch("/api/market/indexes", {
          credentials: "same-origin",
          cache: "no-store",
          signal: AbortSignal.timeout(12_000),
        })
        if (!response.ok) return
        const data = await response.json() as MarketIndexesResponse
        if (disposed || !data.ok) return
        const next: Record<string, IndexBreadthSnapshot> = {}
        for (const symbol of ["VNINDEX", "VN30"]) {
          const quote = data.quotes?.[symbol]
          const snapshot = quote?.updatedAt
            ? {
                advances: quote.advances ?? Number.NaN,
                unchanged: quote.unchanged ?? Number.NaN,
                declines: quote.declines ?? Number.NaN,
                sourceUpdatedAt: quote.updatedAt,
              }
            : null
          if (snapshot && validIndexBreadth(snapshot, vietnamDateKey(new Date().toISOString()) ?? "")) {
            next[symbol] = snapshot
          }
        }
        setVpsBreadth(next)
      } catch {
        // Keep same-day last observed source snapshot; never invent breadth.
      } finally {
        inFlight = false
      }
    }
    void loadBreadth()
    const timer = window.setInterval(() => void loadBreadth(), 30_000)
    const refresh = () => { if (document.visibilityState === "visible") void loadBreadth() }
    window.addEventListener("focus", refresh)
    document.addEventListener("visibilitychange", refresh)
    return () => {
      disposed = true
      window.clearInterval(timer)
      window.removeEventListener("focus", refresh)
      document.removeEventListener("visibilitychange", refresh)
    }
  }, [])

  useEffect(() => {
    let disposed = false
    let stopped = false
    let timer: ReturnType<typeof setInterval> | null = null

    const loadFinhayContext = async () => {
      if (stopped) return
      try {
        const response = await fetch("/api/finhay/market-context", {
          cache: "no-store",
          credentials: "same-origin",
        })
        if (response.status === 401 || response.status === 403) {
          stopped = true
          return
        }

        const data = await response.json() as FinhayMarketContextResponse
        if (disposed) return
        if (response.ok && data.ok) setFinhayBreadth(data.breadth ?? {})
        if (!response.ok || !data.ok) return
        const foreign = data.foreign
        const liquidity = data.liquidity
        const sampledAt = data.sampledAt ?? ""
        // The two Finhay sources are independent; loss of one after close
        // must not prevent retention of the other verified session snapshot.
        if (liquidity && finite(liquidity.value) && liquidity.value >= 0
          && Number.isFinite(Date.parse(liquidity.sourceUpdatedAt))) {
          setFinhayLiquidity(liquidity)
        }
        if (foreign && sampledAt
          && finite(foreign.buy?.value) && foreign.buy.value >= 0
          && finite(foreign.sell?.value) && foreign.sell.value >= 0
          && Number.isFinite(Date.parse(foreign.sourceUpdatedAt ?? ""))) {
          setFinhayForeign({ ...foreign, sampledAt })
        }
      } catch {
        // Optional Finhay data is unavailable; verified DNSE snapshots remain eligible.
      }
    }

    void loadFinhayContext()
    timer = setInterval(() => void loadFinhayContext(), 30_000)
    return () => {
      disposed = true
      if (timer) clearInterval(timer)
    }
  }, [])

  const quoteSessionDate = vietnamDateKey(indexQuotes.VNINDEX?.sourceAsOf ?? indexQuotes.VNINDEX?.updatedAt ?? "")
  const liveImpactDate = vietnamDateKey(realtimeImpact?.asOf ?? "") ?? ""
  const contextSessionDate = [quoteSessionDate, liveImpactDate].filter(Boolean).sort().at(-1) ?? ""
  const metricDisplayDay = observedAtMs > 0 ? displayedMarketMetricDay(new Date(observedAtMs)) : ""
  // Server-owned snapshots arrive even after a fully unattended morning.
  // This read path creates no new market subscriptions or market-data polling.
  useEffect(() => {
    let stopped = false
    let fetching = false
    const loadReplay = async () => {
      if (stopped || fetching || document.visibilityState === "hidden") return
      fetching = true
      try {
        const response = await fetch("/api/market/metric-history", {
          credentials: "same-origin",
          cache: "no-store",
          signal: AbortSignal.timeout(10_000),
        })
        if (!response.ok) return
        const next = await response.json() as MarketBoardMetricReplay & { ok?: boolean }
        if (!stopped && next.ok && next.day === metricDisplayDay) {
          setServerReplay(next)
        }
      } catch {
        // Retain the last valid server data and observed browser points.
      } finally {
        fetching = false
      }
    }
    void loadReplay()
    const timer = window.setInterval(() => void loadReplay(), 60_000)
    const onVisible = () => { if (document.visibilityState === "visible") void loadReplay() }
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("focus", onVisible)
    return () => {
      stopped = true
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("focus", onVisible)
    }
  }, [metricDisplayDay])

  const retention = retainedFlow.day === metricDisplayDay ? retainedFlow : null
  useEffect(() => {
    setRetainedFlow(loadRetainedFlow(metricDisplayDay))
  }, [metricDisplayDay])

  const vnindexQuote = indexQuotes.VNINDEX
  const indexLiquidity = currentSessionIndexMetrics(vnindexQuote, metricDisplayDay)
  const fallbackLiquidityValue = indexLiquidity.valueTraded
  const fallbackLiquidityUpdatedAt = indexLiquidity.asOf
  const hasFinhayLiquidity = Boolean(
    finhayLiquidity && validSessionMetricTimestamp(finhayLiquidity.sourceUpdatedAt, metricDisplayDay)
      && finite(finhayLiquidity.value) && finhayLiquidity.value >= 0,
  )
  const freshLiquidity: RetainedLiquidity | null = hasFinhayLiquidity && finhayLiquidity
    ? { day: metricDisplayDay, source: "finhay-vnindex", asOf: finhayLiquidity.sourceUpdatedAt,
        value: finhayLiquidity.value, ...(finite(finhayLiquidity.volume) && finhayLiquidity.volume >= 0 ? { volume: finhayLiquidity.volume } : {}) }
    : null
  const indexSnapshot: RetainedLiquidity | null = validSessionMetricTimestamp(fallbackLiquidityUpdatedAt, metricDisplayDay)
    && finite(fallbackLiquidityValue) && fallbackLiquidityValue >= 0
    ? { day: metricDisplayDay, source: "index-quote", asOf: fallbackLiquidityUpdatedAt,
        value: fallbackLiquidityValue, ...(finite(indexLiquidity.volume) && indexLiquidity.volume >= 0 ? { volume: indexLiquidity.volume } : {}) }
    : null
  // Both sources represent full-index liquidity; choose the most recently
  // timestamped actual sample, not whichever REST endpoint answered last.
  const liquidityCandidate = [freshLiquidity, indexSnapshot, retention?.liquidityFull, retention?.liquidityIndex]
    .filter((item): item is RetainedLiquidity => Boolean(item))
    .sort((a, b) => Date.parse(b.asOf) - Date.parse(a.asOf))[0]
  const liquiditySeriesSource = liquidityCandidate?.source ?? "index-quote"
  const liquidityValue = liquidityCandidate?.value
  const liquidityVolume = liquidityCandidate?.volume
  const liquidityUpdatedAt = liquidityCandidate?.asOf ?? ""

  useEffect(() => {
    for (const [field, snapshot] of [["liquidityFull", freshLiquidity], ["liquidityIndex", indexSnapshot]] as const) {
      if (!snapshot || !metricDisplayDay) continue
      try { writeRetainedMetric(localStorage, "liquidity", snapshot) } catch { /* Optional storage. */ }
      setRetainedFlow((current) => current.day === metricDisplayDay
        && (!current[field] || Date.parse(current[field]!.asOf) <= Date.parse(snapshot.asOf))
        ? { ...current, [field]: snapshot } : current)
    }
  }, [metricDisplayDay, freshLiquidity?.asOf, freshLiquidity?.value, freshLiquidity?.volume,
    indexSnapshot?.asOf, indexSnapshot?.value, indexSnapshot?.volume])

  const liquidityHistoryKey = metricHistoryPrefix("liquidity", liquiditySeriesSource)
  const liquiditySampleKey = `${liquidityHistoryKey}:${metricDisplayDay}`
  const liquidityPoints = liquiditySamples.key === liquiditySampleKey ? liquiditySamples.points : []
  useEffect(() => {
    setLiquiditySamples({ key: liquiditySampleKey, points: readMetricHistory<MetricPoint>(liquidityHistoryKey, metricDisplayDay) })
    setPreviousLiquidity(previousMetricHistory<MetricPoint>(liquidityHistoryKey, metricDisplayDay))
  }, [metricDisplayDay, liquidityHistoryKey, liquiditySampleKey])
  useEffect(() => {
    if (!metricDisplayDay || !validSessionMetricTimestamp(liquidityUpdatedAt, metricDisplayDay)
      || !finite(liquidityValue) || liquidityValue < 0) return
    const existing = readMetricHistory<MetricPoint>(liquidityHistoryKey, metricDisplayDay)
    const next = upsertMetricPoint(existing, liquidityUpdatedAt, liquidityValue)
    writeMetricHistory(liquidityHistoryKey, metricDisplayDay, next)
    setLiquiditySamples({ key: liquiditySampleKey, points: next })
  }, [metricDisplayDay, liquidityUpdatedAt, liquidityValue, liquidityHistoryKey, liquiditySampleKey])

  const foreignSnapshot = useMemo(() => {
    let buy = 0
    let sell = 0
    let covered = 0
    let asOf = ""

    for (const stock of canonicalUniverse) {
      const quote = stockQuotes[stock.ticker]
      if (
        !quote
        || quote.foreignSource !== "DNSE Onidel WS"
        || quote.foreignSessionDate !== metricDisplayDay
        || !quote.foreignUpdatedAt
        || !validSessionMetricTimestamp(quote.foreignUpdatedAt, metricDisplayDay)
        || !finite(quote.foreignBuyValue)
        || !finite(quote.foreignSellValue)
        || quote.foreignBuyValue < 0
        || quote.foreignSellValue < 0
      ) continue
      buy += quote.foreignBuyValue
      sell += quote.foreignSellValue
      covered += 1
      if (quote.foreignUpdatedAt > asOf) asOf = quote.foreignUpdatedAt
    }

    return { buy, sell, covered, asOf }
  }, [canonicalUniverse, stockQuotes, metricDisplayDay])

  const hasFinhayForeign = Boolean(
    finhayForeign && metricDisplayDay
      && finhayForeign.sessionDate === metricDisplayDay
      && validSessionMetricTimestamp(finhayForeign.sourceUpdatedAt ?? "", metricDisplayDay)
      && finite(finhayForeign.buy.value) && finhayForeign.buy.value >= 0
      && finite(finhayForeign.sell.value) && finhayForeign.sell.value >= 0,
  )
  const foreignFullSnapshot: RetainedForeign | null = hasFinhayForeign && finhayForeign
    ? { day: metricDisplayDay, source: "finhay-vnindex",
        asOf: finhayForeign.sourceUpdatedAt!,
        buy: finhayForeign.buy.value!, sell: finhayForeign.sell.value! }
    : null
  const top200ForeignTotals = coveredTop200ForeignTotals(foreignSnapshot)
  const foreignPartialSnapshot: RetainedForeign | null = top200ForeignTotals
    && validSessionMetricTimestamp(foreignSnapshot.asOf, metricDisplayDay)
    ? { day: metricDisplayDay, source: "top200-partial", asOf: foreignSnapshot.asOf,
        buy: top200ForeignTotals.buy, sell: top200ForeignTotals.sell }
    : null
  // Full HOSE and partial Top-200 totals must never be combined or relabelled.
  // Prefer a retained full-HOSE observation to a fresh *partial* observation.
  const fullForeign = [foreignFullSnapshot, retention?.foreignFull]
    .filter((item): item is RetainedForeign => Boolean(item))
    .sort((a, b) => Date.parse(b.asOf) - Date.parse(a.asOf))[0]
  const partialForeign = [foreignPartialSnapshot, retention?.foreignPartial]
    .filter((item): item is RetainedForeign => Boolean(item))
    .sort((a, b) => Date.parse(b.asOf) - Date.parse(a.asOf))[0]
  const foreignCandidate = fullForeign ?? partialForeign
  const foreignSeriesSource = foreignCandidate?.source ?? "top200-partial"
  const foreignUpdatedAt = foreignCandidate?.asOf ?? ""
  const displayedForeignBuy = foreignCandidate?.buy
  const displayedForeignSell = foreignCandidate?.sell
  const displayedForeignNet = finite(displayedForeignBuy) && finite(displayedForeignSell)
    ? displayedForeignBuy - displayedForeignSell : undefined

  useEffect(() => {
    for (const [field, snapshot] of [["foreignFull", foreignFullSnapshot], ["foreignPartial", foreignPartialSnapshot]] as const) {
      if (!snapshot || !metricDisplayDay) continue
      try { writeRetainedMetric(localStorage, "foreign", snapshot) } catch { /* Optional storage. */ }
      setRetainedFlow((current) => current.day === metricDisplayDay
        && (!current[field] || Date.parse(current[field]!.asOf) <= Date.parse(snapshot.asOf))
        ? { ...current, [field]: snapshot } : current)
    }
  }, [metricDisplayDay, foreignFullSnapshot?.asOf, foreignFullSnapshot?.buy, foreignFullSnapshot?.sell,
    foreignPartialSnapshot?.asOf, foreignPartialSnapshot?.buy, foreignPartialSnapshot?.sell])

  const foreignHistoryKey = metricHistoryPrefix("foreign", foreignSeriesSource)
  const foreignSampleKey = `${foreignHistoryKey}:${metricDisplayDay}`
  const foreignPoints = foreignSamples.key === foreignSampleKey ? foreignSamples.points : []
  useEffect(() => {
    setForeignSamples({ key: foreignSampleKey, points: readMetricHistory<ForeignMetricPoint>(foreignHistoryKey, metricDisplayDay) })
  }, [metricDisplayDay, foreignHistoryKey, foreignSampleKey])
  useEffect(() => {
    if (!foreignPartialSnapshot || foreignSeriesSource !== "top200-partial") return
    const existing = readMetricHistory<ForeignMetricPoint>(foreignHistoryKey, metricDisplayDay)
    const next = upsertForeignMetricPoint(existing, foreignPartialSnapshot.asOf, foreignPartialSnapshot.buy, foreignPartialSnapshot.sell)
    writeMetricHistory(foreignHistoryKey, metricDisplayDay, next)
    setForeignSamples({ key: foreignSampleKey, points: next })
  }, [metricDisplayDay, foreignHistoryKey, foreignSampleKey, foreignSeriesSource,
    foreignPartialSnapshot?.asOf, foreignPartialSnapshot?.buy, foreignPartialSnapshot?.sell])
  useEffect(() => {
    if (!foreignFullSnapshot || foreignSeriesSource !== "finhay-vnindex") return
    const existing = readMetricHistory<ForeignMetricPoint>(foreignHistoryKey, metricDisplayDay)
    // Keep the original provider timestamp, not the later Finhay polling time.
    const next = upsertForeignMetricPoint(existing, foreignFullSnapshot.asOf, foreignFullSnapshot.buy, foreignFullSnapshot.sell)
    writeMetricHistory(foreignHistoryKey, metricDisplayDay, next)
    setForeignSamples({ key: foreignSampleKey, points: next })
  }, [metricDisplayDay, foreignHistoryKey, foreignSampleKey, foreignSeriesSource,
    foreignFullSnapshot?.asOf, foreignFullSnapshot?.buy, foreignFullSnapshot?.sell])

  // The rendered session holds through EOD, midnight, weekends and holidays.
  // At 09:00 on the next trading day it switches and does NOT reuse yesterday's
  // totals or primary chart as if they were current-session observations.
  const isDisplaySession = metricDisplayDay !== ""
  const replay = isDisplaySession && serverReplay?.day === metricDisplayDay ? serverReplay : null
  const serverLiquidityPoints = replay?.liquidity.today ?? []
  const serverForeignPoints = replay?.foreign.today ?? []
  const useServerLiquidity = serverLiquidityPoints.length >= 2
    || (!liquidityPoints.length && serverLiquidityPoints.length > 0)
  // Index-quote and Finhay cover the same full-HOSE liquidity, but individual
  // series are never spliced; previous day must match this chart's source.
  const todayLiquidityPoints = isDisplaySession
    ? preferObservedReplay(serverLiquidityPoints, liquidityPoints) : []
  const verifiedPreviousLiquidity = isDisplaySession
    ? useServerLiquidity && replay?.previousDay === previousTradingSessionDateKey(metricDisplayDay)
      ? replay.liquidity.previous.length >= 2
        ? { day: replay.previousDay!, points: replay.liquidity.previous } : null
      : previousLiquidity
    : null
  // Full-HOSE foreign totals depend on a browser Finhay OAuth cookie, so the
  // unattended DNSE series is explicitly Top-200 partial, not the same scope.
  const hasFullObservedForeign = foreignSeriesSource === "finhay-vnindex" && foreignPoints.length >= 2
  const useServerForeign = !hasFullObservedForeign && serverForeignPoints.length >= 2
  const foreignChartPartial = foreignSeriesSource === "top200-partial" || useServerForeign
  const chartForeignPoints = !isDisplaySession ? []
    : foreignChartPartial ? preferObservedReplay(serverForeignPoints, foreignPoints) : foreignPoints
  const todayForeignNetPoints = intradayForeignNet(chartForeignPoints)
  const todayForeignBuy = isDisplaySession ? displayedForeignBuy : undefined
  const todayForeignSell = isDisplaySession ? displayedForeignSell : undefined
  const todayForeignNet = isDisplaySession ? displayedForeignNet : undefined
  const contextErrors = bootstrap?.errors?.join("; ") || loadError
  const sessionOpen = observedAtMs > 0 && getMarketSessionStatus(new Date(observedAtMs)).isLiveSession
  const isFresh = (asOf: string | null | undefined) => {
    const sourceMs = Date.parse(asOf ?? "")
    return sessionOpen
      && contextSessionDate !== ""
      && Number.isFinite(sourceMs)
      && sourceMs <= observedAtMs + 5_000
      && observedAtMs - sourceMs <= 120_000
      && vietnamDateKey(asOf ?? "") === contextSessionDate
  }
  const impactSelection = selectCurrentSessionImpact(bootstrap?.impact, realtimeImpact, contextSessionDate, observedAtMs)
  const impact = impactSelection.impact
  const impactLive = impactSelection.source === "websocket" && Boolean(impact?.asOf && isFresh(impact.asOf))
  const vnindexBreadth = selectMarketBreadth("VNINDEX", contextSessionDate, finhayBreadth, vpsBreadth)
  const vn30Breadth = selectMarketBreadth("VN30", contextSessionDate, finhayBreadth, vpsBreadth)


  return (
    <div className="border-b border-white/[0.08] bg-[#0a0d0b] px-3 py-2" data-market-context-strip title={contextErrors || undefined}>
      <div className="grid min-w-0 grid-cols-1 items-stretch gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)]" data-market-context-single-row>
        <ContextCard title="VN-Index / VN30" icon={<Landmark className="h-3.5 w-3.5" />} accent="green" className="h-full xl:h-[156px]"
          activitySources={[indexQuotes.VNINDEX?.sourceAsOf, indexQuotes.VN30?.sourceAsOf]}
          activitySessionDay={contextSessionDate}
          headerInfo={<MarketSessionClock />}
          headerRight={
            <button
              type="button"
              onClick={onOpenIndexChart}
              aria-label="Mở biểu đồ realtime VN-Index và VN30F1M"
              title="Biểu đồ realtime VN-Index / VN30F1M"
              className="inline-flex h-6 items-center gap-1 rounded-md border border-emerald-400/25 bg-emerald-400/[0.08] px-2 text-[10px] font-semibold text-emerald-300 transition-colors hover:bg-emerald-400/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            >
              <ChartNoAxesCombined className="h-3.5 w-3.5" aria-hidden="true" />
              Chart
            </button>
          }>
          <div className="-mx-2.5 -mt-1.5 flex min-w-0 flex-1 divide-x divide-white/10">
            <IndexedSummary label="VN-Index" quote={indexQuotes.VNINDEX} day={contextSessionDate} breadth={vnindexBreadth} onOpen={onOpenIndexChart} fresh={isFresh(indexQuotes.VNINDEX?.sourceAsOf)} breadthFresh={isFresh(vnindexBreadth?.sourceUpdatedAt)} />
            <IndexedSummary label="VN30" quote={indexQuotes.VN30} day={contextSessionDate} breadth={vn30Breadth} fresh={isFresh(indexQuotes.VN30?.sourceAsOf)} breadthFresh={isFresh(vn30Breadth?.sourceUpdatedAt)} />
          </div>
        </ContextCard>
        <ContextCard title="Thanh khoản HOSE" className="h-full xl:h-[156px]" icon={<WalletCards className="h-3.5 w-3.5" />}
          activitySources={[liquidityUpdatedAt]}
          activitySessionDay={contextSessionDate}
          titleHint={hasFinhayLiquidity ? "Finhay VNINDEX trading_value · VND verified" : "Dữ liệu VNINDEX theo timestamp provider"}
          headerRight={<span key={finite(liquidityValue) ? liquidityValue : "missing"} className={`font-ticker text-[12px] font-extrabold tabular-nums text-zinc-100 ${isFresh(liquidityUpdatedAt) ? "market-realtime-number" : ""}`}>{formatVndValue(liquidityValue)}</span>}>
          <div className="flex justify-between gap-1 text-[10px] text-zinc-400">
            <span>KL <strong key={finite(liquidityVolume) ? liquidityVolume : "missing"} className={`text-zinc-100 ${isFresh(liquidityUpdatedAt) ? "market-realtime-number" : ""}`}>{formatCompactVolume(liquidityVolume)}</strong></span>
            <span className="truncate">{verifiedPreviousLiquidity ? `So với ${verifiedPreviousLiquidity.day}` : "Chưa ghi nhận phiên trước"}</span>
          </div>
          <div className="mt-auto min-w-0"><ComparisonLineChart series={[
            { label: "Nay", points: todayLiquidityPoints, color: PLATINUM },
            { label: "Trước", points: verifiedPreviousLiquidity?.points ?? [], color: "#eb6f6f", previous: true },
          ]} animate={isDisplaySession && isFresh(liquidityUpdatedAt)} /></div>
        </ContextCard>
        <ContextCard title="Mua bán nước ngoài" className="h-full xl:h-[156px]" icon={<Globe2 className="h-3.5 w-3.5" />} accent="purple"
          activitySources={[foreignUpdatedAt]}
          activitySessionDay={contextSessionDate}
          titleHint={foreignSeriesSource === "finhay-vnindex"
            ? foreignChartPartial
              ? "Tiêu đề: Finhay toàn HOSE. Biểu đồ: DNSE chỉ Top 200, không phải tổng toàn HOSE"
              : "Finhay: giao dịch nước ngoài toàn HOSE"
            : foreignSnapshot.covered > 0 && foreignPartialSnapshot?.asOf === foreignUpdatedAt
              ? `DNSE: chỉ ${foreignSnapshot.covered}/${canonicalUniverse.length} mã Top 200; không phải tổng toàn HOSE`
              : "DNSE: dữ liệu Top 200 partial; không phải tổng toàn HOSE"}
          headerRight={<span key={finite(todayForeignNet) ? todayForeignNet : "missing"} className={`text-[11px] font-bold tabular-nums ${isFresh(foreignUpdatedAt) ? "market-realtime-number" : ""} ${finite(todayForeignNet) && todayForeignNet > 0 ? "text-emerald-300" : finite(todayForeignNet) && todayForeignNet < 0 ? "text-red-300" : "text-zinc-300"}`}>{formatSignedVndValue(todayForeignNet)}</span>}>
          <div className="flex justify-between gap-1 text-[10px] tabular-nums">
            <span className="truncate text-emerald-300">Mua <span key={finite(todayForeignBuy) ? todayForeignBuy : "missing"} className={isFresh(foreignUpdatedAt) ? "market-realtime-number" : ""}>{formatVndValue(todayForeignBuy)}</span></span>
            <span className="truncate text-red-300">Bán <span key={finite(todayForeignSell) ? todayForeignSell : "missing"} className={isFresh(foreignUpdatedAt) ? "market-realtime-number" : ""}>{formatVndValue(todayForeignSell)}</span></span>
          </div>
          <div className="relative mt-auto min-w-0">
            {foreignChartPartial && foreignSeriesSource === "finhay-vnindex" && (
              <span data-market-foreign-chart-scope className="pointer-events-none absolute left-1 top-0 z-10 rounded bg-[#111511]/90 px-1 font-sans text-[9px] text-zinc-400">Chart: Top 200</span>
            )}
            <ComparisonLineChart zeroReference series={[
              { label: "Ròng", points: todayForeignNetPoints, color: (todayForeignNetPoints.at(-1)?.value ?? 0) < 0 ? RED : GREEN },
            ]} animate={isDisplaySession && (useServerForeign ? false : isFresh(foreignUpdatedAt))} />
          </div>
        </ContextCard>
        <ContextCard title="Tác động VNINDEX" icon={<Scale className="h-4 w-4" />} accent="green" className="h-full xl:h-[156px]"
          activitySources={[impact?.asOf]}
          activitySessionDay={contextSessionDate}
          activityCanStream={impactSelection.source === "websocket"}
          headerRight={impact && (impact.positive.length || impact.negative.length) ? (
            <span
              className="inline-flex items-center gap-1.5 font-sans text-[10px] font-extrabold tabular-nums"
              aria-label={`Tổng 5 mã kéo tăng ${impact.displayedPositiveTotal.toFixed(2)} điểm và 5 mã kéo giảm ${Math.abs(impact.displayedNegativeTotal).toFixed(2)} điểm`}
              title="Tổng đóng góp của 5 mã tăng và 5 mã giảm hiển thị, tính bằng điểm VNINDEX"
            >
              <span key={impact.displayedPositiveTotal} className={`text-emerald-300 ${impactLive ? "market-realtime-number" : ""}`}>+{Math.max(0, impact.displayedPositiveTotal).toFixed(2)}</span>
              <span key={impact.displayedNegativeTotal} className={`text-rose-300 ${impactLive ? "market-realtime-number" : ""}`}>−{Math.max(0, -impact.displayedNegativeTotal).toFixed(2)}</span>
            </span>
          ) : null}>
          {impact && (impact.positive.length > 0 || impact.negative.length > 0) ? (
            <ImpactChart impact={impact} live={impactLive} />
          ) : (
            <div className="flex min-h-[75px] flex-1 items-center justify-center gap-2 text-[10px] text-zinc-500">
              <Activity className="h-4 w-4" /> Chưa có provider contribution snapshot
            </div>
          )}
        </ContextCard>
      </div>
    </div>
  )
}
