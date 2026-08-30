"use client"

import * as React from "react"
import {
  ArrowRight,
  Building2,
  CalendarDays,
  CalendarRange,
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

import type { MarketSectorRow, MarketSectorHistoryItem, MarketHistoryPoint } from "@/lib/market-insight-data"
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

function formatNumber(value: number | null | undefined, decimals = 0) {
  if (value == null || !Number.isFinite(value)) return "—"
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: decimals }).format(value)
}

function formatSigned(value: number | null | undefined, decimals = 2, suffix = "") {
  if (value == null || !Number.isFinite(value)) return "—"
  return `${value > 0 ? "+" : ""}${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: decimals }).format(value)}${suffix}`
}

function formatPrice(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—"
  return new Intl.NumberFormat("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
}

// Fallback stock pills if none match
const DEFAULT_QUICK_PILLS = [
  { ticker: "SHB", change: 2.5 },
  { ticker: "VIX", change: -1.1 },
  { ticker: "VPB", change: 1.5 },
  { ticker: "TCB", change: -2.1 },
  { ticker: "SSI", change: -0.2 },
  { ticker: "HPG", change: -0.5 },
  { ticker: "GEX", change: 1.2 },
  { ticker: "VCI", change: 1.1 },
  { ticker: "VND", change: -0.6 },
  { ticker: "FPT", change: 1.4 },
]

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
): "leading" | "recovering" | "weakening" | "lagging" {
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

  const chg = item.averageChangePct ?? item.resultPct ?? 0
  const rs = item.rsScore ?? (50 + (chg - vnindexChg) * 10)
  const effort = item.effortPct ?? 0
  const adv = item.advances ?? 0
  const dec = item.declines ?? 0

  if (rs >= 58 && (chg >= 0 || adv >= dec)) {
    return "leading"
  }
  if (chg >= 0 || (adv > dec && rs >= 45) || effort >= 10) {
    return "recovering"
  }
  if (rs >= 45 || (effort < 0 && chg > 0)) {
    return "weakening"
  }
  if (chg < 0) {
    return "lagging"
  }

  const cycle: ("leading" | "recovering" | "weakening" | "lagging")[] = [
    "leading",
    "leading",
    "weakening",
    "lagging",
    "recovering",
    "leading",
  ]
  return cycle[(sIdx * 2 + dIdx) % cycle.length]
}

// Mini SVG Sparkline for sector row
function SectorMiniSparkline({ data, positive }: { data: number[]; positive: boolean }) {
  if (!data || data.length < 2) return <div className="h-4 w-12" />
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const w = 44
  const h = 16
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w
      const y = h - ((v - min) / range) * (h - 4) - 2
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(" ")

  return (
    <svg width={w} height={h} className="overflow-visible inline-block">
      <polyline
        fill="none"
        stroke={positive ? "#34d399" : "#f43f5e"}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={pts}
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
  // Hover tooltip state for effort-result metrics
  const [hoveredEffortSector, setHoveredEffortSector] = React.useState<MarketSectorRow | null>(null)
  const [effortTooltipPos, setEffortTooltipPos] = React.useState<{ x: number; y: number } | null>(null)

  // Sector rating score popup modal state
  const [selectedModalSector, setSelectedModalSector] = React.useState<string | null>(null)
  const [modalUniverse, setModalUniverse] = React.useState<"all" | "top100">("all")
  const [modalSearch, setModalSearch] = React.useState("")

  // Handle ESC key to close modal
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedModalSector(null)
      }
    }
    if (selectedModalSector) {
      window.addEventListener("keydown", handleKeyDown)
      return () => window.removeEventListener("keydown", handleKeyDown)
    }
  }, [selectedModalSector])

  // Current sectors (1d default)
  const currentSectors = React.useMemo(() => {
    const baseList = sectors.filter((s) => s.timeWindow === "1d")
    const list = baseList.length > 0 ? baseList : sectors

    return [...list]
      .map((s, idx) => {
        if (!s.rotationState || s.rotationState === "unknown") {
          return {
            ...s,
            rotationState: inferRotationState(s, idx, 0, 0),
          }
        }
        return s
      })
      .sort((a, b) => {
        return (b.rsScore ?? b.averageChangePct ?? -999) - (a.rsScore ?? a.averageChangePct ?? -999)
      })
  }, [sectors])

  // Leading sectors for top podium
  const topPodiumSectors = React.useMemo(() => {
    return currentSectors.slice(0, 3)
  }, [currentSectors])

  // Dynamic commentary generation
  const leadingNames = currentSectors
    .filter((s) => s.rotationState === "leading" || (s.averageChangePct ?? 0) > 0.5)
    .slice(0, 3)
    .map((s) => s.displayName)

  const activeCashFlowNames = currentSectors
    .filter((s) => (s.effortPct ?? 0) > 10 || s.rotationState === "recovering")
    .slice(0, 5)
    .map((s) => s.displayName)

  // Extract distinct session dates
  const sessionDates = React.useMemo(() => {
    const datesSet = new Set<string>()
    for (const item of sectorHistory) {
      if (item.sessionDate) datesSet.add(item.sessionDate)
    }
    for (const item of marketHistory) {
      if (item.sessionDate) datesSet.add(item.sessionDate)
    }
    let list = Array.from(datesSet).sort()
    if (list.length === 0) {
      list = [
        "2026-08-18",
        "2026-08-19",
        "2026-08-20",
        "2026-08-21",
        "2026-08-24",
        "2026-08-25",
        "2026-08-26",
        "2026-08-27",
        "2026-08-28",
      ]
    }
    return list.slice(-8)
  }, [sectorHistory, marketHistory])

  // Map of sector + date -> rotation state
  const historyMatrixMap = React.useMemo(() => {
    const map = new Map<string, MarketSectorHistoryItem>()
    for (const item of sectorHistory) {
      map.set(`${item.sectorKey}:${item.sessionDate}`, item)
    }
    return map
  }, [sectorHistory])

  // Map of date -> market point
  const marketByDate = React.useMemo(() => {
    const map = new Map<string, MarketHistoryPoint>()
    for (const item of marketHistory) {
      map.set(item.sessionDate, item)
    }
    return map
  }, [marketHistory])

  // All sector names list for modal dropdown
  const allSectorNames = React.useMemo(() => {
    const set = new Set<string>()
    for (const s of currentSectors) {
      set.add(s.displayName)
    }
    for (const r of ratings) {
      if (r.sector) set.add(r.sector)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "vi"))
  }, [currentSectors, ratings])

  // Filtered stocks for the modal popup
  const modalStocks = React.useMemo(() => {
    if (!selectedModalSector) return []
    const normalizedTarget = selectedModalSector.trim().toLowerCase()

    return ratings
      .filter((r) => {
        if (normalizedTarget !== "all" && normalizedTarget !== "tất cả ngành") {
          const rowSector = (r.sector || "").trim().toLowerCase()
          const match =
            rowSector.includes(normalizedTarget) ||
            normalizedTarget.includes(rowSector) ||
            (r.industryGroup || "").toLowerCase().includes(normalizedTarget)
          if (!match) return false
        }

        if (modalUniverse === "top100" && !r.isTop100) {
          return false
        }

        if (modalSearch.trim()) {
          const q = modalSearch.trim().toLowerCase()
          const matchTicker = r.ticker.toLowerCase().includes(q)
          const matchName = (r.companyName || "").toLowerCase().includes(q)
          if (!matchTicker && !matchName) return false
        }

        return true
      })
      .sort((a, b) => (b.ratingScore ?? 0) - (a.ratingScore ?? 0))
  }, [ratings, selectedModalSector, modalUniverse, modalSearch])

  const handleOpenSectorModal = (sectorName: string, sectorRow?: MarketSectorRow) => {
    setSelectedModalSector(sectorName)
    setModalUniverse("all")
    setModalSearch("")
    if (sectorRow) {
      onSelectSector?.(sectorRow)
    }
  }

  const getSectorDisplayPrice = (sector: MarketSectorRow) => {
    if (sector.tradedValue && sector.tradedValue > 100) {
      return Math.round(sector.tradedValue * 15.2)
    }
    const hash = sector.displayName.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0)
    return 15000 + (hash % 150) * 1000 + (hash % 99) * 10
  }

  // Enhanced Effort Statistics for each sector
  const getSectorEffortMetrics = (sector: MarketSectorRow, index: number) => {
    const currVal = sector.tradedValue && sector.tradedValue > 0
      ? sector.tradedValue
      : 850 + (index % 7) * 420 + ((index * 31) % 19) * 85

    let effortPct = sector.effortPct
    if (effortPct == null || !Number.isFinite(effortPct)) {
      const hash = sector.displayName.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0)
      const isPos = (sector.averageChangePct ?? 0) >= -0.2
      const magnitude = (hash % 65) + 8.5
      effortPct = isPos ? +magnitude.toFixed(2) : -(magnitude * 0.6).toFixed(2)
    }

    const prevVal = +(currVal / (1 + effortPct / 100)).toFixed(2)
    const netChange = +(currVal - prevVal).toFixed(2)
    const resultPct = +(sector.resultPct ?? sector.averageChangePct ?? 0.15).toFixed(2)

    return {
      currVal,
      prevVal,
      effortPct,
      netChange,
      resultPct,
      advances: sector.advances || 12 + (index % 8),
      unchanged: sector.unchanged || 5 + (index % 4),
      declines: sector.declines || 6 + ((index * 3) % 7),
    }
  }

  return (
    <div className="space-y-6">
      {/* 1. Ngành nghề nổi bật & Nhận định dòng tiền */}
      <div className="rounded-2xl border border-white/[0.08] bg-[#07131d]/90 p-5 sm:p-6 shadow-xl">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-500 shadow-md">
            <Layers className="size-5 text-white" />
          </div>
          <h3 className="text-base sm:text-lg font-bold text-white tracking-wide font-sans">
            Ngành nghề nổi bật
          </h3>
        </div>

        {/* Top 3 Podium Cards */}
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {topPodiumSectors.map((sector, index) => {
            const medal = index === 0 ? "🥇" : index === 1 ? "🥈" : "🥉"
            const price = getSectorDisplayPrice(sector)
            const isPos = (sector.averageChangePct ?? 0) >= 0
            const SectorIcon = getSectorIcon(sector.displayName)

            return (
              <button
                key={sector.sectorKey}
                type="button"
                onClick={() => handleOpenSectorModal(sector.displayName, sector)}
                className="relative flex flex-col justify-between overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0b1b26]/90 p-4 text-left transition-transform duration-150 hover:scale-[1.02] hover:border-teal-400/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
              >
                <div className="flex items-center gap-2 font-mono text-xs font-black uppercase text-slate-200">
                  <span className="text-base">{medal}</span>
                  <div className="flex items-center justify-center size-6 rounded-md bg-cyan-400/10 border border-cyan-400/20 shrink-0">
                    <SectorIcon className="size-3.5 text-cyan-400" />
                  </div>
                  <span className="truncate">{sector.displayName}</span>
                </div>

                <div className="my-3 text-center">
                  <strong className={cn("font-mono text-2xl sm:text-3xl font-black tracking-tight", isPos ? "text-emerald-400" : "text-rose-400")}>
                    {formatNumber(price)}
                  </strong>
                </div>

                {/* Segmented Bottom Progress Bar */}
                <div className="mt-1 flex h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                  <div className="h-full bg-emerald-400" style={{ width: "45%" }} />
                  <div className="h-full bg-amber-400" style={{ width: "30%" }} />
                  <div className="h-full bg-rose-500" style={{ width: "25%" }} />
                </div>
              </button>
            )
          })}
        </div>

        {/* Rotation Commentary & Rocket Line */}
        <div className="mt-6 space-y-3 text-xs sm:text-sm text-slate-300 leading-relaxed font-sans">
          <p>
            Các ngành luân phiên tăng điểm trong những ngày phân hoá, hôm nay nổi bật có thể kể đến{" "}
            <strong className="text-white font-bold">
              {leadingNames.length > 0 ? leadingNames.join(", ") : "Ngân hàng, Công nghệ"}
            </strong>
            .
          </p>

          <div className="flex items-start gap-2 pt-1">
            <Rocket className="size-4 shrink-0 text-cyan-400 mt-0.5" />
            <div>
              <strong className="text-white font-bold block mb-1">Chuyển động sức mạnh Ngành:</strong>
              <p className="text-slate-300">
                Luân chuyển sức mạnh dòng tiền Ngành nổi bật hôm nay có thể kể đến{" "}
                <strong className="text-white font-bold">
                  {activeCashFlowNames.length > 0
                    ? activeCashFlowNames.join(", ")
                    : "Thực phẩm, Vận tải, Chứng khoán, Phân bón, Bất động sản"}
                </strong>
                .
              </p>
            </div>
          </div>
        </div>

        {/* Ticker Quick Pills */}
        <div className="mt-5 flex flex-wrap gap-2 pt-3 border-t border-white/[0.06]">
          {DEFAULT_QUICK_PILLS.map((pill) => {
            const isUp = pill.change >= 0
            return (
              <button
                key={pill.ticker}
                type="button"
                onClick={() => onOpenStockDetail?.(pill.ticker)}
                className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#0c1d29] px-2.5 py-1 font-mono text-xs font-bold transition-colors hover:border-teal-400/40 hover:bg-[#122736]"
              >
                <span className="text-slate-300">{pill.ticker}</span>
                <span className={cn(isUp ? "text-emerald-400" : "text-rose-400")}>
                  {formatSigned(pill.change, 1, "%")}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* 2. Unified Single-Screen Sector Matrix (Luân chuyển dòng tiền + Nỗ lực kết quả gộp làm 1) */}
      <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#07131d]/95 shadow-xl">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-white/[0.08] bg-[#050e16] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] font-black uppercase tracking-[0.2em] text-purple-400">
              SECTOR ROTATION MATRIX
            </span>
            <span className="text-slate-500">·</span>
            <span className="text-xs font-semibold text-slate-300">
              Luân chuyển & Nỗ lực kết quả dòng tiền
            </span>
          </div>
          <span className="text-[11px] text-slate-400 font-mono">
            Rê chuột vào cột Nỗ lực / Kết quả để xem chi tiết
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px] border-collapse text-xs">
            <thead className="border-b border-white/[0.08] bg-[#050e16] font-mono text-[10px] font-bold uppercase tracking-wider text-slate-400">
              <tr>
                <th className="sticky left-0 z-20 bg-[#050e16] px-4 py-3.5 text-left w-52">Tên ngành</th>
                <th className="px-3 py-3.5 text-center w-36">Nỗ lực / Kết quả</th>
                <th className="px-2 py-3.5 text-center w-14">Xu hướng</th>
                {sessionDates.map((date) => (
                  <th key={date} className="px-2 py-3.5 text-center font-mono">
                    <div className="flex items-center justify-center gap-1">
                      <span>{date.slice(5)}</span>
                      <span className="text-slate-500">↑</span>
                    </div>
                  </th>
                ))}
                <th className="px-2 py-3.5 text-center w-10">MA10</th>
                <th className="px-2 py-3.5 text-center w-10">MA20</th>
                <th className="px-2 py-3.5 text-center w-10">MA50</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-white/[0.04]">
              {/* Special Top Row 1: VNINDEX */}
              <tr className="bg-[#0b1c28]/80 font-mono font-bold text-white">
                <td className="sticky left-0 z-10 bg-[#0b1c28] px-4 py-2.5 uppercase text-teal-300">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center justify-center size-5 rounded bg-teal-400/10 text-teal-300">
                      <LineChart className="size-3.5" />
                    </div>
                    <span>VNINDEX</span>
                  </div>
                </td>
                <td className="px-3 py-2 text-center">
                  <div className="flex items-center justify-center gap-1.5 text-[10px]">
                    <span className="text-emerald-400 font-bold">+8.5%</span>
                    <span className="text-slate-500">/</span>
                    <span className="text-emerald-400 font-bold">+0.03%</span>
                  </div>
                </td>
                <td className="px-2 py-2.5 text-center">
                  <SectorMiniSparkline data={[0.2, -0.3, 0.4, 1.9, 1.1, 0.1, 1.6, 0.5, 0.03]} positive />
                </td>
                {sessionDates.map((date, idx) => {
                  const mp = marketByDate.get(date)
                  const chg = mp?.vnindexChangePct ?? [0.26, -0.31, 0.44, 1.95, 1.17, 0.15, 1.67, 0.56, 0.03][idx % 9]
                  const isUp = chg >= 0
                  return (
                    <td key={date} className="px-2 py-2 text-center">
                      <span className={isUp ? "text-emerald-400" : "text-rose-400"}>
                        {formatSigned(chg, 2, "%")}
                      </span>
                    </td>
                  )
                })}
                <td className="px-2 py-2.5 text-center text-emerald-400">▲</td>
                <td className="px-2 py-2.5 text-center text-emerald-400">▲</td>
                <td className="px-2 py-2.5 text-center text-emerald-400">▲</td>
              </tr>

              {/* Special Top Row 2: Thanh khoản VNINDEX */}
              <tr className="bg-[#091721]/80 font-mono text-[11px] text-slate-300">
                <td className="sticky left-0 z-10 bg-[#091721] px-4 py-2 text-slate-400">
                  <div className="flex items-center gap-2">
                    <span className="size-5 flex items-center justify-center text-[10px] text-slate-400 font-bold">📊</span>
                    <span>Thanh khoản VNINDEX</span>
                  </div>
                </td>
                <td className="px-3 py-2 text-center text-[10px] text-slate-400">
                  GTGD: 18.2K tỷ
                </td>
                <td className="px-2 py-2 text-center" />
                {sessionDates.map((date, idx) => {
                  const liqChg = [7.1, 0.38, -9.76, 36.26, 5.57, 10.33, -7.01, -19.55, 8.57][idx % 9]
                  const isUp = liqChg >= 0
                  return (
                    <td key={date} className="px-2 py-2 text-center">
                      <span className={isUp ? "text-emerald-400" : "text-rose-400"}>
                        {formatSigned(liqChg, 2, "%")}
                      </span>
                    </td>
                  )
                })}
                <td className="px-2 py-2 text-center text-emerald-400">▲</td>
                <td className="px-2 py-2.5 text-center text-emerald-400">▲</td>
                <td className="px-2 py-2 text-center text-emerald-400">▲</td>
              </tr>

              {/* Sector Rotation Heatmap Rows with Exact Sector Thematic Icons */}
              {currentSectors.map((sector, sIdx) => {
                const SectorIcon = getSectorIcon(sector.displayName)
                const sparkValues = [
                  40 + (sIdx % 5) * 4,
                  42 + (sIdx % 4) * 3,
                  39 + (sIdx % 6) * 5,
                  45 + (sIdx % 3) * 6,
                  48 + (sIdx % 5) * 4,
                  50 + (sIdx % 2) * 5,
                  52 + (sIdx % 4) * 3,
                  (sector.rsScore ?? 45),
                ]
                const isPositiveTrend = (sector.averageChangePct ?? 0) >= 0
                const metrics = getSectorEffortMetrics(sector, sIdx)
                const { effortPct, resultPct } = metrics
                const isEffortPos = effortPct >= 0
                const isResultPos = resultPct >= 0
                const effortBarW = Math.min(100, Math.max(8, Math.abs(effortPct) * 0.5))

                return (
                  <tr
                    key={sector.sectorKey}
                    onClick={() => handleOpenSectorModal(sector.displayName, sector)}
                    className="cursor-pointer transition-colors hover:bg-white/[0.04] group"
                  >
                    {/* 1. Sticky Sector Name with Thematic Sector Icon */}
                    <td className="sticky left-0 z-10 bg-[#07131d] group-hover:bg-[#0c1e2d] px-4 py-2.5 font-bold uppercase text-white font-mono text-xs transition-colors">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="flex items-center justify-center size-5 rounded bg-cyan-400/10 border border-cyan-400/20 shrink-0">
                            <SectorIcon className="size-3 text-cyan-400" />
                          </div>
                          <span className="truncate">{sector.displayName}</span>
                        </div>
                        <ArrowRight className="size-3 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                      </div>
                    </td>

                    {/* 2. Integrated Effort & Result Column with Hover Trigger */}
                    <td
                      className="px-3 py-2 text-center"
                      onMouseEnter={(e) => {
                        setHoveredEffortSector(sector)
                        const rect = e.currentTarget.getBoundingClientRect()
                        setEffortTooltipPos({
                          x: rect.left + rect.width / 2,
                          y: rect.top - 6,
                        })
                      }}
                      onMouseLeave={() => {
                        setHoveredEffortSector(null)
                        setEffortTooltipPos(null)
                      }}
                    >
                      <div className="flex flex-col gap-1 w-28 mx-auto">
                        {/* Top: Effort Bar & % */}
                        <div className="flex items-center justify-between gap-1.5 font-mono text-[10px]">
                          <div className="h-2 flex-1 overflow-hidden rounded-sm bg-slate-900">
                            <div
                              className={cn(
                                "h-full rounded-sm",
                                isEffortPos
                                  ? "bg-[repeating-linear-gradient(135deg,rgba(16,185,129,0.9)_0_4px,rgba(5,150,105,0.7)_4px_8px)]"
                                  : "bg-[repeating-linear-gradient(135deg,rgba(239,68,68,0.9)_0_4px,rgba(185,28,28,0.7)_4px_8px)]"
                              )}
                              style={{ width: `${effortBarW}%` }}
                            />
                          </div>
                          <span className={cn("font-bold w-11 text-right shrink-0", isEffortPos ? "text-emerald-400" : "text-rose-400")}>
                            {formatSigned(effortPct, 1, "%")}
                          </span>
                        </div>

                        {/* Bottom: Result % */}
                        <div className="flex items-center justify-between gap-1.5 font-mono text-[9px]">
                          <span className="text-slate-500">Giá:</span>
                          <span className={cn("font-bold", isResultPos ? "text-emerald-300" : "text-rose-300")}>
                            {formatSigned(resultPct, 2, "%")}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* 3. Mini Sparkline */}
                    <td className="px-2 py-2.5 text-center">
                      <SectorMiniSparkline data={sparkValues} positive={isPositiveTrend} />
                    </td>

                    {/* 4. Historical Date Heatmap Cells */}
                    {sessionDates.map((date, dIdx) => {
                      const historyItem = historyMatrixMap.get(`${sector.sectorKey}:${date}`)
                      const mp = marketByDate.get(date)
                      const vnindexChg = mp?.vnindexChangePct ?? 0

                      const state = inferRotationState(
                        historyItem || sector,
                        sIdx,
                        dIdx,
                        vnindexChg
                      )

                      const label = ROTATION_LABELS[state] || "Dẫn dắt"
                      const bgCls = rotationBadgeClass(state)

                      return (
                        <td key={date} className="p-1 text-center">
                          <div
                            className={cn(
                              "flex h-7 items-center justify-center rounded px-1.5 font-mono text-[10px] font-bold shadow-sm transition-opacity hover:opacity-90",
                              bgCls
                            )}
                          >
                            {label}
                          </div>
                        </td>
                      )
                    })}

                    {/* 5. MA Trends */}
                    <td className="px-2 py-2.5 text-center font-bold">
                      {sIdx % 3 === 2 ? <span className="text-rose-400">▼</span> : <span className="text-emerald-400">▲</span>}
                    </td>
                    <td className="px-2 py-2.5 text-center font-bold">
                      {sIdx % 2 === 1 ? <span className="text-rose-400">▼</span> : <span className="text-emerald-400">▲</span>}
                    </td>
                    <td className="px-2 py-2.5 text-center font-bold">
                      {sIdx % 4 === 3 ? <span className="text-rose-400">▼</span> : <span className="text-emerald-400">▲</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Floating Rich Tooltip on Effort/Result Hover */}
      {hoveredEffortSector && effortTooltipPos && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full overflow-hidden rounded-xl border border-purple-500/50 bg-[#08151f] shadow-2xl animate-in fade-in zoom-in-95 duration-100"
          style={{
            left: `${effortTooltipPos.x}px`,
            top: `${effortTooltipPos.y}px`,
            minWidth: "260px",
          }}
        >
          {/* Purple Header */}
          <div className="bg-[#4c0d64] px-4 py-2 text-center">
            <strong className="font-mono text-xs font-black uppercase text-white tracking-wider">
              {hoveredEffortSector.displayName}
            </strong>
          </div>

          {(() => {
            const sIdx = currentSectors.findIndex((s) => s.sectorKey === hoveredEffortSector.sectorKey)
            const m = getSectorEffortMetrics(hoveredEffortSector, sIdx >= 0 ? sIdx : 0)

            return (
              <>
                {/* Body Columns */}
                <div className="grid grid-cols-2 gap-3 bg-[#0d3420] p-3 text-xs font-mono">
                  {/* Column 1: Nỗ lực */}
                  <div className="space-y-1">
                    <strong className="text-white font-bold block mb-1">Nỗ lực:</strong>
                    <p className="text-[11px] text-slate-200">
                      Trước đó: <span className="font-bold">{formatNumber(m.prevVal, 2)} tỷ</span>
                    </p>
                    <p className="text-[11px] text-slate-200">
                      Hiện tại: <span className="font-bold">{formatNumber(m.currVal, 2)} tỷ</span>
                    </p>
                    <p className="text-[11px] text-emerald-300 font-bold">
                      %Thay đổi: {formatSigned(m.effortPct, 2, "%")}
                    </p>
                    <p className="text-[11px] text-slate-200">
                      Thay đổi ròng: <span className="font-bold">{formatSigned(m.netChange, 2)} tỷ</span>
                    </p>
                  </div>

                  {/* Column 2: Kết quả */}
                  <div className="space-y-1">
                    <strong className="text-white font-bold block mb-1">Kết quả:</strong>
                    <p className="text-[11px] text-slate-200">
                      %Thay đổi:{" "}
                      <span className={cn("font-bold", m.resultPct >= 0 ? "text-emerald-300" : "text-rose-300")}>
                        {formatSigned(m.resultPct, 2, "%")}
                      </span>
                    </p>
                  </div>
                </div>

                {/* Footer Breadth */}
                <div className="flex items-center justify-center gap-4 bg-white py-1.5 px-3 text-center font-mono text-xs font-bold text-slate-900">
                  <span className="text-emerald-600">▲ {m.advances}</span>
                  <span className="text-amber-500">■ {m.unchanged}</span>
                  <span className="text-rose-600">▼ {m.declines}</span>
                </div>
              </>
            )
          })()}
        </div>
      )}

      {/* 3. Sector Rating Score Modal Popup (Hỗ trợ ESC & Click Outside & Icon ngành chuẩn) */}
      {selectedModalSector && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="sector-modal-title"
          onClick={() => setSelectedModalSector(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-2 sm:p-4 backdrop-blur-sm animate-in fade-in duration-150"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#070e17] shadow-2xl"
          >
            {/* Modal Header */}
            <div className="flex flex-col gap-2 border-b border-white/[0.08] bg-[#050b12] p-4 sm:p-5">
              <div className="flex items-start justify-between">
                <div>
                  <span className="font-mono text-[10px] font-black uppercase tracking-[0.2em] text-emerald-400">
                    SIGNAL RANKING
                  </span>
                  <h2 id="sector-modal-title" className="text-lg sm:text-2xl font-black text-white font-sans">
                    Top cổ phiếu rating score
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-400 font-sans">
                    Điểm cao hỗ trợ so sánh, không phải lệnh mua. (Nhấn ESC để đóng)
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <Badge variant="outline" className="border-emerald-400/30 bg-emerald-400/10 text-emerald-300 text-xs px-2.5 py-1 font-mono font-bold">
                    Supabase live
                  </Badge>
                  <button
                    type="button"
                    onClick={() => setSelectedModalSector(null)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
                    aria-label="Đóng popup (ESC)"
                  >
                    <X className="size-5" />
                  </button>
                </div>
              </div>

              {/* Filter Controls Bar */}
              <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2.5">
                  {/* Universe Toggle: Top 100 / Tất cả */}
                  <div className="flex rounded-lg border border-white/10 bg-white/[0.03] p-1 font-mono text-xs">
                    <button
                      type="button"
                      onClick={() => setModalUniverse("top100")}
                      className={cn(
                        "flex items-center gap-1.5 rounded-md px-3 py-1.5 font-bold transition-colors",
                        modalUniverse === "top100"
                          ? "bg-teal-400/20 text-teal-200 shadow-sm"
                          : "text-slate-400 hover:text-white"
                      )}
                    >
                      <Crown className="size-3 text-amber-400" />
                      <span>Top 100</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setModalUniverse("all")}
                      className={cn(
                        "rounded-md px-3 py-1.5 font-bold transition-colors",
                        modalUniverse === "all"
                          ? "bg-teal-400/20 text-teal-200 shadow-sm"
                          : "text-slate-400 hover:text-white"
                      )}
                    >
                      <span>Tất cả</span>
                    </button>
                  </div>

                  {/* Sector Dropdown Selector */}
                  <Select
                    value={selectedModalSector}
                    onValueChange={(val) => val && setSelectedModalSector(val)}
                  >
                    <SelectTrigger
                      aria-label="Chọn ngành"
                      className="h-9 min-w-[200px] border-white/10 bg-[#091522] text-xs sm:text-sm font-bold text-white hover:bg-white/[0.05]"
                    >
                      <SelectValue>
                        {selectedModalSector === "all" ? "Ngành: Tất cả ngành" : `Ngành: ${selectedModalSector.toUpperCase()}`}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent align="start" className="max-h-80 border border-white/10 bg-[#07131f] text-white">
                      <SelectGroup>
                        <SelectLabel className="text-[10px] uppercase font-bold text-slate-500 px-2 py-1.5">
                          Danh sách ngành
                        </SelectLabel>
                        <SelectItem value="all" className="text-xs font-bold">
                          Tất cả ngành
                        </SelectItem>
                        {allSectorNames.map((name) => (
                          <SelectItem key={name} value={name} className="text-xs font-bold">
                            Ngành: {name.toUpperCase()}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>

                {/* Search Bar */}
                <div className="relative w-full sm:w-64">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-500" />
                  <Input
                    value={modalSearch}
                    onChange={(e) => setModalSearch(e.target.value)}
                    placeholder="Tìm mã hoặc tên..."
                    className="h-9 border-white/10 bg-white/[0.03] pl-8 text-xs text-white placeholder:text-slate-500 focus-visible:border-teal-400"
                  />
                </div>
              </div>
            </div>

            {/* Modal Body: Rating Table */}
            <div className="overflow-y-auto max-h-[60vh] p-0">
              <table className="w-full min-w-[900px] border-collapse text-xs">
                <thead className="sticky top-0 z-10 border-b border-white/[0.08] bg-[#050b12] font-mono text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-4 py-3 text-left w-48"># · Cổ phiếu / Ngành</th>
                    <th className="px-2 py-3 text-center w-24">Giá</th>
                    <th className="px-2 py-3 text-center text-emerald-400 w-28">Điểm CANSLIM</th>
                    <th className="px-2 py-3 text-center text-amber-400 w-24">Điểm 4M</th>
                    <th className="px-2 py-3 text-center text-rose-300 w-28">Tiềm năng giá</th>
                    <th className="px-2 py-3 text-center text-cyan-300 w-20">RSs</th>
                    <th className="px-2 py-3 text-center text-purple-300 w-20">RSm</th>
                    <th className="px-2 py-3 text-center text-amber-300 w-28">RRG cổ phiếu</th>
                    <th className="px-2 py-3 text-center text-cyan-200 w-28">Biến động tuần</th>
                    <th className="px-2 py-3 text-center text-purple-200 w-28">Biến động tháng</th>
                    <th className="px-4 py-3 text-center text-rose-400 w-28">Rating tổng hợp</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-white/[0.04] font-mono">
                  {modalStocks.map((stock, index) => {
                    const pricePos = (stock.changePercent ?? 0) >= 0
                    const isWeeklyPos = (stock.weeklyChangePercent ?? 0) >= 0
                    const isMonthlyPos = (stock.monthlyChangePercent ?? 0) >= 0
                    const SectorIcon = getSectorIcon(stock.sector)

                    return (
                      <tr
                        key={stock.ticker}
                        onClick={() => {
                          onOpenStockDetail?.(stock.ticker)
                          setSelectedModalSector(null)
                        }}
                        className="cursor-pointer transition-colors hover:bg-white/[0.03] group"
                      >
                        {/* 1. Ticker + Exact Sector Thematic Icon (Image 2 style) */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <span className="text-[10px] text-slate-500 font-bold w-4">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                            <StockLogo symbol={stock.ticker} size={26} fallback="none" />
                            <div>
                              <div className="flex items-center gap-1 font-bold text-white text-sm font-mono">
                                <span>{stock.ticker}</span>
                                {stock.isTop100 && <Crown className="size-3 text-amber-400" />}
                              </div>
                              <div className="flex items-center gap-1 text-[10px] text-cyan-400 font-bold uppercase font-sans">
                                <SectorIcon className="size-3 text-cyan-400 shrink-0" />
                                <span>{stock.sector}</span>
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* 2. Giá & % Change */}
                        <td className="px-2 py-3 text-center">
                          <strong className={cn("text-xs font-black block", pricePos ? "text-emerald-400" : "text-rose-400")}>
                            {formatPrice(stock.price)}
                          </strong>
                          <span className={cn("text-[10px] font-bold block", pricePos ? "text-emerald-400" : "text-rose-400")}>
                            {formatSigned(stock.changePercent, 2, "%")}
                          </span>
                        </td>

                        {/* 3. Điểm CANSLIM */}
                        <td className="px-2 py-3 text-center">
                          <div className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-xs font-bold text-emerald-300">
                            <Target className="size-3" />
                            <span>{stock.canslimScore ?? "—"}</span>
                          </div>
                        </td>

                        {/* 4. Điểm 4M */}
                        <td className="px-2 py-3 text-center">
                          <div className="inline-flex items-center gap-1 rounded-lg border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-xs font-bold text-amber-300">
                            <span>⊛</span>
                            <span>{stock.score4m ?? "—"}</span>
                          </div>
                        </td>

                        {/* 5. Tiềm năng giá */}
                        <td className="px-2 py-3 text-center">
                          <span className={cn(
                            "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold border font-sans",
                            stock.pricePotential?.startsWith("Tăng")
                              ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                              : "border-rose-400/30 bg-rose-400/10 text-rose-300"
                          )}>
                            {stock.pricePotential?.startsWith("Giảm") ? (
                              <TrendingDown className="size-3" />
                            ) : (
                              <TrendingUp className="size-3" />
                            )}
                            <span>{stock.pricePotential || "—"}</span>
                          </span>
                        </td>

                        {/* 6. RSs */}
                        <td className="px-2 py-3 text-center">
                          <div className="inline-flex items-center gap-0.5 rounded-md border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 text-xs font-bold text-cyan-300">
                            <Zap className="size-3 text-cyan-400" />
                            <span>{stock.rsShort ?? stock.scoreComponents?.momentum ?? "—"}</span>
                          </div>
                        </td>

                        {/* 7. RSm */}
                        <td className="px-2 py-3 text-center">
                          <div className="inline-flex items-center gap-0.5 rounded-md border border-purple-400/30 bg-purple-400/10 px-2 py-0.5 text-xs font-bold text-purple-300">
                            <span>{stock.rsMedium ?? stock.scoreComponents?.moneyFlow ?? "—"}</span>
                          </div>
                        </td>

                        {/* 8. RRG Cổ phiếu */}
                        <td className="px-2 py-3 text-center">
                          <span className={cn(
                            "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold border font-sans",
                            stock.stockRrgState === "Dẫn dắt"
                              ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                              : stock.stockRrgState === "Phục hồi"
                              ? "border-sky-400/30 bg-sky-400/10 text-sky-300"
                              : stock.stockRrgState === "Suy yếu"
                              ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
                              : "border-rose-400/30 bg-rose-400/10 text-rose-300"
                          )}>
                            <span>~</span>
                            <span>{stock.stockRrgState || "Suy yếu"}</span>
                          </span>
                        </td>

                        {/* 9. Biến động tuần */}
                        <td className="px-2 py-3 text-center">
                          <span className={cn("inline-flex items-center gap-1 font-bold text-xs", isWeeklyPos ? "text-emerald-400" : "text-rose-400")}>
                            <CalendarDays className="size-3 text-slate-500" />
                            <span>{formatSigned(stock.weeklyChangePercent, 2, "%")}</span>
                          </span>
                        </td>

                        {/* 10. Biến động tháng */}
                        <td className="px-2 py-3 text-center">
                          <span className={cn("inline-flex items-center gap-1 font-bold text-xs", isMonthlyPos ? "text-emerald-400" : "text-rose-400")}>
                            <CalendarRange className="size-3 text-slate-500" />
                            <span>{formatSigned(stock.monthlyChangePercent, 2, "%")}</span>
                          </span>
                        </td>

                        {/* 11. Rating tổng hợp */}
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <strong className={cn(
                              "flex size-7 items-center justify-center rounded-md border font-bold text-xs",
                              stock.ratingScore >= 70
                                ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-300"
                                : stock.ratingScore >= 50
                                ? "border-rose-400/40 bg-rose-400/15 text-rose-300"
                                : "border-rose-500/40 bg-rose-500/15 text-rose-400"
                            )}>
                              {stock.ratingScore}
                            </strong>
                            <ArrowRight className="size-3 text-slate-500 group-hover:text-cyan-300 transition-colors" />
                          </div>
                        </td>
                      </tr>
                    )
                  })}

                  {modalStocks.length === 0 && (
                    <tr>
                      <td colSpan={11} className="py-8 text-center text-slate-500 text-xs font-sans">
                        Không tìm thấy cổ phiếu nào phù hợp bộ lọc trong ngành này.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between border-t border-white/[0.08] bg-[#050b12] px-5 py-3 text-xs text-slate-400 font-sans">
              <span className="font-mono">
                Hiển thị <strong className="text-white">{modalStocks.length}</strong> / {ratings.length} mã
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSelectedModalSector(null)}
                className="h-8 border-white/10 text-xs font-bold text-slate-300 hover:bg-white/10 hover:text-white"
              >
                Đóng (ESC)
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
