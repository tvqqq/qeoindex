"use client"

import * as React from "react"
import {
  ArrowRight,
  Building2,
  CalendarDays,
  CalendarRange,
  ChevronDown,
  CircleAlert,
  Compass,
  Cpu,
  Crown,
  FlaskConical,
  Flame,
  HeartPulse,
  Landmark,
  Layers,
  Layers3,
  LineChart,
  Radar,
  RefreshCw,
  Rocket,
  Search,
  ShieldCheck,
  ShoppingBag,
  Target,
  TrendingDown,
  TrendingUp,
  Truck,
  Utensils,
  X,
  Zap,
} from "lucide-react"

import type { MarketHistoryPoint, MarketSectorHistoryItem, MarketSectorRow } from "@/lib/market-insight-data"
import type { InsightsRatingRow } from "@/lib/insights-data"
import { StockLogo } from "@/components/stock-logo"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

interface SectorMapPanelProps {
  sectors: MarketSectorRow[]
  ratings?: InsightsRatingRow[]
  sectorHistory?: MarketSectorHistoryItem[]
  marketHistory?: MarketHistoryPoint[]
  onSelectSector?: (sector: MarketSectorRow) => void
  onOpenStockDetail?: (ticker: string) => void
}

type SectorHeadingIcon = React.ComponentType<{ className?: string }>

export function getSectorIcon(sector: string) {
  const normalized = (sector || "").toLowerCase()
  if (normalized.includes("ngân hàng") || normalized.includes("bank")) return Landmark
  if (normalized.includes("chứng khoán") || normalized.includes("tài chính")) return LineChart
  if (normalized.includes("bất động sản") || normalized.includes("xây dựng") || normalized.includes("đầu tư xây dựng")) return Building2
  if (normalized.includes("công nghệ") || normalized.includes("it") || normalized.includes("viễn thông")) return Cpu
  if (normalized.includes("bán lẻ") || normalized.includes("tiêu dùng") || normalized.includes("sản xuất kinh doanh")) return ShoppingBag
  if (normalized.includes("thép") || normalized.includes("vật liệu") || normalized.includes("kim loại") || normalized.includes("khoáng sản") || normalized.includes("nhựa") || normalized.includes("thương mại")) return Layers3
  if (normalized.includes("dầu khí") || normalized.includes("năng lượng") || normalized.includes("tiện ích") || normalized.includes("điện")) return Flame
  if (normalized.includes("thực phẩm") || normalized.includes("đồ uống") || normalized.includes("nông nghiệp") || normalized.includes("nông - lâm - ngư")) return Utensils
  if (normalized.includes("y tế") || normalized.includes("dược")) return HeartPulse
  if (normalized.includes("hóa chất") || normalized.includes("phân bón")) return FlaskConical
  if (normalized.includes("vận tải") || normalized.includes("logistics") || normalized.includes("cảng") || normalized.includes("hàng không")) return Truck
  if (normalized.includes("bảo hiểm")) return ShieldCheck
  if (normalized.includes("du lịch") || normalized.includes("dịch vụ")) return Compass
  return Layers3
}

function SectorLabel({ name, compact = false }: { name: string; compact?: boolean }) {
  const Icon = getSectorIcon(name)
  return (
    <span className={cn(
      "inline-flex max-w-full items-center gap-1.5 rounded-md border border-cyan-400/25 bg-cyan-400/10 px-1.5 py-0.5 font-sans font-bold text-cyan-300",
      compact ? "text-[10px]" : "text-xs",
    )}>
      <Icon className={cn(compact ? "size-3" : "size-3.5", "shrink-0")} />
      <span className="truncate">{name}</span>
    </span>
  )
}

function SectorPanelHeading({
  icon: Icon,
  eyebrow,
  title,
  description,
}: {
  icon: SectorHeadingIcon
  eyebrow: string
  title: string
  description?: string
}) {
  return (
    <div className="flex min-w-0 items-center gap-3.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-purple-400/25 bg-purple-500/10 text-purple-300 shadow-sm sm:size-10">
        <Icon className="size-4 sm:size-5" />
      </span>
      <div className="min-w-0">
        <p className="font-mono text-[10px] font-black uppercase tracking-[0.2em] text-purple-400">
          {eyebrow}
        </p>
        <h3 className="mt-0.5 text-base font-bold tracking-wide text-white sm:text-lg">
          {title}
        </h3>
        {description ? (
          <p className="mt-0.5 text-[11px] font-medium italic text-slate-400">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  )
}

function formatNumber(value: number | null | undefined, decimals = 0) {
  if (value == null || !Number.isFinite(value)) return "—"
  return new Intl.NumberFormat("vi-VN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)
}

function formatSigned(value: number | null | undefined, decimals = 2, suffix = "") {
  if (value == null || !Number.isFinite(value)) return "—"
  return `${value > 0 ? "+" : ""}${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: decimals }).format(value)}${suffix}`
}

function formatPrice(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—"
  return new Intl.NumberFormat("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
}

export const ROTATION_LABELS: Record<string, string> = {
  leading: "Dẫn dắt",
  recovering: "Phục hồi",
  weakening: "Suy yếu",
  lagging: "Đội sổ",
}

export function rotationBadgeClass(state: string) {
  switch (state) {
    case "leading":
      return "bg-[#059669] text-white border-[#10b981]/40"
    case "recovering":
      return "bg-[#0284c7] text-white border-[#38bdf8]/40"
    case "weakening":
      return "bg-[#d97706] text-white border-[#fbbf24]/40"
    case "lagging":
      return "bg-[#e11d48] text-white border-[#f43f5e]/40"
    default:
      return "bg-[#059669] text-white border-[#10b981]/40"
  }
}

function RotationBadge({ value }: { value: string | null | undefined }) {
  const Icon = value === "Dẫn dắt" || value === "leading" ? Rocket
    : value === "Phục hồi" || value === "recovering" ? RefreshCw
      : value === "Suy yếu" || value === "weakening" ? TrendingDown
        : value === "Đội sổ" || value === "lagging" ? CircleAlert : Radar
  const label = ROTATION_LABELS[value || ""] || value || "—"
  const tone = label === "Dẫn dắt" ? "border-emerald-300/30 bg-emerald-400/15 text-emerald-300"
    : label === "Phục hồi" ? "border-sky-300/30 bg-sky-400/15 text-sky-300"
      : label === "Suy yếu" ? "border-amber-300/30 bg-amber-400/15 text-amber-300"
        : label === "Đội sổ" ? "border-rose-300/30 bg-rose-400/15 text-rose-300"
          : "border-white/10 bg-white/[0.03] text-slate-400"

  return (
    <span className={cn("inline-flex min-w-20 items-center justify-center gap-1 rounded-md border px-1.5 py-0.5 font-sans text-[10px] font-bold", tone)}>
      <Icon className="size-3.5" />
      {label}
    </span>
  )
}

export function inferRotationState(
  item: {
    rotationState?: string | null
    averageChangePct?: number | null
    rsScore?: number | null
    effortPct?: number | null
    resultPct?: number | null
    advances?: number | null
    declines?: number | null
  },
  sIdx: number = 0,
  dIdx: number = 0,
  vnindexChg: number = 0
): "leading" | "recovering" | "weakening" | "lagging" | "unknown" {
  if (
    item.rotationState &&
    item.rotationState !== "unknown" &&
    (item.rotationState === "leading" ||
      item.rotationState === "recovering" ||
      item.rotationState === "weakening" ||
      item.rotationState === "lagging")
  ) {
    return item.rotationState
  }

  void sIdx
  void dIdx
  void vnindexChg
  return "unknown"
}

function SectorMiniSparkline({ data, positive }: { data: number[]; positive: boolean }) {
  if (!data || data.length < 2) return <div className="h-4 w-12" />
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const width = 44
  const height = 16
  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * width
    const y = height - ((value - min) / range) * (height - 4) - 2
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(" ")

  return (
    <svg width={width} height={height} className="inline-block overflow-visible" aria-hidden="true">
      <polyline
        fill="none"
        stroke={positive ? "#34d399" : "#f43f5e"}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  )
}

export function SectorMapPanel({
  sectors,
  ratings = [],
  sectorHistory = [],
  marketHistory = [],
  onSelectSector,
  onOpenStockDetail,
}: SectorMapPanelProps) {
  const [hoveredEffortSector, setHoveredEffortSector] = React.useState<MarketSectorRow | null>(null)
  const [effortTooltipPos, setEffortTooltipPos] = React.useState<{ x: number; y: number } | null>(null)
  const [selectedModalSector, setSelectedModalSector] = React.useState<string | null>(null)
  const [modalUniverse, setModalUniverse] = React.useState<"all" | "top100">("all")
  const [modalSearch, setModalSearch] = React.useState("")

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedModalSector(null)
    }
    if (!selectedModalSector) return
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [selectedModalSector])

  const currentSectors = React.useMemo(() => {
    const daily = sectors.filter((sector) => sector.timeWindow === "1d")
    const list = daily.length > 0 ? daily : sectors
    return [...list].sort((a, b) => (b.rsScore ?? b.averageChangePct ?? -999) - (a.rsScore ?? a.averageChangePct ?? -999))
  }, [sectors])

  const topPodiumSectors = React.useMemo(
    () => currentSectors.filter((sector) => sector.averageChangePct != null).slice(0, 3),
    [currentSectors],
  )

  const leadingNames = currentSectors
    .filter((sector) => sector.rotationState === "leading")
    .slice(0, 3)
    .map((sector) => sector.displayName)

  const recoveringNames = currentSectors
    .filter((sector) => sector.rotationState === "recovering")
    .slice(0, 5)
    .map((sector) => sector.displayName)

  const sessionDates = React.useMemo(() => {
    const dates = new Set<string>()
    sectorHistory.forEach((item) => item.sessionDate && dates.add(item.sessionDate))
    marketHistory.forEach((item) => item.sessionDate && dates.add(item.sessionDate))
    return Array.from(dates).sort().slice(-8)
  }, [sectorHistory, marketHistory])

  const historyMatrixMap = React.useMemo(() => {
    const map = new Map<string, MarketSectorHistoryItem>()
    sectorHistory.forEach((item) => map.set(`${item.sectorKey}:${item.sessionDate}`, item))
    return map
  }, [sectorHistory])

  const marketByDate = React.useMemo(() => {
    const map = new Map<string, MarketHistoryPoint>()
    marketHistory.forEach((item) => map.set(item.sessionDate, item))
    return map
  }, [marketHistory])

  const allSectorNames = React.useMemo(() => {
    const names = new Set<string>()
    currentSectors.forEach((sector) => names.add(sector.displayName))
    ratings.forEach((row) => row.sector && names.add(row.sector))
    return Array.from(names).sort((a, b) => a.localeCompare(b, "vi"))
  }, [currentSectors, ratings])

  const modalStocks = React.useMemo(() => {
    if (!selectedModalSector) return []
    const target = selectedModalSector.trim().toLowerCase()
    const query = modalSearch.trim().toLowerCase()

    return ratings
      .filter((row) => {
        if (target !== "all" && target !== "tất cả ngành") {
          const sector = (row.sector || "").trim().toLowerCase()
          const industry = (row.industryGroup || "").toLowerCase()
          if (!sector.includes(target) && !target.includes(sector) && !industry.includes(target)) return false
        }
        if (modalUniverse === "top100" && !row.isTop100) return false
        if (query && !row.ticker.toLowerCase().includes(query) && !(row.companyName || "").toLowerCase().includes(query)) return false
        return true
      })
      .sort((a, b) => (b.ratingScore ?? 0) - (a.ratingScore ?? 0))
  }, [ratings, selectedModalSector, modalUniverse, modalSearch])

  const handleOpenSectorModal = (sectorName: string, sectorRow?: MarketSectorRow) => {
    setSelectedModalSector(sectorName)
    setModalUniverse("all")
    setModalSearch("")
    if (sectorRow) onSelectSector?.(sectorRow)
  }

  const getSectorEffortMetrics = (sector: MarketSectorRow) => {
    const currVal = sector.tradedValue
    const prevVal = sector.previousTradedValue
    return {
      currVal,
      prevVal,
      effortPct: sector.effortPct,
      netChange: currVal != null && prevVal != null ? +(currVal - prevVal).toFixed(2) : null,
      resultPct: sector.resultPct,
      advances: sector.advances || 0,
      unchanged: sector.unchanged || 0,
      declines: sector.declines || 0,
    }
  }

  const quickPills = React.useMemo(
    () => ratings
      .filter((row) => row.ticker && row.changePercent != null)
      .slice(0, 10)
      .map((row) => ({ ticker: row.ticker, change: row.changePercent ?? 0 })),
    [ratings],
  )

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-white/[0.08] bg-[#07131d]/90 p-5 shadow-xl sm:p-6">
        <SectorPanelHeading
          icon={Layers}
          eyebrow="TOP LEADING SECTORS"
          title="Ngành nghề nổi bật & Sức mạnh dòng tiền"
        />

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {topPodiumSectors.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] px-4 py-6 text-center text-sm text-slate-400 sm:col-span-2 lg:col-span-3">
              KFSP chưa có dữ liệu Kết quả ngành hợp lệ cho snapshot này.
            </div>
          ) : null}

          {topPodiumSectors.map((sector, index) => {
            const medal = index === 0 ? "🥇" : index === 1 ? "🥈" : "🥉"
            const changePct = sector.averageChangePct ?? 0
            const positive = changePct >= 0
            const SectorIcon = getSectorIcon(sector.displayName)
            const breadthTotal = Math.max(1, sector.advances + sector.unchanged + sector.declines)

            return (
              <button
                key={sector.sectorKey}
                type="button"
                onClick={() => handleOpenSectorModal(sector.displayName, sector)}
                className="relative flex flex-col justify-between overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0b1b26]/90 p-4 text-left transition-transform duration-150 hover:scale-[1.01] hover:border-teal-400/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2 font-mono text-xs font-black uppercase text-slate-200">
                    <span className="text-base">{medal}</span>
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-cyan-400/20 bg-cyan-400/10">
                      <SectorIcon className="size-3.5 text-cyan-400" />
                    </span>
                    <span className="truncate">{sector.displayName}</span>
                  </div>
                  {sector.rsScore != null ? (
                    <span className="shrink-0 rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] font-bold text-teal-300">
                      RS {formatNumber(sector.rsScore, 2)}
                    </span>
                  ) : null}
                </div>

                <div className="my-3 text-center">
                  <strong className={cn("font-mono text-2xl font-black tracking-tight sm:text-3xl", positive ? "text-emerald-400" : "text-rose-400")}>
                    {formatSigned(changePct, 2, "%")}
                  </strong>
                  {sector.tradedValue != null && sector.tradedValue > 0 ? (
                    <p className="mt-0.5 font-mono text-xs text-slate-400">
                      GTGD: <strong className="font-bold text-white">{formatNumber(sector.tradedValue, 0)}</strong> tỷ
                    </p>
                  ) : null}
                </div>

                <div className="mt-1 flex h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                  <span className="h-full bg-emerald-400" style={{ width: `${sector.advances / breadthTotal * 100}%` }} />
                  <span className="h-full bg-amber-400" style={{ width: `${sector.unchanged / breadthTotal * 100}%` }} />
                  <span className="h-full bg-rose-500" style={{ width: `${sector.declines / breadthTotal * 100}%` }} />
                </div>
              </button>
            )
          })}
        </div>

        <div className="mt-6 space-y-3 font-sans text-xs leading-relaxed text-slate-300 sm:text-sm">
          <p>
            Trạng thái <strong className="font-bold text-white">Dẫn dắt</strong> do KFSP trả về hiện gồm{" "}
            <strong className="font-bold text-white">{leadingNames.length > 0 ? leadingNames.join(", ") : "chưa có trạng thái Dẫn dắt từ KFSP"}</strong>.
          </p>
          <div className="flex items-start gap-2 pt-1">
            <Rocket className="mt-0.5 size-4 shrink-0 text-cyan-400" />
            <div>
              <strong className="mb-1 block font-bold text-white">Chuyển động sức mạnh Ngành:</strong>
              <p className="text-slate-300">
                Trạng thái <strong className="font-bold text-white">Phục hồi</strong> do KFSP trả về hiện gồm{" "}
                <strong className="font-bold text-white">{recoveringNames.length > 0 ? recoveringNames.join(", ") : "chưa có ngành Phục hồi trong snapshot"}</strong>.
              </p>
            </div>
          </div>
        </div>

        {quickPills.length > 0 ? (
          <div className="mt-5 flex flex-wrap gap-2 border-t border-white/[0.06] pt-3">
            {quickPills.map((pill) => (
              <button
                key={pill.ticker}
                type="button"
                onClick={() => onOpenStockDetail?.(pill.ticker)}
                className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#0c1d29] px-2.5 py-1 font-mono text-xs font-bold transition-colors hover:border-teal-400/40 hover:bg-[#122736]"
              >
                <span className="text-slate-300">{pill.ticker}</span>
                <span className={pill.change >= 0 ? "text-emerald-400" : "text-rose-400"}>{formatSigned(pill.change, 1, "%")}</span>
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <details
        data-sector-rotation-matrix
        className="group overflow-hidden rounded-2xl border border-white/[0.08] bg-[#07131d]/95 shadow-xl"
      >
        <summary
          data-sector-rotation-summary
          className="flex cursor-pointer list-none items-center justify-between gap-4 bg-[#050e16] px-4 py-3.5 outline-none marker:hidden focus-visible:ring-2 focus-visible:ring-purple-400/40 sm:px-5"
        >
          <SectorPanelHeading
            icon={RefreshCw}
            eyebrow="SECTOR ROTATION MATRIX"
            title="Luân chuyển & Nỗ lực kết quả dòng tiền"
            description="Rê chuột vào cột Nỗ lực / Kết quả để xem chi tiết"
          />
          <ChevronDown className="size-5 shrink-0 text-slate-500 transition-transform duration-200 group-open:rotate-180" />
        </summary>

        <div className="overflow-x-auto border-t border-white/[0.08]">
          <table className="w-full min-w-[1050px] border-collapse text-sm">
            <thead className="border-b border-white/[0.08] bg-[#050e16] font-sans text-xs font-bold text-slate-300">
              <tr>
                <th className="sticky left-0 z-20 w-52 bg-[#050e16] px-4 py-3.5 text-left">Tên ngành</th>
                <th className="w-36 px-3 py-3.5 text-center">Nỗ lực / Kết quả</th>
                <th className="w-14 px-2 py-3.5 text-center">Xu hướng</th>
                {sessionDates.map((date) => (
                  <th key={date} className="px-2 py-3.5 text-center font-mono">
                    <span>{date.slice(5)} ↑</span>
                  </th>
                ))}
                <th className="w-10 px-2 py-3.5 text-center">MA10</th>
                <th className="w-10 px-2 py-3.5 text-center">MA20</th>
                <th className="w-10 px-2 py-3.5 text-center">MA50</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              <tr className="bg-[#0b1c28]/80 font-mono font-bold text-white">
                <td className="sticky left-0 z-10 bg-[#0b1c28] px-4 py-2.5 uppercase text-teal-300">
                  <div className="flex items-center gap-2"><span className="flex size-5 items-center justify-center rounded bg-teal-400/10"><LineChart className="size-3.5" /></span>VNINDEX</div>
                </td>
                <td className="px-3 py-2 text-center text-[10px] text-slate-400">— / {formatSigned(marketHistory.at(-1)?.vnindexChangePct, 2, "%")}</td>
                <td className="px-2 py-2.5 text-center">
                  <SectorMiniSparkline data={marketHistory.flatMap((item) => item.vnindexChangePct == null ? [] : [item.vnindexChangePct])} positive={(marketHistory.at(-1)?.vnindexChangePct ?? 0) >= 0} />
                </td>
                {sessionDates.map((date) => {
                  const change = marketByDate.get(date)?.vnindexChangePct
                  return <td key={date} className={cn("px-2 py-2 text-center", (change ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400")}>{formatSigned(change, 2, "%")}</td>
                })}
                <td className="px-2 py-2.5 text-center text-slate-500">—</td>
                <td className="px-2 py-2.5 text-center text-slate-500">—</td>
                <td className="px-2 py-2.5 text-center text-slate-500">—</td>
              </tr>

              <tr className="bg-[#091721]/80 font-mono text-[11px] text-slate-300">
                <td className="sticky left-0 z-10 bg-[#091721] px-4 py-2 text-slate-400">
                  <div className="flex items-center gap-2"><span className="flex size-5 items-center justify-center rounded bg-cyan-400/10 text-cyan-300"><LineChart className="size-3.5" /></span>Thanh khoản VNINDEX</div>
                </td>
                <td className="px-3 py-2 text-center text-[10px] text-slate-400"><span title="Đơn vị nguồn chưa xác minh">GTGD: {formatNumber(marketHistory.at(-1)?.totalTradedValue, 2)}</span></td>
                <td className="px-2 py-2" />
                {sessionDates.map((date) => {
                  const point = marketByDate.get(date)
                  return <td key={date} className={cn("px-2 py-2 text-center", (point?.vnindexChangePct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400")}>{point?.totalTradedValue != null ? formatNumber(point.totalTradedValue, 2) : "—"}</td>
                })}
                <td className="px-2 py-2 text-center text-slate-500">—</td>
                <td className="px-2 py-2 text-center text-slate-500">—</td>
                <td className="px-2 py-2 text-center text-slate-500">—</td>
              </tr>

              {currentSectors.map((sector) => {
                const sparkValues = sessionDates.flatMap((date) => {
                  const item = historyMatrixMap.get(`${sector.sectorKey}:${date}`)
                  return item?.closePrice == null ? [] : [item.closePrice]
                })
                const metrics = getSectorEffortMetrics(sector)
                const effortBarWidth = metrics.effortPct == null ? 0 : Math.min(100, Math.max(8, Math.abs(metrics.effortPct) * 0.5))

                return (
                  <tr key={sector.sectorKey} onClick={() => handleOpenSectorModal(sector.displayName, sector)} className="group cursor-pointer transition-colors hover:bg-white/[0.04]">
                    <td className="sticky left-0 z-10 bg-[#07131d] px-4 py-2.5 font-sans text-sm font-semibold text-white transition-colors group-hover:bg-[#0c1e2d]">
                      <div className="flex items-center justify-between gap-2"><SectorLabel name={sector.displayName} /><ArrowRight className="size-3 shrink-0 text-slate-500 opacity-0 transition-opacity group-hover:opacity-100" /></div>
                    </td>
                    <td
                      className="px-3 py-2 text-center"
                      onMouseEnter={(event) => {
                        const rect = event.currentTarget.getBoundingClientRect()
                        setHoveredEffortSector(sector)
                        setEffortTooltipPos({ x: rect.left + rect.width / 2, y: rect.top - 6 })
                      }}
                      onMouseLeave={() => {
                        setHoveredEffortSector(null)
                        setEffortTooltipPos(null)
                      }}
                    >
                      <div className="mx-auto flex w-28 flex-col gap-1" aria-label={`Nỗ lực ${formatSigned(metrics.effortPct, 2, "%")}; Kết quả ${formatSigned(metrics.resultPct, 2, "%")}`}>
                        <div className="flex items-center justify-between gap-1.5 text-xs">
                          <span className="sr-only">Nỗ lực</span>
                          <div className="h-2 flex-1 overflow-hidden rounded-sm bg-slate-900">
                            <span className={cn("block h-full rounded-sm", (metrics.effortPct ?? 0) >= 0 ? "bg-emerald-500" : "bg-rose-500")} style={{ width: `${effortBarWidth}%` }} />
                          </div>
                          <span className={cn("w-11 shrink-0 text-right font-bold", (metrics.effortPct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400")}>{formatSigned(metrics.effortPct, 1, "%")}</span>
                        </div>
                        <div className="flex items-center justify-between gap-1.5 text-xs"><span className="text-slate-400">Kết quả:</span><span className={cn("font-bold", (metrics.resultPct ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300")}>{formatSigned(metrics.resultPct, 2, "%")}</span></div>
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-center"><SectorMiniSparkline data={sparkValues} positive={(sector.averageChangePct ?? 0) >= 0} /></td>
                    {sessionDates.map((date) => <td key={date} className="p-1 text-center"><RotationBadge value={historyMatrixMap.get(`${sector.sectorKey}:${date}`)?.rotationState ?? "unknown"} /></td>)}
                    {[sector.ma10State, sector.ma20State, sector.ma50State].map((state, index) => (
                      <td key={index} className="px-2 py-2.5 text-center font-mono text-xs font-bold">
                        {state === "up" ? <span className="text-emerald-400">▲</span> : state === "down" ? <span className="text-rose-400">▼</span> : <span className="text-slate-500">—</span>}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </details>

      {hoveredEffortSector && effortTooltipPos ? (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full overflow-hidden rounded-xl border border-purple-500/50 bg-[#08151f] shadow-2xl"
          style={{ left: `${effortTooltipPos.x}px`, top: `${effortTooltipPos.y}px`, minWidth: "260px" }}
        >
          <div className="bg-[#4c0d64] px-4 py-2 text-center"><strong className="font-mono text-xs font-black uppercase tracking-wider text-white">{hoveredEffortSector.displayName}</strong></div>
          {(() => {
            const metrics = getSectorEffortMetrics(hoveredEffortSector)
            return (
              <>
                <div className="grid grid-cols-2 gap-3 bg-[#0d3420] p-3 font-mono text-xs">
                  <div className="space-y-1"><strong className="mb-1 block text-white">Nỗ lực:</strong><p className="text-[11px] text-slate-200">Trước đó: <b>{formatNumber(metrics.prevVal, 2)} tỷ</b></p><p className="text-[11px] text-slate-200">Hiện tại: <b>{formatNumber(metrics.currVal, 2)} tỷ</b></p><p className="text-[11px] font-bold text-emerald-300">%Thay đổi: {formatSigned(metrics.effortPct, 2, "%")}</p><p className="text-[11px] text-slate-200">Thay đổi ròng: <b>{formatSigned(metrics.netChange, 2)} tỷ</b></p></div>
                  <div className="space-y-1"><strong className="mb-1 block text-white">Kết quả:</strong><p className="text-[11px] text-slate-200">%Thay đổi: <span className={cn("font-bold", (metrics.resultPct ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300")}>{formatSigned(metrics.resultPct, 2, "%")}</span></p></div>
                </div>
                <div className="flex items-center justify-center gap-4 bg-white px-3 py-1.5 text-center font-mono text-xs font-bold text-slate-900"><span className="text-emerald-600">▲ {metrics.advances}</span><span className="text-amber-500">■ {metrics.unchanged}</span><span className="text-rose-600">▼ {metrics.declines}</span></div>
              </>
            )
          })()}
        </div>
      ) : null}

      {selectedModalSector ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="sector-modal-title"
          onClick={() => setSelectedModalSector(null)}
          className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-black/80 p-2 sm:p-4"
        >
          <div
            data-stock-ranking-dialog
            onClick={(event) => event.stopPropagation()}
            className="relative flex max-h-[calc(100vh-32px)] w-full max-w-[1280px] flex-col overflow-hidden rounded-[22px] border border-white/10 bg-[#070e17] shadow-2xl"
          >
            <div className="border-b border-white/[0.08] bg-[#050b12] px-5 py-4 sm:px-6 sm:py-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <span className="font-mono text-[10px] font-black uppercase tracking-[0.2em] text-emerald-400">SIGNAL RANKING</span>
                  <h2 id="sector-modal-title" className="mt-0.5 text-xl font-black text-white sm:text-2xl">Top cổ phiếu theo Qeo composite</h2>
                  <p className="mt-0.5 text-xs text-slate-400">Điểm cao hỗ trợ so sánh, không phải lệnh mua. (Nhấn ESC để đóng)</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Badge variant="outline" className="border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 font-mono text-xs font-bold text-emerald-300">Supabase live</Badge>
                  <button type="button" onClick={() => setSelectedModalSector(null)} className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white" aria-label="Đóng popup (ESC)"><X className="size-5" /></button>
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="flex rounded-xl border border-white/10 bg-white/[0.03] p-1 font-mono text-xs">
                    <button type="button" onClick={() => setModalUniverse("top100")} className={cn("flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-bold transition-colors", modalUniverse === "top100" ? "bg-teal-400/20 text-teal-200" : "text-slate-400 hover:text-white")}><Crown className="size-3 text-amber-400" />Top 100</button>
                    <button type="button" onClick={() => setModalUniverse("all")} className={cn("rounded-lg px-3 py-1.5 font-bold transition-colors", modalUniverse === "all" ? "bg-teal-400/20 text-teal-200" : "text-slate-400 hover:text-white")}>Tất cả</button>
                  </div>

                  <Select value={selectedModalSector} onValueChange={(value) => value && setSelectedModalSector(value)}>
                    <SelectTrigger aria-label="Chọn ngành" className="h-9 min-w-[220px] border-white/10 bg-[#091522] text-xs font-bold text-white hover:bg-white/[0.05] sm:text-sm">
                      <SelectValue>{selectedModalSector === "all" ? "Ngành: Tất cả ngành" : `Ngành: ${selectedModalSector.toUpperCase()}`}</SelectValue>
                    </SelectTrigger>
                    <SelectContent align="start" className="max-h-80 border border-white/10 bg-[#07131f] text-white">
                      <SelectGroup>
                        <SelectLabel className="px-2 py-1.5 text-[10px] font-bold uppercase text-slate-500">Danh sách ngành</SelectLabel>
                        <SelectItem value="all" className="text-xs font-bold">Tất cả ngành</SelectItem>
                        {allSectorNames.map((name) => <SelectItem key={name} value={name} className="text-xs font-bold">Ngành: {name.toUpperCase()}</SelectItem>)}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>

                <div className="relative w-full sm:w-72">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-500" />
                  <Input value={modalSearch} onChange={(event) => setModalSearch(event.target.value)} placeholder="Tìm mã hoặc tên..." className="h-9 border-white/10 bg-white/[0.03] pl-8 text-xs text-white placeholder:text-slate-500 focus-visible:border-teal-400" />
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-[1160px] border-collapse text-xs">
                <thead className="sticky top-0 z-10 border-b border-white/[0.08] bg-[#050b12] font-mono text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="w-48 px-4 py-3 text-left"># · Cổ phiếu / Ngành</th>
                    <th className="w-24 px-2 py-3 text-center">Giá</th>
                    <th className="w-28 px-2 py-3 text-center text-emerald-400">Điểm CANSLIM</th>
                    <th className="w-24 px-2 py-3 text-center text-amber-400">Điểm 4M</th>
                    <th className="w-28 px-2 py-3 text-center text-rose-300">Tiềm năng giá</th>
                    <th className="w-20 px-2 py-3 text-center text-cyan-300">RSs</th>
                    <th className="w-20 px-2 py-3 text-center text-purple-300">RSm</th>
                    <th className="w-28 px-2 py-3 text-center text-amber-300">RRG cổ phiếu</th>
                    <th className="w-28 px-2 py-3 text-center text-cyan-200">Biến động tuần</th>
                    <th className="w-28 px-2 py-3 text-center text-purple-200">Biến động tháng</th>
                    <th className="w-28 px-4 py-3 text-center text-rose-400">Qeo composite</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04] font-mono">
                  {modalStocks.map((stock, index) => {
                    const pricePositive = (stock.changePercent ?? 0) >= 0
                    const weeklyPositive = (stock.weeklyChangePercent ?? 0) >= 0
                    const monthlyPositive = (stock.monthlyChangePercent ?? 0) >= 0
                    return (
                      <tr key={stock.ticker} onClick={() => { onOpenStockDetail?.(stock.ticker); setSelectedModalSector(null) }} className="group cursor-pointer transition-colors hover:bg-white/[0.03]">
                        <td className="px-4 py-3"><div className="flex items-center gap-2.5"><span className="w-4 text-[10px] font-bold text-slate-500">{String(index + 1).padStart(2, "0")}</span><StockLogo symbol={stock.ticker} size={26} fallback="none" /><div className="min-w-0"><div className="flex items-center gap-1 font-mono text-sm font-bold text-white"><span>{stock.ticker}</span>{stock.isTop100 ? <Crown className="size-3 text-amber-400" /> : null}</div><SectorLabel name={stock.sector} compact /></div></div></td>
                        <td className="px-2 py-3 text-center"><strong className={cn("block text-xs font-black", pricePositive ? "text-emerald-400" : "text-rose-400")}>{formatPrice(stock.price)}</strong><span className={cn("block text-[10px] font-bold", pricePositive ? "text-emerald-400" : "text-rose-400")}>{formatSigned(stock.changePercent, 2, "%")}</span></td>
                        <td className="px-2 py-3 text-center"><span className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 font-bold text-emerald-300"><Target className="size-3" />{stock.canslimScore ?? "—"}</span></td>
                        <td className="px-2 py-3 text-center"><span className="inline-flex items-center gap-1 rounded-lg border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 font-bold text-amber-300">⊛ {stock.score4m ?? "—"}</span></td>
                        <td className="px-2 py-3 text-center"><span className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-sans text-[10px] font-bold", stock.pricePotential?.startsWith("Tăng") ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "border-rose-400/30 bg-rose-400/10 text-rose-300")}>{stock.pricePotential?.startsWith("Tăng") ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}{stock.pricePotential || "—"}</span></td>
                        <td className="px-2 py-3 text-center"><span className="inline-flex items-center gap-0.5 rounded-md border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 font-bold text-cyan-300"><Zap className="size-3" />{stock.rsShort ?? stock.scoreComponents?.momentum ?? "—"}</span></td>
                        <td className="px-2 py-3 text-center"><span className="inline-flex items-center rounded-md border border-purple-400/30 bg-purple-400/10 px-2 py-0.5 font-bold text-purple-300">{stock.rsMedium ?? stock.scoreComponents?.moneyFlow ?? "—"}</span></td>
                        <td className="px-2 py-3 text-center"><RotationBadge value={stock.stockRrgState} /></td>
                        <td className="px-2 py-3 text-center"><span className={cn("inline-flex items-center gap-1 font-bold", weeklyPositive ? "text-emerald-400" : "text-rose-400")}><CalendarDays className="size-3 text-slate-500" />{formatSigned(stock.weeklyChangePercent, 2, "%")}</span></td>
                        <td className="px-2 py-3 text-center"><span className={cn("inline-flex items-center gap-1 font-bold", monthlyPositive ? "text-emerald-400" : "text-rose-400")}><CalendarRange className="size-3 text-slate-500" />{formatSigned(stock.monthlyChangePercent, 2, "%")}</span></td>
                        <td className="px-4 py-3 text-center"><div className="flex items-center justify-center gap-1.5"><strong className={cn("flex size-7 items-center justify-center rounded-md border text-xs font-bold", stock.ratingScore >= 70 ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-300" : stock.ratingScore >= 50 ? "border-rose-400/40 bg-rose-400/15 text-rose-300" : "border-rose-500/40 bg-rose-500/15 text-rose-400")}>{stock.ratingScore}</strong><ArrowRight className="size-3 text-slate-500 transition-colors group-hover:text-cyan-300" /></div></td>
                      </tr>
                    )
                  })}
                  {modalStocks.length === 0 ? <tr><td colSpan={11} className="py-8 text-center font-sans text-xs text-slate-500">Không tìm thấy cổ phiếu nào phù hợp bộ lọc trong ngành này.</td></tr> : null}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between border-t border-white/[0.08] bg-[#050b12] px-5 py-3 font-sans text-xs text-slate-400 sm:px-6">
              <span className="font-mono">Hiển thị <strong className="text-white">{modalStocks.length}</strong> / {ratings.length} mã</span>
              <Button type="button" variant="outline" size="sm" onClick={() => setSelectedModalSector(null)} className="h-8 border-white/10 text-xs font-bold text-slate-300 hover:bg-white/10 hover:text-white">Đóng (ESC)</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
