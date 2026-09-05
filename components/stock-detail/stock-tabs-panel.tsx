"use client"

import Link from "next/link"
import React, { useMemo, useState } from "react"
import {
  Activity,
  BadgePercent,
  BarChart3,
  Bolt,
  Building2,
  Droplets,
  ExternalLink,
  FileText,
  Gauge,
  Info,
  Layers3,
  LineChart,
  Maximize2,
  PieChart,
  Radar,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Zap,
} from "lucide-react"

import AnimatedProgressBar from "@/components/smoothui/animated-progress-bar"
import { TtaiDashboard } from "@/components/insights/ttai-dashboard"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { StockDetailData } from "./types"
import type { InsightsRatingRow, KfspMetricValue } from "@/modules/research/insights/data"
import { getMetricSemantic } from "@/modules/research/insights/metric-semantics"
import {
  calculateRatingModel,
  historyDelta,
  type RatingDimension,
  type RatingModelSnapshot,
} from "@/modules/research/insights/rating-model"
import { cn } from "@/modules/shared/ui/cn"
import {
  KFSP_FIELD_CATALOG,
  KFSP_GROUPS,
  type KfspFieldDefinition,
} from "@/supabase/functions/_shared/kfsp-catalog"

type StockDetailTab = "overview" | "info" | "ta" | "ttai"

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

function compactVolume(value: number | null) {
  if (value == null) return "—"
  return new Intl.NumberFormat("vi-VN", { notation: "compact", maximumFractionDigits: 2 }).format(value)
}

function formatMarketCapBillion(value: number | null) {
  if (value == null) return "—"
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

function MetricLabel({
  definition,
  metricKey,
  label,
  className,
}: {
  definition?: KfspFieldDefinition
  metricKey?: string
  label?: string
  className?: string
}) {
  const effectiveKey = metricKey || definition?.key || ""
  const semantic = getMetricSemantic(effectiveKey)
  const displayLabel = label || definition?.label || semantic?.label || effectiveKey
  const description = semantic?.beginner.what || definition?.description || ""
  const notMeaning = semantic?.beginner.notMeaning

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            aria-label={`Giải thích chỉ số ${displayLabel}`}
            className={cn("inline-flex cursor-help items-center gap-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/50 rounded", className)}
          />
        }
      >
        {displayLabel}
        <Info className="size-3.5 opacity-55 hover:opacity-100 transition-opacity" />
      </TooltipTrigger>
      <TooltipContent className="max-w-80 border border-white/10 bg-[#090e19] px-3.5 py-2.5 text-xs leading-5 text-white shadow-2xl space-y-2 pointer-events-none">
        <div className="font-bold text-cyan-300">{displayLabel}</div>
        <div className="text-muted-2">{description}</div>
        {notMeaning && (
          <div className="rounded border border-rose-500/20 bg-rose-500/[0.08] p-1.5 text-[11px] text-rose-200 leading-4">
            <strong>Không có nghĩa là:</strong> {notMeaning}
          </div>
        )}
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
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / dimensions.length
    const length = (radius * dimension.score) / 100
    return `${(center + Math.cos(angle) * length).toFixed(1)},${(center + Math.sin(angle) * length).toFixed(1)}`
  }).join(" ")
}

function RatingRadar({ row }: { row: InsightsRatingRow }) {
  const history = row.scoreHistory?.length ? row.scoreHistory : [row]
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
            const angle = -Math.PI / 2 + (index * Math.PI * 2) / model.dimensions.length
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

function AccumulationHeatmap({ row }: { row: InsightsRatingRow }) {
  const history = [...(row.scoreHistory || [])].sort((a, b) => a.asOfDate.localeCompare(b.asOfDate))

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
                                getTileColor(score),
                              )}
                            >
                              {score}
                            </div>
                          }
                        />
                        <TooltipContent className="w-56 border border-white/10 bg-[#090e19] p-3 text-xs font-ticker text-white shadow-2xl space-y-1">
                          <div className="font-bold text-cyan-300 border-b border-white/10 pb-1">{dim.label}</div>
                          <div className="flex justify-between text-slate-300"><span>Snapshot:</span> <strong className="font-mono text-white">{col.fullDate}</strong></div>
                          <div className="flex justify-between text-slate-300"><span>Điểm:</span> <strong className="font-mono text-emerald-300">{score}/100</strong></div>
                        </TooltipContent>
                      </Tooltip>
                    )
                  })}
                </div>
              </div>
            )
          })}

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
  const history = [...(row.scoreHistory || [])].sort((a, b) => a.asOfDate.localeCompare(b.asOfDate)).filter((item) => item.ratingScore != null)
  if (history.length < 2) {
    return (
      <div className="rounded-2xl border border-white/[0.07] bg-[#07111f] p-4 font-ticker text-xs text-muted-2">
        <LineChart className="mr-2 inline size-4 text-violet-300" />
        Lịch sử sẽ tự mở rộng sau các snapshot cron tiếp theo; hiện chưa đủ 2 mốc để vẽ đường điểm.
      </div>
    )
  }
  const width = 960
  const points = history.map((item, index) => `${40 + (index * (width - 80)) / Math.max(1, history.length - 1)},${190 - (item.ratingScore || 0) * 1.45}`)
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-[#07111f] p-4 sm:p-5 font-ticker">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.06] pb-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-violet-500/20 bg-violet-500/10">
            <LineChart className="size-4 text-violet-300" />
          </span>
          <div className="min-w-0">
            <h4 className="text-base font-extrabold text-white">Xu hướng Qeo composite qua các phiên</h4>
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

export function StockTabsPanel({ data }: { data: StockDetailData }) {
  const [topTab, setTopTab] = useState<StockDetailTab>("overview")
  const row = data.ratingRow

  if (!row) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-[#07111f] p-6 text-center text-slate-400 font-ticker text-sm">
        Đang tải dữ liệu hồ sơ phân tích cho mã {data.ticker}...
      </div>
    )
  }

  const ratingModel = calculateRatingModel(row)
  const fieldByKey = new Map(KFSP_FIELD_CATALOG.map((field) => [field.key, field]))
  const deltaRs7d = historyDelta(row.rsShort ?? 50, row.scoreHistory || [], 7, (item) => item.rsShort)
  const deltaRs30d = historyDelta(row.rsShort ?? 50, row.scoreHistory || [], 30, (item) => item.rsShort)

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
        const width = value == null ? 0 : Math.min(50, (Math.abs(value) / performanceScale) * 50)
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
            <span className={cn("text-right font-mono text-sm font-black", value == null ? "text-muted-2" : value >= 0 ? "text-up" : "text-down")}>
              {formatPercent(value)}
            </span>
          </div>
        )
      })}
    </div>
  )

  return (
    <div className="overflow-hidden rounded-2xl border border-cyan-300/20 bg-[#060c16] font-ticker shadow-[0_40px_120px_-20px_rgba(0,0,0,.98),0_0_70px_-35px_rgba(103,232,249,.3)]">
      {/* HEADER TABS & ACTIONS */}
      <div className="shrink-0 border-b border-white/[0.08] bg-[#080d19] px-4 py-3 sm:px-5">
        <div className="flex items-center justify-between gap-4 overflow-x-auto">
          <nav
            className="inline-flex min-w-max items-center gap-1.5 rounded-full border border-white/[0.1] bg-[#080c10]/90 p-1 shadow-[0_0_24px_-4px_rgba(176,124,255,0.18),0_0_24px_-4px_rgba(34,201,138,0.18)]"
            role="tablist"
            aria-label="Điều hướng hồ sơ cổ phiếu"
          >
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

      {/* TAB PANELS BODY */}
      <div className="p-4 sm:p-5">
        {/* ========================================================================= */}
        {/* TAB 1: TỔNG QUAN                                                         */}
        {/* ========================================================================= */}
        {topTab === "overview" && (
          <section id="rating-panel-overview" role="tabpanel" aria-labelledby="rating-tab-overview" className="space-y-4">
            {/* Top 4 Summary Cards */}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border border-violet-300/20 bg-violet-400/[0.07] p-4">
                <div className="flex items-center justify-between text-xs font-extrabold uppercase tracking-wider text-violet-200/70">
                  <span>Qeo composite</span>
                  <Sparkles className="size-4" />
                </div>
                <div className="mt-3 font-mono text-3xl font-black text-violet-200">
                  {row.ratingScore}
                  <span className="text-base text-violet-200/50">/100</span>
                </div>
                <div className="mt-2 text-sm font-bold text-white">{ratingModel.state}</div>
              </div>

              <div className="rounded-xl border border-emerald-300/20 bg-emerald-400/[0.07] p-4">
                <div className="flex items-center justify-between text-xs font-extrabold uppercase tracking-wider text-emerald-200/70">
                  <span>CANSLIM / 4M</span>
                  <Target className="size-4" />
                </div>
                <div className="mt-3 flex items-end gap-3">
                  <span className="font-mono text-2xl font-black text-emerald-300">{row.canslimScore}</span>
                  <span className="pb-1 text-muted-2">/</span>
                  <span className="font-mono text-2xl font-black text-amber-300">{row.score4m}</span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {row.canslimScore == null ? (
                    <span className="text-xs text-muted-2">CANSLIM —</span>
                  ) : (
                    <AnimatedProgressBar value={row.canslimScore} color="#6ee7b7" />
                  )}
                  {row.score4m == null ? (
                    <span className="text-xs text-muted-2">4M —</span>
                  ) : (
                    <AnimatedProgressBar value={row.score4m} color="#fcd34d" />
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-cyan-300/20 bg-cyan-400/[0.07] p-4">
                <div className="flex items-center justify-between text-xs font-extrabold uppercase tracking-wider text-cyan-200/70">
                  <span>RS Momentum</span>
                  <Zap className="size-4" />
                </div>
                <div className="mt-3 font-mono text-2xl font-black text-cyan-200">
                  {row.rsShort ?? "—"}
                  <span className="text-base text-cyan-200/45"> · {row.rsMedium ?? "—"}</span>
                </div>
                <div className="mt-2 flex gap-3 text-xs font-bold text-muted-2">
                  <span>
                    7D <b className={(deltaRs7d ?? 0) >= 0 ? "text-up" : "text-down"}>{deltaRs7d == null ? "—" : `${deltaRs7d >= 0 ? "+" : ""}${deltaRs7d}`}</b>
                  </span>
                  <span>
                    30D <b className={(deltaRs30d ?? 0) >= 0 ? "text-up" : "text-down"}>{deltaRs30d == null ? "—" : `${deltaRs30d >= 0 ? "+" : ""}${deltaRs30d}`}</b>
                  </span>
                </div>
              </div>

              <div className="rounded-xl border border-amber-300/20 bg-amber-400/[0.06] p-4">
                <div className="flex items-center justify-between text-xs font-extrabold uppercase tracking-wider text-amber-200/70">
                  <span>Market state</span>
                  <Radar className="size-4" />
                </div>
                <div className="mt-3 text-xl font-black text-white">{row.stockRrgState || "—"}</div>
                <div className="mt-2 flex flex-wrap gap-3 text-xs font-bold text-muted-2">
                  <span>RSI <b className="text-white">{rsi ?? "—"}</b></span>
                  <span>Beta <b className="text-white">{row.beta ?? metricDisplay("beta")}</b></span>
                  <span>{smaAboveCount}/5 SMA phía trên</span>
                </div>
              </div>
            </div>

            {/* 2 Columns: 30% left / 70% right */}
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
                    {["net_revenue_growth_pct", "net_income_growth_pct", "roe_ttm_pct", "net_margin_ttm_pct", "pe_ttm", "pb_ttm"].map((key) =>
                      metricTile(key, "h-full"),
                    )}
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
                    {["price_vs_sma20_pct", "price_vs_sma50_pct", "price_vs_sma200_pct", "rsi_14", "macd_vs_signal", "position_in_bollinger_band"].map((key) =>
                      metricTile(key, "h-full"),
                    )}
                  </div>
                </div>

                {/* 3. Range & thanh khoản */}
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
                    <div className="rounded-xl bg-white/[0.03] p-3">
                      <span className="text-[11px] font-bold text-muted-2">Cách đỉnh 52W</span>
                      <div className="mt-1.5 font-mono text-base font-black text-white">{metricDisplay("distance_to_52w_high_pct")}</div>
                    </div>
                    <div className="rounded-xl bg-white/[0.03] p-3">
                      <span className="text-[11px] font-bold text-muted-2">Cách đáy 52W</span>
                      <div className="mt-1.5 font-mono text-base font-black text-white">{metricDisplay("distance_to_52w_low_pct")}</div>
                    </div>
                    <div className="rounded-xl bg-white/[0.03] p-3">
                      <span className="text-[11px] font-bold text-muted-2">Volume vs trước</span>
                      <div className="mt-1.5 font-mono text-base font-black text-white">{metricDisplay("volume_vs_previous_session_pct")}</div>
                    </div>
                    <div className="rounded-xl bg-white/[0.03] p-3">
                      <span className="text-[11px] font-bold text-muted-2">GTGD vs trước</span>
                      <div className="mt-1.5 font-mono text-base font-black text-white">{metricDisplay("traded_value_vs_previous_session_pct")}</div>
                    </div>
                  </div>
                  <div className="mt-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5 text-[11px] font-semibold text-muted-2">
                    KLGD TB 50P <strong className="font-mono text-white">{compactVolume(row.volume)}</strong> · Vốn hóa{" "}
                    <strong className="font-mono text-white">
                      {row.marketCapBillion == null ? "—" : formatMarketCapBillion(row.marketCapBillion)}
                    </strong>
                  </div>
                </div>
              </div>

              {/* CỘT PHẢI (70% width) */}
              <div className="space-y-4">
                {/* 1. QeoIndex state radar */}
                <RatingRadar row={row} />

                {/* 2. Ma trận tích lũy & Trạng thái thị trường */}
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

                {/* 4. Xu hướng Qeo composite qua các phiên */}
                <RatingHistoryChart row={row} />
              </div>
            </div>
          </section>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: THÔNG TIN DOANH NGHIỆP                                            */}
        {/* ========================================================================= */}
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
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {["company_name", "charter_capital_billion", "market_cap_billion", "shares_outstanding", "website"].map((key) =>
                  metricTile(key),
                )}
              </div>
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
                {[
                  { label: "Free float", value: freeFloat, display: metricDisplay("free_float_pct") },
                  { label: "Room nước ngoài còn lại", value: foreignRoom, display: metricDisplay("foreign_room_remaining_pct") },
                ].map((item) => (
                  <div key={item.label} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-muted-2">{item.label}</span>
                      <span className="font-mono text-lg font-black text-white">{item.display}</span>
                    </div>
                    <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/[0.06]">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400"
                        style={{ width: `${Math.max(0, Math.min(100, item.value ?? 0))}%` }}
                      />
                    </div>
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
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {["eps_ttm_vnd", "pe_ttm", "bvps_ttm_vnd", "pb_ttm", "eps_ttm_growth_pct", "bvps_ttm_growth_pct"].map((key) =>
                    metricTile(key),
                  )}
                </div>
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
                <div className="grid gap-2 sm:grid-cols-2">
                  {["financial_period", "net_revenue_ttm_billion", "net_income_ttm_billion"].map((key) => metricTile(key))}
                </div>
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
                <div className="mt-4 space-y-3.5">
                  {[
                    { label: "Doanh thu", key: "net_revenue_growth_pct" },
                    { label: "LN sau thuế", key: "net_income_growth_pct" },
                    { label: "EPS", key: "eps_ttm_growth_pct" },
                    { label: "BVPS", key: "bvps_ttm_growth_pct" },
                  ].map((item) => {
                    const value = metricNumber(item.key)
                    const width = value == null ? 0 : Math.min(100, Math.abs(value))
                    return (
                      <div key={item.key}>
                        <div className="mb-1.5 flex items-center justify-between text-xs font-bold">
                          <span className="text-muted-2">{item.label}</span>
                          <span className={value == null ? "text-muted-2" : value >= 0 ? "text-up" : "text-down"}>
                            {value == null ? "—" : formatPercent(value)}
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-white/[0.05]">
                          <div
                            className={cn("h-full rounded-full", (value ?? 0) >= 0 ? "bg-emerald-400" : "bg-rose-400")}
                            style={{ width: `${width}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
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
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  {["net_margin_ttm_pct", "roa_ttm_pct", "roe_ttm_pct"].map((key) => metricTile(key))}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: PHÂN TÍCH TA                                                      */}
        {/* ========================================================================= */}
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
                <div className="space-y-3">
                  {smaDistance.map((item) => {
                    const width = item.value == null ? 0 : Math.min(50, (Math.abs(item.value) / smaScale) * 50)
                    return (
                      <div key={item.label} className="grid grid-cols-[60px_1fr_70px] items-center gap-3">
                        <span className="text-xs font-extrabold text-muted-2">{item.label}</span>
                        <div className="relative h-2.5 rounded-full bg-white/[0.05]">
                          <span className="absolute left-1/2 top-0 h-full w-px bg-white/20" />
                          {item.value != null && (
                            <span
                              className={cn("absolute top-0 h-full rounded-full", item.value >= 0 ? "left-1/2 bg-cyan-400" : "right-1/2 bg-rose-400")}
                              style={{ width: `${width}%` }}
                            />
                          )}
                        </div>
                        <span className={cn("text-right font-mono text-xs font-black", item.value == null ? "text-muted-2" : item.value >= 0 ? "text-up" : "text-down")}>
                          {formatPercent(item.value)}
                        </span>
                      </div>
                    )
                  })}
                </div>
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
                <div className="mt-2 flex items-center justify-between text-xs font-bold text-muted-2">
                  <span>0</span>
                  <span>30</span>
                  <span>70</span>
                  <span>100</span>
                </div>
                <div className="relative mt-2 h-3 rounded-full bg-gradient-to-r from-cyan-500/35 via-white/10 to-rose-500/35">
                  <span
                    className="absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#07111f] bg-white shadow-[0_0_14px_rgba(255,255,255,.5)]"
                    style={{ left: `${Math.max(0, Math.min(100, rsi ?? 50))}%` }}
                  />
                </div>
                <div className="mt-4 font-mono text-2xl font-black text-white">{rsi ?? "—"}</div>
                <p className="mt-1 text-xs text-muted-2">
                  {rsi == null ? "Không có dữ liệu" : rsi < 30 ? "Vùng quá bán" : rsi > 70 ? "Vùng quá mua" : "Vùng trung tính"}
                </p>
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

            {/* Phạm vi giá & Biên độ kỹ thuật */}
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
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="text-xs uppercase tracking-wider text-muted-2">
                    <tr className="border-b border-white/10">
                      <th className="pb-3">Khung</th>
                      <th className="pb-3">Độ rộng</th>
                      <th className="pb-3">Vị trí</th>
                      <th className="pb-3">Khoảng cách đặc biệt</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06] text-white">
                    {[
                      { label: "10D", width: "range_width_10d_pct", position: "position_in_10d_range", distance: null },
                      { label: "20D", width: "range_width_20d_pct", position: "position_in_20d_range", distance: null },
                      { label: "50D", width: "range_width_50d_pct", position: "position_in_50d_range", distance: null },
                      { label: "52W", width: "range_width_52w_pct", position: "position_in_52w_range", distance: "distance_to_52w_high_pct" },
                    ].map((item) => (
                      <tr key={item.label}>
                        <td className="py-3 font-extrabold">{item.label}</td>
                        <td className="py-3 font-mono">{metricDisplay(item.width)}</td>
                        <td className="py-3 font-semibold">{metricDisplay(item.position)}</td>
                        <td className="py-3 font-mono text-muted-2">
                          {item.distance
                            ? `Đỉnh: ${metricDisplay(item.distance)} · Đáy: ${metricDisplay("distance_to_52w_low_pct")}`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Khối lượng & Giá trị giao dịch */}
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
                <div className="space-y-3">
                  {volumeSeries.map((item) => (
                    <div key={item.label} className="grid grid-cols-[72px_1fr_90px] items-center gap-3">
                      <span className="text-xs font-bold text-muted-2">{item.label}</span>
                      <div className="h-2.5 rounded-full bg-white/[0.05]">
                        <div
                          className="h-full rounded-full bg-cyan-400"
                          style={{ width: `${Math.min(100, ((item.value ?? 0) / volumeScale) * 100)}%` }}
                        />
                      </div>
                      <span className="text-right font-mono text-xs font-black text-white">
                        {item.value == null ? "—" : compactVolume(item.value)}
                      </span>
                    </div>
                  ))}
                </div>
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
                <div className="space-y-3">
                  {tradedValueSeries.map((item) => (
                    <div key={item.label} className="grid grid-cols-[72px_1fr_90px] items-center gap-3">
                      <span className="text-xs font-bold text-muted-2">{item.label}</span>
                      <div className="h-2.5 rounded-full bg-white/[0.05]">
                        <div
                          className="h-full rounded-full bg-amber-400"
                          style={{ width: `${Math.min(100, ((item.value ?? 0) / tradedValueScale) * 100)}%` }}
                        />
                      </div>
                      <span className="text-right font-mono text-xs font-black text-white">
                        {item.value == null ? "—" : `${formatNumber(item.value)} tỷ`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Giao dịch khối ngoại & Tự doanh */}
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
                {["volume_vs_previous_session_pct", "traded_value_vs_previous_session_pct", "net_foreign_trading_billion", "net_proprietary_trading_billion"].map(
                  (key) => metricTile(key),
                )}
                {metricTile("beta")}
              </div>
            </div>
          </section>
        )}

        {/* ========================================================================= */}
        {/* TAB 4: TTAI                                                              */}
        {/* ========================================================================= */}
        {topTab === "ttai" && <TtaiDashboard row={row} />}
      </div>
    </div>
  )
}
