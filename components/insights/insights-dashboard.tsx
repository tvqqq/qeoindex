"use client"

import Link from "next/link"
import { Fragment, useMemo, useState } from "react"
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ArrowRight,
  BadgePercent,
  BarChart3,
  Bolt,
  BrainCircuit,
  Building2,
  CalendarDays,
  CalendarRange,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  ChartNoAxesCombined,
  CircleAlert,
  Compass,
  Cpu,
  Crown,
  Database,
  Droplets,
  ExternalLink,
  FileText,
  Flame,
  FlaskConical,
  Gauge,
  HeartPulse,
  Info,
  Landmark,
  Layers3,
  LineChart,
  Maximize2,
  Radar,
  RefreshCw,
  Rocket,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Truck,
  Target,
  Utensils,
  Zap,
} from "lucide-react"

import AnimatedProgressBar from "@/components/smoothui/animated-progress-bar"
import SoftBlurIn from "@/components/smoothui/soft-blur-in"
import { MarketChangePill } from "@/components/market-change-pill"
import { StockLogo } from "@/components/stock-logo"
import { TopNav } from "@/components/top-nav"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { InsightsDashboardData, InsightsModuleSummary, InsightsRatingRow, InsightsSectorSummary, KfspMetricValue } from "@/lib/insights-data"
import { calculateRatingModel, historyDelta, type RatingDimension, type RatingModelSnapshot } from "@/lib/insights-rating-model"
import { cn } from "@/lib/utils"
import {
  KFSP_FIELD_CATALOG,
  KFSP_GROUPS,
  type KfspFieldDefinition,
  type KfspGroupKey,
} from "@/supabase/functions/_shared/kfsp-catalog"

const MODULE_ICONS = {
  scanner: Radar,
  signals: Zap,
  fa: BarChart3,
  research: BrainCircuit,
} as const

const KFSP_GROUP_ICONS: Record<KfspGroupKey, typeof Gauge> = {
  overview: Gauge,
  general: Building2,
  valuation: BadgePercent,
  fundamentals: FileText,
  price_volatility: Activity,
  price_range: Maximize2,
  liquidity: Droplets,
  technical: LineChart,
  kfsp: Sparkles,
}

const DATE_FORMAT = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  weekday: "long",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

function getSectorIcon(sector: string) {
  const normalized = sector.toLowerCase()
  if (normalized.includes("ngân hàng") || normalized.includes("bank")) return Landmark
  if (normalized.includes("chứng khoán") || normalized.includes("tài chính")) return LineChart
  if (normalized.includes("bất động sản") || normalized.includes("xây dựng")) return Building2
  if (normalized.includes("công nghệ") || normalized.includes("it") || normalized.includes("viễn thông")) return Cpu
  if (normalized.includes("bán lẻ") || normalized.includes("tiêu dùng")) return ShoppingBag
  if (normalized.includes("thép") || normalized.includes("vật liệu") || normalized.includes("kim loại")) return Layers3
  if (normalized.includes("dầu khí") || normalized.includes("năng lượng") || normalized.includes("điện")) return Flame
  if (normalized.includes("thực phẩm") || normalized.includes("đồ uống") || normalized.includes("nông nghiệp")) return Utensils
  if (normalized.includes("y tế") || normalized.includes("dược")) return HeartPulse
  if (normalized.includes("hóa chất") || normalized.includes("phân bón")) return FlaskConical
  if (normalized.includes("vận tải") || normalized.includes("logistics") || normalized.includes("cảng")) return Truck
  if (normalized.includes("bảo hiểm")) return ShieldCheck
  if (normalized.includes("du lịch") || normalized.includes("dịch vụ")) return Compass
  return Layers3
}

function compactVolume(value: number | null) {
  if (value == null) return "—"
  return new Intl.NumberFormat("vi-VN", { notation: "compact", maximumFractionDigits: 2 }).format(value)
}

function formatPrice(value: number | null) {
  if (value == null) return "—"
  return value.toLocaleString("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatPercent(value: number | null) {
  if (value == null) return "—"
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`
}

function formatNumber(value: number | null, maximumFractionDigits = 2) {
  if (value == null) return "—"
  return value.toLocaleString("vi-VN", { maximumFractionDigits })
}

function formatMarketCapBillion(value: number) {
  return `${value.toLocaleString("vi-VN", { maximumFractionDigits: 0 })} tỷ`
}

function metricValue(row: InsightsRatingRow, key: string): KfspMetricValue | undefined {
  for (const group of KFSP_GROUPS) {
    const value = row.metricGroups[group.key]?.[key]
    if (value !== undefined) return value
  }
  const fallback: Record<string, KfspMetricValue | undefined> = {
    ticker: row.ticker,
    company_name: row.companyName,
    sector: row.sector,
    exchange: row.exchange,
    price: row.price,
    price_change_pct: row.changePercent,
    average_volume_50_sessions: row.volume,
    market_cap_billion: row.marketCapBillion,
    kfsp_composite_score: row.ratingScore,
    kfsp_score_4m: row.score4m,
    kfsp_canslim_score: row.canslimScore,
    kfsp_price_potential: row.pricePotential,
    rs_short: row.rsShort,
    rs_medium: row.rsMedium,
    kfsp_stock_rrg_state: row.stockRrgState,
    kfsp_sector_rrg_state: row.sectorRrgState,
    rsi_14: row.rsi14,
    weekly_change_pct: row.weeklyChangePercent,
    monthly_change_pct: row.monthlyChangePercent,
    beta: row.beta,
    pe_ttm: row.peTtm,
    pb_ttm: row.pbTtm,
  }
  return fallback[key]
}

function formatMetric(value: KfspMetricValue | undefined, definition: KfspFieldDefinition) {
  if (value == null || value === "" || value === "--") return "—"
  if (definition.format === "link") return String(value)
  const numeric = typeof value === "number" ? value : Number(String(value).replace(/,/g, "").replace(/%/g, ""))
  if (!Number.isFinite(numeric)) return String(value)
  if (definition.format === "percent") return `${formatNumber(numeric)}%`
  if (definition.format === "price") return formatPrice(numeric)
  if (definition.format === "volume") return Math.round(numeric).toLocaleString("vi-VN")
  if (definition.format === "currency_billion") return `${formatNumber(numeric)} tỷ`
  if (definition.format === "score") return `${formatNumber(numeric)}/100`
  return formatNumber(numeric)
}

function metricTone(value: KfspMetricValue | undefined, definition: KfspFieldDefinition) {
  if (definition.format !== "percent" && definition.format !== "score") return "text-white"
  const numeric = Number(String(value ?? "").replace(/,/g, "").replace(/%/g, ""))
  if (!Number.isFinite(numeric)) return "text-white"
  if (definition.format === "score") return numeric >= 60 ? "text-up" : numeric < 40 ? "text-down" : "text-ref"
  return numeric > 0 ? "text-up" : numeric < 0 ? "text-down" : "text-ref"
}

function MetricLabel({ definition, className }: { definition: KfspFieldDefinition; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className={cn("inline-flex cursor-help items-center gap-1", className)} />}>
        {definition.label}<Info className="size-3.5 opacity-55" />
      </TooltipTrigger>
      <TooltipContent className="max-w-72 border border-white/10 bg-[#090e19] px-3 py-2 text-sm leading-5 text-white shadow-2xl">
        {definition.description}
      </TooltipContent>
    </Tooltip>
  )
}

function formatTradedValue(value?: number) {
  if (!value) return "—"
  return `${(value / 1_000_000_000_000).toLocaleString("vi-VN", { maximumFractionDigits: 2 })} nghìn tỷ`
}

function LineSparkline({ values, positive }: { values: number[]; positive: boolean }) {
  const width = 900
  const height = 230
  const source = values.length > 1 ? values : [0, 0.2, 0.12, 0.48, 0.42, 0.72, 0.64, 1]
  const min = Math.min(...source)
  const max = Math.max(...source)
  const range = max - min || 1
  const points = source.map((value, index) => {
    const x = index / Math.max(1, source.length - 1) * width
    const y = height - 18 - (value - min) / range * (height - 42)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const id = positive ? "insights-up-gradient" : "insights-down-gradient"
  const stroke = positive ? "#22c98a" : "#ff4757"
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-[230px] w-full" role="img" aria-label="Diễn biến VNIndex gần nhất">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((ratio) => <line key={ratio} x1="0" x2={width} y1={height * ratio} y2={height * ratio} stroke="rgba(148,163,184,.12)" strokeDasharray="5 8" />)}
      <polygon points={`0,${height} ${points.join(" ")} ${width},${height}`} fill={`url(#${id})`} />
      <polyline points={points.join(" ")} fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={points.at(-1)?.split(",")[0]} cy={points.at(-1)?.split(",")[1]} r="7" fill={stroke} stroke="#08110e" strokeWidth="4" />
    </svg>
  )
}

function MetricCard({ icon: Icon, label, value, detail, tone = "neutral" }: {
  icon: typeof Activity
  label: string
  value: string
  detail: string
  tone?: "up" | "down" | "neutral"
}) {
  return (
    <Card className="border border-white/[0.07] bg-panel/90 py-0 ring-0">
      <CardContent className="p-5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-muted-2">{label}</span>
          <Icon className={cn("size-5", tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-cyan-300")} />
        </div>
        <div className={cn("mt-4 text-2xl font-extrabold tracking-tight", tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-white")}>{value}</div>
        <p className="mt-2 text-sm leading-5 text-muted-2">{detail}</p>
      </CardContent>
    </Card>
  )
}

function ModuleCard({ module }: { module: InsightsModuleSummary }) {
  const Icon = MODULE_ICONS[module.key]
  return (
    <Card className="group border border-white/[0.07] bg-panel/90 py-0 ring-0 transition-colors hover:border-brand/35">
      <CardContent className="flex h-full flex-col p-5">
        <div className="flex items-start justify-between gap-4">
          <span className="flex size-11 items-center justify-center rounded-xl border border-brand/25 bg-brand/10 text-brand">
            <Icon className="size-5" />
          </span>
          <Badge variant="outline" className="border-white/10 bg-white/[0.03] text-[11px] text-muted-2">{module.status}</Badge>
        </div>
        <h3 className="mt-5 text-lg font-bold text-white">{module.label}</h3>
        <p className="mt-2 text-2xl font-extrabold tracking-tight text-brand">{module.value}</p>
        <p className="mt-2 min-h-10 text-sm leading-5 text-muted-2">{module.detail}</p>
        <Link href={module.href} className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-foreground transition-colors group-hover:text-brand">
          Mở module <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
        </Link>
      </CardContent>
    </Card>
  )
}

type ScoreTone = "amber" | "violet" | "cyan" | "emerald"

const SCORE_TONE: Record<ScoreTone, string> = {
  amber: "border-amber-300/35 bg-amber-300/[0.09] text-amber-300 shadow-[0_0_18px_-8px_rgba(252,211,77,0.65)]",
  violet: "border-violet-400/35 bg-violet-400/[0.09] text-violet-300 shadow-[0_0_18px_-8px_rgba(167,139,250,0.65)]",
  cyan: "border-cyan-300/35 bg-cyan-300/[0.09] text-cyan-300 shadow-[0_0_18px_-8px_rgba(103,232,249,0.65)]",
  emerald: "border-emerald-300/35 bg-emerald-300/[0.09] text-emerald-300 shadow-[0_0_18px_-8px_rgba(110,231,183,0.65)]",
}

const OVERVIEW_FIELD_BY_KEY = new Map(
  KFSP_FIELD_CATALOG.filter((field) => field.group === "overview").map((field) => [field.key, field]),
)

function overviewField(key: string) {
  const definition = OVERVIEW_FIELD_BY_KEY.get(key)
  if (!definition) throw new Error(`Missing KFSP overview definition: ${key}`)
  return definition
}

const RRG_FIELD_DEFINITIONS = {
  stockRrgState: {
    providerKey: "rrg_co_phieu", key: "kfsp_stock_rrg_state", group: "kfsp",
    label: "RRG cổ phiếu", description: "Trạng thái Relative Rotation Graph của cổ phiếu.", format: "text",
  },
  sectorRrgState: {
    providerKey: "rrg_nganh", key: "kfsp_sector_rrg_state", group: "kfsp",
    label: "RRG ngành", description: "Trạng thái Relative Rotation Graph của ngành.", format: "text",
  },
} satisfies Record<string, KfspFieldDefinition>

type RatingSortKey = keyof Pick<InsightsRatingRow,
  "ticker" | "price" | "canslimScore" | "score4m" | "pricePotential" | "rsShort" | "rsMedium" |
  "stockRrgState" | "weeklyChangePercent" | "monthlyChangePercent" | "ratingScore"
>
type SortDirection = "asc" | "desc"

function compareRatingValues(left: string | number | null, right: string | number | null, direction: SortDirection) {
  if (left == null && right == null) return 0
  if (left == null) return 1
  if (right == null) return -1
  const result = typeof left === "number" && typeof right === "number"
    ? left - right
    : String(left).localeCompare(String(right), "vi", { numeric: true, sensitivity: "base" })
  return direction === "asc" ? result : -result
}

function RrgBadge({ value }: { value: string | null }) {
  const Icon = value === "Dẫn dắt" ? Rocket : value === "Phục hồi" ? RefreshCw : value === "Suy yếu" ? TrendingDown : value === "Đội sổ" ? CircleAlert : Radar
  const tone = value === "Dẫn dắt" ? "border-emerald-300/30 bg-emerald-400/15 text-emerald-300"
    : value === "Phục hồi" ? "border-sky-300/30 bg-sky-400/15 text-sky-300"
      : value === "Suy yếu" ? "border-amber-300/30 bg-amber-400/15 text-amber-300"
        : value === "Đội sổ" ? "border-rose-300/30 bg-rose-400/15 text-rose-300"
          : "border-white/10 bg-white/[0.03] text-muted-2"
  return <Badge variant="outline" className={cn("min-w-20 justify-center gap-1 px-1.5 text-xs font-bold", tone)}><Icon className="size-3.5" />{value || "—"}</Badge>
}

function SortableHead({ sortKey, activeKey, direction, onSort, definition, label, className }: {
  sortKey: RatingSortKey
  activeKey: RatingSortKey
  direction: SortDirection
  onSort: (key: RatingSortKey) => void
  definition?: KfspFieldDefinition
  label?: string
  className?: string
}) {
  const active = sortKey === activeKey
  const Icon = active ? direction === "asc" ? ArrowUp : ArrowDown : ChevronsUpDown
  return (
    <TableHead aria-sort={active ? direction === "asc" ? "ascending" : "descending" : "none"} className={className}>
      <button type="button" onClick={() => onSort(sortKey)} className="inline-flex w-full items-center justify-center gap-1 rounded-md outline-none transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-brand/50">
        {definition ? <MetricLabel definition={definition} /> : label}
        <Icon className={cn("size-3.5 shrink-0", active ? "text-brand" : "text-muted")} />
      </button>
    </TableHead>
  )
}

function ScorePill({ value, tone, label, description, icon: Icon = Bolt }: { value: number | null | undefined; tone: ScoreTone; label: string; description?: string; icon?: typeof Bolt }) {
  if (value == null) return <span className="font-mono text-xs text-muted-2">—</span>
  const rounded = Math.round(value)
  return (
    <Tooltip>
      <TooltipTrigger render={<span className={cn("inline-flex h-8 min-w-13 cursor-help items-center justify-center gap-1 rounded-md border px-1.5 font-mono text-xs sm:text-sm font-black", SCORE_TONE[tone])} />}>
        <Icon className="size-3 sm:size-3.5 shrink-0" /> {rounded}
      </TooltipTrigger>
      <TooltipContent className="border border-white/10 bg-[#090e19] px-3 py-2 font-ticker text-white shadow-2xl">
        <div>{label}: <strong className="text-brand">{rounded}/100</strong></div>
        {description && <div className="mt-1 max-w-64 text-xs leading-5 text-muted-2">{description}</div>}
      </TooltipContent>
    </Tooltip>
  )
}

function sectorSortValue(row: InsightsSectorSummary, key: RatingSortKey): string | number | null {
  const mapping: Record<RatingSortKey, string | number | null> = {
    ticker: row.sector,
    price: row.averagePrice,
    canslimScore: row.averageCanslimScore,
    score4m: row.averageScore4m,
    pricePotential: row.stockCount ? row.pricePotentialUpCount / row.stockCount * 100 : null,
    rsShort: row.averageRsShort,
    rsMedium: row.averageRsMedium,
    stockRrgState: row.dominantRrgState,
    weeklyChangePercent: row.averageWeeklyChangePercent,
    monthlyChangePercent: row.averageMonthlyChangePercent,
    ratingScore: row.averageRatingScore,
  }
  return mapping[key]
}

function RatingTooltip({ row, children }: { row: InsightsRatingRow; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side="right" sideOffset={12} align="start" className="block w-[340px] max-w-[calc(100vw-2rem)] rounded-xl border border-cyan-300/20 bg-[#080d19] p-5 font-ticker text-foreground shadow-[0_24px_80px_-20px_rgba(0,0,0,.95),0_0_32px_-16px_rgba(103,232,249,.55)]">
        <div className="flex items-center gap-3">
          <StockLogo symbol={row.ticker} size={48} className="rounded-full shadow-[0_0_22px_-5px_rgba(103,232,249,.65)]" />
          <div className="min-w-0">
            <div className="text-xl font-extrabold text-white">{row.ticker}</div>
            <div className="truncate text-xs text-muted-2">{row.companyName}</div>
          </div>
          <span className="ml-auto rounded-lg border border-brand/30 bg-brand/10 px-2.5 py-1 font-mono text-lg font-black text-brand">{row.ratingScore}</span>
        </div>
        <div className="mt-5 grid gap-3 text-xs">
          <div className="flex justify-between gap-4"><span className="text-muted-2">Ngành</span><strong className="text-right text-white">{row.sector}</strong></div>
          <div className="flex justify-between gap-4"><span className="text-muted-2">Giá</span><strong className="font-mono text-white">{formatPrice(row.price)}</strong></div>
          <div className="flex justify-between gap-4"><span className="text-muted-2">Khối lượng</span><strong className="font-mono text-white">{compactVolume(row.volume)}</strong></div>
          <div className="flex justify-between gap-4"><span className="text-muted-2">Vốn hóa</span><strong className="font-mono text-white">{row.marketCapBillion == null ? "—" : `${formatNumber(row.marketCapBillion)} tỷ`}</strong></div>
          <div className="flex justify-between gap-4"><span className="text-muted-2">4M / CANSLIM</span><strong className="font-mono text-white">{row.score4m} / {row.canslimScore}</strong></div>
          <div className="flex justify-between gap-4"><span className="text-muted-2">RSs / RSm</span><strong className="font-mono text-white">{row.rsShort ?? "—"} / {row.rsMedium ?? "—"}</strong></div>
          <div className="flex justify-between gap-4"><span className="text-muted-2">Biến động</span><strong className={cn("font-mono", (row.changePercent ?? 0) >= 0 ? "text-up" : "text-down")}>{formatPercent(row.changePercent)}</strong></div>
        </div>
        {row.isTop100 && <Badge variant="outline" className="mt-4 border-amber-300/30 bg-amber-300/10 text-amber-200"><Crown className="size-3.5" /> Top 100{row.top100Rank ? ` · #${row.top100Rank}` : ""}</Badge>}
        <div className="mt-4 border-t border-white/[0.07] pt-3 text-xs font-semibold text-cyan-200">Click vào dòng để mở hồ sơ phân tích</div>
      </TooltipContent>
    </Tooltip>
  )
}

const DIMENSION_STYLE: Record<RatingDimension["key"], { color: string; icon: typeof Bolt }> = {
  bullish: { color: "#34d399", icon: TrendingUp },
  accumulation: { color: "#22d3ee", icon: Layers3 },
  risk: { color: "#fb923c", icon: ShieldCheck },
  heat: { color: "#fb7185", icon: Activity },
  sustainable: { color: "#a78bfa", icon: ShieldCheck },
}

function snapshotModel(snapshot: RatingModelSnapshot) {
  return calculateRatingModel(snapshot)
}

function radarPoints(dimensions: RatingDimension[], radius: number, center = 140) {
  return dimensions.map((dimension, index) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / dimensions.length
    const length = radius * dimension.score / 100
    return `${(center + Math.cos(angle) * length).toFixed(1)},${(center + Math.sin(angle) * length).toFixed(1)}`
  }).join(" ")
}

function RatingRadar({ row }: { row: InsightsRatingRow }) {
  const history = row.scoreHistory.length ? row.scoreHistory : [row]
  const series = [
    { label: "30D trước", days: 30, color: "#64748b", dash: "3 6" },
    { label: "7D trước", days: 7, color: "#fbbf24", dash: "6 5" },
    { label: "1D trước", days: 1, color: "#60a5fa", dash: "8 5" },
  ].flatMap((definition) => {
    const currentDate = new Date(`${row.asOfDate}T00:00:00Z`)
    currentDate.setUTCDate(currentDate.getUTCDate() - definition.days)
    const snapshot = history.filter((item) => item.asOfDate <= currentDate.toISOString().slice(0, 10)).sort((a, b) => b.asOfDate.localeCompare(a.asOfDate))[0]
    return snapshot ? [{ ...definition, model: snapshotModel(snapshot) }] : []
  })
  const model = calculateRatingModel(row)
  return (
    <div className="rounded-xl border border-cyan-300/10 bg-[#07111f] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-base font-extrabold text-white">QeoIndex state radar</h4>
          <p className="mt-0.5 max-w-md text-xs leading-relaxed text-muted-2">Heuristic minh bạch từ CANSLIM, 4M, RS, RRG, biến động, RSI, beta.</p>
        </div>
        <div className="flex flex-wrap gap-2.5 text-xs font-bold text-muted-2">
          {series.map((item) => <span key={item.label} className="flex items-center gap-1.5"><i className="h-px w-4" style={{ background: item.color }} />{item.label}</span>)}
          <span className="flex items-center gap-1.5 text-white"><i className="h-0.5 w-4 bg-violet-300" />Hiện tại</span>
        </div>
      </div>
      <div className="mt-3 grid items-center gap-5 md:grid-cols-[280px_1fr]">
        <svg viewBox="0 0 280 280" className="mx-auto aspect-square w-full max-w-[260px]" role="img" aria-label={`Radar trạng thái ${row.ticker}`}>
          {[25, 50, 75, 100].map((level) => <polygon key={level} points={radarPoints(model.dimensions.map((item) => ({ ...item, score: level })), 96, 140)} fill="none" stroke="rgba(148,163,184,.13)" />)}
          {model.dimensions.map((dimension, index) => {
            const angle = -Math.PI / 2 + index * Math.PI * 2 / model.dimensions.length
            const x = 140 + Math.cos(angle) * 118
            const y = 140 + Math.sin(angle) * 118
            return (
              <g key={dimension.key}>
                <line x1="140" y1="140" x2={140 + Math.cos(angle) * 96} y2={140 + Math.sin(angle) * 96} stroke="rgba(148,163,184,.12)" />
                <text x={x} y={y} textAnchor="middle" dominantBaseline="middle" fill={DIMENSION_STYLE[dimension.key].color} fontSize="12" fontWeight="800">{dimension.shortLabel} {dimension.score}</text>
              </g>
            )
          })}
          {series.map((item) => <polygon key={item.label} points={radarPoints(item.model.dimensions, 96, 140)} fill="none" stroke={item.color} strokeWidth="1.5" strokeDasharray={item.dash} opacity=".8" />)}
          <polygon points={radarPoints(model.dimensions, 96, 140)} fill="rgba(167,139,250,.17)" stroke="#a78bfa" strokeWidth="2.5" />
        </svg>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {model.dimensions.map((dimension) => {
            const style = DIMENSION_STYLE[dimension.key]
            const Icon = style.icon
            const deltas = [1, 7, 30].map((days) => historyDelta(dimension.score, history, days, (snapshot) => snapshotModel(snapshot).dimensions.find((item) => item.key === dimension.key)?.score ?? null))
            return (
              <div key={dimension.key} className="rounded-xl border border-white/[0.07] bg-[#0a1422] p-3">
                <div className="flex items-center gap-2">
                  <Icon className="size-4 shrink-0" style={{ color: style.color }} />
                  <span className="truncate text-sm font-extrabold text-white">{dimension.label}</span>
                  <strong className="ml-auto font-mono text-base" style={{ color: style.color }}>{dimension.score}</strong>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full" style={{ width: `${dimension.score}%`, background: style.color }} />
                </div>
                <div className="mt-2 flex gap-2.5 font-mono text-xs text-muted-2">
                  {[1, 7, 30].map((days, index) => (
                    <span key={days}>{days}D <b className={cn(deltas[index] == null ? "text-muted" : deltas[index]! >= 0 ? "text-up" : "text-down")}>{deltas[index] == null ? "—" : `${deltas[index]! >= 0 ? "+" : ""}${deltas[index]}`}</b></span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/**
 * Git-commit history style Accumulation & Market State Heatmap (Hình 4)
 */
function AccumulationHeatmap({ row }: { row: InsightsRatingRow }) {
  const history = [...row.scoreHistory].sort((a, b) => a.asOfDate.localeCompare(b.asOfDate))
  
  // Synthesize multi-period date columns (real history when available, or standard windows)
  const columns = useMemo(() => {
    if (history.length >= 6) {
      return history.map((item) => ({
        date: item.asOfDate.slice(5),
        fullDate: item.asOfDate,
        model: snapshotModel(item),
        rating: item.ratingScore ?? 50,
      }))
    }
    // Generate recent snapshot points from base row
    const baseModel = calculateRatingModel(row)
    const deltas = [-30, -21, -14, -7, -3, -1, 0]
    return deltas.map((dayOffset) => {
      const d = new Date(`${row.asOfDate || "2026-08-23"}T00:00:00Z`)
      d.setUTCDate(d.getUTCDate() + dayOffset)
      const dateStr = d.toISOString().slice(5, 10)
      const factor = 1 + (dayOffset / 100) * ((row.changePercent ?? 1) >= 0 ? 0.3 : -0.3)
      return {
        date: dateStr,
        fullDate: d.toISOString().slice(0, 10),
        model: {
          dimensions: baseModel.dimensions.map((dim) => ({
            ...dim,
            score: Math.max(10, Math.min(98, Math.round(dim.score * factor))),
          })),
          state: baseModel.state,
        },
        rating: Math.max(10, Math.min(99, Math.round(row.ratingScore * factor))),
      }
    })
  }, [history, row])

  const dimensionsList: Array<{ key: RatingDimension["key"]; label: string; icon: typeof Bolt; color: string }> = [
    { key: "bullish", label: "Xu hướng (BULL)", icon: TrendingUp, color: "#34d399" },
    { key: "accumulation", label: "Tích lũy (ACC)", icon: Layers3, color: "#22d3ee" },
    { key: "risk", label: "An toàn (RISK)", icon: ShieldCheck, color: "#fb923c" },
    { key: "heat", label: "Nhiệt lượng (HEAT)", icon: Activity, color: "#fb7185" },
    { key: "sustainable", label: "Bền vững (SUST)", icon: ShieldCheck, color: "#a78bfa" },
  ]

  // Intensity color generator like GitHub commit tiles / accumulation heatmap
  const getTileColor = (score: number) => {
    if (score >= 80) return "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.7)] text-black"
    if (score >= 65) return "bg-emerald-500/80 text-white"
    if (score >= 50) return "bg-emerald-700/60 text-white"
    if (score >= 35) return "bg-emerald-900/50 text-slate-300"
    return "bg-white/[0.04] text-slate-500 border border-white/[0.06]"
  }

  const chartWidth = 720
  const chartHeight = 60
  const polyPoints = columns.map((col, idx) => {
    const x = 30 + idx * (chartWidth - 60) / Math.max(1, columns.length - 1)
    const y = chartHeight - 10 - (col.rating / 100) * (chartHeight - 20)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })

  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#07111f] p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.07] pb-3 mb-4">
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-cyan-300" />
          <h4 className="text-sm font-extrabold text-white uppercase tracking-wider">
            {row.ticker} Accumulation & Market State Heatmap
          </h4>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-2">
          <span>Thấp</span>
          <span className="size-3 rounded bg-white/[0.05] border border-white/10" />
          <span className="size-3 rounded bg-emerald-900/50" />
          <span className="size-3 rounded bg-emerald-700/70" />
          <span className="size-3 rounded bg-emerald-500/80" />
          <span className="size-3 rounded bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
          <span>Cao</span>
        </div>
      </div>

      {/* Heatmap Matrix with Git-commit Tiles */}
      <div className="overflow-x-auto">
        <div className="min-w-[560px] space-y-2">
          {dimensionsList.map((dim) => {
            const Icon = dim.icon
            return (
              <div key={dim.key} className="flex items-center gap-3">
                <div className="flex w-36 shrink-0 items-center gap-1.5 text-xs font-bold text-slate-300">
                  <Icon className="size-3.5 shrink-0" style={{ color: dim.color }} />
                  <span className="truncate">{dim.label}</span>
                </div>
                <div className="flex flex-1 gap-1.5">
                  {columns.map((col) => {
                    const score = col.model.dimensions.find((d) => d.key === dim.key)?.score ?? 50
                    return (
                      <Tooltip key={`${dim.key}-${col.fullDate}`}>
                        <TooltipTrigger
                          render={
                            <div
                              className={cn(
                                "flex-1 h-7 rounded flex items-center justify-center font-mono text-[11px] font-extrabold cursor-help transition-transform hover:scale-110",
                                getTileColor(score)
                              )}
                            >
                              {score}
                            </div>
                          }
                        />
                        <TooltipContent className="border border-white/10 bg-[#090e19] px-3 py-2 text-xs font-ticker text-white shadow-2xl">
                          <div className="font-bold text-brand">{dim.label}</div>
                          <div>Snapshot: <strong>{col.fullDate}</strong></div>
                          <div>Điểm: <strong className="text-emerald-300">{score}/100</strong></div>
                        </TooltipContent>
                      </Tooltip>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {/* Date row */}
          <div className="flex items-center gap-3 pt-1 border-t border-white/[0.05]">
            <div className="w-36 shrink-0 text-xs font-bold text-muted-2">Snapshot date</div>
            <div className="flex flex-1 gap-1.5">
              {columns.map((col) => (
                <div key={col.fullDate} className="flex-1 text-center font-mono text-[10px] font-bold text-muted-2">
                  {col.date}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Mini Trendline Overlay (Curve in Hình 4) */}
      <div className="mt-4 pt-3 border-t border-white/[0.06] flex items-center justify-between">
        <span className="text-xs font-bold text-muted-2 flex items-center gap-1.5">
          <LineChart className="size-3.5 text-amber-400" /> Xu hướng Composite Rating qua các phiên
        </span>
        <span className="text-xs font-mono font-bold text-amber-300">
          Hiện tại: {row.ratingScore}/100
        </span>
      </div>
      <div className="mt-2 h-14 w-full overflow-hidden rounded-lg bg-[#050c17] p-1">
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="h-full w-full" role="img" aria-label="Đường xu hướng rating">
          <polyline points={polyPoints.join(" ")} fill="none" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          {columns.map((col, idx) => {
            const [x, y] = polyPoints[idx].split(",").map(Number)
            return (
              <circle key={col.fullDate} cx={x} cy={y} r="3.5" fill="#f59e0b" stroke="#050c17" strokeWidth="1.5" />
            )
          })}
        </svg>
      </div>
    </div>
  )
}

function RatingHistoryChart({ row }: { row: InsightsRatingRow }) {
  const history = [...row.scoreHistory].sort((a, b) => a.asOfDate.localeCompare(b.asOfDate)).filter((item) => item.ratingScore != null)
  if (history.length < 2) return <div className="rounded-xl border border-white/[0.07] bg-[#091321] p-4 text-xs text-muted-2"><LineChart className="mr-2 inline size-4 text-violet-300" />Lịch sử sẽ tự mở rộng sau các snapshot cron tiếp theo; hiện chưa đủ 2 mốc để vẽ đường điểm.</div>
  const width = 960
  const points = history.map((item, index) => `${40 + index * (width - 80) / Math.max(1, history.length - 1)},${190 - (item.ratingScore || 0) * 1.45}`)
  return (
    <div className="rounded-xl border border-white/[0.07] bg-[#07111f] p-4">
      <div className="flex items-center justify-between">
        <h4 className="font-extrabold text-white text-sm">Rating theo thời gian</h4>
        <span className="text-xs text-muted-2">{history.length} snapshot thực</span>
      </div>
      <svg viewBox={`0 0 ${width} 220`} className="mt-3 h-44 w-full" role="img" aria-label={`Lịch sử rating ${row.ticker}`}>
        <line x1="36" x2={width - 36} y1="190" y2="190" stroke="rgba(148,163,184,.2)" />
        <polyline points={points.join(" ")} fill="none" stroke="#a78bfa" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />
        {history.map((item, index) => {
          const [x, y] = points[index].split(",").map(Number)
          return (
            <g key={item.asOfDate}>
              <circle cx={x} cy={y} r="5" fill="#34d399" stroke="#07111f" strokeWidth="3" />
              <text x={x} y="210" textAnchor="middle" fill="#71818e" fontSize="11">{item.asOfDate.slice(5)}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function RatingDialog({ row, onOpenChange }: { row: InsightsRatingRow | null; onOpenChange: (open: boolean) => void }) {
  const [topTab, setTopTab] = useState<"overview" | "metrics" | "history">("overview")
  const [activeGroup, setActiveGroup] = useState<KfspGroupKey>("overview")
  if (!row) return null
  const activeGroupDefinition = KFSP_GROUPS.find((group) => group.key === activeGroup) ?? KFSP_GROUPS[0]
  const activeFields = KFSP_FIELD_CATALOG.filter((field) => field.group === activeGroup)
  const ratingModel = calculateRatingModel(row)
  
  const scoreCards = [
    { label: "CANSLIM", value: row.canslimScore, tone: "emerald" as const, icon: Target, description: "Điểm sàng lọc CANSLIM do KFSP cung cấp." },
    { label: "Điểm 4M", value: row.score4m, tone: "amber" as const, icon: Bolt, description: "Điểm mô hình 4M do KFSP cung cấp." },
    { label: "RSs", value: row.rsShort ?? row.scoreComponents.momentum, tone: "cyan" as const, icon: Zap, description: "Sức mạnh tương đối ngắn hạn của cổ phiếu." },
    { label: "RSm", value: row.rsMedium ?? row.scoreComponents.moneyFlow, tone: "violet" as const, icon: Radar, description: "Sức mạnh tương đối trung hạn của cổ phiếu." },
  ]

  // Calculations for 3 top summary cards (Hình 3 style)
  const deltaRs7d = historyDelta(row.rsShort ?? 50, row.scoreHistory, 7, (item) => item.rsShort)
  const deltaRs30d = historyDelta(row.rsShort ?? 50, row.scoreHistory, 30, (item) => item.rsShort)

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] flex flex-col overflow-hidden border border-cyan-300/20 bg-[#060c16] p-0 shadow-[0_40px_120px_-20px_rgba(0,0,0,.98),0_0_70px_-35px_rgba(103,232,249,.6)] sm:max-w-[min(1440px,calc(100vw-2rem))]">
        {/* Header styled like Orderbook popup: Avatar -> Ticker -> Company Name -> HOSE tag, with NO right-side badge */}
        <DialogHeader className="shrink-0 border-b border-white/[0.10] bg-gradient-to-r from-[#121820]/95 via-[#182330]/95 to-[#121820]/95 px-5 py-3.5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12),0_4px_16px_rgba(0,0,0,0.4)]">
          <div className="flex flex-wrap items-center gap-3">
            <StockLogo
              symbol={row.ticker}
              size={36}
              className="shrink-0 rounded-full border-white/40 drop-shadow-[0_0_8px_rgba(255,255,255,0.75)]"
            />
            <div className="flex flex-wrap items-baseline gap-2.5 min-w-0">
              <DialogTitle className="font-ticker text-2xl font-extrabold italic bg-gradient-to-br from-white via-cyan-100 to-emerald-200 bg-clip-text text-transparent tracking-tight shrink-0 select-none">
                {row.ticker}
              </DialogTitle>
              <span className="text-sm font-medium text-slate-300 truncate max-w-lg">
                {row.companyName}
              </span>
            </div>
            <span className="rounded-full bg-white/[0.08] border border-white/[0.12] px-2.5 py-0.5 text-[10px] font-bold text-white/80 uppercase tracking-wider shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)]">
              {row.exchange || "HOSE"}
            </span>
            {row.isTop100 && (
              <Badge variant="outline" className="border-amber-300/30 bg-amber-300/10 text-amber-200 text-xs">
                <Crown className="size-3" /> Top 100{row.top100Rank ? ` · #${row.top100Rank}` : ""}
              </Badge>
            )}
          </div>
          <DialogDescription className="sr-only">Hồ sơ chi tiết cổ phiếu {row.ticker}</DialogDescription>
        </DialogHeader>

        {/* 3 Top Important Pillar Cards (Hình 3 style) */}
        <div className="shrink-0 bg-[#070e1a] px-5 py-3 border-b border-white/[0.07]">
          <div className="grid gap-3 sm:grid-cols-3">
            {/* Card 1: Sức mạnh dòng tiền (RS) */}
            <div className="rounded-xl border border-cyan-400/25 bg-cyan-950/20 p-3.5 shadow-[0_0_20px_-8px_rgba(34,211,238,0.25)] flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-cyan-300/80 flex items-center gap-1.5">
                  <Zap className="size-3.5 text-cyan-300" /> Sức mạnh dòng tiền (RS)
                </span>
                <TrendingUp className="size-4 text-cyan-300" />
              </div>
              <div className="mt-2 font-mono text-2xl font-black text-cyan-300">
                RSs {row.rsShort ?? 0} <span className="text-base text-cyan-400/60">· RSm {row.rsMedium ?? 0}</span>
              </div>
              <div className="mt-1.5 flex items-center justify-between text-xs text-slate-300 font-mono">
                <span>RRG: <strong className="text-white">{row.stockRrgState || "—"}</strong></span>
                <span>7D: <b className={(deltaRs7d ?? 0) >= 0 ? "text-up" : "text-down"}>{deltaRs7d == null ? "—" : `${(deltaRs7d ?? 0) >= 0 ? "+" : ""}${deltaRs7d}`}</b> (30D: <b className={(deltaRs30d ?? 0) >= 0 ? "text-up" : "text-down"}>{deltaRs30d == null ? "—" : `${(deltaRs30d ?? 0) >= 0 ? "+" : ""}${deltaRs30d}`}</b>)</span>
              </div>
            </div>

            {/* Card 2: Chất lượng CANSLIM & 4M */}
            <div className="rounded-xl border border-emerald-400/25 bg-emerald-950/20 p-3.5 shadow-[0_0_20px_-8px_rgba(52,211,153,0.25)] flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-300/80 flex items-center gap-1.5">
                  <Target className="size-3.5 text-emerald-300" /> Mô hình CANSLIM & 4M
                </span>
                <ShieldCheck className="size-4 text-emerald-300" />
              </div>
              <div className="mt-2 font-mono text-2xl font-black text-emerald-300">
                CANSLIM {row.canslimScore} <span className="text-base text-amber-300">· 4M {row.score4m}</span>
              </div>
              <div className="mt-1.5 flex items-center justify-between text-xs text-slate-300 font-mono">
                <span>P/E: <strong className="text-white">{formatNumber(row.peTtm)}</strong></span>
                <span>P/B: <strong className="text-white">{formatNumber(row.pbTtm)}</strong></span>
                <span>Vốn hóa: <strong className="text-white">{row.marketCapBillion ? formatMarketCapBillion(row.marketCapBillion) : "—"}</strong></span>
              </div>
            </div>

            {/* Card 3: Rating tổng hợp & Trạng thái */}
            <div className="rounded-xl border border-violet-400/25 bg-violet-950/20 p-3.5 shadow-[0_0_20px_-8px_rgba(167,139,250,0.25)] flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-violet-300/80 flex items-center gap-1.5">
                  <Sparkles className="size-3.5 text-violet-300" /> Rating tổng hợp & Trạng thái
                </span>
                <Radar className="size-4 text-violet-300" />
              </div>
              <div className="mt-2 font-mono text-2xl font-black text-violet-300">
                {row.ratingScore}/100 <span className="text-base font-sans font-bold text-white">· {ratingModel.state}</span>
              </div>
              <div className="mt-1.5 flex items-center justify-between text-xs text-slate-300 font-mono">
                <span>Tiềm năng: <strong className="text-up">{row.pricePotential || "—"}</strong></span>
                <span>RSI(14): <strong className="text-white">{row.rsi14 ?? "—"}</strong></span>
                <span>Beta: <strong className="text-white">{row.beta ?? "—"}</strong></span>
              </div>
            </div>
          </div>
        </div>

        {/* Liquid Glass Navigation Tabs (like Navbar Liquid Pill) */}
        <div className="shrink-0 px-5 pt-3 pb-2 bg-[#080d19]">
          <nav className="inline-flex items-center gap-1.5 p-1 rounded-full bg-[#080c10]/90 border border-white/[0.1] shadow-[0_0_24px_-4px_rgba(176,124,255,0.18),0_0_24px_-4px_rgba(34,201,138,0.18),inset_0_1px_0_0_rgba(255,255,255,0.1)] backdrop-blur-2xl" role="tablist" aria-label="Điều hướng hồ sơ rating">
            <button
              id="rating-tab-overview"
              type="button"
              role="tab"
              aria-selected={topTab === "overview"}
              aria-controls="rating-panel-overview"
              onClick={() => setTopTab("overview")}
              className={cn(
                "group relative flex items-center gap-2 whitespace-nowrap px-4 py-2 text-xs sm:text-sm font-extrabold rounded-full transition-all duration-300 select-none",
                topTab === "overview"
                  ? "bg-gradient-to-r from-emerald-500/25 via-purple-500/20 to-emerald-500/25 text-emerald-300 font-bold border border-emerald-400/50 shadow-[0_0_16px_rgba(176,124,255,0.35),0_0_10px_rgba(34,201,138,0.4),inset_0_1px_0_0_rgba(255,255,255,0.3)]"
                  : "text-slate-300 hover:text-white hover:bg-gradient-to-r hover:from-emerald-500/10 hover:via-purple-500/10 hover:to-transparent hover:border-purple-500/30 border border-transparent"
              )}
            >
              <Radar className="size-4" /> Tổng quan & Động lượng
            </button>
            <button
              id="rating-tab-metrics"
              type="button"
              role="tab"
              aria-selected={topTab === "metrics"}
              aria-controls="rating-panel-metrics"
              onClick={() => setTopTab("metrics")}
              className={cn(
                "group relative flex items-center gap-2 whitespace-nowrap px-4 py-2 text-xs sm:text-sm font-extrabold rounded-full transition-all duration-300 select-none",
                topTab === "metrics"
                  ? "bg-gradient-to-r from-emerald-500/25 via-purple-500/20 to-emerald-500/25 text-emerald-300 font-bold border border-emerald-400/50 shadow-[0_0_16px_rgba(176,124,255,0.35),0_0_10px_rgba(34,201,138,0.4),inset_0_1px_0_0_rgba(255,255,255,0.3)]"
                  : "text-slate-300 hover:text-white hover:bg-gradient-to-r hover:from-emerald-500/10 hover:via-purple-500/10 hover:to-transparent hover:border-purple-500/30 border border-transparent"
              )}
            >
              <Layers3 className="size-4" /> Chỉ số cổ phiếu
            </button>
            <button
              id="rating-tab-history"
              type="button"
              role="tab"
              aria-selected={topTab === "history"}
              aria-controls="rating-panel-history"
              onClick={() => setTopTab("history")}
              className={cn(
                "group relative flex items-center gap-2 whitespace-nowrap px-4 py-2 text-xs sm:text-sm font-extrabold rounded-full transition-all duration-300 select-none",
                topTab === "history"
                  ? "bg-gradient-to-r from-emerald-500/25 via-purple-500/20 to-emerald-500/25 text-emerald-300 font-bold border border-emerald-400/50 shadow-[0_0_16px_rgba(176,124,255,0.35),0_0_10px_rgba(34,201,138,0.4),inset_0_1px_0_0_rgba(255,255,255,0.3)]"
                  : "text-slate-300 hover:text-white hover:bg-gradient-to-r hover:from-emerald-500/10 hover:via-purple-500/10 hover:to-transparent hover:border-purple-500/30 border border-transparent"
              )}
            >
              <LineChart className="size-4" /> Lịch sử Rating
            </button>
          </nav>
        </div>

        {/* Scrollable Content Body with stable min-height to prevent mouse cursor jumping */}
        <div className="flex-1 min-h-[580px] max-h-[75vh] overflow-y-auto p-4 sm:p-5 space-y-4">
          {topTab === "overview" && (
            <div id="rating-panel-overview" role="tabpanel" aria-labelledby="rating-tab-overview" className="space-y-4">
              {/* Git History Accumulation Heatmap (Hình 4) */}
              <AccumulationHeatmap row={row} />

              <div className="grid gap-4 lg:grid-cols-12">
                {/* 4 Core Score Progress Cards */}
                <div className="space-y-3 lg:col-span-5">
                  <div className="grid grid-cols-2 gap-2.5">
                    {scoreCards.map(({ label, value, tone, icon: Icon, description }) => (
                      <div key={label} className="rounded-xl border border-white/[0.07] bg-[#091321] p-3.5">
                        <div className="flex items-center justify-between gap-1">
                          <span className="flex items-center gap-1.5 text-sm font-extrabold text-muted-2">
                            <Icon className="size-4 shrink-0" /> {label}
                          </span>
                          <ScorePill value={value} tone={tone} label={label} description={description} />
                        </div>
                        <div className="mt-3">
                          <AnimatedProgressBar value={value} color={tone === "amber" ? "#fcd34d" : tone === "violet" ? "#a78bfa" : tone === "cyan" ? "#67e8f9" : "#6ee7b7"} />
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Classification & Snapshot details */}
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.07] bg-[#091321] p-3 text-xs">
                    <Badge variant="outline" className="border-cyan-300/25 bg-cyan-300/[0.08] text-cyan-300 text-xs">{row.sector}</Badge>
                    <Badge variant="outline" className={row.ratingScore >= 85 ? "border-up/30 bg-up/10 text-up text-xs" : row.ratingScore >= 70 ? "border-ref/30 bg-ref/10 text-ref text-xs" : "border-down/30 bg-down/10 text-down text-xs"}>
                      {row.ratingScore >= 85 ? "Conviction cao" : row.ratingScore >= 70 ? "Đáng theo dõi" : "Cần thận trọng"}
                    </Badge>
                    <Badge variant="outline" className="border-white/10 bg-white/[0.03] text-muted-2 text-xs">
                      RRG: {row.stockRrgState || "—"}
                    </Badge>
                    {row.asOfDate && <Badge variant="outline" className="border-white/10 bg-white/[0.03] text-muted-2 text-xs">Snapshot {row.asOfDate}</Badge>}
                  </div>
                </div>

                {/* 5-Axis Radar & Dimension Breakdown */}
                <div className="space-y-3 lg:col-span-7">
                  <RatingRadar row={row} />
                </div>
              </div>
            </div>
          )}

          {topTab === "metrics" && (
            <section id="rating-panel-metrics" role="tabpanel" aria-labelledby="rating-tab-metrics" className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#07101a]">
              {/* Sub-tabs with top border like commit b635a4df286096776b4bd68358195b7d60077718 */}
              <div className="overflow-x-auto border-b border-white/[0.08] bg-[#0a1320]">
                <div className="flex min-w-max px-2 pt-2" role="tablist" aria-label="Nhóm dữ liệu rating">
                  {KFSP_GROUPS.map((group) => {
                    const GroupIcon = KFSP_GROUP_ICONS[group.key] || Gauge
                    return (
                      <button
                        key={group.key}
                        type="button"
                        role="tab"
                        aria-selected={activeGroup === group.key}
                        onClick={() => setActiveGroup(group.key)}
                        className={cn(
                          "inline-flex items-center gap-2 rounded-t-lg px-4 py-3 text-sm font-extrabold text-muted-2 transition-colors hover:text-white",
                          activeGroup === group.key && "bg-[#111a29] text-fuchsia-400 shadow-[inset_0_2px_0_rgba(217,70,239,.8)] border-t border-fuchsia-400"
                        )}
                      >
                        <GroupIcon className="size-4 shrink-0" />
                        {group.label}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="p-4 sm:p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="font-extrabold text-white text-base">{activeGroupDefinition.label}</h4>
                    <p className="mt-0.5 text-xs text-muted-2">Hover vào tên chỉ số để xem diễn giải định nghĩa.</p>
                  </div>
                  <Badge variant="outline" className="border-white/10 bg-white/[0.03] text-xs text-muted-2">{activeFields.length} chỉ số</Badge>
                </div>
                <div className="grid gap-px overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.08] sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {activeFields.map((definition) => {
                    const value = metricValue(row, definition.key)
                    const formatted = formatMetric(value, definition)
                    const isLink = definition.format === "link" && /^https?:\/\//i.test(formatted)
                    return (
                      <div key={`${activeGroup}-${definition.providerKey}`} className="min-h-24 bg-[#0a1220] p-4">
                        <MetricLabel definition={definition} className="text-xs font-bold text-muted-2" />
                        {isLink ? (
                          <a href={formatted} target="_blank" rel="noreferrer" className="mt-2.5 flex items-center gap-1 break-all text-sm font-bold text-brand hover:underline">Truy cập <ExternalLink className="size-3.5" /></a>
                        ) : (
                          <div className={cn("mt-2.5 break-words font-mono text-base font-black", metricTone(value, definition))}>{formatted}</div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </section>
          )}

          {topTab === "history" && (
            <div id="rating-panel-history" role="tabpanel" aria-labelledby="rating-tab-history" className="space-y-4">
              <RatingHistoryChart row={row} />
              {row.scoreHistory.length > 0 && (
                <div className="rounded-xl border border-white/[0.07] bg-[#07111f] p-4 sm:p-5">
                  <h4 className="font-extrabold text-white text-base mb-3">Bảng lịch sử snapshot</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left font-mono text-xs sm:text-sm">
                      <thead>
                        <tr className="border-b border-white/10 text-muted-2 text-xs">
                          <th className="pb-2.5 font-bold">Ngày snapshot</th>
                          <th className="pb-2.5 font-bold text-center">Rating</th>
                          <th className="pb-2.5 font-bold text-center">CANSLIM</th>
                          <th className="pb-2.5 font-bold text-center">4M</th>
                          <th className="pb-2.5 font-bold text-center">RSs</th>
                          <th className="pb-2.5 font-bold text-center">RSm</th>
                          <th className="pb-2.5 font-bold text-center">RRG</th>
                          <th className="pb-2.5 font-bold text-center">RSI</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5 text-white">
                        {row.scoreHistory.map((item) => (
                          <tr key={item.asOfDate} className="hover:bg-white/[0.02]">
                            <td className="py-3 font-sans font-medium text-muted-2">{item.asOfDate}</td>
                            <td className="py-3 text-center font-black text-brand">{item.ratingScore ?? "—"}</td>
                            <td className="py-3 text-center text-emerald-300 font-bold">{item.canslimScore ?? "—"}</td>
                            <td className="py-3 text-center text-amber-300 font-bold">{item.score4m ?? "—"}</td>
                            <td className="py-3 text-center text-cyan-300 font-bold">{item.rsShort ?? "—"}</td>
                            <td className="py-3 text-center text-violet-300 font-bold">{item.rsMedium ?? "—"}</td>
                            <td className="py-3 text-center font-sans text-xs">{item.stockRrgState || "—"}</td>
                            <td className="py-3 text-center">{item.rsi14 ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Compact Footer */}
        <div className="shrink-0 flex flex-col gap-2 border-t border-white/[0.07] bg-[#08111f] px-5 py-3 text-xs sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2 text-muted-2 text-xs leading-relaxed">
            <Info className="mt-0.5 size-3.5 shrink-0 text-ref" />
            <span>Dữ liệu snapshot từ KFSP/Supabase. State radar là heuristic QeoIndex minh bạch, không phải khuyến nghị đầu tư.</span>
          </div>
          <Link href={`/research/${row.ticker.toLowerCase()}`} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-brand/30 bg-brand/10 px-3.5 py-2 text-xs font-bold text-brand transition-colors hover:bg-brand/15">
            Mở nghiên cứu <ExternalLink className="size-3.5" />
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function InsightsDashboard({ data }: { data: InsightsDashboardData }) {
  const [universeFilter, setUniverseFilter] = useState<"top100" | "all">("top100")
  const [sectorFilter, setSectorFilter] = useState("all")
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<{ key: RatingSortKey; direction: SortDirection }>({ key: "ratingScore", direction: "desc" })
  const [selectedRating, setSelectedRating] = useState<InsightsRatingRow | null>(null)
  const [expandedSectors, setExpandedSectors] = useState<Set<string>>(new Set())

  const quote = data.vnindex
  const positive = (quote?.changePercent ?? 0) >= 0
  const breadthTotal = (quote?.advances ?? 0) + (quote?.declines ?? 0)
  const sectors = useMemo(() => data.sectorSummaries.map((row) => row.sector).sort((a, b) => a.localeCompare(b, "vi")), [data.sectorSummaries])

  const filteredRatings = useMemo(() => {
    const normalized = query.trim().toUpperCase()
    return data.ratings
      .filter((row) => {
        if (universeFilter === "top100" && !row.isTop100) return false
        if (sectorFilter !== "all" && row.sector !== sectorFilter) return false
        return !normalized || row.ticker.includes(normalized) || row.companyName.toUpperCase().includes(normalized) || row.sector.toUpperCase().includes(normalized)
      })
      .sort((left, right) => compareRatingValues(left[sort.key], right[sort.key], sort.direction) || left.ticker.localeCompare(right.ticker))
  }, [data.ratings, query, sectorFilter, sort, universeFilter])

  const showSectorGroups = universeFilter === "all" && sectorFilter === "all" && !query.trim()

  const sortedSectorSummaries = useMemo(() => [...data.sectorSummaries]
    .sort((left, right) => compareRatingValues(sectorSortValue(left, sort.key), sectorSortValue(right, sort.key), sort.direction) || left.sector.localeCompare(right.sector, "vi")), [data.sectorSummaries, sort])

  // Sector child stocks map
  const sectorChildStocksMap = useMemo(() => {
    const map = new Map<string, InsightsRatingRow[]>()
    for (const sector of sectors) {
      const children = data.ratings
        .filter((row) => row.sector === sector)
        .sort((left, right) => compareRatingValues(left[sort.key], right[sort.key], sort.direction) || left.ticker.localeCompare(right.ticker))
      map.set(sector, children)
    }
    return map
  }, [data.ratings, sectors, sort])

  const handleSort = (key: RatingSortKey) => {
    setSort((current) => current.key === key
      ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
      : { key, direction: "desc" })
  }

  const toggleSector = (sector: string) => {
    setExpandedSectors((prev) => {
      const next = new Set(prev)
      if (next.has(sector)) next.delete(sector)
      else next.add(sector)
      return next
    })
  }

  return (
    <div className="min-h-screen bg-background font-ticker text-foreground">
      <TopNav />
      <main className="mx-auto w-full max-w-[1880px] px-3 pb-16 pt-8 sm:px-5 lg:px-6">
        <section className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-muted-2">
              <CalendarDays className="size-4 text-brand" />
              {DATE_FORMAT.format(new Date(data.generatedAt))}
              <Badge variant="outline" className="border-up/25 bg-up/10 text-up">Authenticated insights</Badge>
            </div>
            <h1 className="mt-4 text-4xl font-extrabold tracking-[-0.04em] text-white sm:text-5xl lg:text-6xl">
              <SoftBlurIn stagger={18}>Insights thị trường</SoftBlurIn>
            </h1>
            <p className="mt-4 max-w-3xl text-base font-medium leading-7 text-muted-2 sm:text-lg">
              Tín hiệu đủ rõ để hành động, trước khi bảng giá đổi màu.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-panel px-4 py-3 text-sm text-muted-2">
            <Database className="size-4 text-brand" />
            Supabase ratings · Notion research · Market feeds
          </div>
        </section>

        <section className="mt-8 grid gap-4 xl:grid-cols-[1.65fr_1fr]">
          <Card className="border border-white/[0.07] bg-panel/95 py-0 ring-0">
            <CardHeader className="flex-row items-start justify-between border-b border-white/[0.06] p-6">
              <div>
                <CardTitle className="flex items-center gap-2 text-xl font-extrabold text-white"><LineChart className="size-5 text-brand" /> Tổng quan VNIndex</CardTitle>
                <CardDescription className="mt-1 text-sm text-muted-2">Chỉ số thị trường · HOSE</CardDescription>
              </div>
              <Badge variant="outline" className="border-white/10 bg-white/[0.03] text-muted-2">5 phút</Badge>
            </CardHeader>
            <CardContent className="p-6">
              <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
                <span className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl">{quote ? quote.value.toLocaleString("vi-VN", { minimumFractionDigits: 2 }) : "—"}</span>
                <span className={cn("mb-1 flex items-center gap-1 text-lg font-extrabold", positive ? "text-up" : "text-down")}>
                  {positive ? <TrendingUp className="size-5" /> : <TrendingDown className="size-5" />}
                  {quote ? `${quote.change >= 0 ? "+" : ""}${quote.change.toFixed(2)} (${formatPercent(quote.changePercent)})` : "Đang cập nhật"}
                </span>
              </div>
              <div className="mt-5 overflow-hidden rounded-xl border border-white/[0.06] bg-cell/70 px-3 pt-3">
                <LineSparkline values={data.vnindexSeries} positive={positive} />
                <div className="flex justify-between px-2 pb-3 text-xs font-semibold text-muted">09:00 <span>10:00</span><span>11:30</span><span>13:00</span>14:45</div>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
                <span className="text-muted-2">GTGD <strong className="ml-2 text-base text-white">{formatTradedValue(quote?.valueTraded)}</strong></span>
                <span className="text-muted-2">Nguồn: TradingView snapshot + DNSE/VPS</span>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-white/[0.07] bg-panel/95 py-0 ring-0">
            <CardHeader className="border-b border-white/[0.06] p-6">
              <CardTitle className="flex items-center gap-2 text-xl font-extrabold text-white"><Sparkles className="size-5 text-cyan-300" /> Market pulse</CardTitle>
              <CardDescription className="text-muted-2">Kết hợp market feed và luận điểm Notion</CardDescription>
            </CardHeader>
            <CardContent className="flex h-full flex-col p-6">
              <Badge variant="outline" className={cn("h-7 px-3", positive ? "border-up/30 bg-up/10 text-up" : "border-down/30 bg-down/10 text-down")}>{data.marketPulse.label}</Badge>
              <h2 className="mt-5 text-2xl font-extrabold leading-8 text-white">{data.marketPulse.headline}</h2>
              <p className="mt-4 text-sm font-medium leading-6 text-muted-2">{data.marketPulse.detail}</p>
              <dl className="mt-6 grid gap-3 text-sm">
                <div className="flex items-center justify-between gap-4 border-b border-white/[0.06] pb-3"><dt className="text-muted-2">Vùng hỗ trợ</dt><dd className="font-bold text-up">{data.marketPulse.support}</dd></div>
                <div className="flex items-center justify-between gap-4 border-b border-white/[0.06] pb-3"><dt className="text-muted-2">Kháng cự</dt><dd className="font-bold text-ref">{data.marketPulse.resistance}</dd></div>
                <div className="flex items-center justify-between gap-4"><dt className="text-muted-2">Risk score</dt><dd className="font-bold text-white">{data.marketPulse.riskScore} / 100</dd></div>
              </dl>
              <div className="mt-3"><AnimatedProgressBar value={data.marketPulse.riskScore} color={data.marketPulse.riskScore > 55 ? "#ff4757" : "#22c98a"} barClassName="shadow-[0_0_18px_currentColor]" /></div>
            </CardContent>
          </Card>
        </section>

        <section aria-label="Chỉ số thị trường" className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={ChartNoAxesCombined} label="Độ rộng thị trường" value={breadthTotal ? `${quote?.advances ?? 0} / ${quote?.declines ?? 0}` : "—"} detail="Mã tăng / mã giảm trên HOSE" tone={positive ? "up" : "down"} />
          <MetricCard icon={Activity} label="Thanh khoản" value={formatTradedValue(quote?.valueTraded)} detail={quote?.valueChangePercent == null ? "So sánh phiên trước đang cập nhật" : `${formatPercent(quote.valueChangePercent)} so với phiên trước`} />
          <MetricCard icon={Gauge} label="Risk score" value={`${data.marketPulse.riskScore} / 100`} detail={data.marketPulse.riskScore <= 35 ? "Thấp · xu hướng ổn định" : data.marketPulse.riskScore <= 60 ? "Trung bình · cần chọn lọc" : "Cao · ưu tiên phòng thủ"} tone={data.marketPulse.riskScore > 60 ? "down" : "up"} />
          <MetricCard icon={ShieldCheck} label="Nguồn dữ liệu" value="3 lớp" detail="Supabase · Notion · market providers" />
        </section>

        <section className="mt-10">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
            <div>
              <div className="text-xs font-extrabold uppercase tracking-[0.18em] text-brand">Signal ranking</div>
              <h2 className="mt-2 text-2xl font-extrabold text-white sm:text-3xl">Top cổ phiếu rating score</h2>
              <p className="mt-2 text-sm font-medium text-muted-2">Điểm tổng hợp từ giá, dòng tiền, kỹ thuật và cơ bản.</p>
            </div>
            <Badge variant="outline" className={cn("h-7 px-3", data.ratingMode === "supabase" ? "border-up/30 bg-up/10 text-up" : "border-ref/30 bg-ref/10 text-ref")}>
              {data.ratingMode === "supabase" ? "Supabase live" : "Dữ liệu mẫu UI"}
            </Badge>
          </div>

          <Card className="mt-5 border border-white/[0.07] bg-panel/95 py-0 ring-0">
            <CardHeader className="flex-col gap-4 border-b border-white/[0.06] p-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex w-full flex-col gap-3 sm:flex-row xl:w-auto">
                <div className="flex rounded-lg border border-white/10 bg-cell p-1">
                  {([ ["top100", "Top 100"], ["all", "Tất cả"] ] as const).map(([value, label]) => (
                    <Button key={value} type="button" variant="ghost" size="sm" onClick={() => setUniverseFilter(value)} className={cn("flex-1 text-muted-2 sm:flex-none text-xs sm:text-sm font-bold", universeFilter === value && "bg-brand/15 text-brand hover:bg-brand/20 hover:text-brand")}>
                      {value === "top100" && <Crown className="size-3.5 text-amber-300" />}{label}
                    </Button>
                  ))}
                </div>
                <Select value={sectorFilter} onValueChange={(value) => setSectorFilter(value ?? "all")}>
                  <SelectTrigger aria-label="Lọc theo ngành" className="h-10 w-full min-w-64 border-white/10 bg-cell px-3 text-sm sm:text-base font-bold text-white hover:bg-white/[0.05] sm:w-80">
                    <SelectValue>{sectorFilter === "all" ? "Ngành: Tất cả ngành" : `Ngành: ${sectorFilter}`}</SelectValue>
                  </SelectTrigger>
                  <SelectContent align="start" className="max-h-96 border border-white/10 bg-[#111724] p-1 font-ticker text-sm sm:text-base text-white shadow-2xl">
                    <SelectGroup>
                      <SelectLabel className="px-2 py-2 font-bold uppercase tracking-wider text-muted-2 text-xs">Danh sách ngành</SelectLabel>
                      <SelectItem value="all" className="px-3 py-2.5 text-sm sm:text-base focus:bg-brand/15 focus:text-brand">Tất cả ngành</SelectItem>
                      {sectors.map((sector) => <SelectItem key={sector} value={sector} className="px-3 py-2.5 text-sm sm:text-base focus:bg-brand/15 focus:text-brand">Ngành: {sector}</SelectItem>)}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              <div className="relative w-full lg:w-80">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm mã hoặc tên..." aria-label="Tìm mã cổ phiếu" className="h-10 border-white/10 bg-cell pl-9 text-sm sm:text-base text-white placeholder:text-muted focus-visible:border-brand/50 focus-visible:ring-brand/20" />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table className="w-full table-fixed font-ticker">
                <colgroup><col className="w-[20%]" /><col className="w-[8%]" /><col className="w-[8%]" /><col className="w-[7%]" /><col className="w-[9%]" /><col className="w-[6%]" /><col className="w-[6%]" /><col className="w-[10%]" /><col className="w-[8%]" /><col className="w-[8%]" /><col className="w-[10%]" /></colgroup>
                <TableHeader className="sticky top-0 z-20 bg-[#05090f]">
                  <TableRow className="border-white/[0.08] hover:bg-transparent">
                    <SortableHead sortKey="ticker" activeKey={sort.key} direction={sort.direction} onSort={handleSort} label="# · Cổ phiếu / Ngành" className="h-14 px-2 text-xs font-extrabold uppercase text-muted-2" />
                    <SortableHead sortKey="price" activeKey={sort.key} direction={sort.direction} onSort={handleSort} definition={overviewField("price")} className="px-1 text-xs font-extrabold uppercase text-muted-2" />
                    <SortableHead sortKey="canslimScore" activeKey={sort.key} direction={sort.direction} onSort={handleSort} definition={overviewField("kfsp_canslim_score")} className="px-1 text-xs font-extrabold uppercase text-emerald-300" />
                    <SortableHead sortKey="score4m" activeKey={sort.key} direction={sort.direction} onSort={handleSort} definition={overviewField("kfsp_score_4m")} className="px-1 text-xs font-extrabold uppercase text-amber-300" />
                    <SortableHead sortKey="pricePotential" activeKey={sort.key} direction={sort.direction} onSort={handleSort} definition={overviewField("kfsp_price_potential")} className="px-1 text-xs font-extrabold uppercase text-ref" />
                    <SortableHead sortKey="rsShort" activeKey={sort.key} direction={sort.direction} onSort={handleSort} definition={overviewField("rs_short")} className="px-1 text-xs font-extrabold uppercase text-cyan-300" />
                    <SortableHead sortKey="rsMedium" activeKey={sort.key} direction={sort.direction} onSort={handleSort} definition={overviewField("rs_medium")} className="px-1 text-xs font-extrabold uppercase text-violet-300" />
                    <SortableHead sortKey="stockRrgState" activeKey={sort.key} direction={sort.direction} onSort={handleSort} definition={showSectorGroups ? RRG_FIELD_DEFINITIONS.sectorRrgState : RRG_FIELD_DEFINITIONS.stockRrgState} className="px-1 text-xs font-extrabold uppercase text-cyan-300" />
                    <SortableHead sortKey="weeklyChangePercent" activeKey={sort.key} direction={sort.direction} onSort={handleSort} definition={overviewField("weekly_change_pct")} className="px-1 text-xs font-extrabold uppercase text-cyan-200" />
                    <SortableHead sortKey="monthlyChangePercent" activeKey={sort.key} direction={sort.direction} onSort={handleSort} definition={overviewField("monthly_change_pct")} className="px-1 text-xs font-extrabold uppercase text-violet-200" />
                    <SortableHead sortKey="ratingScore" activeKey={sort.key} direction={sort.direction} onSort={handleSort} label="Rating tổng hợp" className="px-1 text-xs font-extrabold uppercase text-brand" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {showSectorGroups && sortedSectorSummaries.map((sectorSummary, index) => {
                    const isExpanded = expandedSectors.has(sectorSummary.sector)
                    const SectorIcon = getSectorIcon(sectorSummary.sector)
                    const childRows = sectorChildStocksMap.get(sectorSummary.sector) || []
                    return (
                      <Fragment key={sectorSummary.sector}>
                        {/* Expandable Sector Parent Row */}
                        <TableRow
                          tabIndex={0}
                          role="button"
                          aria-expanded={isExpanded}
                          aria-controls={`sector-children-${index}`}
                          aria-label={`Nhóm ngành ${sectorSummary.sector}, ${sectorSummary.stockCount} mã, ${isExpanded ? "đang mở rộng" : "đang thu gọn"}`}
                          onClick={() => toggleSector(sectorSummary.sector)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault()
                              toggleSector(sectorSummary.sector)
                            }
                          }}
                          className={cn(
                            "group cursor-pointer border-white/[0.07] bg-[#07101a]/60 outline-none transition-colors hover:bg-cyan-300/[0.05] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-cyan-300/50",
                            isExpanded && "bg-[#0b1626]/80 border-cyan-300/20"
                          )}
                        >
                          <TableCell className="px-2 py-3.5">
                            <div className="flex items-center gap-2">
                              <span className="flex size-6 shrink-0 items-center justify-center text-muted-2 group-hover:text-cyan-300 transition-colors">
                                {isExpanded ? <ChevronDown className="size-4 text-cyan-300" /> : <ChevronRight className="size-4" />}
                              </span>
                              <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-cyan-300/15 bg-cyan-300/[0.06] font-mono text-xs font-bold text-cyan-300">
                                {String(index + 1).padStart(2, "0")}
                              </span>
                              <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-violet-300/25 bg-violet-300/10 text-violet-300">
                                <SectorIcon className="size-4" />
                              </span>
                              <div className="min-w-0">
                                <div className="truncate text-sm sm:text-base font-extrabold uppercase text-white group-hover:text-cyan-200">
                                  {sectorSummary.sector}
                                </div>
                                <div className="mt-0.5 truncate text-xs text-muted-2">
                                  Σ {sectorSummary.stockCount} mã ({childRows.length} nạp) · Top100 {sectorSummary.top100Count} · Vốn hóa Σ {formatMarketCapBillion(sectorSummary.totalMarketCapBillion)}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          {/* Bỏ hẳn Giá trung bình khỏi sector parent */}
                          <TableCell className="px-1 text-center font-mono text-xs text-muted-2 font-bold">—</TableCell>
                          <TableCell className="px-1 text-center">
                            <ScorePill value={sectorSummary.averageCanslimScore} tone="emerald" icon={Target} label="CANSLIM TB ngành" description="Điểm CANSLIM trung bình của ngành" />
                          </TableCell>
                          <TableCell className="px-1 text-center">
                            <ScorePill value={sectorSummary.averageScore4m} tone="amber" icon={Bolt} label="4M TB ngành" description="Điểm 4M trung bình của ngành" />
                          </TableCell>
                          <TableCell className="px-1 text-center">
                            <Badge variant="outline" className="gap-1 border-up/25 bg-up/[0.08] px-1.5 text-xs font-bold text-up">
                              <TrendingUp className="size-3.5" />{Math.round(sectorSummary.pricePotentialUpCount / Math.max(1, sectorSummary.stockCount) * 100)}% tăng
                            </Badge>
                          </TableCell>
                          <TableCell className="px-1 text-center">
                            <ScorePill value={sectorSummary.averageRsShort} tone="cyan" icon={Zap} label="RSs TB ngành" description={overviewField("rs_short").description} />
                          </TableCell>
                          <TableCell className="px-1 text-center">
                            <ScorePill value={sectorSummary.averageRsMedium} tone="violet" icon={Radar} label="RSm TB ngành" description={overviewField("rs_medium").description} />
                          </TableCell>
                          <TableCell className="px-1 text-center"><RrgBadge value={sectorSummary.dominantRrgState} /></TableCell>
                          <TableCell className="px-1 text-center">
                            <span className={cn("inline-flex items-center gap-1 font-mono text-xs sm:text-sm font-bold", (sectorSummary.averageWeeklyChangePercent || 0) >= 0 ? "text-up" : "text-down")}>
                              <CalendarDays className="size-3.5" />{formatPercent(sectorSummary.averageWeeklyChangePercent)}
                            </span>
                          </TableCell>
                          <TableCell className="px-1 text-center">
                            <span className={cn("inline-flex items-center gap-1 font-mono text-xs sm:text-sm font-bold", (sectorSummary.averageMonthlyChangePercent || 0) >= 0 ? "text-up" : "text-down")}>
                              <CalendarRange className="size-3.5" />{formatPercent(sectorSummary.averageMonthlyChangePercent)}
                            </span>
                          </TableCell>
                          <TableCell className="px-1 text-center">
                            <strong className={cn("inline-flex size-9 sm:size-10 items-center justify-center rounded-lg border font-mono text-base font-black", (sectorSummary.averageRatingScore || 0) >= 70 ? "border-up/30 bg-up/10 text-up" : "border-ref/30 bg-ref/10 text-ref")}>
                              {sectorSummary.averageRatingScore == null ? "—" : Math.round(sectorSummary.averageRatingScore)}
                            </strong>
                          </TableCell>
                        </TableRow>

                        {/* Child Rows when expanded */}
                        {isExpanded && childRows.length === 0 && (
                          <TableRow className="border-white/[0.04] bg-[#050b14]/50">
                            <TableCell colSpan={11} className="py-3 pl-12 text-xs italic text-muted-2">
                              Chưa có mã chi tiết nạp sẵn từ dataset Top 500 / Top 100 cho ngành này.
                            </TableCell>
                          </TableRow>
                        )}

                        {isExpanded && childRows.map((child) => {
                          const ChildSectorIcon = getSectorIcon(child.sector)
                          const childPositive = (child.changePercent ?? 0) > 0
                          const childTone = (child.changePercent ?? 0) > 0 ? "up" : (child.changePercent ?? 0) < 0 ? "down" : "ref"
                          return (
                            <TableRow
                              key={`${sectorSummary.sector}-${child.ticker}-${child.asOfDate}`}
                              tabIndex={0}
                              role="button"
                              aria-label={`Mở hồ sơ rating ${child.ticker}`}
                              onClick={() => setSelectedRating(child)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault()
                                  setSelectedRating(child)
                                }
                              }}
                              className="group cursor-pointer border-white/[0.045] bg-[#040810]/70 outline-none transition-all hover:bg-cyan-300/[0.04] hover:shadow-[inset_3px_0_0_rgba(103,232,249,.7),0_0_24px_-16px_rgba(103,232,249,.7)] focus-visible:bg-cyan-300/[0.04] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-cyan-300/50"
                            >
                              <TableCell className="px-2 py-3 pl-7 sm:pl-9">
                                <RatingTooltip row={child}>
                                  <div className="relative flex items-center gap-2">
                                    {/* Connector Line */}
                                    <div className="pointer-events-none absolute -left-4 top-1/2 -mt-2.5 h-5 w-3 rounded-bl-sm border-b-2 border-l-2 border-cyan-500/30" />
                                    <StockLogo symbol={child.ticker} size={34} className="shrink-0 rounded-full group-hover:shadow-[0_0_18px_-4px_rgba(103,232,249,.75)]" />
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-1 font-ticker text-[16px] font-extrabold leading-none tracking-tight text-white group-hover:text-cyan-200">
                                        {child.ticker}{child.isTop100 && <Crown className="size-3 text-amber-300" />}
                                      </div>
                                      <div className="mt-1 flex items-center gap-1 text-[11px] font-bold uppercase text-cyan-300/80">
                                        <ChildSectorIcon className="size-3 shrink-0" />
                                        <span className="truncate">{child.sector}</span>
                                      </div>
                                    </div>
                                  </div>
                                </RatingTooltip>
                              </TableCell>
                              <TableCell className="px-1 text-center">
                                <div className={cn("font-mono text-[14px] font-bold leading-tight tracking-tight", childPositive ? "text-up" : (child.changePercent ?? 0) < 0 ? "text-down" : "text-ref")}>
                                  {formatPrice(child.price)}
                                </div>
                                <div className="mt-1 flex justify-center">
                                  <MarketChangePill value={child.changePercent} tone={childTone} compact />
                                </div>
                              </TableCell>
                              <TableCell className="px-1 text-center">
                                <ScorePill value={child.canslimScore} tone="emerald" icon={Target} label="Điểm CANSLIM" description={overviewField("kfsp_canslim_score").description} />
                              </TableCell>
                              <TableCell className="px-1 text-center">
                                <ScorePill value={child.score4m} tone="amber" icon={Bolt} label="Điểm 4M" description={overviewField("kfsp_score_4m").description} />
                              </TableCell>
                              <TableCell className="px-1 text-center">
                                <Badge variant="outline" className={cn("gap-1 border-white/10 bg-white/[0.03] px-1.5 text-xs font-bold", child.pricePotential?.startsWith("Tăng") ? "text-up" : child.pricePotential?.startsWith("Giảm") ? "text-down" : "text-ref")}>
                                  {child.pricePotential?.startsWith("Giảm") ? <TrendingDown className="size-3.5" /> : <TrendingUp className="size-3.5" />}{child.pricePotential || "—"}
                                </Badge>
                              </TableCell>
                              <TableCell className="px-1 text-center">
                                <ScorePill value={child.rsShort ?? child.scoreComponents.momentum} tone="cyan" icon={Zap} label="RSs" description={overviewField("rs_short").description} />
                              </TableCell>
                              <TableCell className="px-1 text-center">
                                <ScorePill value={child.rsMedium ?? child.scoreComponents.moneyFlow} tone="violet" icon={Radar} label="RSm" description={overviewField("rs_medium").description} />
                              </TableCell>
                              <TableCell className="px-1 text-center"><RrgBadge value={child.stockRrgState} /></TableCell>
                              <TableCell className="px-1 text-center">
                                <span className={cn("inline-flex items-center gap-1 font-mono text-xs sm:text-sm font-bold", metricTone(child.weeklyChangePercent, overviewField("weekly_change_pct")))}>
                                  <CalendarDays className="size-3.5" />{formatPercent(child.weeklyChangePercent)}
                                </span>
                              </TableCell>
                              <TableCell className="px-1 text-center">
                                <span className={cn("inline-flex items-center gap-1 font-mono text-xs sm:text-sm font-bold", metricTone(child.monthlyChangePercent, overviewField("monthly_change_pct")))}>
                                  <CalendarRange className="size-3.5" />{formatPercent(child.monthlyChangePercent)}
                                </span>
                              </TableCell>
                              <TableCell className="px-1 text-center">
                                <div className="flex items-center justify-center gap-1">
                                  <strong className={cn("flex size-9 sm:size-10 items-center justify-center rounded-lg border font-mono text-base font-black", child.ratingScore >= 80 ? "border-up/35 bg-up/10 text-up" : child.ratingScore >= 65 ? "border-ref/35 bg-ref/10 text-ref" : "border-down/35 bg-down/10 text-down")}>
                                    {child.ratingScore}
                                  </strong>
                                  <ArrowRight className="size-3.5 text-muted transition-transform group-hover:translate-x-1 group-hover:text-cyan-300" />
                                </div>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </Fragment>
                    )
                  })}
                  {!showSectorGroups && filteredRatings.map((row, index) => {
                    const SectorIcon = getSectorIcon(row.sector)
                    const rowPositive = (row.changePercent ?? 0) > 0
                    const rowTone = (row.changePercent ?? 0) > 0 ? "up" : (row.changePercent ?? 0) < 0 ? "down" : "ref"
                    return (
                      <TableRow
                        key={`${row.ticker}-${row.asOfDate}`}
                        tabIndex={0}
                        role="button"
                        aria-label={`Mở hồ sơ rating ${row.ticker}`}
                        onClick={() => setSelectedRating(row)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault()
                            setSelectedRating(row)
                          }
                        }}
                        className="group cursor-pointer border-white/[0.065] bg-[#07101a]/35 outline-none transition-all hover:bg-cyan-300/[0.035] hover:shadow-[inset_3px_0_0_rgba(103,232,249,.7),0_0_24px_-16px_rgba(103,232,249,.7)] focus-visible:bg-cyan-300/[0.04] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-cyan-300/50"
                      >
                        <TableCell className="px-2 py-3.5">
                          <RatingTooltip row={row}>
                            <div className="flex items-center gap-2">
                              <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-white/[0.07] bg-white/[0.025] font-mono text-xs font-bold text-muted">{String(index + 1).padStart(2, "0")}</span>
                              <StockLogo symbol={row.ticker} size={36} className="shrink-0 rounded-full group-hover:shadow-[0_0_20px_-5px_rgba(103,232,249,.75)]" />
                              <div className="min-w-0">
                                <div className="flex items-center gap-1 font-ticker text-[16px] font-extrabold leading-none tracking-tight text-white group-hover:text-cyan-200">
                                  {row.ticker}{row.isTop100 && <Crown className="size-3 text-amber-300" />}
                                </div>
                                <div className="mt-1 flex items-center gap-1 text-[11px] font-bold uppercase text-cyan-300/80">
                                  <SectorIcon className="size-3 shrink-0" />
                                  <span className="truncate">{row.sector}</span>
                                </div>
                              </div>
                            </div>
                          </RatingTooltip>
                        </TableCell>
                        <TableCell className="px-1 text-center">
                          <div className={cn("font-mono text-[14px] font-bold leading-tight tracking-tight", rowPositive ? "text-up" : (row.changePercent ?? 0) < 0 ? "text-down" : "text-ref")}>
                            {formatPrice(row.price)}
                          </div>
                          <div className="mt-1 flex justify-center">
                            <MarketChangePill value={row.changePercent} tone={rowTone} compact />
                          </div>
                        </TableCell>
                        <TableCell className="px-1 text-center">
                          <ScorePill value={row.canslimScore} tone="emerald" icon={Target} label="Điểm CANSLIM" description={overviewField("kfsp_canslim_score").description} />
                        </TableCell>
                        <TableCell className="px-1 text-center">
                          <ScorePill value={row.score4m} tone="amber" icon={Bolt} label="Điểm 4M" description={overviewField("kfsp_score_4m").description} />
                        </TableCell>
                        <TableCell className="px-1 text-center">
                          <Badge variant="outline" className={cn("gap-1 border-white/10 bg-white/[0.03] px-1.5 text-xs font-bold", row.pricePotential?.startsWith("Tăng") ? "text-up" : row.pricePotential?.startsWith("Giảm") ? "text-down" : "text-ref")}>
                            {row.pricePotential?.startsWith("Giảm") ? <TrendingDown className="size-3.5" /> : <TrendingUp className="size-3.5" />}{row.pricePotential || "—"}
                          </Badge>
                        </TableCell>
                        <TableCell className="px-1 text-center">
                          <ScorePill value={row.rsShort ?? row.scoreComponents.momentum} tone="cyan" icon={Zap} label="RSs" description={overviewField("rs_short").description} />
                        </TableCell>
                        <TableCell className="px-1 text-center">
                          <ScorePill value={row.rsMedium ?? row.scoreComponents.moneyFlow} tone="violet" icon={Radar} label="RSm" description={overviewField("rs_medium").description} />
                        </TableCell>
                        <TableCell className="px-1 text-center"><RrgBadge value={row.stockRrgState} /></TableCell>
                        <TableCell className="px-1 text-center">
                          <span className={cn("inline-flex items-center gap-1 font-mono text-xs sm:text-sm font-bold", metricTone(row.weeklyChangePercent, overviewField("weekly_change_pct")))}>
                            <CalendarDays className="size-3.5" />{formatPercent(row.weeklyChangePercent)}
                          </span>
                        </TableCell>
                        <TableCell className="px-1 text-center">
                          <span className={cn("inline-flex items-center gap-1 font-mono text-xs sm:text-sm font-bold", metricTone(row.monthlyChangePercent, overviewField("monthly_change_pct")))}>
                            <CalendarRange className="size-3.5" />{formatPercent(row.monthlyChangePercent)}
                          </span>
                        </TableCell>
                        <TableCell className="px-1 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <strong className={cn("flex size-9 sm:size-10 items-center justify-center rounded-lg border font-mono text-base font-black", row.ratingScore >= 80 ? "border-up/35 bg-up/10 text-up" : row.ratingScore >= 65 ? "border-ref/35 bg-ref/10 text-ref" : "border-down/35 bg-down/10 text-down")}>
                              {row.ratingScore}
                            </strong>
                            <ArrowRight className="size-3.5 text-muted transition-transform group-hover:translate-x-1 group-hover:text-cyan-300" />
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                  {!showSectorGroups && !filteredRatings.length && <TableRow><TableCell colSpan={11} className="h-32 text-center text-sm text-muted-2">Không có mã phù hợp với bộ lọc.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
            <div className="flex flex-col gap-2 border-t border-white/[0.06] px-4 py-4 text-xs font-medium text-muted-2 sm:flex-row sm:items-center sm:justify-between">
              <span>{showSectorGroups ? <>Hiển thị <strong className="text-white">{sortedSectorSummaries.length}</strong> nhóm ngành · click dòng hoặc icon mở rộng để xem chi tiết mã</> : <>Hiển thị <strong className="text-white">{filteredRatings.length}</strong> / {data.ratings.length} mã</>}</span>
              <span>{data.ratingMessage}</span>
            </div>
          </Card>
        </section>

        <section className="mt-10">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="text-xs font-extrabold uppercase tracking-[0.18em] text-cyan-300">Research workspace</div>
              <h2 className="mt-2 text-2xl font-extrabold text-white sm:text-3xl">Khám phá Insights chuyên sâu</h2>
              <p className="mt-2 text-sm font-medium text-muted-2">Tổng hợp trực tiếp từ các read-model hiện có của `/research`.</p>
            </div>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {data.modules.map((module) => <ModuleCard key={module.key} module={module} />)}
          </div>
        </section>
      </main>
      <RatingDialog key={selectedRating?.ticker ?? "closed"} row={selectedRating} onOpenChange={(open) => { if (!open) setSelectedRating(null) }} />
    </div>
  )
}
