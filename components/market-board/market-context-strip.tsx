"use client"

import { useEffect, useId, useMemo, useState, type ReactNode } from "react"
import { Activity, Globe2, Landmark, Scale, WalletCards } from "lucide-react"

import type {
  MarketBoardContextBootstrap,
  MarketContextIndexSeries,
  MarketImpactEntry,
  MarketImpactSnapshot,
} from "@/modules/market/board/market-context-contract"

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
  foreignBuyValue?: number
  foreignSellValue?: number
  updatedAt: string
}

type MarketContextUniverseStock = {
  ticker: string
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
}: {
  title: string
  icon: ReactNode
  accent?: "green" | "purple" | "platinum"
  children: ReactNode
  className?: string
  titleHint?: string
}) {
  const accentClass = accent === "green"
    ? "border-emerald-400/25"
    : accent === "purple"
      ? "border-purple-400/30"
      : "border-zinc-300/15"

  return (
    <section
      className={`min-h-[142px] min-w-0 rounded-2xl border bg-[#0b0f14] px-3 py-2.5 ${accentClass} ${className}`}
      title={titleHint}
      data-market-context-card
    >
      <header className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-400">
        <span className="text-zinc-300">{icon}</span>
        <span>{title}</span>
      </header>
      {children}
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
  const hasBreadth = finite(quote?.advances) || finite(quote?.declines) || finite(quote?.unchanged)

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[19px] font-bold leading-none text-zinc-100">
            {quote && finite(quote.value) ? INDEX_FORMATTER.format(quote.value) : series?.points.at(-1) ? INDEX_FORMATTER.format(series.points.at(-1)!.value) : "—"}
          </div>
          <div className="mt-1 font-mono text-[11px] font-semibold" style={{ color }}>
            {formatChange(quote?.changePercent)}
          </div>
        </div>
        <div className="text-right font-mono text-[9px] leading-relaxed text-zinc-500">
          <div>KL <span className="font-semibold text-zinc-300">{formatCompactVolume(quote?.volume)}</span></div>
          <div>GT <span className="font-semibold text-zinc-300">{formatVndValue(quote?.valueTraded)}</span></div>
        </div>
      </div>

      {hasBreadth ? (
        <div className="mt-1 flex items-center gap-2 font-mono text-[9px] font-semibold">
          <span className="text-emerald-300">▲ {finite(quote?.advances) ? quote!.advances : "—"}</span>
          <span className="text-amber-300">■ {finite(quote?.unchanged) ? quote!.unchanged : "—"}</span>
          <span className="text-red-300">▼ {finite(quote?.declines) ? quote!.declines : "—"}</span>
        </div>
      ) : null}

      <div className="mt-1.5 h-[58px] w-full overflow-hidden rounded-lg">
        {hasHistory ? (
          <ContextLineChart values={data} color={color} reference={reference} splitAtReference />
        ) : (
          <div className="flex h-full items-center justify-center text-[9px] text-zinc-600">Chưa có lịch sử 1m</div>
        )}
      </div>
      <div className="mt-1 truncate text-[8px] text-zinc-600">
        {series ? `1m · ${series.sessionDate} · ${formatAsOf(quote?.updatedAt ?? series.asOf)}` : "Index history unavailable"}
      </div>
    </>
  )

  return (
    <ContextCard
      title={label}
      icon={<Landmark className="h-3.5 w-3.5" />}
      accent={label === "VNINDEX" ? "green" : "purple"}
      className="xl:col-span-2"
      titleHint={series?.source}
    >
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="w-full rounded-lg text-left focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand"
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

function ImpactSide({ entry, maxAbs, positive }: { entry?: MarketImpactEntry; maxAbs: number; positive: boolean }) {
  if (!entry) return <div className="h-3.5" />
  const width = maxAbs > 0 ? Math.max(3, Math.min(100, (Math.abs(entry.contribution) / maxAbs) * 100)) : 0
  return (
    <div className={`grid grid-cols-[34px_minmax(0,1fr)_45px] items-center gap-1 text-[8px] ${positive ? "" : "text-right"}`}>
      <span className={`font-mono font-bold ${positive ? "text-emerald-300" : "text-red-300"}`}>{entry.symbol}</span>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-white/[0.04]">
        <span
          className={`h-full rounded-full ${positive ? "bg-emerald-400/80" : "ml-auto bg-red-400/80"}`}
          style={{ width: `${width}%` }}
        />
      </div>
      <span className="font-mono tabular-nums text-zinc-400">
        {entry.contribution > 0 ? "+" : ""}{entry.contribution.toFixed(2)}
      </span>
    </div>
  )
}

function ImpactChart({ impact }: { impact: MarketImpactSnapshot }) {
  const pairs = Array.from({ length: 8 }, (_, index) => ({
    negative: impact.negative[index],
    positive: impact.positive[index],
  }))
  const maxAbs = Math.max(
    0,
    ...impact.negative.map((entry) => Math.abs(entry.contribution)),
    ...impact.positive.map((entry) => Math.abs(entry.contribution)),
  )

  return (
    <>
      <div className="mb-1 grid grid-cols-2 gap-3 text-[8px] font-semibold uppercase tracking-wide text-zinc-600">
        <span>Giảm điểm</span><span>Tăng điểm</span>
      </div>
      <div className="space-y-[1px]">
        {pairs.map((pair, index) => (
          <div key={index} className="grid grid-cols-2 gap-3">
            <ImpactSide entry={pair.negative} maxAbs={maxAbs} positive={false} />
            <ImpactSide entry={pair.positive} maxAbs={maxAbs} positive />
          </div>
        ))}
      </div>
    </>
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
    <div
      className="grid shrink-0 grid-cols-1 gap-2 border-b border-white/[0.08] bg-[#06080a] px-2 py-2 md:grid-cols-2 xl:grid-cols-12"
      data-market-context-strip
      title={contextErrors || undefined}
    >
      <IndexContextCard
        label="VNINDEX"
        quote={indexQuotes.VNINDEX}
        series={bootstrap?.indexes.VNINDEX}
        onOpen={onOpenIndexChart}
      />

      <ContextCard
        title="Thanh khoản HOSE"
        icon={<WalletCards className="h-3.5 w-3.5" />}
        accent="platinum"
        className="xl:col-span-2"
        titleHint={hasFinhayLiquidity
          ? "Finhay VNINDEX trading_value: GTGD HOSE 1D, đơn vị VND đã xác minh. Chưa có aligned intraday history của phiên trước."
          : "Index realtime fallback. Chưa có aligned intraday GTGD history của phiên trước."}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-mono text-[18px] font-bold leading-none text-zinc-100">{formatVndValue(liquidityValue)}</div>
            <div className="mt-1 text-[9px] font-medium text-zinc-500">vs phiên trước: <span className="text-zinc-400">—</span></div>
          </div>
          <div className="text-right text-[8px] leading-relaxed text-zinc-600">
            <div>{hasFinhayLiquidity ? "Finhay full HOSE" : "Index realtime fallback"}</div>
            <div>{contextSessionDate || "—"}</div>
          </div>
        </div>
        <div className="mt-2 h-[58px] w-full overflow-hidden rounded-lg">
          {liquidityData.length >= 2 ? (
            <ContextLineChart values={liquidityData} color={PLATINUM} />
          ) : (
            <div className="flex h-full items-center justify-center text-[9px] text-zinc-600">Đang tích lũy realtime từ lúc mở bảng</div>
          )}
        </div>
        <div className="mt-1 text-[8px] leading-tight text-zinc-600">
          VND verified · history phiên trước chưa verified
        </div>
      </ContextCard>

      <IndexContextCard
        label="VN30"
        quote={indexQuotes.VN30}
        series={bootstrap?.indexes.VN30}
      />

      <ContextCard
        title="Mua bán nước ngoài"
        icon={<Globe2 className="h-3.5 w-3.5" />}
        accent="purple"
        className="xl:col-span-2"
        titleHint={hasFinhayForeign
          ? "Finhay VNINDEX foreign trading: tổng mua/bán trên toàn universe HOSE."
          : finhayForeignState === "UNAVAILABLE"
            ? "Finhay full-HOSE unavailable; đang dùng foreign buy/sell của canonical Top 200 làm partial fallback."
            : "Đang kiểm tra Finhay full-HOSE foreign flow; canonical Top 200 là fallback."}
      >
        <div className="grid grid-cols-3 gap-2">
          <div>
            <div className="text-[8px] uppercase tracking-wide text-zinc-600">Mua</div>
            <div className="font-mono text-[11px] font-bold text-emerald-300">
              {formatVndValue((hasFinhayForeign || foreignSnapshot.covered > 0) ? displayedForeignBuy : undefined)}
            </div>
          </div>
          <div>
            <div className="text-[8px] uppercase tracking-wide text-zinc-600">Bán</div>
            <div className="font-mono text-[11px] font-bold text-red-300">
              {formatVndValue((hasFinhayForeign || foreignSnapshot.covered > 0) ? displayedForeignSell : undefined)}
            </div>
          </div>
          <div>
            <div className="text-[8px] uppercase tracking-wide text-zinc-600">Ròng</div>
            <div className={`font-mono text-[11px] font-bold ${finite(displayedForeignNet) && displayedForeignNet > 0 ? "text-emerald-300" : finite(displayedForeignNet) && displayedForeignNet < 0 ? "text-red-300" : "text-zinc-300"}`}>
              {formatSignedVndValue(displayedForeignNet)}
            </div>
          </div>
        </div>
        <div className="mt-2 overflow-hidden rounded-lg"><DualLineChart points={foreignPoints} /></div>
        <div className="mt-1 flex items-center justify-between gap-2 text-[8px] text-zinc-600">
          <span>
            {hasFinhayForeign
              ? `Finhay full HOSE · ${displayedForeignCoverage ?? "—"} mã`
              : `Top 200 partial · ${foreignSnapshot.covered}/${canonicalUniverse.length} mã`}
          </span>
          <span>{hasFinhayForeign ? finhayForeign?.sessionDate : formatAsOf(displayedForeignAsOf)}</span>
        </div>
      </ContextCard>

      <ContextCard
        title="Tác động VNINDEX"
        icon={<Scale className="h-3.5 w-3.5" />}
        accent="green"
        className="xl:col-span-4"
        titleHint={impact?.source}
      >
        {impact && (impact.positive.length > 0 || impact.negative.length > 0) ? (
          <>
            <ImpactChart impact={impact} />
            <div className="mt-1 flex items-center justify-between gap-3 border-t border-white/[0.05] pt-1 text-[8px] text-zinc-600">
              <span>
                Tổng các mã hiển thị:{" "}
                <strong className={impact.displayedNetTotal >= 0 ? "text-emerald-300" : "text-red-300"}>
                  {impact.displayedNetTotal > 0 ? "+" : ""}{impact.displayedNetTotal.toFixed(2)} điểm
                </strong>
              </span>
              <span>{formatAsOf(impact.asOf)}</span>
            </div>
          </>
        ) : (
          <div className="flex h-[78px] items-center justify-center gap-2 text-[10px] text-zinc-600">
            <Activity className="h-3.5 w-3.5" />
            Chưa có provider contribution snapshot
          </div>
        )}
      </ContextCard>
    </div>
  )
}
