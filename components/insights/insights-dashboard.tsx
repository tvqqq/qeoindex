"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import {
  Activity,
  ArrowRight,
  BarChart3,
  Bolt,
  BrainCircuit,
  CalendarDays,
  ChartNoAxesCombined,
  CircleDollarSign,
  Database,
  ExternalLink,
  Gauge,
  Info,
  Layers3,
  LineChart,
  Radar,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react"

import AnimatedProgressBar from "@/components/smoothui/animated-progress-bar"
import SoftBlurIn from "@/components/smoothui/soft-blur-in"
import { StockLogo } from "@/components/stock-logo"
import { TopNav } from "@/components/top-nav"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { InsightsDashboardData, InsightsModuleSummary, InsightsRatingRow } from "@/lib/insights-data"
import { cn } from "@/lib/utils"

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

function ScorePill({ value, tone, label }: { value: number; tone: ScoreTone; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className={cn("inline-flex h-8 min-w-14 cursor-help items-center justify-center gap-1 rounded-md border px-2 font-mono text-sm font-black", SCORE_TONE[tone])} />}>
        <Bolt className="size-3.5" /> {value}
      </TooltipTrigger>
      <TooltipContent className="border border-white/10 bg-[#090e19] px-3 py-2 font-ticker text-white shadow-2xl">
        {label}: <strong className="text-brand">{value}/100</strong>
      </TooltipContent>
    </Tooltip>
  )
}

function RatingTooltip({ row, children }: { row: InsightsRatingRow; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side="right" sideOffset={12} align="start" className="block w-[330px] max-w-[calc(100vw-2rem)] rounded-xl border border-cyan-300/20 bg-[#080d19] p-5 font-ticker text-foreground shadow-[0_24px_80px_-20px_rgba(0,0,0,.95),0_0_32px_-16px_rgba(103,232,249,.55)]">
        <div className="flex items-center gap-3">
          <StockLogo symbol={row.ticker} size={48} className="rounded-full shadow-[0_0_22px_-5px_rgba(103,232,249,.65)]" />
          <div className="min-w-0">
            <div className="text-xl font-extrabold text-white">{row.ticker}</div>
            <div className="truncate text-sm text-muted-2">{row.companyName}</div>
          </div>
          <span className="ml-auto rounded-lg border border-brand/30 bg-brand/10 px-2.5 py-1 font-mono text-lg font-black text-brand">{row.ratingScore}</span>
        </div>
        <div className="mt-5 grid gap-3 text-sm">
          <div className="flex justify-between gap-4"><span className="text-muted-2">Ngành</span><strong className="text-right text-white">{row.sector}</strong></div>
          <div className="flex justify-between gap-4"><span className="text-muted-2">Giá</span><strong className="font-mono text-white">{formatPrice(row.price)}</strong></div>
          <div className="flex justify-between gap-4"><span className="text-muted-2">Khối lượng</span><strong className="font-mono text-white">{compactVolume(row.volume)}</strong></div>
          <div className="flex justify-between gap-4"><span className="text-muted-2">Biến động</span><strong className={cn("font-mono", (row.changePercent ?? 0) >= 0 ? "text-up" : "text-down")}>{formatPercent(row.changePercent)}</strong></div>
        </div>
        <div className="mt-4 border-t border-white/[0.07] pt-3 text-xs font-semibold text-cyan-200">Click vào dòng để mở hồ sơ phân tích</div>
      </TooltipContent>
    </Tooltip>
  )
}

function ScoreProfileChart({ row }: { row: InsightsRatingRow }) {
  const metrics = [
    ["Kỹ thuật", row.scoreComponents.technical],
    ["Động lượng", row.scoreComponents.momentum],
    ["Dòng tiền", row.scoreComponents.moneyFlow],
    ["Cơ bản", row.scoreComponents.fundamental],
    ["Tổng hợp", row.ratingScore],
  ] as const
  const width = 880
  const height = 300
  const points = metrics.map(([, value], index) => {
    const x = 52 + index * ((width - 104) / (metrics.length - 1))
    const y = height - 52 - value / 100 * (height - 92)
    return `${x},${y}`
  })
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-[#07111f] p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="font-extrabold text-white">Hồ sơ điểm hiện tại</h3><p className="mt-1 text-xs text-muted-2">So sánh 4 trụ cột với rating tổng hợp</p></div>
        <Badge variant="outline" className="border-violet-400/25 bg-violet-400/10 text-violet-300">{row.provider}</Badge>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="mt-4 h-[250px] w-full" role="img" aria-label={`Hồ sơ rating ${row.ticker}`}>
        <defs><linearGradient id={`rating-${row.ticker}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8b7cff" stopOpacity=".42" /><stop offset="100%" stopColor="#22c98a" stopOpacity=".02" /></linearGradient></defs>
        {[25, 50, 75, 100].map((level) => {
          const y = height - 52 - level / 100 * (height - 92)
          return <g key={level}><line x1="42" x2={width - 42} y1={y} y2={y} stroke="rgba(148,163,184,.13)" strokeDasharray="5 8" /><text x="6" y={y + 4} fill="#62727d" fontSize="12">{level}</text></g>
        })}
        <polygon points={`${points[0].split(",")[0]},${height - 52} ${points.join(" ")} ${points.at(-1)?.split(",")[0]},${height - 52}`} fill={`url(#rating-${row.ticker})`} />
        <polyline points={points.join(" ")} fill="none" stroke="#8b7cff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        {metrics.map(([label, value], index) => {
          const [x, y] = points[index].split(",").map(Number)
          return <g key={label}><circle cx={x} cy={y} r="6" fill="#22c98a" stroke="#07111f" strokeWidth="4" /><text x={x} y={y - 15} textAnchor="middle" fill="#e1e7ec" fontSize="15" fontWeight="800">{value}</text><text x={x} y={height - 18} textAnchor="middle" fill="#8a9ba7" fontSize="13" fontWeight="700">{label}</text></g>
        })}
      </svg>
    </div>
  )
}

function RatingDialog({ row, onOpenChange }: { row: InsightsRatingRow | null; onOpenChange: (open: boolean) => void }) {
  if (!row) return null
  const positive = (row.changePercent ?? 0) >= 0
  const scoreCards = [
    { label: "Kỹ thuật", value: row.scoreComponents.technical, tone: "amber" as const, icon: Activity },
    { label: "Động lượng", value: row.scoreComponents.momentum, tone: "violet" as const, icon: Bolt },
    { label: "Dòng tiền", value: row.scoreComponents.moneyFlow, tone: "cyan" as const, icon: CircleDollarSign },
    { label: "Cơ bản", value: row.scoreComponents.fundamental, tone: "emerald" as const, icon: Layers3 },
  ]
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto border border-cyan-300/20 bg-[#060c16] p-0 shadow-[0_40px_120px_-20px_rgba(0,0,0,.98),0_0_70px_-35px_rgba(103,232,249,.6)] sm:max-w-[1080px]">
        <DialogHeader className="border-b border-white/[0.07] bg-[#08111f] p-6 pr-14">
          <div className="flex flex-wrap items-center gap-4">
            <StockLogo symbol={row.ticker} size={56} className="rounded-full shadow-[0_0_28px_-6px_rgba(139,124,255,.8)]" />
            <div>
              <DialogTitle className="text-2xl font-extrabold text-white">{row.companyName} <span className="text-violet-300">{row.ticker}</span></DialogTitle>
              <DialogDescription className="mt-1 font-ticker text-sm text-muted-2">Rating score & market profile · {row.provider}</DialogDescription>
            </div>
            <Badge variant="outline" className="ml-auto h-9 border-brand/35 bg-brand/10 px-4 font-mono text-lg font-black text-brand">{row.ratingScore}/100</Badge>
          </div>
        </DialogHeader>

        <div className="space-y-5 p-5 sm:p-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Giá", formatPrice(row.price), "text-white"],
              ["Biến động", formatPercent(row.changePercent), positive ? "text-up" : "text-down"],
              ["Khối lượng", compactVolume(row.volume), "text-cyan-300"],
              ["Rating tổng hợp", `${row.ratingScore}/100`, "text-violet-300"],
            ].map(([label, value, tone]) => <div key={label} className="rounded-xl border border-white/[0.07] bg-[#091321] p-4"><div className="text-xs font-bold uppercase tracking-wider text-muted">{label}</div><div className={cn("mt-2 font-mono text-xl font-black", tone)}>{value}</div></div>)}
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.07] bg-[#091321] p-4">
            <span className="mr-2 text-xs font-extrabold uppercase tracking-wider text-muted">Phân loại</span>
            <Badge variant="outline" className="border-cyan-300/25 bg-cyan-300/[0.08] text-cyan-300">{row.sector}</Badge>
            <Badge variant="outline" className={row.ratingScore >= 85 ? "border-up/30 bg-up/10 text-up" : row.ratingScore >= 70 ? "border-ref/30 bg-ref/10 text-ref" : "border-down/30 bg-down/10 text-down"}>{row.ratingScore >= 85 ? "Conviction cao" : row.ratingScore >= 70 ? "Đáng theo dõi" : "Cần thận trọng"}</Badge>
            {row.asOfDate && <Badge variant="outline" className="border-white/10 bg-white/[0.03] text-muted-2">Snapshot {row.asOfDate}</Badge>}
          </div>

          <ScoreProfileChart row={row} />

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {scoreCards.map(({ label, value, tone, icon: Icon }) => (
              <div key={label} className="rounded-xl border border-white/[0.07] bg-[#091321] p-4">
                <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-sm font-bold text-muted-2"><Icon className="size-4" /> {label}</span><ScorePill value={value} tone={tone} label={label} /></div>
                <div className="mt-4"><AnimatedProgressBar value={value} color={tone === "amber" ? "#fcd34d" : tone === "violet" ? "#a78bfa" : tone === "cyan" ? "#67e8f9" : "#6ee7b7"} /></div>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-3 border-t border-white/[0.07] pt-5 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2 text-muted-2"><Info className="mt-0.5 size-4 shrink-0 text-ref" /><span>Dữ liệu phục vụ phân tích, không phải khuyến nghị đầu tư. Biểu đồ thể hiện cấu trúc điểm hiện tại, không phải time series.</span></div>
            <Link href={`/research/${row.ticker.toLowerCase()}`} className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-brand/30 bg-brand/10 px-4 py-2 font-bold text-brand transition-colors hover:bg-brand/15">Mở nghiên cứu <ExternalLink className="size-4" /></Link>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function InsightsDashboard({ data }: { data: InsightsDashboardData }) {
  const [filter, setFilter] = useState<"all" | "up" | "down">("all")
  const [query, setQuery] = useState("")
  const [selectedRating, setSelectedRating] = useState<InsightsRatingRow | null>(null)
  const quote = data.vnindex
  const positive = (quote?.changePercent ?? 0) >= 0
  const breadthTotal = (quote?.advances ?? 0) + (quote?.declines ?? 0)
  const filteredRatings = useMemo(() => {
    const normalized = query.trim().toUpperCase()
    return data.ratings.filter((row) => {
      if (filter === "up" && (row.changePercent ?? 0) < 0) return false
      if (filter === "down" && (row.changePercent ?? 0) >= 0) return false
      return !normalized || row.ticker.includes(normalized) || row.companyName.toUpperCase().includes(normalized)
    })
  }, [data.ratings, filter, query])

  return (
    <div className="min-h-screen bg-background font-ticker text-foreground">
      <TopNav />
      <main className="mx-auto w-full max-w-[1520px] px-4 pb-16 pt-8 sm:px-6 lg:px-8">
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
            <CardHeader className="flex-col gap-4 border-b border-white/[0.06] p-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap gap-2">
                {([['all', 'Tất cả'], ['up', 'Tăng'], ['down', 'Giảm']] as const).map(([value, label]) => (
                  <Button key={value} type="button" variant="outline" size="sm" onClick={() => setFilter(value)} className={cn("border-white/10 bg-white/[0.02] text-muted-2", filter === value && "border-brand/40 bg-brand/12 text-brand")}>{label}</Button>
                ))}
              </div>
              <div className="relative w-full lg:w-80">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm mã hoặc tên..." aria-label="Tìm mã cổ phiếu" className="h-10 border-white/10 bg-cell pl-9 text-base text-white placeholder:text-muted focus-visible:border-brand/50 focus-visible:ring-brand/20" />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-[#05090f]">
                  <TableRow className="border-white/[0.08] hover:bg-transparent">
                    <TableHead className="h-14 px-4 text-xs font-extrabold uppercase tracking-[0.12em] text-muted-2"># · Cổ phiếu</TableHead>
                    <TableHead className="text-right text-xs font-extrabold uppercase tracking-[0.12em] text-muted-2">Giá / %</TableHead>
                    <TableHead className="hidden text-right text-xs font-extrabold uppercase tracking-[0.12em] text-muted-2 md:table-cell">Khối lượng</TableHead>
                    <TableHead className="hidden text-center text-xs font-extrabold uppercase tracking-[0.12em] text-amber-300 lg:table-cell"><span className="inline-flex items-center gap-1"><Bolt className="size-3.5" /> Kỹ thuật</span></TableHead>
                    <TableHead className="hidden text-center text-xs font-extrabold uppercase tracking-[0.12em] text-violet-300 lg:table-cell"><span className="inline-flex items-center gap-1"><Bolt className="size-3.5" /> Động lượng</span></TableHead>
                    <TableHead className="hidden text-center text-xs font-extrabold uppercase tracking-[0.12em] text-cyan-300 xl:table-cell"><span className="inline-flex items-center gap-1"><CircleDollarSign className="size-3.5" /> Dòng tiền</span></TableHead>
                    <TableHead className="hidden text-center text-xs font-extrabold uppercase tracking-[0.12em] text-emerald-300 xl:table-cell"><span className="inline-flex items-center gap-1"><Layers3 className="size-3.5" /> Cơ bản</span></TableHead>
                    <TableHead className="min-w-40 px-4 text-right text-xs font-extrabold uppercase tracking-[0.12em] text-brand">Rating</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRatings.map((row, index) => (
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
                      <TableCell className="px-4 py-3.5">
                        <RatingTooltip row={row}>
                          <div className="flex min-w-56 items-center gap-3">
                            <span className="flex h-8 w-9 items-center justify-center rounded-md border border-white/[0.07] bg-white/[0.025] font-mono text-xs font-bold text-muted">{String(index + 1).padStart(2, "0")}</span>
                            <StockLogo symbol={row.ticker} size={38} className="rounded-full group-hover:shadow-[0_0_20px_-5px_rgba(103,232,249,.75)]" />
                            <div className="min-w-0"><div className="text-base font-extrabold text-white group-hover:text-cyan-200">{row.ticker}</div><div className="mt-0.5 max-w-40 truncate text-xs font-medium text-muted-2 2xl:max-w-56">{row.companyName} · {row.sector}</div></div>
                          </div>
                        </RatingTooltip>
                      </TableCell>
                      <TableCell className="text-right"><div className="font-mono text-base font-black text-white">{formatPrice(row.price)}</div><div className={cn("mt-1 font-mono text-xs font-extrabold", (row.changePercent ?? 0) >= 0 ? "text-up" : "text-down")}>{formatPercent(row.changePercent)}</div></TableCell>
                      <TableCell className="hidden text-right font-mono text-sm font-semibold text-muted-2 md:table-cell">{compactVolume(row.volume)}</TableCell>
                      <TableCell className="hidden text-center lg:table-cell" onClick={(event) => event.stopPropagation()}><ScorePill value={row.scoreComponents.technical} tone="amber" label="Kỹ thuật" /></TableCell>
                      <TableCell className="hidden text-center lg:table-cell" onClick={(event) => event.stopPropagation()}><ScorePill value={row.scoreComponents.momentum} tone="violet" label="Động lượng" /></TableCell>
                      <TableCell className="hidden text-center xl:table-cell" onClick={(event) => event.stopPropagation()}><ScorePill value={row.scoreComponents.moneyFlow} tone="cyan" label="Dòng tiền" /></TableCell>
                      <TableCell className="hidden text-center xl:table-cell" onClick={(event) => event.stopPropagation()}><ScorePill value={row.scoreComponents.fundamental} tone="emerald" label="Cơ bản" /></TableCell>
                      <TableCell className="px-4">
                        <div className="flex items-center justify-end gap-3"><div className="hidden w-20 sm:block"><AnimatedProgressBar value={row.ratingScore} color={row.ratingScore >= 80 ? "#22c98a" : row.ratingScore >= 65 ? "#e2b93b" : "#ff4757"} /></div><strong className={cn("flex size-11 items-center justify-center rounded-lg border font-mono text-lg", row.ratingScore >= 80 ? "border-up/35 bg-up/10 text-up" : row.ratingScore >= 65 ? "border-ref/35 bg-ref/10 text-ref" : "border-down/35 bg-down/10 text-down")}>{row.ratingScore}</strong><ArrowRight className="size-4 text-muted transition-transform group-hover:translate-x-1 group-hover:text-cyan-300" /></div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!filteredRatings.length && <TableRow><TableCell colSpan={8} className="h-32 text-center text-sm text-muted-2">Không có mã phù hợp với bộ lọc.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
            <div className="flex flex-col gap-2 border-t border-white/[0.06] px-4 py-4 text-xs font-medium text-muted-2 sm:flex-row sm:items-center sm:justify-between">
              <span>Hiển thị <strong className="text-white">{filteredRatings.length}</strong> / {data.ratings.length} mã</span>
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
      <RatingDialog row={selectedRating} onOpenChange={(open) => { if (!open) setSelectedRating(null) }} />
    </div>
  )
}
