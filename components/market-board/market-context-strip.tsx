"use client"

import { useEffect, useId, useMemo, useState, type ReactNode } from "react"
import { Activity, BarChart3, Globe2, Landmark, Scale, WalletCards } from "lucide-react"

import type {
  MarketBoardContextBootstrap,
  MarketContextIndexSeries,
  MarketImpactEntry,
  MarketImpactSnapshot,
} from "@/modules/market/board/market-context-contract"
import { buildMarketDepthSnapshot, MARKET_DEPTH_BUCKETS, type MarketDepthSnapshot } from "@/modules/market/board/market-depth"

type MarketContextIndexQuote = {
  symbol: string
  value: number
  change?: number
  changePercent: number
  volume?: number
  valueTraded?: number
  advances?: number
  declines?: number
  unchanged?: number
  updatedAt: string
}

type MarketContextStockQuote = {
  symbol: string
  price?: number
  changePercent?: number
  foreignBuyValue?: number
  foreignSellValue?: number
  updatedAt: string
}

type MarketContextUniverseStock = {
  ticker: string
  exchange?: string | null
}

type MarketContextStripProps = {
  indexQuotes: Record<string, MarketContextIndexQuote | undefined>
  stockQuotes: Record<string, MarketContextStockQuote | undefined>
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

type FinhayMarketContextResponse = {
  ok?: boolean
  state?: string
  provider?: string
  sampledAt?: string
  foreign?: FinhayForeignSnapshot
  liquidity?: FinhayLiquiditySnapshot
}


const MAX_LIVE_POINTS = 120
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

function appendLiveIndexValue(series: MarketContextIndexSeries | undefined, quote: MarketContextIndexQuote | undefined) {
  const values = series?.points.map((point) => point.value) ?? []
  if (!values.length || !series || !quote || !finite(quote.value) || quote.value <= 0) return values
  if (vietnamDateKey(quote.updatedAt) !== series.sessionDate) return values
  if (Math.abs(values.at(-1)! - quote.value) < 1e-6) return values
  return [...values, quote.value]
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

function indexReference(quote?: MarketContextIndexQuote) {
  if (!quote || !finite(quote.value) || quote.value <= 0) return undefined
  if (finite(quote.change)) {
    const reference = quote.value - quote.change
    if (reference > 0) return reference
  }
  if (finite(quote.changePercent) && Math.abs(100 + quote.changePercent) > 1e-6) {
    const reference = quote.value / (1 + quote.changePercent / 100)
    if (reference > 0 && Number.isFinite(reference)) return reference
  }
  return undefined
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

function ContextLineChart({
  values,
  color,
  reference,
  splitAtReference = false,
}: {
  values: number[]
  color: string
  reference?: number
  splitAtReference?: boolean
}) {
  const reactId = useId()
  const uid = reactId.replace(/:/g, "")
  const width = 320
  const height = 58
  const valid = values.filter((value) => Number.isFinite(value) && value >= 0)
  if (valid.length < 2) return null

  const maxPoints = 90
  const step = Math.max(1, Math.ceil(valid.length / maxPoints))
  const points = valid.length <= maxPoints
    ? valid
    : valid.filter((_, index) => index % step === 0 || index === valid.length - 1)
  const hasReference = finite(reference) && reference > 0
  const domainValues = hasReference ? [...points, reference] : points
  const rawMin = Math.min(...domainValues)
  const rawMax = Math.max(...domainValues)
  const rawRange = rawMax - rawMin
  const domainPadding = rawRange > 0 ? rawRange * 0.12 : Math.max(Math.abs(rawMax) * 0.003, 1)
  const min = rawMin - domainPadding
  const max = rawMax + domainPadding
  const range = max - min || 1
  const pad = 2
  const x = (index: number) => pad + (index / Math.max(1, points.length - 1)) * (width - pad * 2)
  const y = (value: number) => height - pad - ((value - min) / range) * (height - pad * 2)
  const coords = points.map((value, index) => [x(index), y(value)] as const)
  let path = `M ${coords[0][0].toFixed(1)},${coords[0][1].toFixed(1)}`
  for (let index = 0; index < coords.length - 1; index += 1) {
    const [x0, y0] = coords[index]
    const [x1, y1] = coords[index + 1]
    const midX = (x0 + x1) / 2
    path += ` C ${midX.toFixed(1)},${y0.toFixed(1)} ${midX.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`
  }
  const last = coords.at(-1)!
  const referenceValue = hasReference ? reference : undefined
  const referenceY = referenceValue !== undefined ? Math.max(pad, Math.min(height - pad, y(referenceValue))) : null
  const splitReferenceY = referenceY ?? 0
  const shouldSplit = splitAtReference && referenceValue !== undefined && referenceY !== null
  const lastValue = points.at(-1)!

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full" aria-hidden="true" shapeRendering="optimizeSpeed">
      <defs>
        <linearGradient id={`context-fill-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.24" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
        {shouldSplit ? (
          <>
            <clipPath id={`context-above-${uid}`}><rect x="0" y="0" width={width} height={splitReferenceY} /></clipPath>
            <clipPath id={`context-below-${uid}`}><rect x="0" y={splitReferenceY} width={width} height={Math.max(0, height - splitReferenceY)} /></clipPath>
          </>
        ) : null}
      </defs>
      <path
        d={`${path} L ${last[0].toFixed(1)},${height} L ${coords[0][0].toFixed(1)},${height} Z`}
        fill={`url(#context-fill-${uid})`}
        stroke="none"
      />
      {shouldSplit ? (
        <>
          <path d={path} fill="none" stroke={GREEN} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" clipPath={`url(#context-above-${uid})`} />
          <path d={path} fill="none" stroke={RED} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" clipPath={`url(#context-below-${uid})`} />
        </>
      ) : (
        <path d={path} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      )}
      {referenceY !== null ? (
        <line x1="0" x2={width} y1={referenceY} y2={referenceY} stroke="rgba(226,232,240,0.48)" strokeWidth="1" strokeDasharray="3 3" />
      ) : null}
      <circle cx={last[0]} cy={last[1]} r="2.2" fill={shouldSplit && referenceValue !== undefined && lastValue < referenceValue ? RED : shouldSplit && referenceValue !== undefined && lastValue > referenceValue ? GREEN : color} />
    </svg>
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
  titleValue,
}: {
  title: string
  icon: ReactNode
  accent?: "green" | "purple" | "platinum"
  children: ReactNode
  className?: string
  titleHint?: string
  headerRight?: ReactNode
  titleValue?: ReactNode
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
        {titleValue ? <span className="min-w-0 truncate">{titleValue}</span> : null}
        {headerRight ? <span className="ml-auto shrink-0 text-right">{headerRight}</span> : null}
      </header>
      <div className="flex min-h-0 flex-1 flex-col px-3 pb-2 pt-1.5">
        {children}
      </div>
    </section>
  )
}

function IndexContextCard({
  label,
  quote,
  series,
  onOpen,
}: {
  label: string
  quote?: MarketContextIndexQuote
  series?: MarketContextIndexSeries
  onOpen?: () => void
}) {
  const color = marketColor(quote?.changePercent)
  const data = appendLiveIndexValue(series, quote)
  const hasHistory = Boolean(series?.points.length)
  const reference = indexReference(quote)
  const indexValue = quote && finite(quote.value)
    ? quote.value
    : series?.points.at(-1)?.value
  const change = quote?.change
  const headerRight = (
    <span className="flex items-center justify-end gap-1.5 font-ticker tabular-nums" style={{ color }}>
      {finite(change) ? <span className="hidden text-[11px] sm:inline">{change > 0 ? "+" : ""}{INDEX_FORMATTER.format(change)}</span> : null}
      <span className="text-[12px] font-extrabold">{formatChange(quote?.changePercent)}</span>
    </span>
  )

  const body = (
    <>
      <div className="mt-auto h-[69px] w-full overflow-hidden">
        {hasHistory ? (
          <ContextLineChart values={data} color={color} reference={reference} splitAtReference />
        ) : (
          <div className="flex h-full items-center justify-center text-[10px] text-zinc-500">Chưa có dữ liệu 1m</div>
        )}
      </div>
    </>
  )

  return (
    <ContextCard
      title={label}
      icon={<Landmark className="h-3.5 w-3.5" />}
      accent={label === "VNINDEX" ? "green" : "platinum"}
      titleHint={series?.source ?? "Chưa xác minh được lịch sử 1m"}
      headerRight={headerRight}
      titleValue={<span className="font-ticker text-[14px] font-extrabold tabular-nums" style={{ color }}>{finite(indexValue) ? INDEX_FORMATTER.format(indexValue) : "—"}</span>}
    >
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="flex w-full flex-1 flex-col text-left focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand"
          aria-label="Mở biểu đồ VN-INDEX"
        >
          {body}
        </button>
      ) : body}
    </ContextCard>
  )
}
function DualLineChart({ points }: { points: ForeignMetricPoint[] }) {
  const width = 320
  const height = 58
  if (points.length < 2) {
    return <div className="flex h-[58px] items-center justify-center text-[9px] leading-tight text-zinc-600">Đang tích lũy realtime từ lúc mở bảng</div>
  }

  const values = points.flatMap((point) => [point.buy, point.sell]).filter((value) => Number.isFinite(value))
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || Math.max(max * 0.01, 1)
  const y = (value: number) => height - 3 - ((value - min) / range) * (height - 6)
  const x = (index: number) => 2 + (index / Math.max(1, points.length - 1)) * (width - 4)
  const buyPoints = points.map((point, index) => `${x(index).toFixed(1)},${y(point.buy).toFixed(1)}`).join(" ")
  const sellPoints = points.map((point, index) => `${x(index).toFixed(1)},${y(point.sell).toFixed(1)}`).join(" ")

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-[58px] w-full" aria-hidden="true" shapeRendering="optimizeSpeed">
      <polyline points={buyPoints} fill="none" stroke={GREEN} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={sellPoints} fill="none" stroke={RED} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ImpactChart({ impact }: { impact: MarketImpactSnapshot }) {
  const entries = [...impact.positive, ...impact.negative]
  const maxUp = Math.max(0.2, ...impact.positive.map((entry) => entry.contribution)) * 1.2
  const maxDown = Math.max(0.2, ...impact.negative.map((entry) => -entry.contribution)) * 1.2
  const plotTop = 26
  const plotHeight = 166
  const plotBottom = plotTop + plotHeight
  const zeroY = plotTop + plotHeight * (maxUp / (maxUp + maxDown))
  const left = 10
  const plotWidth = 850
  const step = plotWidth / Math.max(1, entries.length)
  const barWidth = Math.min(34, step * 0.66)
  const positiveTotal = Math.max(0, impact.displayedPositiveTotal)
  const negativeTotal = Math.max(0, -impact.displayedNegativeTotal)
  const sumAbs = positiveTotal + negativeTotal

  const valueY = (value: number) => plotTop + (maxUp - value) / (maxUp + maxDown) * plotHeight
  return (
    <div className="min-w-0">
      <div className="overflow-x-auto [scrollbar-color:#34414b_#111511] [scrollbar-width:thin]">
        <svg
          viewBox="0 0 870 224"
          className="min-w-[620px] w-full"
          role="img"
          aria-label="Tác động VNINDEX: cột xanh trên trục 0 là mã kéo tăng, cột đỏ dưới trục 0 là mã kéo giảm; mỗi cột là số điểm basketInfluence thực tế"
        >
          <title>Tác động VNINDEX theo từng cổ phiếu (điểm)</title>
          {entries.map((entry, index) => (
            <rect
              key={`stripe-${entry.symbol}`}
              x={left + index * step}
              y={plotTop}
              width={step}
              height={plotHeight}
              fill={index % 2 === 0 ? "#ffffff" : "#94a3b8"}
              fillOpacity={index % 2 === 0 ? 0.017 : 0.035}
            />
          ))}
          {[-maxDown, -maxDown / 2, 0, maxUp / 2, maxUp].map((tick, index) => {
            const y = valueY(tick)
            return (
              <line
                key={index}
                x1={left}
                y1={y}
                x2={left + plotWidth}
                y2={y}
                stroke={tick === 0 ? "#9ca3af" : "#6b7280"}
                strokeOpacity={tick === 0 ? 0.8 : 0.3}
                strokeWidth={tick === 0 ? 1.4 : 1}
              />
            )
          })}
          {entries.map((entry, index) => {
            const value = entry.contribution
            const endY = valueY(value)
            const x = left + index * step + (step - barWidth) / 2
            const positive = value > 0
            const top = positive ? endY : zeroY
            const height = Math.max(1, Math.abs(endY - zeroY))
            const numberY = positive ? Math.max(plotTop - 4, top - 7) : zeroY - 6
            return (
              <g key={entry.symbol}>
                <title>{`${entry.symbol}: ${value > 0 ? "+" : ""}${value.toFixed(2)} điểm`}</title>
                <rect
                  x={x}
                  y={top}
                  width={barWidth}
                  height={height}
                  rx={2}
                  fill={positive ? "#28b6a6" : "#ef4e53"}
                />
                <text
                  x={x + barWidth / 2}
                  y={numberY}
                  fontSize={13}
                  fontWeight={800}
                  textAnchor="middle"
                  fill="#e5e7eb"
                  paintOrder="stroke"
                  stroke="#111511"
                  strokeWidth={3}
                >
                  {value > 0 ? "+" : ""}{value.toFixed(2)}
                </text>
                <text x={x + barWidth / 2} y={plotBottom + 17} fontSize={13} fontWeight={700} textAnchor="middle" fill="#bac1c8">
                  {entry.symbol}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
      <div className="mt-1 flex h-9 overflow-hidden rounded-lg font-ticker text-[14px] font-extrabold tabular-nums text-white" aria-label="Tổng điểm kéo tăng và kéo giảm của các mã hiển thị">
        <div className="flex items-center justify-center bg-[#269f91]" style={{ width: `${sumAbs > 0 ? 100 * positiveTotal / sumAbs : 50}%` }}>
          +{positiveTotal.toFixed(2)}
        </div>
        <div className="flex items-center justify-center bg-[#ed5056]" style={{ width: `${sumAbs > 0 ? 100 * negativeTotal / sumAbs : 50}%` }}>
          −{negativeTotal.toFixed(2)}
        </div>
      </div>
      <p className="mt-1 text-right font-ticker text-[10px] text-zinc-500">
        Top {impact.positive.length} kéo tăng / {impact.negative.length} kéo giảm · DNSE basketInfluence · {formatAsOf(impact.asOf)}
      </p>
    </div>
  )
}

function MarketDepthCard({
  snapshot,
  sessionDate,
}: {
  snapshot: MarketDepthSnapshot
  sessionDate: string
}) {
  const maxCount = Math.max(1, ...snapshot.bins)
  const totalKnown = snapshot.advancers + snapshot.decliners + snapshot.unchanged
  const canShow = Boolean(sessionDate && snapshot.total > 0 && snapshot.covered > 0)

  return (
    <ContextCard
      title="Độ sâu thị trường"
      icon={<BarChart3 className="h-4 w-4" />}
      accent="green"
      className="h-full"
      headerRight={<span className="font-ticker text-right text-zinc-400"><span className="block text-[9px] uppercase tracking-wider">Mã HOSE trong Top 200</span><strong className="text-[20px] font-black tabular-nums text-white">{snapshot.total}</strong></span>}
      titleHint="Phân bố realtime theo % thay đổi của các mã HOSE trong Top 200. Không phải toàn bộ HOSE."
    >
      <p className="mb-2 text-[10px] text-zinc-400">Phân bố biến động · HOSE trong Top 200</p>
      {canShow ? (
        <>
          <div className="mt-auto grid h-[198px] grid-cols-11 items-end gap-[3px] border-b border-white/10 pb-1" role="img" aria-label="Phân bố cổ phiếu HOSE theo nhóm phần trăm biến động">
            {MARKET_DEPTH_BUCKETS.map((bucket, index) => {
              const count = snapshot.bins[index]
              const tone = bucket.tone === "down"
                ? "bg-[#ef5059] text-[#ff6670]"
                : bucket.tone === "up"
                  ? "bg-[#26b965] text-[#3fd881]"
                  : "bg-[#dec452] text-[#ead668]"
              return (
                <div key={bucket.label} className="flex h-full min-w-0 flex-col items-center justify-end">
                  <span className={`mb-1 font-ticker text-[11px] font-extrabold tabular-nums ${tone.split(" ")[1]}`}>{count}</span>
                  <div
                    className={`w-full rounded-t-[9px] ${tone.split(" ")[0]}`}
                    style={{ height: `${count === 0 ? 2 : Math.max(5, 150 * count / maxCount)}px`, opacity: count === 0 ? 0.2 : 1 }}
                  />
                </div>
              )
            })}
          </div>
          <div className="mt-1 grid grid-cols-11 gap-[3px]">
            {MARKET_DEPTH_BUCKETS.map((bucket) => (
              <span key={bucket.label} className="whitespace-nowrap text-center font-ticker text-[8px] text-zinc-400 sm:text-[9px]">{bucket.label}</span>
            ))}
          </div>
          <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-zinc-700/60">
            <span className="bg-[#ef5059]" style={{ width: `${100 * snapshot.decliners / Math.max(1, snapshot.total)}%` }} />
            <span className="bg-[#dec452]" style={{ width: `${100 * snapshot.unchanged / Math.max(1, snapshot.total)}%` }} />
            <span className="bg-[#26b965]" style={{ width: `${100 * snapshot.advancers / Math.max(1, snapshot.total)}%` }} />
          </div>
          <div className="mt-2 flex justify-between gap-1 font-ticker text-[11px] font-extrabold tabular-nums">
            <span className="text-red-400">Giảm {snapshot.decliners}</span>
            <span className="text-amber-300">Đứng giá {snapshot.unchanged}</span>
            <span className="text-green-400">Tăng {snapshot.advancers}</span>
          </div>
          <p className="mt-3 border-t border-white/10 pt-2 text-[10px] text-zinc-400">
            HOSE · Top 200 partial · Có giá {totalKnown}/{snapshot.total} · Thiếu {snapshot.missing} · {formatAsOf(snapshot.asOf)}
          </p>
        </>
      ) : (
        <div className="flex min-h-[195px] flex-1 items-center justify-center text-center text-[11px] text-zinc-400">
          Chưa có đủ báo giá cùng phiên để tính độ sâu thị trường
        </div>
      )}
    </ContextCard>
  )
}

export function MarketContextStrip({
  indexQuotes,
  stockQuotes,
  canonicalUniverse,
  onOpenIndexChart,
}: MarketContextStripProps) {
  const [bootstrap, setBootstrap] = useState<MarketContextApiResponse | null>(null)
  const [loadError, setLoadError] = useState("")
  const [finhayForeign, setFinhayForeign] = useState<(FinhayForeignSnapshot & { sampledAt: string }) | null>(null)
  const [finhayLiquidity, setFinhayLiquidity] = useState<FinhayLiquiditySnapshot | null>(null)
  const [finhayForeignState, setFinhayForeignState] = useState<"UNKNOWN" | "AVAILABLE" | "UNAVAILABLE">("UNKNOWN")
  const [liquidityPoints, setLiquidityPoints] = useState<MetricPoint[]>([])
  const [foreignPoints, setForeignPoints] = useState<ForeignMetricPoint[]>([])

  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setInterval> | null = null

    const load = async () => {
      try {
        const response = await fetch("/api/market/board-context", {
          cache: "no-store",
          credentials: "same-origin",
        })
        const data = await response.json() as MarketContextApiResponse
        if (disposed) return
        setBootstrap(data)
        setLoadError(response.ok || data.ok ? "" : data.errors?.join("; ") || "Market context unavailable")
      } catch (error) {
        if (!disposed) setLoadError(error instanceof Error ? error.message : "Market context unavailable")
      }
    }

    void load()
    timer = setInterval(() => void load(), 30_000)
    return () => {
      disposed = true
      if (timer) clearInterval(timer)
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

  const contextSessionDate = bootstrap?.indexes.VNINDEX?.sessionDate ?? ""
  const vnindexQuote = indexQuotes.VNINDEX
  const fallbackLiquidityValue = vnindexQuote?.valueTraded
  const fallbackLiquidityUpdatedAt = vnindexQuote?.updatedAt ?? ""
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
    : contextSessionDate && vietnamDateKey(vnindexQuote?.updatedAt ?? "") === contextSessionDate
      ? vnindexQuote?.volume
      : undefined
  const liquidityUpdatedAt = hasFinhayLiquidity ? finhayLiquidity?.sourceUpdatedAt ?? "" : fallbackLiquidityUpdatedAt

  useEffect(() => {
    setLiquidityPoints([])
  }, [contextSessionDate, liquiditySeriesSource])

  useEffect(() => {
    if (!contextSessionDate || vietnamDateKey(liquidityUpdatedAt) !== contextSessionDate) return
    if (!finite(liquidityValue) || liquidityValue < 0) return
    setLiquidityPoints((current) => upsertMetricPoint(current, liquidityUpdatedAt, liquidityValue))
  }, [contextSessionDate, liquidityUpdatedAt, liquidityValue])

  const foreignSnapshot = useMemo(() => {
    let buy = 0
    let sell = 0
    let covered = 0
    let asOf = ""

    for (const stock of canonicalUniverse) {
      const quote = stockQuotes[stock.ticker]
      if (!quote || !finite(quote.foreignBuyValue) || !finite(quote.foreignSellValue)) continue
      buy += quote.foreignBuyValue
      sell += quote.foreignSellValue
      covered += 1
      if (quote.updatedAt > asOf) asOf = quote.updatedAt
    }

    return { buy, sell, covered, asOf }
  }, [canonicalUniverse, stockQuotes])

  const hasFinhayForeign = Boolean(
    finhayForeign
    && contextSessionDate
    && finhayForeign.sessionDate === contextSessionDate
    && finite(finhayForeign.buy.value)
    && finite(finhayForeign.sell.value),
  )
  const foreignSeriesSource = hasFinhayForeign ? "finhay-vnindex" : "top200-partial"
  const displayedForeignBuy = hasFinhayForeign ? finhayForeign?.buy.value : foreignSnapshot.buy
  const displayedForeignSell = hasFinhayForeign ? finhayForeign?.sell.value : foreignSnapshot.sell
  const displayedForeignCoverage = hasFinhayForeign
    ? finhayForeign?.constituentCount
    : foreignSnapshot.covered
  const displayedForeignAsOf = hasFinhayForeign
    ? finhayForeign?.sourceUpdatedAt
    : foreignSnapshot.asOf

  const displayedForeignNet = hasFinhayForeign && finite(finhayForeign?.net.value)
    ? finhayForeign!.net.value
    : finite(displayedForeignBuy) && finite(displayedForeignSell)
      ? displayedForeignBuy - displayedForeignSell
      : undefined

  useEffect(() => {
    setForeignPoints([])
  }, [contextSessionDate, foreignSeriesSource])

  useEffect(() => {
    if (hasFinhayForeign) return
    if (foreignSnapshot.covered === 0 || !foreignSnapshot.asOf || !contextSessionDate) return
    if (vietnamDateKey(foreignSnapshot.asOf) !== contextSessionDate) return
    setForeignPoints((current) => upsertForeignMetricPoint(
      current,
      foreignSnapshot.asOf,
      foreignSnapshot.buy,
      foreignSnapshot.sell,
    ))
  }, [contextSessionDate, foreignSnapshot.asOf, foreignSnapshot.buy, foreignSnapshot.covered, foreignSnapshot.sell, hasFinhayForeign])

  useEffect(() => {
    if (!hasFinhayForeign || !finhayForeign || !contextSessionDate) return
    if (vietnamDateKey(finhayForeign.sampledAt) !== contextSessionDate) return
    const buy = finhayForeign.buy.value
    const sell = finhayForeign.sell.value
    if (!finite(buy) || !finite(sell)) return
    setForeignPoints((current) => upsertForeignMetricPoint(current, finhayForeign.sampledAt, buy, sell))
  }, [contextSessionDate, finhayForeign, hasFinhayForeign])

  const liquidityData = liquidityPoints.map((point) => point.value)
  const contextErrors = bootstrap?.errors?.join("; ") || loadError
  const impact = bootstrap?.impact

  return (
    <div className="space-y-2 border-b border-white/[0.08] bg-[#0a0d0b] px-3 py-2" data-market-context-strip title={contextErrors || undefined}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4" data-market-context-index-row>
        <IndexContextCard
          label="VNINDEX"
          quote={indexQuotes.VNINDEX}
          series={bootstrap?.indexes.VNINDEX}
          onOpen={onOpenIndexChart}
        />

        <ContextCard
          title="Thanh khoản HOSE"
          icon={<WalletCards className="h-3.5 w-3.5" />}
          titleHint={hasFinhayLiquidity
            ? "Finhay VNINDEX trading_value · VND verified. Không có history GTGD phiên trước theo phút."
            : "Index realtime fallback. Chưa có history GTGD phiên trước theo phút."}
          headerRight={<span className="font-ticker text-[13px] font-extrabold tabular-nums text-zinc-100">{formatVndValue(liquidityValue)}</span>}
        >
          <div className="flex items-center justify-between gap-2 font-ticker text-[11px] text-zinc-400">
            <span>KL <strong className="font-extrabold tabular-nums text-zinc-100">{formatCompactVolume(liquidityVolume)}</strong></span>
            <span>vs phiên trước: <strong className="text-zinc-400">—</strong></span>
          </div>
          <div className="mt-auto h-[45px] w-full overflow-hidden">
            {liquidityData.length >= 2 ? (
              <ContextLineChart values={liquidityData} color={PLATINUM} />
            ) : (
              <div className="flex h-full items-center justify-center text-[10px] text-zinc-500">Đang tích lũy realtime</div>
            )}
          </div>
          <div className="mt-0.5 truncate text-[9px] text-zinc-500">
            {hasFinhayLiquidity ? "Finhay HOSE" : "Index realtime"} · history phiên trước chưa verified
          </div>
        </ContextCard>

        <IndexContextCard label="VN30" quote={indexQuotes.VN30} series={bootstrap?.indexes.VN30} />

        <ContextCard
          title="Mua bán nước ngoài"
          icon={<Globe2 className="h-3.5 w-3.5" />}
          accent="purple"
          titleHint={hasFinhayForeign
            ? "Finhay full VNINDEX/HOSE foreign buy/sell, sampled during current session."
            : finhayForeignState === "UNAVAILABLE"
              ? "Finhay unavailable. Canonical Top 200 partial fallback."
              : "Waiting for Finhay; Top 200 partial fallback."}
          headerRight={<span className={`font-ticker text-[12px] font-extrabold tabular-nums ${finite(displayedForeignNet) && displayedForeignNet > 0 ? "text-emerald-300" : finite(displayedForeignNet) && displayedForeignNet < 0 ? "text-red-300" : "text-zinc-300"}`}>{formatSignedVndValue(displayedForeignNet)}</span>}
        >
          <div className="flex items-center justify-between gap-2 font-ticker text-[10px] tabular-nums">
            <span className="min-w-0 truncate text-emerald-300">Mua {formatVndValue((hasFinhayForeign || foreignSnapshot.covered > 0) ? displayedForeignBuy : undefined)}</span>
            <span className="min-w-0 truncate text-right text-red-300">Bán {formatVndValue((hasFinhayForeign || foreignSnapshot.covered > 0) ? displayedForeignSell : undefined)}</span>
          </div>
          <div className="mt-auto overflow-hidden rounded-lg"><DualLineChart points={foreignPoints} /></div>
          <div className="mt-0.5 flex items-center justify-between gap-1 text-[9px] text-zinc-500">
            <span className="truncate">{hasFinhayForeign
              ? `Finhay full HOSE · ${displayedForeignCoverage ?? "—"} mã`
              : `Top 200 partial · ${foreignSnapshot.covered}/${canonicalUniverse.length} mã`}</span>
            <span className="shrink-0">{hasFinhayForeign ? finhayForeign?.sessionDate : formatAsOf(displayedForeignAsOf)}</span>
          </div>
        </ContextCard>
      </div>

      <div data-market-context-impact-row>
        <ContextCard
          title="Tác động VNINDEX"
          icon={<Scale className="h-4 w-4" />}
          accent="green"
          titleHint={impact?.source}
          headerRight={impact && (impact.negative.length > 0 || impact.positive.length > 0)
            ? <span className="font-ticker text-[11px] text-zinc-400">Tổng các mã hiển thị: <strong className={`text-[15px] font-extrabold tabular-nums ${impact.displayedNetTotal >= 0 ? "text-emerald-300" : "text-red-300"}`}>{impact.displayedNetTotal > 0 ? "+" : ""}{impact.displayedNetTotal.toFixed(2)} điểm</strong></span>
            : null}
        >
          {impact && (impact.positive.length > 0 || impact.negative.length > 0) ? (
            <>
              <ImpactChart impact={impact} />
              <div className="mt-2 text-right font-ticker text-[9px] text-zinc-500">{formatAsOf(impact.asOf)} · DNSE basketInfluence · Top mã hiển thị</div>
            </>
          ) : (
            <div className="flex min-h-[66px] items-center justify-center gap-2 text-[11px] text-zinc-500">
              <Activity className="h-4 w-4" /> Chưa có provider contribution snapshot
            </div>
          )}
        </ContextCard>
      </div>
    </div>
  )
}
