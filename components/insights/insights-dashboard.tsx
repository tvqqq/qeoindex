"use client"

import Link from "next/link"
import { Fragment, useEffect, useMemo, useState } from "react"
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
  GripVertical,
  HeartPulse,
  Info,
  Landmark,
  Layers3,
  LineChart,
  Maximize2,
  PieChart,
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
  X,
  Zap,
} from "lucide-react"

import AnimatedProgressBar from "@/components/smoothui/animated-progress-bar"
import SoftBlurIn from "@/components/smoothui/soft-blur-in"
import InsightsTransition from "@/components/smoothui/insights-transition"
import { MarketChangePill } from "@/components/market-change-pill"
import { TtaiDashboard } from "@/components/insights/ttai-dashboard"
import { StockLogo } from "@/components/stock-logo"
import { TopNav } from "@/components/top-nav"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
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
} from "@/supabase/functions/_shared/kfsp-catalog"

const MODULE_ICONS = {
  scanner: Radar,
  signals: Zap,
  fa: BarChart3,
  research: BrainCircuit,
} as const

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
    <div className="rounded-2xl border border-white/[0.07] bg-[#07111f] p-4 sm:p-5 font-ticker">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.06] pb-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-violet-500/20 bg-violet-500/10">
            <Radar className="size-4 text-violet-300" />
          </span>
          <div className="min-w-0">
            <h4 className="text-base font-extrabold text-white">QeoIndex state radar</h4>
            <p className="mt-0.5 text-xs text-muted-2">Heuristic minh bạch từ CANSLIM, 4M, RS, RRG, biến động, RSI, beta.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 text-xs font-bold text-muted-2">
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
 * Uses 100% authentic snapshot records from Supabase database (no fake/synthetic data).
 */
function AccumulationHeatmap({ row }: { row: InsightsRatingRow }) {
  const history = [...row.scoreHistory].sort((a, b) => a.asOfDate.localeCompare(b.asOfDate))
  
  // Use only published snapshots. Never synthesize historical periods in analytical UI.
  const columns = useMemo(() => {
    const source = history.length ? history : [row]
    return source.map((item) => ({
      date: item.asOfDate ? item.asOfDate.slice(5) : "—",
      fullDate: item.asOfDate || row.asOfDate || "—",
      model: snapshotModel(item),
    }))
  }, [history, row])

  const dimensionsList: Array<{ key: RatingDimension["key"]; label: string; icon: typeof Bolt; color: string }> = [
    { key: "bullish", label: "Xu hướng", icon: TrendingUp, color: "#34d399" },
    { key: "accumulation", label: "Tích lũy", icon: Layers3, color: "#22d3ee" },
    { key: "risk", label: "An toàn", icon: ShieldCheck, color: "#fb923c" },
    { key: "heat", label: "Nhiệt lượng", icon: Activity, color: "#fb7185" },
    { key: "sustainable", label: "Bền vững", icon: ShieldCheck, color: "#a78bfa" },
  ]

  // Intensity color generator like GitHub commit tiles / accumulation heatmap
  const getTileColor = (score: number) => {
    if (score >= 80) return "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.7)] text-black font-black"
    if (score >= 65) return "bg-emerald-500/80 text-white font-bold"
    if (score >= 50) return "bg-emerald-700/60 text-white font-semibold"
    if (score >= 35) return "bg-emerald-900/50 text-slate-300 font-medium"
    return "bg-white/[0.04] text-slate-500 border border-white/[0.06]"
  }

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-[#07111f] p-4 sm:p-5 font-ticker">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.06] pb-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-cyan-500/20 bg-cyan-500/10">
            <Layers3 className="size-4 text-cyan-300" />
          </span>
          <div className="min-w-0">
            <h4 className="text-base font-extrabold text-white">Ma trận tích lũy & Trạng thái thị trường</h4>
            <p className="mt-0.5 text-xs text-muted-2">Lịch sử chuỗi snapshot trạng thái tích lũy, rủi ro và nhiệt lượng.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 font-ticker text-xs text-muted-2">
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
                <div className="flex w-36 shrink-0 items-center gap-1.5 font-ticker text-xs font-bold text-slate-300">
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
                                "flex-1 h-7 rounded flex items-center justify-center font-mono text-[11px] cursor-help transition-transform hover:scale-110",
                                getTileColor(score)
                              )}
                            >
                              {score}
                            </div>
                          }
                        />
                        <TooltipContent className="border border-white/10 bg-[#090e19] px-3 py-2 text-xs font-ticker text-white shadow-2xl">
                          <div className="font-bold text-brand">{dim.label}</div>
                          <div>Snapshot: <strong className="font-mono">{col.fullDate}</strong></div>
                          <div>Điểm: <strong className="font-mono text-emerald-300">{score}/100</strong></div>
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
            <div className="w-36 shrink-0 font-ticker text-xs font-bold text-muted-2">Snapshot ngày</div>
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

    </div>
  )
}

function RatingHistoryChart({ row }: { row: InsightsRatingRow }) {
  const history = [...row.scoreHistory].sort((a, b) => a.asOfDate.localeCompare(b.asOfDate)).filter((item) => item.ratingScore != null)
  if (history.length < 2) return <div className="rounded-2xl border border-white/[0.07] bg-[#07111f] p-4 font-ticker text-xs text-muted-2"><LineChart className="mr-2 inline size-4 text-violet-300" />Lịch sử sẽ tự mở rộng sau các snapshot cron tiếp theo; hiện chưa đủ 2 mốc để vẽ đường điểm.</div>
  const width = 960
  const points = history.map((item, index) => `${40 + index * (width - 80) / Math.max(1, history.length - 1)},${190 - (item.ratingScore || 0) * 1.45}`)
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-[#07111f] p-4 sm:p-5 font-ticker">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.06] pb-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-violet-500/20 bg-violet-500/10">
            <LineChart className="size-4 text-violet-300" />
          </span>
          <div className="min-w-0">
            <h4 className="text-base font-extrabold text-white">Xu hướng Composite Rating qua các phiên</h4>
            <p className="mt-0.5 text-xs text-muted-2">Lịch sử biến động điểm số tổng hợp từ cơ sở dữ liệu.</p>
          </div>
        </div>
        <span className="text-xs font-semibold text-muted-2">{history.length} snapshot thực từ DB</span>
      </div>
      <svg viewBox={`0 0 ${width} 220`} className="mt-3 h-44 w-full" role="img" aria-label={`Lịch sử rating ${row.ticker}`}>
        <line x1="36" x2={width - 36} y1="190" y2="190" stroke="rgba(148,163,184,.2)" />
        <polyline points={points.join(" ")} fill="none" stroke="#a78bfa" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />
        {history.map((item, index) => {
          const [x, y] = points[index].split(",").map(Number)
          return (
            <g key={item.asOfDate}>
              <circle cx={x} cy={y} r="5" fill="#34d399" stroke="#07111f" strokeWidth="3" />
              <text x={x} y="210" textAnchor="middle" fill="#71818e" fontSize="11" fontFamily="monospace">{item.asOfDate.slice(5)}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function RatingDialog({ row, onOpenChange }: { row: InsightsRatingRow | null; onOpenChange: (open: boolean) => void }) {
  type StockDetailTab = "overview" | "info" | "ta" | "ttai"
  const [topTab, setTopTab] = useState<StockDetailTab>("overview")
  if (!row) return null

  const ratingModel = calculateRatingModel(row)
  const fieldByKey = new Map(KFSP_FIELD_CATALOG.map((field) => [field.key, field]))
  const deltaRs7d = historyDelta(row.rsShort ?? 50, row.scoreHistory, 7, (item) => item.rsShort)
  const deltaRs30d = historyDelta(row.rsShort ?? 50, row.scoreHistory, 30, (item) => item.rsShort)

  const metricNumber = (key: string): number | null => {
    const value = metricValue(row, key)
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (typeof value === "string") {
      const normalized = value.trim().replace(/%$/, "")
      const numeric = Number(normalized)
      return Number.isFinite(numeric) ? numeric : null
    }
    return null
  }

  const metricDisplay = (key: string) => {
    const definition = fieldByKey.get(key)
    if (!definition) return "—"
    return formatMetric(metricValue(row, key), definition)
  }

  const metricTile = (key: string, className?: string) => {
    const definition = fieldByKey.get(key)
    if (!definition) return null
    const value = metricValue(row, key)
    const formatted = formatMetric(value, definition)
    const isLink = definition.format === "link" && /^https?:\/\//i.test(formatted)
    return (
      <div key={key} className={cn("min-h-24 rounded-xl border border-white/[0.07] bg-[#091321] p-4", className)}>
        <MetricLabel definition={definition} className="text-xs font-bold text-muted-2" />
        {isLink ? (
          <a href={formatted} target="_blank" rel="noreferrer" className="mt-2.5 inline-flex items-center gap-1 break-all text-sm font-bold text-brand hover:underline">
            Truy cập <ExternalLink className="size-3.5" />
          </a>
        ) : (
          <div className={cn("mt-2.5 break-words font-mono text-base font-black", metricTone(value, definition))}>{formatted}</div>
        )}
      </div>
    )
  }

  const performance = [
    { label: "1D", value: metricNumber("price_change_1d_pct") ?? row.changePercent },
    { label: "1W", value: metricNumber("price_change_1w_pct") ?? row.weeklyChangePercent },
    { label: "2W", value: metricNumber("price_change_2w_pct") },
    { label: "1M", value: metricNumber("price_change_1m_pct") ?? row.monthlyChangePercent },
    { label: "3M", value: metricNumber("price_change_3m_pct") },
    { label: "YTD", value: metricNumber("price_change_ytd_pct") },
    { label: "1Y", value: metricNumber("price_change_1y_pct") },
  ]
  const performanceScale = Math.max(1, ...performance.map((item) => Math.abs(item.value ?? 0)))

  const smaDistance = [10, 20, 50, 100, 200].map((period) => ({
    label: `SMA${period}`,
    value: metricNumber(`price_vs_sma${period}_pct`),
  }))
  const smaScale = Math.max(1, ...smaDistance.map((item) => Math.abs(item.value ?? 0)))
  const smaAboveCount = smaDistance.filter((item) => (item.value ?? -Infinity) > 0).length

  const volumeSeries = [
    { label: "Hôm nay", value: metricNumber("volume_1d") },
    { label: "TB 10D", value: metricNumber("average_volume_10d") },
    { label: "TB 20D", value: metricNumber("average_volume_20d") },
    { label: "TB 50D", value: metricNumber("average_volume_50d") ?? row.volume },
  ]
  const volumeScale = Math.max(1, ...volumeSeries.map((item) => item.value ?? 0))

  const tradedValueSeries = [
    { label: "Hôm nay", value: metricNumber("traded_value_1d_billion") },
    { label: "TB 10D", value: metricNumber("average_traded_value_10d_billion") },
    { label: "TB 20D", value: metricNumber("average_traded_value_20d_billion") },
    { label: "TB 50D", value: metricNumber("average_traded_value_50d_billion") },
  ]
  const tradedValueScale = Math.max(1, ...tradedValueSeries.map((item) => item.value ?? 0))

  const rowRsi = typeof row.rsi14 === "number" ? row.rsi14 : Number(row.rsi14)
  const rsi = metricNumber("rsi_14") ?? (Number.isFinite(rowRsi) ? rowRsi : null)
  const freeFloat = metricNumber("free_float_pct")
  const foreignRoom = metricNumber("foreign_room_remaining_pct")

  const tabItems: Array<{ key: StockDetailTab; label: string; icon: typeof Gauge }> = [
    { key: "overview", label: "Tổng quan", icon: Gauge },
    { key: "info", label: "Thông tin doanh nghiệp", icon: Building2 },
    { key: "ta", label: "Phân tích TA", icon: LineChart },
    { key: "ttai", label: "TTAI", icon: Sparkles },
  ]

  const renderPerformanceBars = () => (
    <div className="space-y-3">
      {performance.map((item) => {
        const value = item.value
        const width = value == null ? 0 : Math.min(50, Math.abs(value) / performanceScale * 50)
        return (
          <div key={item.label} className="grid grid-cols-[42px_1fr_74px] items-center gap-3">
            <span className="text-xs font-extrabold text-muted-2">{item.label}</span>
            <div className="relative h-2.5 overflow-hidden rounded-full bg-white/[0.05]">
              <span className="absolute left-1/2 top-0 h-full w-px bg-white/20" />
              {value != null && (
                <span
                  className={cn("absolute top-0 h-full rounded-full", value >= 0 ? "left-1/2 bg-emerald-400" : "right-1/2 bg-rose-400")}
                  style={{ width: `${width}%` }}
                />
              )}
            </div>
            <span className={cn("text-right font-mono text-sm font-black", value == null ? "text-muted-2" : value >= 0 ? "text-up" : "text-down")}>{formatPercent(value)}</span>
          </div>
        )
      })}
    </div>
  )

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="flex max-h-[94vh] flex-col overflow-hidden border border-cyan-300/20 bg-[#060c16] p-0 font-ticker shadow-[0_40px_120px_-20px_rgba(0,0,0,.98),0_0_70px_-35px_rgba(103,232,249,.6)] sm:max-w-[min(1440px,calc(100vw-2rem))]">
        {/* HEADER / ORDERBOOK POPUP EXACT STYLE */}
        <header className="flex cursor-grab select-none items-center justify-between gap-2.5 border-b border-white/[0.10] bg-gradient-to-r from-[#121820]/95 via-[#182330]/95 to-[#121820]/95 px-4 py-2.5 active:cursor-grabbing touch-none backdrop-blur-2xl shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12),0_4px_16px_rgba(0,0,0,0.4)]">
          {/* Left Ticker, Logo & Exchange */}
          <div className="flex items-center gap-2.5 min-w-0 shrink">
            <GripVertical className="h-4 w-4 text-white/30 hover:text-white/60 shrink-0 transition-colors" />
            <StockLogo
              symbol={row.ticker}
              size={32}
              className="shrink-0 rounded-full border-white/40 drop-shadow-[0_0_8px_rgba(255,255,255,0.75)]"
            />
            <DialogTitle className="font-ticker text-xl sm:text-2xl font-extrabold italic bg-gradient-to-br from-white via-cyan-100 to-emerald-200 bg-clip-text text-transparent pr-2 drop-shadow-[0_0_15px_rgba(34,211,238,0.2)] tracking-tight shrink-0 select-none m-0">
              {row.ticker}
            </DialogTitle>
            <span className="hidden sm:inline-block font-ticker text-xs font-semibold text-slate-300 truncate max-w-xs">
              {row.companyName}
            </span>
            {row.exchange ? (
              <span className="hidden md:inline-flex rounded-full bg-white/[0.08] border border-white/[0.12] px-2 py-0.5 font-ticker text-[9.5px] font-bold text-white/70 uppercase tracking-wider shrink-0 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)]">
                {row.exchange}
              </span>
            ) : null}
            {row.isTop100 && (
              <Badge variant="outline" className="border-amber-400/40 bg-amber-400/10 text-amber-300 font-ticker text-[10px] font-bold shrink-0 hidden lg:inline-flex">
                <Crown className="size-3" /> Top 100{row.top100Rank ? ` · #${row.top100Rank}` : ""}
              </Badge>
            )}
          </div>

          {/* Center / Right Price & Action Controls */}
          <div className="flex items-center gap-2.5 shrink-0">
            {/* Live Price & Change Pill */}
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "font-mono text-lg sm:text-xl font-black tracking-tight rounded px-1 transition-colors drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]",
                  (row.changePercent ?? 0) > 0 ? "text-up" : (row.changePercent ?? 0) < 0 ? "text-down" : "text-ref"
                )}
              >
                {formatPrice(row.price)}
              </span>
              {row.price != null && (
                <MarketChangePill
                  value={row.changePercent}
                  tone={(row.changePercent ?? 0) > 0 ? "up" : (row.changePercent ?? 0) < 0 ? "down" : "ref"}
                  compact
                  decimals={2}
                />
              )}
            </div>

            {/* Close control */}
            <div className="flex items-center border-l border-white/10 pl-2 ml-0.5">
              <button
                type="button"
                aria-label="Đóng"
                title="Đóng"
                onClick={() => onOpenChange(false)}
                className="rounded p-1 text-white/50 hover:bg-rose-500/20 hover:text-rose-400 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <DialogDescription className="sr-only">Hồ sơ chi tiết cổ phiếu {row.ticker}</DialogDescription>
        </header>

        <div className="shrink-0 border-b border-white/[0.08] bg-[#080d19] px-5 py-3">
          <div className="flex items-center justify-between gap-4 overflow-x-auto">
            <nav className="inline-flex min-w-max items-center gap-1.5 rounded-full border border-white/[0.1] bg-[#080c10]/90 p-1 shadow-[0_0_24px_-4px_rgba(176,124,255,0.18),0_0_24px_-4px_rgba(34,201,138,0.18)]" role="tablist" aria-label="Điều hướng hồ sơ cổ phiếu">
              {tabItems.map((tab) => {
                const Icon = tab.icon
                const active = topTab === tab.key
                return (
                  <button
                    key={tab.key}
                    id={`rating-tab-${tab.key}`}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    aria-controls={`rating-panel-${tab.key}`}
                    onClick={() => setTopTab(tab.key)}
                    className={cn(
                      "inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-4 py-2 text-xs font-extrabold transition-colors sm:text-sm",
                      active
                        ? "border-emerald-400/45 bg-gradient-to-r from-emerald-500/25 via-purple-500/20 to-emerald-500/20 text-emerald-200 shadow-[0_0_16px_rgba(176,124,255,0.28),0_0_10px_rgba(34,201,138,0.32)]"
                        : "border-transparent text-slate-400 hover:border-white/10 hover:bg-white/[0.05] hover:text-white",
                    )}
                  >
                    <Icon className="size-4" /> {tab.label}
                  </button>
                )
              })}
            </nav>
            <aside className="sticky right-0 shrink-0 border-l border-white/10 bg-[#080d19] pl-4" aria-label="Công cụ phân tích chuyên sâu">
              <Link
                href={`/insights/wyckoff?ticker=${row.ticker}&timeframe=1D`}
                prefetch={false}
                aria-label={`Phân tích chart Wyckoff ${row.ticker}`}
                title="Phân tích chart Wyckoff"
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-cyan-400/35 bg-cyan-500/10 px-3 py-2 font-ticker text-xs font-bold text-cyan-300 transition-colors hover:border-cyan-400/60 hover:bg-cyan-500/20"
              >
                <BarChart3 className="size-3.5" />
                <span>Phân tích Wyckoff</span>
              </Link>
            </aside>
          </div>
        </div>

        <div className="min-h-[580px] flex-1 overflow-y-auto p-4 sm:p-5">
          {topTab === "overview" && (
            <section id="rating-panel-overview" role="tabpanel" aria-labelledby="rating-tab-overview" className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border border-violet-300/20 bg-violet-400/[0.07] p-4">
                  <div className="flex items-center justify-between text-xs font-extrabold uppercase tracking-wider text-violet-200/70"><span>Composite</span><Sparkles className="size-4" /></div>
                  <div className="mt-3 font-mono text-3xl font-black text-violet-200">{row.ratingScore}<span className="text-base text-violet-200/50">/100</span></div>
                  <div className="mt-2 text-sm font-bold text-white">{ratingModel.state}</div>
                </div>
                <div className="rounded-xl border border-emerald-300/20 bg-emerald-400/[0.07] p-4">
                  <div className="flex items-center justify-between text-xs font-extrabold uppercase tracking-wider text-emerald-200/70"><span>CANSLIM / 4M</span><Target className="size-4" /></div>
                  <div className="mt-3 flex items-end gap-3"><span className="font-mono text-2xl font-black text-emerald-300">{row.canslimScore}</span><span className="pb-1 text-muted-2">/</span><span className="font-mono text-2xl font-black text-amber-300">{row.score4m}</span></div>
                  <div className="mt-3 grid grid-cols-2 gap-2"><AnimatedProgressBar value={row.canslimScore} color="#6ee7b7" /><AnimatedProgressBar value={row.score4m} color="#fcd34d" /></div>
                </div>
                <div className="rounded-xl border border-cyan-300/20 bg-cyan-400/[0.07] p-4">
                  <div className="flex items-center justify-between text-xs font-extrabold uppercase tracking-wider text-cyan-200/70"><span>RS Momentum</span><Zap className="size-4" /></div>
                  <div className="mt-3 font-mono text-2xl font-black text-cyan-200">{row.rsShort ?? "—"}<span className="text-base text-cyan-200/45"> · {row.rsMedium ?? "—"}</span></div>
                  <div className="mt-2 flex gap-3 text-xs font-bold text-muted-2"><span>7D <b className={(deltaRs7d ?? 0) >= 0 ? "text-up" : "text-down"}>{deltaRs7d == null ? "—" : `${deltaRs7d >= 0 ? "+" : ""}${deltaRs7d}`}</b></span><span>30D <b className={(deltaRs30d ?? 0) >= 0 ? "text-up" : "text-down"}>{deltaRs30d == null ? "—" : `${deltaRs30d >= 0 ? "+" : ""}${deltaRs30d}`}</b></span></div>
                </div>
                <div className="rounded-xl border border-amber-300/20 bg-amber-400/[0.06] p-4">
                  <div className="flex items-center justify-between text-xs font-extrabold uppercase tracking-wider text-amber-200/70"><span>Market state</span><Radar className="size-4" /></div>
                  <div className="mt-3 text-xl font-black text-white">{row.stockRrgState || "—"}</div>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs font-bold text-muted-2"><span>RSI <b className="text-white">{rsi ?? "—"}</b></span><span>Beta <b className="text-white">{row.beta ?? metricDisplay("beta")}</b></span><span>{smaAboveCount}/5 SMA phía trên</span></div>
                </div>
              </div>

              <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,30%)_minmax(0,70%)]">
                {/* CỘT TRÁI (30% width) */}
                <div className="space-y-4">
                  {/* 1. FA quick read */}
                  <div className="flex flex-col rounded-2xl border border-white/[0.07] bg-[#07111f] p-4 sm:p-5 font-ticker">
                    <div className="mb-4 flex items-start gap-2.5 border-b border-white/[0.06] pb-3">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10">
                        <BadgePercent className="size-4 text-emerald-300" />
                      </span>
                      <div className="min-w-0">
                        <h4 className="text-base font-extrabold text-white">FA quick read</h4>
                        <p className="mt-0.5 text-xs text-muted-2">Growth, profitability và valuation quan trọng.</p>
                      </div>
                    </div>
                    <div className="grid content-stretch gap-2 sm:grid-cols-2">
                      {["net_revenue_growth_pct", "net_income_growth_pct", "roe_ttm_pct", "net_margin_ttm_pct", "pe_ttm", "pb_ttm"].map((key) => metricTile(key, "h-full"))}
                    </div>
                  </div>

                  {/* 2. TA quick read */}
                  <div className="flex flex-col rounded-2xl border border-white/[0.07] bg-[#07111f] p-4 sm:p-5 font-ticker">
                    <div className="mb-4 flex items-start gap-2.5 border-b border-white/[0.06] pb-3">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-cyan-500/20 bg-cyan-500/10">
                        <LineChart className="size-4 text-cyan-300" />
                      </span>
                      <div className="min-w-0">
                        <h4 className="text-base font-extrabold text-white">TA quick read</h4>
                        <p className="mt-0.5 text-xs text-muted-2">Trend, oscillator và trạng thái kỹ thuật.</p>
                      </div>
                    </div>
                    <div className="grid content-stretch gap-2 sm:grid-cols-2">
                      {["price_vs_sma20_pct", "price_vs_sma50_pct", "price_vs_sma200_pct", "rsi_14", "macd_vs_signal", "position_in_bollinger_band"].map((key) => metricTile(key, "h-full"))}
                    </div>
                  </div>

                  {/* 3. Range & thanh khoản (Chuyển sang cột trái) */}
                  <div className="rounded-2xl border border-white/[0.07] bg-[#07111f] p-4 sm:p-5 font-ticker">
                    <div className="mb-4 flex items-start justify-between gap-3 border-b border-white/[0.06] pb-3">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-cyan-500/20 bg-cyan-500/10">
                          <Droplets className="size-4 text-cyan-300" />
                        </span>
                        <div className="min-w-0">
                          <h4 className="text-base font-extrabold text-white">Range & thanh khoản</h4>
                          <p className="mt-0.5 text-xs text-muted-2">Vị thế giá 52 tuần và cường độ giao dịch.</p>
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-xl bg-white/[0.03] p-3"><span className="text-[11px] font-bold text-muted-2">Cách đỉnh 52W</span><div className="mt-1.5 font-mono text-base font-black text-white">{metricDisplay("distance_to_52w_high_pct")}</div></div>
                      <div className="rounded-xl bg-white/[0.03] p-3"><span className="text-[11px] font-bold text-muted-2">Cách đáy 52W</span><div className="mt-1.5 font-mono text-base font-black text-white">{metricDisplay("distance_to_52w_low_pct")}</div></div>
                      <div className="rounded-xl bg-white/[0.03] p-3"><span className="text-[11px] font-bold text-muted-2">Volume vs trước</span><div className="mt-1.5 font-mono text-base font-black text-white">{metricDisplay("volume_vs_previous_session_pct")}</div></div>
                      <div className="rounded-xl bg-white/[0.03] p-3"><span className="text-[11px] font-bold text-muted-2">GTGD vs trước</span><div className="mt-1.5 font-mono text-base font-black text-white">{metricDisplay("traded_value_vs_previous_session_pct")}</div></div>
                    </div>
                    <div className="mt-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5 text-[11px] font-semibold text-muted-2">KLGD TB 50P <strong className="font-mono text-white">{compactVolume(row.volume)}</strong> · Vốn hóa <strong className="font-mono text-white">{row.marketCapBillion == null ? "—" : formatMarketCapBillion(row.marketCapBillion)}</strong></div>
                  </div>
                </div>

                {/* CỘT PHẢI (70% width) */}
                <div className="space-y-4">
                  {/* 1. QeoIndex state radar */}
                  <RatingRadar row={row} />

                  {/* 2. Ma trận tích lũy & Trạng thái thị trường (Dưới State Radar) */}
                  <AccumulationHeatmap row={row} />

                  {/* 3. Hiệu suất giá */}
                  <div className="rounded-2xl border border-white/[0.07] bg-[#07111f] p-4 sm:p-5 font-ticker">
                    <div className="mb-4 flex items-start justify-between gap-3 border-b border-white/[0.06] pb-3">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10">
                          <Activity className="size-4 text-emerald-300" />
                        </span>
                        <div className="min-w-0">
                          <h4 className="text-base font-extrabold text-white">Hiệu suất giá</h4>
                          <p className="mt-0.5 text-xs text-muted-2">Động lượng 1D → 1Y qua các khung thời gian.</p>
                        </div>
                      </div>
                    </div>
                    {renderPerformanceBars()}
                  </div>

                  {/* 4. Xu hướng Composite Rating qua các phiên (Dưới cùng cột phải) */}
                  <RatingHistoryChart row={row} />
                </div>
              </div>
            </section>
          )}

          {topTab === "info" && (
            <section id="rating-panel-info" role="tabpanel" aria-labelledby="rating-tab-info" className="space-y-4">
              <div className="rounded-2xl border border-white/[0.07] bg-[#07111f] p-4 sm:p-5 font-ticker">
                <div className="mb-4 flex items-start gap-2.5 border-b border-white/[0.06] pb-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-cyan-300/20 bg-cyan-300/10">
                    <Building2 className="size-4 text-cyan-200" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-base font-extrabold text-white">Thông tin doanh nghiệp</h3>
                    <p className="mt-0.5 text-xs text-muted-2">Hồ sơ, quy mô vốn điều lệ và vốn hóa thị trường.</p>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{["company_name", "charter_capital_billion", "market_cap_billion", "shares_outstanding", "website"].map((key) => metricTile(key))}</div>
              </div>

              <div className="rounded-2xl border border-white/[0.07] bg-[#07111f] p-4 sm:p-5 font-ticker">
                <div className="mb-4 flex items-start gap-2.5 border-b border-white/[0.06] pb-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10">
                    <PieChart className="size-4 text-emerald-300" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-base font-extrabold text-white">Cơ cấu sở hữu & Room nước ngoài</h3>
                    <p className="mt-0.5 text-xs text-muted-2">Tỷ lệ cổ phiếu lưu hành tự do và room khối ngoại còn lại.</p>
                  </div>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  {[{ label: "Free float", value: freeFloat, display: metricDisplay("free_float_pct") }, { label: "Room nước ngoài còn lại", value: foreignRoom, display: metricDisplay("foreign_room_remaining_pct") }].map((item) => (
                    <div key={item.label} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                      <div className="flex items-center justify-between"><span className="text-sm font-bold text-muted-2">{item.label}</span><span className="font-mono text-lg font-black text-white">{item.display}</span></div>
                      <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400" style={{ width: `${Math.max(0, Math.min(100, item.value ?? 0))}%` }} /></div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <div className="rounded-2xl border border-white/[0.07] bg-[#07111f] p-4 sm:p-5 font-ticker">
                  <div className="mb-4 flex items-start gap-2.5 border-b border-white/[0.06] pb-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10">
                      <BadgePercent className="size-4 text-emerald-300" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-base font-extrabold text-white">Chỉ số tài chính & định giá</h3>
                      <p className="mt-0.5 text-xs text-muted-2">Multiple P/E, P/B và dữ liệu trên mỗi cổ phiếu.</p>
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{["eps_ttm_vnd", "pe_ttm", "bvps_ttm_vnd", "pb_ttm", "eps_ttm_growth_pct", "bvps_ttm_growth_pct"].map((key) => metricTile(key))}</div>
                </div>

                <div className="rounded-2xl border border-white/[0.07] bg-[#07111f] p-4 sm:p-5 font-ticker">
                  <div className="mb-4 flex items-start gap-2.5 border-b border-white/[0.06] pb-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-amber-500/20 bg-amber-500/10">
                      <FileText className="size-4 text-amber-300" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-base font-extrabold text-white">Financial snapshot</h3>
                      <p className="mt-0.5 text-xs text-muted-2">Kỳ BCTC gần nhất và quy mô TTM.</p>
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">{["financial_period", "net_revenue_ttm_billion", "net_income_ttm_billion"].map((key) => metricTile(key))}</div>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <div className="rounded-2xl border border-white/[0.07] bg-[#07111f] p-4 sm:p-5 font-ticker">
                  <div className="mb-4 flex items-start gap-2.5 border-b border-white/[0.06] pb-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-cyan-500/20 bg-cyan-500/10">
                      <TrendingUp className="size-4 text-cyan-300" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-base font-extrabold text-white">Tăng trưởng tài chính</h3>
                      <p className="mt-0.5 text-xs text-muted-2">So sánh tốc độ tăng trưởng của các driver chính.</p>
                    </div>
                  </div>
                  <div className="mt-4 space-y-3.5">{[{ label: "Doanh thu", key: "net_revenue_growth_pct" }, { label: "LN sau thuế", key: "net_income_growth_pct" }, { label: "EPS", key: "eps_ttm_growth_pct" }, { label: "BVPS", key: "bvps_ttm_growth_pct" }].map((item) => { const value = metricNumber(item.key); const width = value == null ? 0 : Math.min(100, Math.abs(value)); return <div key={item.key}><div className="mb-1.5 flex items-center justify-between text-xs font-bold"><span className="text-muted-2">{item.label}</span><span className={value == null ? "text-muted-2" : value >= 0 ? "text-up" : "text-down"}>{value == null ? "—" : formatPercent(value)}</span></div><div className="h-2 rounded-full bg-white/[0.05]"><div className={cn("h-full rounded-full", (value ?? 0) >= 0 ? "bg-emerald-400" : "bg-rose-400")} style={{ width: `${width}%` }} /></div></div> })}</div>
                </div>

                <div className="rounded-2xl border border-white/[0.07] bg-[#07111f] p-4 sm:p-5 font-ticker">
                  <div className="mb-4 flex items-start gap-2.5 border-b border-white/[0.06] pb-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-purple-500/20 bg-purple-500/10">
                      <Target className="size-4 text-purple-300" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-base font-extrabold text-white">Khả năng sinh lời</h3>
                      <p className="mt-0.5 text-xs text-muted-2">Margin, hiệu quả tài sản (ROA) và vốn chủ sở hữu (ROE).</p>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">{["net_margin_ttm_pct", "roa_ttm_pct", "roe_ttm_pct"].map((key) => metricTile(key))}</div>
                </div>
              </div>
            </section>
          )}

          {topTab === "ta" && (
            <section id="rating-panel-ta" role="tabpanel" aria-labelledby="rating-tab-ta" className="space-y-4">
              <div className="grid gap-4 xl:grid-cols-2">
                <div className="rounded-2xl border border-white/[0.07] bg-[#07111f] p-4 sm:p-5 font-ticker">
                  <div className="mb-4 flex items-start justify-between gap-3 border-b border-white/[0.06] pb-3">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10">
                        <Activity className="size-4 text-emerald-300" />
                      </span>
                      <div className="min-w-0">
                        <h3 className="text-base font-extrabold text-white">Momentum đa khung</h3>
                        <p className="mt-0.5 text-xs text-muted-2">Biến động giá từ 1D → 1Y theo hướng tăng/giảm.</p>
                      </div>
                    </div>
                  </div>
                  {renderPerformanceBars()}
                </div>

                <div className="rounded-2xl border border-white/[0.07] bg-[#07111f] p-4 sm:p-5 font-ticker">
                  <div className="mb-4 flex items-start justify-between gap-3 border-b border-white/[0.06] pb-3">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-cyan-500/20 bg-cyan-500/10">
                        <TrendingUp className="size-4 text-cyan-300" />
                      </span>
                      <div className="min-w-0">
                        <h3 className="text-base font-extrabold text-white">Trend so với SMA</h3>
                        <p className="mt-0.5 text-xs text-muted-2">Giá hiện trên {smaAboveCount}/5 đường trung bình SMA.</p>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-3">{smaDistance.map((item) => { const width = item.value == null ? 0 : Math.min(50, Math.abs(item.value) / smaScale * 50); return <div key={item.label} className="grid grid-cols-[60px_1fr_70px] items-center gap-3"><span className="text-xs font-extrabold text-muted-2">{item.label}</span><div className="relative h-2.5 rounded-full bg-white/[0.05]"><span className="absolute left-1/2 top-0 h-full w-px bg-white/20" />{item.value != null && <span className={cn("absolute top-0 h-full rounded-full", item.value >= 0 ? "left-1/2 bg-cyan-400" : "right-1/2 bg-rose-400")} style={{ width: `${width}%` }} />}</div><span className={cn("text-right font-mono text-xs font-black", item.value == null ? "text-muted-2" : item.value >= 0 ? "text-up" : "text-down")}>{formatPercent(item.value)}</span></div> })}</div>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-3">
                {/* RSI (14) */}
                <div className="rounded-2xl border border-white/[0.07] bg-[#07111f] p-4 sm:p-5 font-ticker">
                  <div className="mb-4 flex items-start gap-2.5 border-b border-white/[0.06] pb-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-cyan-500/20 bg-cyan-500/10">
                      <Activity className="size-4 text-cyan-300" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-base font-extrabold text-white">RSI (14)</h3>
                      <p className="mt-0.5 text-xs text-muted-2">Sức mạnh tương đối & vùng quá mua/bán.</p>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs font-bold text-muted-2"><span>0</span><span>30</span><span>70</span><span>100</span></div>
                  <div className="relative mt-2 h-3 rounded-full bg-gradient-to-r from-cyan-500/35 via-white/10 to-rose-500/35"><span className="absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#07111f] bg-white shadow-[0_0_14px_rgba(255,255,255,.5)]" style={{ left: `${Math.max(0, Math.min(100, rsi ?? 50))}%` }} /></div>
                  <div className="mt-4 font-mono text-2xl font-black text-white">{rsi ?? "—"}</div>
                  <p className="mt-1 text-xs text-muted-2">{rsi == null ? "Không có dữ liệu" : rsi < 30 ? "Vùng quá bán" : rsi > 70 ? "Vùng quá mua" : "Vùng trung tính"}</p>
                </div>

                {/* MACD */}
                <div className="rounded-2xl border border-white/[0.07] bg-[#07111f] p-4 sm:p-5 font-ticker">
                  <div className="mb-4 flex items-start gap-2.5 border-b border-white/[0.06] pb-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-violet-500/20 bg-violet-500/10">
                      <LineChart className="size-4 text-violet-300" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-base font-extrabold text-white">MACD</h3>
                      <p className="mt-0.5 text-xs text-muted-2">Vị trí MACD so với đường Signal.</p>
                    </div>
                  </div>
                  <div className="mt-4 text-xl font-black text-white">{metricDisplay("macd_vs_signal")}</div>
                  <p className="mt-2 text-xs text-muted-2">Tín hiệu giao cắt và phân kỳ động lượng.</p>
                </div>

                {/* Bollinger Band */}
                <div className="rounded-2xl border border-white/[0.07] bg-[#07111f] p-4 sm:p-5 font-ticker">
                  <div className="mb-4 flex items-start gap-2.5 border-b border-white/[0.06] pb-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-amber-500/20 bg-amber-500/10">
                      <Layers3 className="size-4 text-amber-300" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-base font-extrabold text-white">Bollinger Band</h3>
                      <p className="mt-0.5 text-xs text-muted-2">Vị trí giá trong/ngoài dải biên độ.</p>
                    </div>
                  </div>
                  <div className="mt-4 text-xl font-black text-white">{metricDisplay("position_in_bollinger_band")}</div>
                  <p className="mt-2 text-xs text-muted-2">Mức độ co thắt dải và ranh giới biến động.</p>
                </div>
              </div>

              <div className="rounded-2xl border border-white/[0.07] bg-[#07111f] p-4 sm:p-5 font-ticker">
                <div className="mb-4 flex items-start gap-2.5 border-b border-white/[0.06] pb-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-violet-500/20 bg-violet-500/10">
                    <Maximize2 className="size-4 text-violet-300" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-base font-extrabold text-white">Phạm vi giá & Biên độ kỹ thuật</h3>
                    <p className="mt-0.5 text-xs text-muted-2">Độ rộng biên độ và vị trí giá theo các mốc 10D, 20D, 50D, 52W.</p>
                  </div>
                </div>
                <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="text-xs uppercase tracking-wider text-muted-2"><tr className="border-b border-white/10"><th className="pb-3">Khung</th><th className="pb-3">Độ rộng</th><th className="pb-3">Vị trí</th><th className="pb-3">Khoảng cách đặc biệt</th></tr></thead><tbody className="divide-y divide-white/[0.06] text-white">{[{ label: "10D", width: "range_width_10d_pct", position: "position_in_10d_range", distance: null }, { label: "20D", width: "range_width_20d_pct", position: "position_in_20d_range", distance: null }, { label: "50D", width: "range_width_50d_pct", position: "position_in_50d_range", distance: null }, { label: "52W", width: "range_width_52w_pct", position: "position_in_52w_range", distance: "distance_to_52w_high_pct" }].map((item) => <tr key={item.label}><td className="py-3 font-extrabold">{item.label}</td><td className="py-3 font-mono">{metricDisplay(item.width)}</td><td className="py-3 font-semibold">{metricDisplay(item.position)}</td><td className="py-3 font-mono text-muted-2">{item.distance ? `Đỉnh: ${metricDisplay(item.distance)} · Đáy: ${metricDisplay("distance_to_52w_low_pct")}` : "—"}</td></tr>)}</tbody></table></div>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <div className="rounded-2xl border border-white/[0.07] bg-[#07111f] p-4 sm:p-5 font-ticker">
                  <div className="mb-4 flex items-start justify-between gap-3 border-b border-white/[0.06] pb-3">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-cyan-500/20 bg-cyan-500/10">
                        <Droplets className="size-4 text-cyan-300" />
                      </span>
                      <div className="min-w-0">
                        <h3 className="text-base font-extrabold text-white">Khối lượng</h3>
                        <p className="mt-0.5 text-xs text-muted-2">Hôm nay so với trung bình 10/20/50 phiên.</p>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-3">{volumeSeries.map((item) => <div key={item.label} className="grid grid-cols-[72px_1fr_90px] items-center gap-3"><span className="text-xs font-bold text-muted-2">{item.label}</span><div className="h-2.5 rounded-full bg-white/[0.05]"><div className="h-full rounded-full bg-cyan-400" style={{ width: `${Math.min(100, (item.value ?? 0) / volumeScale * 100)}%` }} /></div><span className="text-right font-mono text-xs font-black text-white">{item.value == null ? "—" : compactVolume(item.value)}</span></div>)}</div>
                </div>

                <div className="rounded-2xl border border-white/[0.07] bg-[#07111f] p-4 sm:p-5 font-ticker">
                  <div className="mb-4 flex items-start justify-between gap-3 border-b border-white/[0.06] pb-3">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-amber-500/20 bg-amber-500/10">
                        <BarChart3 className="size-4 text-amber-300" />
                      </span>
                      <div className="min-w-0">
                        <h3 className="text-base font-extrabold text-white">Giá trị giao dịch</h3>
                        <p className="mt-0.5 text-xs text-muted-2">Đơn vị tính bằng tỷ đồng.</p>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-3">{tradedValueSeries.map((item) => <div key={item.label} className="grid grid-cols-[72px_1fr_90px] items-center gap-3"><span className="text-xs font-bold text-muted-2">{item.label}</span><div className="h-2.5 rounded-full bg-white/[0.05]"><div className="h-full rounded-full bg-amber-400" style={{ width: `${Math.min(100, (item.value ?? 0) / tradedValueScale * 100)}%` }} /></div><span className="text-right font-mono text-xs font-black text-white">{item.value == null ? "—" : `${formatNumber(item.value)} tỷ`}</span></div>)}</div>
                </div>
              </div>

              <div className="rounded-2xl border border-white/[0.07] bg-[#07111f] p-4 sm:p-5 font-ticker">
                <div className="mb-4 flex items-start gap-2.5 border-b border-white/[0.06] pb-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10">
                    <Zap className="size-4 text-emerald-300" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-base font-extrabold text-white">Giao dịch khối ngoại & Tự doanh</h3>
                    <p className="mt-0.5 text-xs text-muted-2">Giá trị mua bán ròng của khối ngoại, tự doanh và hệ số Beta.</p>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  {["volume_vs_previous_session_pct", "traded_value_vs_previous_session_pct", "net_foreign_trading_billion", "net_proprietary_trading_billion"].map((key) => metricTile(key))}
                  {metricTile("beta")}
                </div>
              </div>
            </section>
          )}

          {topTab === "ttai" && <TtaiDashboard row={row} />}
        </div>

      </DialogContent>
    </Dialog>
  )
}
export function InsightsDashboard({ data, initialTicker }: { data: InsightsDashboardData; initialTicker?: string }) {
  const [universeFilter, setUniverseFilter] = useState<"top100" | "all">("top100")
  const [sectorFilter, setSectorFilter] = useState("all")
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<{ key: RatingSortKey; direction: SortDirection }>({ key: "ratingScore", direction: "desc" })
  const [selectedRating, setSelectedRating] = useState<InsightsRatingRow | null>(() => {
    if (!initialTicker) return null
    return data.ratings.find((r) => r.ticker.toUpperCase() === initialTicker.toUpperCase()) || null
  })
  const [expandedSectors, setExpandedSectors] = useState<Set<string>>(new Set())

  // Auto-sync ticker from URL query if user navigated client-side (popstate / back-forward)
  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search)
      const tickerParam = (params.get("ticker") || params.get("rating") || "").toUpperCase()
      if (tickerParam) {
        const found = data.ratings.find((r) => r.ticker.toUpperCase() === tickerParam)
        if (found) setSelectedRating(found)
      }
    }
    window.addEventListener("popstate", handlePopState)
    return () => window.removeEventListener("popstate", handlePopState)
  }, [data.ratings])

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
      <InsightsTransition>
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
      </InsightsTransition>
      <RatingDialog key={selectedRating?.ticker ?? "closed"} row={selectedRating} onOpenChange={(open) => { if (!open) setSelectedRating(null) }} />
    </div>
  )
}
