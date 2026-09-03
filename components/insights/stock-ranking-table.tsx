"use client"

import * as React from "react"
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Bolt,
  Building2,
  CalendarDays,
  CalendarRange,
  ChevronsUpDown,
  CircleAlert,
  Compass,
  Cpu,
  Flame,
  FlaskConical,
  HeartPulse,
  Info,
  Landmark,
  Layers3,
  LineChart,
  Radar,
  RefreshCw,
  Rocket,
  ShieldCheck,
  ShoppingBag,
  Target,
  TrendingDown,
  TrendingUp,
  Truck,
  Utensils,
  Zap,
} from "lucide-react"

import { MarketChangePill } from "@/components/market-change-pill"
import { StockLogo } from "@/components/stock-logo"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { InsightsRatingRow } from "@/lib/insights-data"
import { getMetricSemantic } from "@/lib/insights-metric-semantics"
import { cn } from "@/lib/utils"
import { KFSP_FIELD_CATALOG, type KfspFieldDefinition } from "@/supabase/functions/_shared/kfsp-catalog"

export type StockRankingSortKey = keyof Pick<InsightsRatingRow,
  "ticker" | "price" | "marketCapBillion" | "canslimScore" | "score4m" | "pricePotential" | "rsShort" | "rsMedium" |
  "stockRrgState" | "weeklyChangePercent" | "monthlyChangePercent" | "ratingScore"
>
export type StockRankingSortDirection = "asc" | "desc"

export function compareStockRankingValues(
  left: string | number | null,
  right: string | number | null,
  direction: StockRankingSortDirection,
) {
  if (left == null && right == null) return 0
  if (left == null) return 1
  if (right == null) return -1
  const result = typeof left === "number" && typeof right === "number"
    ? left - right
    : String(left).localeCompare(String(right), "vi", { numeric: true, sensitivity: "base" })
  return direction === "asc" ? result : -result
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

function compactVolume(value: number | null) {
  if (value == null) return "—"
  return new Intl.NumberFormat("vi-VN", { notation: "compact", maximumFractionDigits: 2 }).format(value)
}

function formatMarketCapBillion(value: number | null) {
  if (value == null) return "—"
  return `${value.toLocaleString("vi-VN", { maximumFractionDigits: 0 })} tỷ`
}

function getSectorIcon(sector: string) {
  const normalized = sector.toLowerCase()
  if (normalized.includes("ngân hàng") || normalized.includes("bank")) return Landmark
  if (normalized.includes("chứng khoán") || normalized.includes("tài chính")) return LineChart
  if (normalized.includes("bất động sản") || normalized.includes("xây dựng")) return Building2
  if (normalized.includes("công nghệ") || normalized.includes("it") || normalized.includes("viễn thông")) return Cpu
  if (normalized.includes("bán lẻ") || normalized.includes("tiêu dùng")) return ShoppingBag
  if (normalized.includes("thép") || normalized.includes("vật liệu") || normalized.includes("kim loại") || normalized.includes("thương mại")) return Layers3
  if (normalized.includes("dầu khí") || normalized.includes("năng lượng") || normalized.includes("điện")) return Flame
  if (normalized.includes("thực phẩm") || normalized.includes("đồ uống") || normalized.includes("nông nghiệp")) return Utensils
  if (normalized.includes("y tế") || normalized.includes("dược")) return HeartPulse
  if (normalized.includes("hóa chất") || normalized.includes("phân bón")) return FlaskConical
  if (normalized.includes("vận tải") || normalized.includes("logistics") || normalized.includes("cảng")) return Truck
  if (normalized.includes("bảo hiểm")) return ShieldCheck
  if (normalized.includes("du lịch") || normalized.includes("dịch vụ")) return Compass
  return Layers3
}

const OVERVIEW_FIELD_BY_KEY = new Map(
  KFSP_FIELD_CATALOG.filter((field) => field.group === "overview").map((field) => [field.key, field]),
)

function overviewField(key: string) {
  const definition = OVERVIEW_FIELD_BY_KEY.get(key)
  if (!definition) throw new Error(`Missing KFSP overview definition: ${key}`)
  return definition
}

function metricTone(value: number | null, definition: KfspFieldDefinition) {
  if (definition.format !== "percent" && definition.format !== "score") return "text-white"
  if (value == null || !Number.isFinite(value)) return "text-white"
  if (definition.format === "score") return value >= 60 ? "text-up" : value < 40 ? "text-down" : "text-ref"
  return value > 0 ? "text-up" : value < 0 ? "text-down" : "text-ref"
}

type ScoreTone = "amber" | "violet" | "cyan" | "emerald"

const SCORE_TONE: Record<ScoreTone, string> = {
  amber: "border-amber-300/35 bg-amber-300/[0.09] text-amber-300 shadow-[0_0_18px_-8px_rgba(252,211,77,0.65)]",
  violet: "border-violet-400/35 bg-violet-400/[0.09] text-violet-300 shadow-[0_0_18px_-8px_rgba(167,139,250,0.65)]",
  cyan: "border-cyan-300/35 bg-cyan-300/[0.09] text-cyan-300 shadow-[0_0_18px_-8px_rgba(103,232,249,0.65)]",
  emerald: "border-emerald-300/35 bg-emerald-300/[0.09] text-emerald-300 shadow-[0_0_18px_-8px_rgba(110,231,183,0.65)]",
}

function SortableHead({
  sortKey,
  activeKey,
  direction,
  onSort,
  definition,
  metricKey,
  label,
  className,
  onOpenGuide,
}: {
  sortKey: StockRankingSortKey
  activeKey: StockRankingSortKey
  direction: StockRankingSortDirection
  onSort: (key: StockRankingSortKey) => void
  definition?: KfspFieldDefinition
  metricKey?: string
  label?: string
  className?: string
  onOpenGuide?: (key: string) => void
}) {
  const active = sortKey === activeKey
  const Icon = active ? (direction === "asc" ? ArrowUp : ArrowDown) : ChevronsUpDown
  const effectiveKey = metricKey || definition?.key || ""
  const semantic = effectiveKey ? getMetricSemantic(effectiveKey) : null
  const displayLabel = label || definition?.label || semantic?.label || effectiveKey || sortKey
  const description = semantic?.beginner.what || definition?.description || ""
  const notMeaning = semantic?.beginner.notMeaning

  return (
    <TableHead aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"} className={className}>
      <div className="inline-flex w-full items-center justify-center gap-1">
        <button
          type="button"
          onClick={() => onSort(sortKey)}
          aria-label={`Sắp xếp theo ${displayLabel}`}
          className="inline-flex items-center gap-1 rounded-md py-0.5 outline-none transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-brand/50"
        >
          <span>{displayLabel}</span>
          <Icon className={cn("size-3.5 shrink-0", active ? "text-brand" : "text-muted")} />
        </button>
        {effectiveKey ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    if (onOpenGuide) onOpenGuide(effectiveKey)
                  }}
                  aria-label={`Xem giải thích chỉ số ${displayLabel}`}
                  className="inline-flex size-4.5 items-center justify-center rounded text-muted-2 transition-colors hover:bg-white/10 hover:text-cyan-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/50"
                />
              }
            >
              <Info className="size-3 opacity-60 hover:opacity-100" />
            </TooltipTrigger>
            <TooltipContent className="w-80 max-w-sm space-y-2 border border-white/10 bg-[#090e19] p-3 text-xs leading-relaxed text-white shadow-2xl pointer-events-none">
              <div className="border-b border-white/10 pb-1 font-bold text-cyan-300">{displayLabel}</div>
              <div className="leading-relaxed text-slate-300">{description}</div>
              {notMeaning ? (
                <div className="rounded-md border border-rose-500/20 bg-rose-500/[0.08] p-2 text-[11px] leading-relaxed text-rose-200">
                  <strong className="text-rose-300">Không có nghĩa là:</strong> {notMeaning}
                </div>
              ) : null}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </TableHead>
  )
}

function ScorePill({
  value,
  tone,
  label,
  description,
  metricKey,
  icon: Icon = Bolt,
  onOpenGuide,
}: {
  value: number | null | undefined
  tone: ScoreTone
  label: string
  description?: string
  metricKey?: string
  icon?: typeof Bolt
  onOpenGuide?: (key: string) => void
}) {
  if (value == null) return <span className="font-mono text-xs text-muted-2">—</span>
  const rounded = Math.round(value)
  const semantic = metricKey ? getMetricSemantic(metricKey) : null
  const displayDesc = description || semantic?.beginner.what || ""
  const hasGuide = Boolean(metricKey && onOpenGuide)

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          hasGuide ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onOpenGuide?.(metricKey!)
              }}
              aria-label={`${label}: ${rounded}/100. Nhấp để xem giải thích chỉ số`}
              className={cn(
                "inline-flex h-8 min-w-13 cursor-pointer items-center justify-center gap-1 rounded-md border px-1.5 font-mono text-xs font-black transition-colors hover:border-white/40 hover:bg-white/[0.14] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 sm:text-sm",
                SCORE_TONE[tone],
              )}
            />
          ) : (
            <span
              tabIndex={0}
              aria-label={`${label}: ${rounded}/100`}
              className={cn(
                "inline-flex h-8 min-w-13 cursor-help items-center justify-center gap-1 rounded-md border px-1.5 font-mono text-xs font-black focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/50 sm:text-sm",
                SCORE_TONE[tone],
              )}
            />
          )
        }
      >
        <Icon className="size-3 shrink-0 sm:size-3.5" /> {rounded}
      </TooltipTrigger>
      <TooltipContent className="w-80 max-w-sm space-y-2 border border-white/10 bg-[#090e19] p-3 font-ticker text-xs text-white shadow-2xl pointer-events-none">
        <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-1.5">
          <span className="font-bold text-slate-200">{label}</span>
          <span className="font-mono font-bold text-brand">{rounded}/100</span>
        </div>
        {displayDesc ? <div className="leading-relaxed text-slate-300">{displayDesc}</div> : null}
        {semantic?.beginner.notMeaning ? (
          <div className="rounded-md border border-rose-500/20 bg-rose-500/[0.08] p-2 text-[11px] leading-relaxed text-rose-200">
            <strong className="text-rose-300">Lưu ý:</strong> {semantic.beginner.notMeaning}
          </div>
        ) : null}
      </TooltipContent>
    </Tooltip>
  )
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
      </TooltipContent>
    </Tooltip>
  )
}

interface StockRankingTableProps {
  rows: InsightsRatingRow[]
  sort: { key: StockRankingSortKey; direction: StockRankingSortDirection }
  onSort: (key: StockRankingSortKey) => void
  onOpenStock: (row: InsightsRatingRow) => void
  onOpenGuide?: (key: string) => void
  emptyMessage?: string
}

export function StockRankingTable({
  rows,
  sort,
  onSort,
  onOpenStock,
  onOpenGuide,
  emptyMessage = "Không có mã phù hợp với bộ lọc.",
}: StockRankingTableProps) {
  return (
    <div className="w-full overflow-x-auto">
      <Table className="w-full min-w-[1400px] table-fixed font-ticker">
        <colgroup><col className="w-[18%]" /><col className="w-[7%]" /><col className="w-[9%]" /><col className="w-[7%]" /><col className="w-[7%]" /><col className="w-[8%]" /><col className="w-[5%]" /><col className="w-[5%]" /><col className="w-[9%]" /><col className="w-[7%]" /><col className="w-[7%]" /><col className="w-[11%]" /></colgroup>
        <TableHeader className="sticky top-0 z-20 bg-[#05090f]">
          <TableRow className="border-white/[0.08] hover:bg-transparent">
            <SortableHead sortKey="ticker" activeKey={sort.key} direction={sort.direction} onSort={onSort} label="# · Cổ phiếu / Ngành" className="h-14 px-2 text-xs font-extrabold uppercase text-muted-2" />
            <SortableHead sortKey="price" activeKey={sort.key} direction={sort.direction} onSort={onSort} definition={overviewField("price")} metricKey="price" onOpenGuide={onOpenGuide} className="px-1 text-xs font-extrabold uppercase text-muted-2" />
            <SortableHead sortKey="marketCapBillion" activeKey={sort.key} direction={sort.direction} onSort={onSort} label="Vốn hóa" metricKey="market_cap_billion" onOpenGuide={onOpenGuide} className="px-1 text-xs font-extrabold uppercase text-cyan-200" />
            <SortableHead sortKey="canslimScore" activeKey={sort.key} direction={sort.direction} onSort={onSort} definition={overviewField("kfsp_canslim_score")} metricKey="kfsp_canslim_score" onOpenGuide={onOpenGuide} className="px-1 text-xs font-extrabold uppercase text-emerald-300" />
            <SortableHead sortKey="score4m" activeKey={sort.key} direction={sort.direction} onSort={onSort} definition={overviewField("kfsp_score_4m")} metricKey="kfsp_score_4m" onOpenGuide={onOpenGuide} className="px-1 text-xs font-extrabold uppercase text-amber-300" />
            <SortableHead sortKey="pricePotential" activeKey={sort.key} direction={sort.direction} onSort={onSort} definition={overviewField("kfsp_price_potential")} metricKey="kfsp_price_potential" onOpenGuide={onOpenGuide} className="px-1 text-xs font-extrabold uppercase text-ref" />
            <SortableHead sortKey="rsShort" activeKey={sort.key} direction={sort.direction} onSort={onSort} definition={overviewField("rs_short")} metricKey="rs_short" onOpenGuide={onOpenGuide} className="px-1 text-xs font-extrabold uppercase text-cyan-300" />
            <SortableHead sortKey="rsMedium" activeKey={sort.key} direction={sort.direction} onSort={onSort} definition={overviewField("rs_medium")} metricKey="rs_medium" onOpenGuide={onOpenGuide} className="px-1 text-xs font-extrabold uppercase text-violet-300" />
            <SortableHead sortKey="stockRrgState" activeKey={sort.key} direction={sort.direction} onSort={onSort} label="RRG cổ phiếu" metricKey="kfsp_stock_rrg_state" onOpenGuide={onOpenGuide} className="px-1 text-xs font-extrabold uppercase text-cyan-300" />
            <SortableHead sortKey="weeklyChangePercent" activeKey={sort.key} direction={sort.direction} onSort={onSort} definition={overviewField("weekly_change_pct")} metricKey="weekly_change_pct" onOpenGuide={onOpenGuide} className="px-1 text-xs font-extrabold uppercase text-cyan-200" />
            <SortableHead sortKey="monthlyChangePercent" activeKey={sort.key} direction={sort.direction} onSort={onSort} definition={overviewField("monthly_change_pct")} metricKey="monthly_change_pct" onOpenGuide={onOpenGuide} className="px-1 text-xs font-extrabold uppercase text-violet-200" />
            <SortableHead sortKey="ratingScore" activeKey={sort.key} direction={sort.direction} onSort={onSort} label="Qeo composite" metricKey="kfsp_composite_score" onOpenGuide={onOpenGuide} className="px-1 text-xs font-extrabold uppercase text-brand" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => {
            const SectorIcon = getSectorIcon(row.sector)
            const rowPositive = (row.changePercent ?? 0) > 0
            const rowTone = (row.changePercent ?? 0) > 0 ? "up" : (row.changePercent ?? 0) < 0 ? "down" : "ref"
            return (
              <TableRow
                key={`${row.ticker}-${row.asOfDate}`}
                tabIndex={0}
                role="button"
                aria-label={`Mở hồ sơ rating ${row.ticker}`}
                onClick={() => onOpenStock(row)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    onOpenStock(row)
                  }
                }}
                className="group cursor-pointer border-white/[0.065] bg-[#07101a]/35 outline-none transition-colors hover:bg-cyan-300/[0.035] hover:shadow-[inset_3px_0_0_rgba(103,232,249,.7),0_0_24px_-16px_rgba(103,232,249,.7)] focus-visible:bg-cyan-300/[0.04] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-cyan-300/50"
              >
                <TableCell className="px-2 py-3.5">
                  <RatingTooltip row={row}>
                    <div className="flex items-center gap-2">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-white/[0.07] bg-white/[0.025] font-mono text-xs font-bold text-muted">{String(index + 1).padStart(2, "0")}</span>
                      <StockLogo symbol={row.ticker} size={36} className="shrink-0 rounded-full group-hover:shadow-[0_0_20px_-5px_rgba(103,232,249,.75)]" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1 font-ticker text-[16px] font-extrabold leading-none tracking-tight text-white group-hover:text-cyan-200">{row.ticker}</div>
                        <div className="mt-1 flex items-center gap-1 text-[11px] font-bold uppercase text-cyan-300/80"><SectorIcon className="size-3 shrink-0" /><span className="truncate">{row.sector}</span></div>
                      </div>
                    </div>
                  </RatingTooltip>
                </TableCell>
                <TableCell className="px-1 text-center">
                  <div className={cn("font-mono text-[14px] font-bold leading-tight tracking-tight", rowPositive ? "text-up" : (row.changePercent ?? 0) < 0 ? "text-down" : "text-ref")}>{formatPrice(row.price)}</div>
                  <div className="mt-1 flex justify-center"><MarketChangePill value={row.changePercent} tone={rowTone} compact /></div>
                </TableCell>
                <TableCell className="px-1 text-center font-mono text-xs font-bold text-cyan-100">{formatMarketCapBillion(row.marketCapBillion)}</TableCell>
                <TableCell className="px-1 text-center"><ScorePill value={row.canslimScore} tone="emerald" icon={Target} label="Điểm CANSLIM" description={overviewField("kfsp_canslim_score").description} metricKey="kfsp_canslim_score" onOpenGuide={onOpenGuide} /></TableCell>
                <TableCell className="px-1 text-center"><ScorePill value={row.score4m} tone="amber" icon={Bolt} label="Điểm 4M" description={overviewField("kfsp_score_4m").description} metricKey="kfsp_score_4m" onOpenGuide={onOpenGuide} /></TableCell>
                <TableCell className="px-1 text-center"><Badge variant="outline" className={cn("gap-1 border-white/10 bg-white/[0.03] px-1.5 text-xs font-bold", row.pricePotential?.startsWith("Tăng") ? "text-up" : row.pricePotential?.startsWith("Giảm") ? "text-down" : "text-ref")}>{row.pricePotential?.startsWith("Giảm") ? <TrendingDown className="size-3.5" /> : <TrendingUp className="size-3.5" />}{row.pricePotential || "—"}</Badge></TableCell>
                <TableCell className="px-1 text-center"><ScorePill value={row.rsShort ?? row.scoreComponents.momentum} tone="cyan" icon={Zap} label="RSs" description={overviewField("rs_short").description} metricKey="rs_short" onOpenGuide={onOpenGuide} /></TableCell>
                <TableCell className="px-1 text-center"><ScorePill value={row.rsMedium ?? row.scoreComponents.moneyFlow} tone="violet" icon={Radar} label="RSm" description={overviewField("rs_medium").description} metricKey="rs_medium" onOpenGuide={onOpenGuide} /></TableCell>
                <TableCell className="px-1 text-center"><RrgBadge value={row.stockRrgState} /></TableCell>
                <TableCell className="px-1 text-center"><span className={cn("inline-flex items-center gap-1 font-mono text-xs font-bold sm:text-sm", metricTone(row.weeklyChangePercent, overviewField("weekly_change_pct")))}><CalendarDays className="size-3.5" />{formatPercent(row.weeklyChangePercent)}</span></TableCell>
                <TableCell className="px-1 text-center"><span className={cn("inline-flex items-center gap-1 font-mono text-xs font-bold sm:text-sm", metricTone(row.monthlyChangePercent, overviewField("monthly_change_pct")))}><CalendarRange className="size-3.5" />{formatPercent(row.monthlyChangePercent)}</span></TableCell>
                <TableCell className="px-1 text-center"><div className="flex items-center justify-center gap-1"><strong className={cn("flex size-9 items-center justify-center rounded-lg border font-mono text-base font-black sm:size-10", row.ratingScore >= 80 ? "border-up/35 bg-up/10 text-up" : row.ratingScore >= 65 ? "border-ref/35 bg-ref/10 text-ref" : "border-down/35 bg-down/10 text-down")}>{row.ratingScore}</strong><ArrowRight className="size-3.5 text-muted transition-transform group-hover:translate-x-1 group-hover:text-cyan-300" /></div></TableCell>
              </TableRow>
            )
          })}
          {!rows.length ? <TableRow><TableCell colSpan={12} className="h-32 text-center text-sm text-muted-2">{emptyMessage}</TableCell></TableRow> : null}
        </TableBody>
      </Table>
    </div>
  )
}
