"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Activity, ChartNoAxesCombined, Globe2, Landmark, Scale, WalletCards } from "lucide-react"
import { getMarketSessionDisplay, getMarketSessionStatus } from "@/modules/market/realtime/session-countdown"

import { coveredTop200ForeignTotals, currentSessionIndexMetrics, orderedImpactBars, selectCurrentSessionImpact } from "@/modules/market/board/market-context-contract"
import { intradayForeignNet, observedValueAtMinute, previousTradingSessionDateKey, vietnamSessionMinute } from "@/modules/market/board/market-context-metrics"
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
}: {
  series: ComparisonSeries[]
  zeroReference?: boolean
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
          const path = ordered.map((point, position) =>
            `${position ? "L" : "M"}${x(vietnamSessionMinute(point.minute)).toFixed(1)},${y(point.value).toFixed(1)}`,
          ).join(" ")
          const latest = ordered.at(-1)
          return <g key={index}>
            {ordered.length > 1 && (
              <path d={path} fill="none" stroke={line.color} strokeDasharray={line.previous ? "5 4" : undefined}
                strokeWidth={line.previous ? 1.8 : 2.4} strokeOpacity={line.previous ? 0.85 : 1} strokeLinecap="round" strokeLinejoin="round" />
            )}
            {latest && (
              <circle cx={x(vietnamSessionMinute(latest.minute))} cy={y(latest.value)} r={line.previous ? 1.7 : 2.4} fill={line.color} />
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

  return (
    <div className="mt-0.5 flex h-[20px] min-w-0 shrink-0 items-center gap-1.5 border-t border-white/[0.07] pt-1 font-ticker text-[10px] tabular-nums"
      data-market-session-status
      title="Lịch phiên giao dịch theo giờ Việt Nam (ICT, UTC+7), độc lập với trạng thái kết nối dữ liệu realtime"
    >
      <span className="shrink-0 text-zinc-400">{display?.time ?? "--:--"} ICT</span>
      <span className="text-zinc-600">·</span>
      <span className={`min-w-0 truncate font-semibold ${color}`}>Thị trường: {display?.label ?? "Đang xác định…"}</span>
    </div>
  )
}

function IndexedSummary({ label, quote, day, breadth: sourceBreadth, onOpen }: { label: string; quote?: MarketContextIndexQuote; day: string; breadth?: SelectedBreadth; onOpen?: () => void }) {
  const value = finite(quote?.value) && quote!.value > 0 ? quote!.value : undefined
  const color = marketColor(quote?.changePercent)
  const change = quote?.change
  const metrics = currentSessionIndexMetrics(quote, day)
  const breadth = [sourceBreadth?.advances, sourceBreadth?.unchanged, sourceBreadth?.declines]
  const hasBreadth = Boolean(sourceBreadth)
  // An index may have untraded constituents; the colored shares apply only to classified stocks.
  const total = hasBreadth ? breadth.reduce<number>((sum, number) => sum + (number ?? 0), 0) : 0
  return (
    <div className="min-w-0 flex-1 px-2.5 py-1.5">
      <div className="flex items-center justify-between gap-1.5">
        {onOpen ? (
          <button type="button" onClick={onOpen} className="truncate text-[11px] font-bold text-zinc-200 hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand" aria-label="Mở biểu đồ VN-Index">{label}</button>
        ) : <span className="truncate text-[11px] font-bold text-zinc-200">{label}</span>}
        <span className="text-[9px] font-bold tabular-nums" style={{ color }}>{formatChange(quote?.changePercent)}</span>
      </div>
      <div className="mt-0.5 flex items-baseline gap-1.5 whitespace-nowrap">
        <strong className="text-[clamp(13px,1.35vw,22px)] font-black leading-tight tabular-nums text-zinc-100">{finite(value) ? INDEX_FORMATTER.format(value) : "—"}</strong>
        <span className="text-[10px] font-extrabold tabular-nums" style={{ color }}>{finite(change) ? `${change > 0 ? "+" : ""}${INDEX_FORMATTER.format(change)}` : "—"}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9px] tabular-nums text-zinc-400">
        <span>KL <b className="text-zinc-200">{formatCompactVolume(metrics.volume)}</b></span>
        <span>GT <b className="text-zinc-200">{formatVndValue(metrics.valueTraded)}</b></span>
      </div>
      <div className="mt-1 flex h-1 overflow-hidden rounded-full bg-zinc-800"
        aria-label="Mã tăng, đứng, giảm theo dữ liệu chỉ số"
        title={sourceBreadth ? `${sourceBreadth.source} · cập nhật ${formatAsOf(sourceBreadth.sourceUpdatedAt)} · chỉ số có thể chứa mã chưa giao dịch` : "Chưa có độ rộng hợp lệ trong phiên"}>

        {hasBreadth && total > 0 ? <>
          <span className="bg-[#22c98a]" style={{ width: `${100 * (breadth[0] ?? 0) / total}%` }} />
          <span className="bg-amber-400" style={{ width: `${100 * (breadth[1] ?? 0) / total}%` }} />
          <span className="bg-[#ff4757]" style={{ width: `${100 * (breadth[2] ?? 0) / total}%` }} />
        </> : null}
      </div>
      <div className="mt-0.5 flex justify-between gap-1 text-[9px] font-semibold tabular-nums">
        <span className="text-emerald-400">▲ {hasBreadth ? breadth[0] : "—"}</span>
        <span className="text-amber-300">– {hasBreadth ? breadth[1] : "—"}</span>
        <span className="text-red-400">▼ {hasBreadth ? breadth[2] : "—"}</span>
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
}: {
  title: string
  icon: ReactNode
  accent?: "green" | "purple" | "platinum"
  children: ReactNode
  className?: string
  titleHint?: string
  headerRight?: ReactNode
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
      <header className="flex min-h-[31px] items-center gap-1.5 border-b border-white/[0.09] px-3 py-1 text-[11px] font-bold text-zinc-200">
        <span className="shrink-0 text-emerald-400">{icon}</span>
        <span className="min-w-0 truncate">{title}</span>
        {headerRight ? <span className="ml-auto shrink-0 text-right">{headerRight}</span> : null}
      </header>
      <div className="flex min-h-0 flex-1 flex-col px-3 pb-2 pt-1.5">
        {children}
      </div>
    </section>
  )
}


function LivePulse({ active, sessionOpen }: { active: boolean; sessionOpen: boolean }) {
  if (active) return (
    <span className="inline-flex items-center gap-1 text-emerald-300">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 motion-safe:animate-pulse" />
      LIVE
    </span>
  )
  return sessionOpen ? <span className="text-amber-300">Chậm</span> : null
}

function ImpactChart({ impact, live, sessionOpen }: { impact: MarketImpactSnapshot; live: boolean; sessionOpen: boolean }) {
  const entries = orderedImpactBars(impact)
  const maxUp = Math.max(0.2, ...impact.positive.map((entry) => entry.contribution)) * 1.15
  const maxDown = Math.max(0.2, ...impact.negative.map((entry) => -entry.contribution)) * 1.15
  const totalRange = maxUp + maxDown
  const zeroPct = (100 * maxUp) / totalRange
  const positiveTotal = Math.max(0, impact.displayedPositiveTotal)
  const negativeTotal = Math.max(0, -impact.displayedNegativeTotal)
  const sumAbs = positiveTotal + negativeTotal
  const columns = { gridTemplateColumns: `repeat(${entries.length},minmax(0,1fr))` }
  return (
    <div className="min-w-0">
      <div className="min-w-0">
        <div className="min-w-0">
          <div
            className="relative grid h-[55px] border-b-0"
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
                    className={`pointer-events-none absolute left-[20%] w-[60%] rounded-[2px] motion-safe:transition-[top,height] motion-safe:duration-300 motion-safe:ease-out motion-reduce:transition-none ${entry.contribution > 0 ? "bg-[#28b6a6]" : "bg-[#ef4e53]"}`}
                    style={{ top: `${barTop}%`, height: `${Math.max(1, barHeight)}%` }}
                  />
                  <div className="pointer-events-none absolute inset-x-0 z-20 flex justify-center"
                    style={{ top: `max(0px, calc(${zeroPct}% - 25px))` }}
                  >
                    <span
                      className={`inline-flex max-w-full flex-col items-center rounded-[4px] border px-0.5 py-[2px] font-sans text-[10px] font-extrabold leading-none tracking-tight tabular-nums shadow-sm sm:text-[11px] ${entry.contribution > 0
                        ? "border-emerald-400/45 bg-[#102e29]/95 text-emerald-200"
                        : "border-rose-400/45 bg-[#351d24]/95 text-rose-200"}`}
                    >
                      <span>{entry.contribution > 0 ? "+" : "−"}{Math.abs(entry.contribution).toFixed(2)}</span>
                      <span className="pt-0.5 text-[8px] font-medium leading-none opacity-90">điểm</span>
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
      <div className="mt-1 flex h-[15px] overflow-hidden rounded font-ticker text-[10px] font-extrabold tabular-nums text-white" aria-label="Tổng điểm kéo tăng và kéo giảm của các mã hiển thị">
        <div className="flex items-center justify-center bg-[#269f91] motion-safe:transition-[width] motion-safe:duration-300 motion-reduce:transition-none" style={{ width: `${sumAbs > 0 ? 100 * positiveTotal / sumAbs : 50}%` }}>
          +{positiveTotal.toFixed(2)}
        </div>
        <div className="flex items-center justify-center bg-[#ed5056] motion-safe:transition-[width] motion-safe:duration-300 motion-reduce:transition-none" style={{ width: `${sumAbs > 0 ? 100 * negativeTotal / sumAbs : 50}%` }}>
          −{negativeTotal.toFixed(2)}
        </div>
      </div>
      <p className="mt-0.5 flex items-center justify-end gap-2 truncate font-ticker text-[8px] text-zinc-500">
        <LivePulse active={live} sessionOpen={sessionOpen} />
        <span>DNSE basketInfluence · {formatAsOf(impact.asOf)}</span>
      </p>
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
  const [finhayForeignState, setFinhayForeignState] = useState<"UNKNOWN" | "AVAILABLE" | "UNAVAILABLE">("UNKNOWN")
  const [liquiditySamples, setLiquiditySamples] = useState<{ key: string; points: MetricPoint[] }>({ key: "", points: [] })
  const [foreignSamples, setForeignSamples] = useState<{ key: string; points: ForeignMetricPoint[] }>({ key: "", points: [] })
  const [previousLiquidity, setPreviousLiquidity] = useState<SessionHistory<MetricPoint> | null>(null)
  const [observedAtMs, setObservedAtMs] = useState(0)

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
          if (!disposed) setFinhayForeignState("UNAVAILABLE")
          return
        }

        const data = await response.json() as FinhayMarketContextResponse
        if (disposed) return
        if (response.ok && data.ok) setFinhayBreadth(data.breadth ?? {})
        const foreign = data.foreign
        const liquidity = data.liquidity
        const buy = foreign?.buy?.value
        const sell = foreign?.sell?.value
        const sampledAt = data.sampledAt ?? ""
        const liquidityValue = liquidity?.value
        if (
          !response.ok
          || !data.ok
          || !foreign
          || !liquidity
          || !sampledAt
          || !finite(buy)
          || !finite(sell)
          || !finite(liquidityValue)
          || !Number.isFinite(Date.parse(liquidity.sourceUpdatedAt))
        ) {
          setFinhayForeignState("UNAVAILABLE")
          return
        }

        setFinhayForeign({ ...foreign, sampledAt })
        setFinhayLiquidity(liquidity)
        setFinhayForeignState("AVAILABLE")
      } catch {
        if (!disposed) setFinhayForeignState("UNAVAILABLE")
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
  const vnindexQuote = indexQuotes.VNINDEX
  const indexLiquidity = currentSessionIndexMetrics(vnindexQuote, contextSessionDate)
  const fallbackLiquidityValue = indexLiquidity.valueTraded
  const fallbackLiquidityUpdatedAt = indexLiquidity.asOf
  const hasFinhayLiquidity = Boolean(
    finhayLiquidity
    && contextSessionDate
    && vietnamDateKey(finhayLiquidity.sourceUpdatedAt) === contextSessionDate
    && finite(finhayLiquidity.value)
    && finhayLiquidity.value >= 0,
  )
  const liquiditySeriesSource = hasFinhayLiquidity ? "finhay-vnindex" : "index-quote"
  const liquidityValue = hasFinhayLiquidity ? finhayLiquidity?.value : fallbackLiquidityValue
  // Match the liquidity source/session when possible; never sum Top-200 volume as full HOSE.
  const liquidityVolume = hasFinhayLiquidity && finite(finhayLiquidity?.volume)
    ? finhayLiquidity.volume
    : indexLiquidity.volume
  const liquidityUpdatedAt = hasFinhayLiquidity ? finhayLiquidity?.sourceUpdatedAt ?? "" : fallbackLiquidityUpdatedAt

  const liquidityHistoryKey = metricHistoryPrefix("liquidity", liquiditySeriesSource)
  const liquiditySampleKey = `${liquidityHistoryKey}:${contextSessionDate}`
  const liquidityPoints = liquiditySamples.key === liquiditySampleKey ? liquiditySamples.points : []
  useEffect(() => {
    setLiquiditySamples({ key: liquiditySampleKey, points: readMetricHistory<MetricPoint>(liquidityHistoryKey, contextSessionDate) })
    setPreviousLiquidity(previousMetricHistory<MetricPoint>(liquidityHistoryKey, contextSessionDate))
  }, [contextSessionDate, liquidityHistoryKey, liquiditySampleKey])
  useEffect(() => {
    if (!contextSessionDate || vietnamDateKey(liquidityUpdatedAt) !== contextSessionDate || !finite(liquidityValue) || liquidityValue < 0) return
    const existing = readMetricHistory<MetricPoint>(liquidityHistoryKey, contextSessionDate)
    const next = upsertMetricPoint(existing, liquidityUpdatedAt, liquidityValue)
    writeMetricHistory(liquidityHistoryKey, contextSessionDate, next)
    setLiquiditySamples({ key: liquiditySampleKey, points: next })
  }, [contextSessionDate, liquidityUpdatedAt, liquidityValue, liquidityHistoryKey, liquiditySampleKey])

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
        || quote.foreignSessionDate !== contextSessionDate
        || !quote.foreignUpdatedAt
        || vietnamDateKey(quote.foreignUpdatedAt) !== contextSessionDate
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
  }, [canonicalUniverse, stockQuotes, contextSessionDate])

  const hasFinhayForeign = Boolean(
    finhayForeign
    && contextSessionDate
    && finhayForeign.sessionDate === contextSessionDate
    && finite(finhayForeign.buy.value)
    && finite(finhayForeign.sell.value),
  )
  const top200ForeignTotals = coveredTop200ForeignTotals(foreignSnapshot)
  const foreignSeriesSource = hasFinhayForeign ? "finhay-vnindex" : "top200-partial"
  const displayedForeignBuy = hasFinhayForeign ? finhayForeign?.buy.value : top200ForeignTotals?.buy
  const displayedForeignSell = hasFinhayForeign ? finhayForeign?.sell.value : top200ForeignTotals?.sell
  const displayedForeignCoverage = hasFinhayForeign
    ? finhayForeign?.constituentCount
    : foreignSnapshot.covered
  const displayedForeignNet = hasFinhayForeign
    ? finite(finhayForeign?.net.value)
      ? finhayForeign!.net.value
      : finite(displayedForeignBuy) && finite(displayedForeignSell)
        ? displayedForeignBuy - displayedForeignSell
        : undefined
    : top200ForeignTotals?.net

  const foreignHistoryKey = metricHistoryPrefix("foreign", foreignSeriesSource)
  const foreignSampleKey = `${foreignHistoryKey}:${contextSessionDate}`
  const foreignPoints = foreignSamples.key === foreignSampleKey ? foreignSamples.points : []
  useEffect(() => {
    setForeignSamples({ key: foreignSampleKey, points: readMetricHistory<ForeignMetricPoint>(foreignHistoryKey, contextSessionDate) })
  }, [contextSessionDate, foreignHistoryKey, foreignSampleKey])
  useEffect(() => {
    if (hasFinhayForeign || foreignSnapshot.covered === 0 || !contextSessionDate || vietnamDateKey(foreignSnapshot.asOf) !== contextSessionDate) return
    const existing = readMetricHistory<ForeignMetricPoint>(foreignHistoryKey, contextSessionDate)
    const next = upsertForeignMetricPoint(existing, foreignSnapshot.asOf, foreignSnapshot.buy, foreignSnapshot.sell)
    writeMetricHistory(foreignHistoryKey, contextSessionDate, next)
    setForeignSamples({ key: foreignSampleKey, points: next })
  }, [contextSessionDate, foreignHistoryKey, foreignSampleKey, foreignSnapshot.asOf, foreignSnapshot.buy, foreignSnapshot.covered, foreignSnapshot.sell, hasFinhayForeign])
  useEffect(() => {
    if (!hasFinhayForeign || !finhayForeign || !contextSessionDate || vietnamDateKey(finhayForeign.sampledAt) !== contextSessionDate) return
    const buy = finhayForeign.buy.value
    const sell = finhayForeign.sell.value
    if (!finite(buy) || !finite(sell)) return
    const existing = readMetricHistory<ForeignMetricPoint>(foreignHistoryKey, contextSessionDate)
    const next = upsertForeignMetricPoint(existing, finhayForeign.sampledAt, buy, sell)
    writeMetricHistory(foreignHistoryKey, contextSessionDate, next)
    setForeignSamples({ key: foreignSampleKey, points: next })
  }, [contextSessionDate, finhayForeign, foreignHistoryKey, foreignSampleKey, hasFinhayForeign])

  // A new trading day must not label yesterday's retained snapshots as today's flow.
  const observedDay = observedAtMs > 0 ? vietnamDateKey(new Date(observedAtMs).toISOString()) : ""
  const isTodaySession = contextSessionDate !== "" && contextSessionDate === observedDay
  const todayLiquidityPoints = isTodaySession ? liquidityPoints : []
  const verifiedPreviousLiquidity = isTodaySession ? previousLiquidity : null
  const todayForeignNetPoints = isTodaySession ? intradayForeignNet(foreignPoints) : []
  const todayForeignBuy = isTodaySession ? displayedForeignBuy : undefined
  const todayForeignSell = isTodaySession ? displayedForeignSell : undefined
  const todayForeignNet = isTodaySession ? displayedForeignNet : undefined
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


  return (
    <div className="border-b border-white/[0.08] bg-[#0a0d0b] px-3 py-2" data-market-context-strip title={contextErrors || undefined}>
      <div className="grid min-w-0 grid-cols-1 items-stretch gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)]" data-market-context-single-row>
        <ContextCard title="VN-Index / VN30" icon={<Landmark className="h-3.5 w-3.5" />} accent="green" className="h-full xl:h-[156px]"
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
            <IndexedSummary label="VN-Index" quote={indexQuotes.VNINDEX} day={contextSessionDate} breadth={selectMarketBreadth("VNINDEX", contextSessionDate, finhayBreadth, vpsBreadth)} onOpen={onOpenIndexChart} />
            <IndexedSummary label="VN30" quote={indexQuotes.VN30} day={contextSessionDate} breadth={selectMarketBreadth("VN30", contextSessionDate, finhayBreadth, vpsBreadth)} />
          </div>
          <MarketSessionClock />
        </ContextCard>
        <ContextCard title="Thanh khoản HOSE" className="h-full xl:h-[156px]" icon={<WalletCards className="h-3.5 w-3.5" />}
          titleHint={hasFinhayLiquidity ? "Finhay VNINDEX trading_value · VND verified" : "Dữ liệu VNINDEX theo timestamp provider"}
          headerRight={<span className="font-ticker text-[12px] font-extrabold tabular-nums text-zinc-100">{formatVndValue(liquidityValue)}</span>}>
          <div className="flex justify-between gap-1 text-[10px] text-zinc-400">
            <span>KL <strong className="text-zinc-100">{formatCompactVolume(liquidityVolume)}</strong></span>
            <span className="truncate">{verifiedPreviousLiquidity ? `So với ${verifiedPreviousLiquidity.day}` : "Chưa ghi nhận phiên trước"}</span>
          </div>
          <div className="mt-auto min-w-0"><ComparisonLineChart series={[
            { label: "Nay", points: todayLiquidityPoints, color: PLATINUM },
            { label: "Trước", points: verifiedPreviousLiquidity?.points ?? [], color: "#eb6f6f", previous: true },
          ]} /></div>
          <div className="flex justify-between gap-1 text-[9px] text-zinc-500">
            <span className="truncate">{hasFinhayLiquidity ? "Finhay full HOSE" : "Index realtime"}</span>
            <span className="shrink-0">━ Hôm nay　┄ Phiên trước</span>
          </div>
        </ContextCard>
        <ContextCard title="Mua bán nước ngoài" className="h-full xl:h-[156px]" icon={<Globe2 className="h-3.5 w-3.5" />} accent="purple"
          titleHint={hasFinhayForeign ? "Finhay full HOSE" : finhayForeignState === "UNAVAILABLE" ? "DNSE Top 200 partial" : "Finhay / DNSE Top 200 partial"}
          headerRight={<span className={`text-[11px] font-bold tabular-nums ${finite(todayForeignNet) && todayForeignNet > 0 ? "text-emerald-300" : finite(todayForeignNet) && todayForeignNet < 0 ? "text-red-300" : "text-zinc-300"}`}>{formatSignedVndValue(todayForeignNet)}</span>}>
          <div className="flex justify-between gap-1 text-[10px] tabular-nums">
            <span className="truncate text-emerald-300">Mua {formatVndValue(todayForeignBuy)}</span>
            <span className="truncate text-red-300">Bán {formatVndValue(todayForeignSell)}</span>
          </div>
          <div className="mt-auto min-w-0"><ComparisonLineChart zeroReference series={[
            { label: "Ròng", points: todayForeignNetPoints, color: finite(todayForeignNet) && todayForeignNet < 0 ? RED : GREEN },
          ]} /></div>
          <div className="flex justify-between gap-1 text-[9px] text-zinc-500">
            <span className="truncate">{hasFinhayForeign ? `Finhay full HOSE · ${displayedForeignCoverage ?? "—"} mã` : `Top 200 partial · ${foreignSnapshot.covered}/${canonicalUniverse.length}`}</span>
            <span className="shrink-0">━ Ròng hôm nay</span>
          </div>
        </ContextCard>
        <ContextCard title="Tác động VNINDEX" icon={<Scale className="h-4 w-4" />} accent="green" className="h-full xl:h-[156px]"
          headerRight={impact && (impact.positive.length || impact.negative.length) ? <span className="text-[10px] font-bold tabular-nums text-zinc-300">Top 5 ± · {impact.displayedNetTotal > 0 ? "+" : ""}{impact.displayedNetTotal.toFixed(2)}đ</span> : null}>
          {impact && (impact.positive.length > 0 || impact.negative.length > 0) ? (
            <ImpactChart impact={impact} live={impactLive} sessionOpen={sessionOpen} />
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
