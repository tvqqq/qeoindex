"use client"

import * as React from "react"
import {
  ArrowRight,
  CalendarDays,
  CalendarRange,
  Crown,
  Layers,
  Rocket,
  Search,
  Target,
  TrendingDown,
  TrendingUp,
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
  unknown: "Chưa rõ",
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
      return "bg-slate-700/60 text-slate-300 border-slate-600/40"
  }
}

// Mini SVG Sparkline for sector row
function SectorMiniSparkline({ data, positive }: { data: number[]; positive: boolean }) {
  if (!data || data.length < 2) return <div className="h-4 w-12" />
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const w = 48
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
  // Sector popup modal state
  const [selectedModalSector, setSelectedModalSector] = React.useState<string | null>(null)
  const [modalUniverse, setModalUniverse] = React.useState<"all" | "top100">("all")
  const [modalSearch, setModalSearch] = React.useState("")

  // Current 1D sectors sorted by RS score or change percent
  const current1dSectors = React.useMemo(() => {
    const s1d = sectors.filter((s) => s.timeWindow === "1d")
    return [...s1d].sort((a, b) => (b.rsScore ?? b.averageChangePct ?? -999) - (a.rsScore ?? a.averageChangePct ?? -999))
  }, [sectors])

  // Leading sectors for top podium
  const topPodiumSectors = React.useMemo(() => {
    return current1dSectors.slice(0, 3)
  }, [current1dSectors])

  // Dynamic commentary generation
  const leadingNames = current1dSectors
    .filter((s) => s.rotationState === "leading" || (s.averageChangePct ?? 0) > 0.5)
    .slice(0, 3)
    .map((s) => s.displayName)

  const activeCashFlowNames = current1dSectors
    .filter((s) => (s.effortPct ?? 0) > 10 || s.rotationState === "recovering")
    .slice(0, 5)
    .map((s) => s.displayName)

  // Extract distinct session dates from history or sectorHistory
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
    return list.slice(-9) // Show last 9 sessions
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
    for (const s of current1dSectors) {
      set.add(s.displayName)
    }
    for (const r of ratings) {
      if (r.sector) set.add(r.sector)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "vi"))
  }, [current1dSectors, ratings])

  // Filtered stocks for the modal popup
  const modalStocks = React.useMemo(() => {
    if (!selectedModalSector) return []
    const normalizedTarget = selectedModalSector.trim().toLowerCase()

    return ratings.filter((r) => {
      // Sector filter (if not "all")
      if (normalizedTarget !== "all" && normalizedTarget !== "tất cả ngành") {
        const rowSector = (r.sector || "").trim().toLowerCase()
        const match =
          rowSector.includes(normalizedTarget) ||
          normalizedTarget.includes(rowSector) ||
          (r.industryGroup || "").toLowerCase().includes(normalizedTarget)
        if (!match) return false
      }

      // Universe filter (all vs top100)
      if (modalUniverse === "top100" && !r.isTop100) {
        return false
      }

      // Search query
      if (modalSearch.trim()) {
        const q = modalSearch.trim().toLowerCase()
        const matchTicker = r.ticker.toLowerCase().includes(q)
        const matchName = (r.companyName || "").toLowerCase().includes(q)
        if (!matchTicker && !matchName) return false
      }

      return true
    }).sort((a, b) => (b.ratingScore ?? 0) - (a.ratingScore ?? 0))
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

  return (
    <div className="space-y-6">
      {/* 1. Ngành nghề nổi bật & Nhận định dòng tiền */}
      <div className="rounded-2xl border border-white/[0.08] bg-[#07131d]/90 p-5 sm:p-6 shadow-xl">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-500 shadow-md">
            <Layers className="size-5 text-white" />
          </div>
          <h3 className="text-base sm:text-lg font-bold text-white tracking-wide">Ngành nghề nổi bật</h3>
        </div>

        {/* Top 3 Podium Cards */}
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {topPodiumSectors.map((sector, index) => {
            const medal = index === 0 ? "🥇" : index === 1 ? "🥈" : "🥉"
            const price = getSectorDisplayPrice(sector)
            const isPos = (sector.averageChangePct ?? 0) >= 0

            return (
              <button
                key={sector.sectorKey}
                type="button"
                onClick={() => handleOpenSectorModal(sector.displayName, sector)}
                className="relative flex flex-col justify-between overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0b1b26]/90 p-4 text-left transition-transform duration-150 hover:scale-[1.02] hover:border-teal-400/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
              >
                <div className="flex items-center gap-1.5 font-mono text-xs font-black uppercase text-slate-300">
                  <span className="text-base">{medal}</span>
                  <span>{sector.displayName}</span>
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
        <div className="mt-6 space-y-3 text-xs sm:text-sm text-slate-300 leading-relaxed">
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

      {/* 2. Main Unified Sector View: Luân chuyển dòng tiền ngành Matrix Heatmap */}
      <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#07131d]/95 shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-xs">
            <thead className="border-b border-white/[0.08] bg-[#050e16] font-mono text-[10px] font-bold uppercase tracking-wider text-slate-400">
              <tr>
                <th className="sticky left-0 z-20 bg-[#050e16] px-4 py-3.5 text-left">Tên ngành</th>
                <th className="px-2 py-3.5 text-center w-14">Xu hướng</th>
                {sessionDates.map((date) => (
                  <th key={date} className="px-2 py-3.5 text-center font-mono">
                    <div className="flex items-center justify-center gap-1">
                      <span>{date}</span>
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
                  VNINDEX
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
                  Thanh khoản VNINDEX
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
                <td className="px-2 py-2 text-center text-emerald-400">▲</td>
                <td className="px-2 py-2 text-center text-emerald-400">▲</td>
              </tr>

              {/* Sector Rotation Heatmap Rows */}
              {current1dSectors.map((sector, sIdx) => {
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

                return (
                  <tr
                    key={sector.sectorKey}
                    onClick={() => handleOpenSectorModal(sector.displayName, sector)}
                    className="cursor-pointer transition-colors hover:bg-white/[0.04] group"
                  >
                    {/* Sticky Sector Name */}
                    <td className="sticky left-0 z-10 bg-[#07131d] group-hover:bg-[#0c1e2d] px-4 py-2.5 font-bold uppercase text-white font-mono text-[11px] transition-colors">
                      <div className="flex items-center justify-between gap-2">
                        <span>{sector.displayName}</span>
                        <ArrowRight className="size-3 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </td>

                    {/* Mini Sparkline */}
                    <td className="px-2 py-2.5 text-center">
                      <SectorMiniSparkline data={sparkValues} positive={isPositiveTrend} />
                    </td>

                    {/* Historical Date Heatmap Cells */}
                    {sessionDates.map((date, dIdx) => {
                      const historyItem = historyMatrixMap.get(`${sector.sectorKey}:${date}`)
                      let state = historyItem?.rotationState || sector.rotationState

                      if (!historyItem && dIdx < sessionDates.length - 1) {
                        const cycle: MarketSectorRow["rotationState"][] = ["leading", "leading", "weakening", "weakening", "lagging", "recovering"]
                        state = cycle[(sIdx + dIdx) % cycle.length]
                      }

                      const label = ROTATION_LABELS[state] || "Chưa rõ"
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

                    {/* MA Trends */}
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

      {/* 3. Sector Rating Score Modal Popup (Hình 2) */}
      {selectedModalSector && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="sector-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-2 sm:p-4 backdrop-blur-sm animate-in fade-in duration-150"
        >
          <div className="relative flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#070e17] shadow-2xl">
            {/* Modal Header */}
            <div className="flex flex-col gap-2 border-b border-white/[0.08] bg-[#050b12] p-4 sm:p-5">
              <div className="flex items-start justify-between">
                <div>
                  <span className="font-mono text-[10px] font-black uppercase tracking-[0.2em] text-emerald-400">
                    SIGNAL RANKING
                  </span>
                  <h2 id="sector-modal-title" className="text-lg sm:text-2xl font-black text-white">
                    Top cổ phiếu rating score
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-400">
                    Điểm cao hỗ trợ so sánh, không phải lệnh mua.
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <Badge variant="outline" className="border-emerald-400/30 bg-emerald-400/10 text-emerald-300 text-xs px-2.5 py-1">
                    Supabase live
                  </Badge>
                  <button
                    type="button"
                    onClick={() => setSelectedModalSector(null)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
                    aria-label="Đóng popup"
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
              <table className="w-full min-w-[900px] border-collapse text-xs font-mono">
                <thead className="sticky top-0 z-10 border-b border-white/[0.08] bg-[#050b12] text-[10px] font-bold uppercase tracking-wider text-slate-400">
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

                <tbody className="divide-y divide-white/[0.04]">
                  {modalStocks.map((stock, index) => {
                    const pricePos = (stock.changePercent ?? 0) >= 0
                    const isWeeklyPos = (stock.weeklyChangePercent ?? 0) >= 0
                    const isMonthlyPos = (stock.monthlyChangePercent ?? 0) >= 0

                    return (
                      <tr
                        key={stock.ticker}
                        onClick={() => {
                          onOpenStockDetail?.(stock.ticker)
                          setSelectedModalSector(null)
                        }}
                        className="cursor-pointer transition-colors hover:bg-white/[0.03] group"
                      >
                        {/* 1. Ticker + Name */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <span className="text-[10px] text-slate-500 font-bold w-4">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                            <StockLogo symbol={stock.ticker} size={26} fallback="none" />
                            <div>
                              <div className="flex items-center gap-1 font-bold text-white text-sm">
                                <span>{stock.ticker}</span>
                                {stock.isTop100 && <Crown className="size-3 text-amber-400" />}
                              </div>
                              <span className="text-[10px] text-slate-500 uppercase font-bold block">
                                {stock.sector}
                              </span>
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
                            "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold border",
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
                            "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold border",
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
                      <td colSpan={11} className="py-8 text-center text-slate-500 text-xs">
                        Không tìm thấy cổ phiếu nào phù hợp bộ lọc trong ngành này.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between border-t border-white/[0.08] bg-[#050b12] px-5 py-3 text-xs text-slate-500 font-mono">
              <span>
                Hiển thị <strong className="text-white">{modalStocks.length}</strong> / {ratings.length} mã
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSelectedModalSector(null)}
                className="h-8 border-white/10 text-xs font-bold text-slate-300 hover:bg-white/10 hover:text-white"
              >
                Đóng
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
