"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Activity, Globe2, Landmark, Scale, WalletCards } from "lucide-react"

import { Sparkline } from "@/components/sparkline"
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
  valueTraded?: number
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

const MAX_LIVE_POINTS = 120
const GREEN = "#22c98a"
const PURPLE = "#a855f7"
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
      className={`min-h-[118px] shrink-0 rounded-2xl border bg-[#0b0f14] px-3 py-2.5 ${accentClass} ${className}`}
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
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[18px] font-bold leading-none text-zinc-100">
            {quote && finite(quote.value) ? INDEX_FORMATTER.format(quote.value) : series?.points.at(-1) ? INDEX_FORMATTER.format(series.points.at(-1)!.value) : "—"}
          </div>
          <div className="mt-1 font-mono text-[11px] font-semibold" style={{ color }}>
            {formatChange(quote?.changePercent)}
          </div>
        </div>
        <div className="flex h-[48px] w-[132px] items-center justify-end">
          {hasHistory ? (
            <Sparkline data={data} color={color} width={132} height={42} strokeWidth={1.8} showDot fill={false} />
          ) : (
            <span className="text-right text-[9px] leading-tight text-zinc-600">Chưa có lịch sử 1m</span>
          )}
        </div>
      </div>
      <div className="mt-1 truncate text-[9px] text-zinc-600">
        {series ? `1m · ${series.sessionDate} · ${formatAsOf(quote?.updatedAt ?? series.asOf)}` : "Index history unavailable"}
      </div>
    </>
  )

  return (
    <ContextCard
      title={label}
      icon={<Landmark className="h-3.5 w-3.5" />}
      accent={label === "VNINDEX" ? "green" : "purple"}
      className="w-[220px]"
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
  const width = 190
  const height = 44
  if (points.length < 2) return <div className="h-[44px] text-right text-[9px] leading-tight text-zinc-600">Đang tích lũy realtime<br />từ lúc mở bảng</div>

  const values = points.flatMap((point) => [point.buy, point.sell]).filter((value) => Number.isFinite(value))
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || Math.max(max * 0.01, 1)
  const y = (value: number) => height - 3 - ((value - min) / range) * (height - 6)
  const x = (index: number) => 2 + (index / Math.max(1, points.length - 1)) * (width - 4)
  const buyPoints = points.map((point, index) => `${x(index).toFixed(1)},${y(point.buy).toFixed(1)}`).join(" ")
  const sellPoints = points.map((point, index) => `${x(index).toFixed(1)},${y(point.sell).toFixed(1)}`).join(" ")

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-[44px] w-full" aria-hidden="true" shapeRendering="optimizeSpeed">
      <polyline points={buyPoints} fill="none" stroke={GREEN} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={sellPoints} fill="none" stroke={PURPLE} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ImpactSide({ entry, maxAbs, positive }: { entry?: MarketImpactEntry; maxAbs: number; positive: boolean }) {
  if (!entry) return <div className="h-3.5" />
  const width = maxAbs > 0 ? Math.max(3, Math.min(100, (Math.abs(entry.contribution) / maxAbs) * 100)) : 0
  return (
    <div className={`grid grid-cols-[34px_minmax(0,1fr)_45px] items-center gap-1 text-[8px] ${positive ? "" : "text-right"}`}>
      <span className={`font-mono font-bold ${positive ? "text-emerald-300" : "text-purple-300"}`}>{entry.symbol}</span>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-white/[0.04]">
        <span
          className={`h-full rounded-full ${positive ? "bg-emerald-400/80" : "ml-auto bg-purple-400/80"}`}
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

  const contextSessionDate = bootstrap?.indexes.VNINDEX?.sessionDate ?? ""
  const vnindexQuote = indexQuotes.VNINDEX
  const liquidityValue = vnindexQuote?.valueTraded
  const liquidityUpdatedAt = vnindexQuote?.updatedAt ?? ""

  useEffect(() => {
    setLiquidityPoints([])
    setForeignPoints([])
  }, [contextSessionDate])

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

  useEffect(() => {
    if (foreignSnapshot.covered === 0 || !foreignSnapshot.asOf || !contextSessionDate) return
    if (vietnamDateKey(foreignSnapshot.asOf) !== contextSessionDate) return
    setForeignPoints((current) => upsertForeignMetricPoint(
      current,
      foreignSnapshot.asOf,
      foreignSnapshot.buy,
      foreignSnapshot.sell,
    ))
  }, [contextSessionDate, foreignSnapshot.asOf, foreignSnapshot.buy, foreignSnapshot.covered, foreignSnapshot.sell])

  const liquidityData = liquidityPoints.map((point) => point.value)
  const contextErrors = bootstrap?.errors?.join("; ") || loadError
  const impact = bootstrap?.impact

  return (
    <div
      className="flex shrink-0 gap-2 overflow-x-auto border-b border-white/[0.08] bg-[#06080a] px-2 py-2 scrollbar-thin"
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
        className="w-[255px]"
        titleHint="GTGD HOSE tích lũy thực tế. Chưa có nguồn lịch sử intraday GTGD chuẩn để so aligned timestamp với phiên trước."
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-mono text-[16px] font-bold leading-none text-zinc-100">{formatVndValue(liquidityValue)}</div>
            <div className="mt-1 text-[9px] font-medium text-zinc-500">vs phiên trước: <span className="text-zinc-400">—</span></div>
          </div>
          <div className="flex h-[46px] w-[116px] items-center justify-end">
            {liquidityData.length >= 2 ? (
              <Sparkline data={liquidityData} color={PLATINUM} width={116} height={42} strokeWidth={1.7} showDot fill={false} />
            ) : (
              <span className="text-right text-[9px] leading-tight text-zinc-600">Realtime từ<br />lúc mở bảng</span>
            )}
          </div>
        </div>
        <div className="mt-1 text-[9px] leading-tight text-zinc-600">GTGD thực tế · phiên {contextSessionDate || "—"} · history phiên trước chưa verified</div>
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
        className="w-[285px]"
        titleHint="Tổng foreign buy/sell value của canonical Top 200. Đây là partial scope, không được trình bày như toàn HOSE."
      >
        <div className="grid grid-cols-[88px_minmax(0,1fr)] items-start gap-2">
          <div className="space-y-1">
            <div>
              <div className="text-[8px] uppercase tracking-wide text-zinc-600">Mua</div>
              <div className="font-mono text-[11px] font-bold text-emerald-300">{formatVndValue(foreignSnapshot.buy)}</div>
            </div>
            <div>
              <div className="text-[8px] uppercase tracking-wide text-zinc-600">Bán</div>
              <div className="font-mono text-[11px] font-bold text-purple-300">{formatVndValue(foreignSnapshot.sell)}</div>
            </div>
          </div>
          <DualLineChart points={foreignPoints} />
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 text-[9px] text-zinc-600">
          <span>Top 200 partial · {foreignSnapshot.covered}/{canonicalUniverse.length} mã</span>
          <span>{formatAsOf(foreignSnapshot.asOf)}</span>
        </div>
      </ContextCard>

      <ContextCard
        title="Tác động VNINDEX"
        icon={<Scale className="h-3.5 w-3.5" />}
        accent="green"
        className="w-[430px]"
        titleHint={impact?.source}
      >
        {impact && (impact.positive.length > 0 || impact.negative.length > 0) ? (
          <>
            <ImpactChart impact={impact} />
            <div className="mt-1 flex items-center justify-between gap-3 border-t border-white/[0.05] pt-1 text-[8px] text-zinc-600">
              <span>
                Tổng các mã hiển thị:{" "}
                <strong className={impact.displayedNetTotal >= 0 ? "text-emerald-300" : "text-purple-300"}>
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
