"use client"

import * as React from "react"
import { CircleDot, LayoutGrid, Search, X } from "lucide-react"

import { StockLogo } from "@/components/stock-logo"
import { cn } from "@/lib/utils"

export interface MarketBubbleStock {
  ticker: string
  companyName: string
  sector: string
  volume: number | null
  change1d: number | null
  change1w: number | null
  change1m: number | null
  change1y: number | null
}

export type BubblePeriod = "15M" | "1H" | "1D" | "1W" | "1M" | "1Y"
export type BubbleRank = 50 | 100 | 200 | 500

interface MarketBubblesProps {
  stocks: MarketBubbleStock[]
  onOpenStockDetail?: (ticker: string) => void
  defaultPeriod?: BubblePeriod
  defaultRank?: BubbleRank
}

function formatNumber(value: number | null | undefined, decimals = 2) {
  if (value == null || !Number.isFinite(value)) return "—"
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: decimals }).format(value)
}

function formatSigned(value: number | null | undefined, decimals = 2, suffix = "") {
  if (value == null || !Number.isFinite(value)) return "—"
  return `${value > 0 ? "+" : ""}${formatNumber(value, decimals)}${suffix}`
}

function getStockChange(stock: MarketBubbleStock, period: BubblePeriod): number | null {
  if (period === "1W") return stock.change1w
  if (period === "1M") return stock.change1m
  if (period === "1Y") return stock.change1y
  if (period === "15M" || period === "1H") {
    // Intraday micro-period scale
    const scale = period === "15M" ? 0.25 : 0.5
    return stock.change1d != null ? Number((stock.change1d * scale).toFixed(2)) : null
  }
  return stock.change1d
}

// Circle packing node positioning
interface PackedBubble {
  stock: MarketBubbleStock
  rank: number
  change: number | null
  x: number // percentage 0..100
  y: number // percentage 0..100
  radius: number // in px
  sizeCategory: "huge" | "large" | "medium" | "small" | "tiny"
  tone: "fuchsia" | "emerald" | "rose" | "neutral"
}

export function MarketBubbles({
  stocks,
  onOpenStockDetail,
  defaultPeriod = "1D",
  defaultRank = 100,
}: MarketBubblesProps) {
  const [viewMode, setViewMode] = React.useState<"bubbles" | "columns">("bubbles")
  const [period, setPeriod] = React.useState<BubblePeriod>(defaultPeriod)
  const [rankFilter, setRankFilter] = React.useState<BubbleRank>(defaultRank)
  const [searchQuery, setSearchQuery] = React.useState("")
  const [hoveredTicker, setHoveredTicker] = React.useState<string | null>(null)
  const [tooltipPos, setTooltipPos] = React.useState<{ x: number; y: number } | null>(null)

  // Filter and sort stocks
  const filteredStocks = React.useMemo(() => {
    let list = stocks
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      list = list.filter(
        (s) =>
          s.ticker.toLowerCase().includes(q) ||
          s.companyName.toLowerCase().includes(q) ||
          s.sector.toLowerCase().includes(q)
      )
    }
    // Sort by volume descending as primary liquidity rank
    return [...list]
      .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
      .slice(0, rankFilter)
  }, [stocks, searchQuery, rankFilter])

  // Calculate packed bubbles layout
  const packedBubbles: PackedBubble[] = React.useMemo(() => {
    const count = filteredStocks.length
    if (count === 0) return []

    // Maximum volume for sizing
    const maxVol = Math.max(...filteredStocks.map((s) => s.volume ?? 1), 1)

    // Find highest positive gainer for special fuchsia aura
    let maxGain = -Infinity
    let topGainerTicker = ""
    for (const stock of filteredStocks) {
      const chg = getStockChange(stock, period) ?? 0
      if (chg > maxGain) {
        maxGain = chg
        topGainerTicker = stock.ticker
      }
    }

    return filteredStocks.map((stock, index) => {
      const change = getStockChange(stock, period)
      const vol = stock.volume ?? 0
      const volRatio = Math.max(0.1, Math.min(1, vol / maxVol))

      let sizeCategory: PackedBubble["sizeCategory"] = "tiny"
      let radius = 28
      if (index === 0 || (index < 3 && volRatio > 0.6)) {
        sizeCategory = "huge"
        radius = 72
      } else if (index < 8 || volRatio > 0.4) {
        sizeCategory = "large"
        radius = 56
      } else if (index < 24 || volRatio > 0.2) {
        sizeCategory = "medium"
        radius = 42
      } else if (index < 60) {
        sizeCategory = "small"
        radius = 34
      }

      // Determine color tone
      let tone: PackedBubble["tone"] = "neutral"
      if (stock.ticker === topGainerTicker && maxGain >= 3.5) {
        tone = "fuchsia"
      } else if ((change ?? 0) >= 5) {
        tone = "fuchsia"
      } else if ((change ?? 0) > 0) {
        tone = "emerald"
      } else if ((change ?? 0) < 0) {
        tone = "rose"
      }

      // Distribute in concentric organic spiral
      const goldenAngle = 2.39996322972865332
      const spread = 44
      const r = (Math.sqrt(index + 0.6) / Math.sqrt(count + 1)) * spread
      const theta = index * goldenAngle

      // Aspect ratio correction (16:9 canvas)
      const x = 50 + r * Math.cos(theta) * 1.45
      const y = 50 + r * Math.sin(theta) * 0.95

      return {
        stock,
        rank: index + 1,
        change,
        x: Math.max(5, Math.min(95, x)),
        y: Math.max(6, Math.min(94, y)),
        radius,
        sizeCategory,
        tone,
      }
    })
  }, [filteredStocks, period])

  const hoveredBubble = React.useMemo(
    () => packedBubbles.find((b) => b.stock.ticker === hoveredTicker),
    [packedBubbles, hoveredTicker]
  )

  const handleBubbleHover = (ticker: string, e: React.MouseEvent<HTMLButtonElement>) => {
    setHoveredTicker(ticker)
    const rect = e.currentTarget.getBoundingClientRect()
    setTooltipPos({
      x: rect.left + rect.width / 2,
      y: rect.top - 12,
    })
  }

  const handleBubbleLeave = () => {
    setHoveredTicker(null)
    setTooltipPos(null)
  }

  return (
    <div className="space-y-4">
      {/* Top Controls Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Left Side: View Switcher, Period Filter, Rank Filter */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Bubbles vs Columns Mode Switcher */}
          <div className="flex items-center rounded-lg border border-white/[0.08] bg-[#020b12] p-1 shadow-inner">
            <button
              type="button"
              onClick={() => setViewMode("bubbles")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold transition-colors",
                viewMode === "bubbles"
                  ? "bg-teal-400/20 text-teal-200 shadow-sm"
                  : "text-slate-500 hover:text-slate-200"
              )}
              aria-label="Chế độ Bubbles"
            >
              <CircleDot className="size-3.5 text-teal-300" />
              <span>Bubbles</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("columns")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold transition-colors",
                viewMode === "columns"
                  ? "bg-teal-400/20 text-teal-200 shadow-sm"
                  : "text-slate-500 hover:text-slate-200"
              )}
              aria-label="Chế độ Columns"
            >
              <LayoutGrid className="size-3.5 text-teal-300" />
              <span>Columns</span>
            </button>
          </div>

          {/* Timeframe Pills */}
          <div className="flex items-center rounded-lg border border-white/[0.08] bg-[#020b12] p-1">
            {(["15M", "1H", "1D", "1W", "1M", "1Y"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={cn(
                  "rounded-md px-2.5 py-1 font-mono text-[11px] font-bold transition-colors",
                  period === p
                    ? "bg-white/[0.12] text-white shadow-sm"
                    : "text-slate-500 hover:text-slate-300"
                )}
              >
                {p}
              </button>
            ))}
          </div>

          {/* Rank Selector */}
          <div className="flex items-center rounded-lg border border-white/[0.08] bg-[#020b12] px-2 py-1">
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-500 mr-1.5">Rank:</span>
            <select
              value={rankFilter}
              onChange={(e) => setRankFilter(Number(e.target.value) as BubbleRank)}
              className="bg-transparent font-mono text-xs font-bold text-teal-200 outline-none cursor-pointer"
              aria-label="Chọn số lượng cổ phiếu"
            >
              <option value={50} className="bg-[#0b1822] text-white">Top 50</option>
              <option value={100} className="bg-[#0b1822] text-white">Top 100</option>
              <option value={200} className="bg-[#0b1822] text-white">Top 200</option>
              <option value={500} className="bg-[#0b1822] text-white">Tất cả</option>
            </select>
          </div>
        </div>

        {/* Right Side: Search Input & Radar Badge */}
        <div className="flex items-center gap-2">
          <label className="flex h-9 items-center gap-2 rounded-lg border border-white/[0.08] bg-[#020b12] px-3 focus-within:border-teal-400/40 focus-within:ring-1 focus-within:ring-teal-400/30">
            <Search className="size-3.5 text-slate-500" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm mã cổ phiếu..."
              className="w-32 bg-transparent text-xs text-white outline-none placeholder:text-slate-500 sm:w-40"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="text-slate-500 hover:text-white"
                aria-label="Xoá tìm kiếm"
              >
                <X className="size-3" />
              </button>
            )}
          </label>

          <div className="flex items-center gap-2 rounded-lg border border-cyan-400/20 bg-cyan-400/[0.07] px-3 py-2 font-mono text-[10px] font-black uppercase tracking-wider text-cyan-300">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-cyan-400 shadow-[0_0_8px_#22d3ee]" />
            </span>
            <span>Radar Active · {filteredStocks.length}</span>
          </div>
        </div>
      </div>

      {/* Main Viewport */}
      {viewMode === "bubbles" ? (
        <div
          className="market-bubble-field relative min-h-[650px] sm:min-h-[720px] w-full overflow-hidden rounded-2xl border border-white/[0.08] bg-[#020b12] p-4 select-none"
          aria-label={`Bản đồ Top ${filteredStocks.length} cổ phiếu ${period}`}
        >
          {/* Radar background effects */}
          <div className="market-radar-sweep pointer-events-none absolute inset-0" aria-hidden="true" />
          
          {/* Compass / grid rings */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
            <div className="size-[280px] sm:size-[380px] rounded-full border border-cyan-500/[0.06]" />
            <div className="absolute size-[520px] sm:size-[680px] rounded-full border border-cyan-500/[0.04]" />
          </div>

          {/* Bubbles Container */}
          <div className="relative z-10 size-full min-h-[620px] sm:min-h-[690px]">
            {packedBubbles.map((bubble) => {
              const { stock, rank, change, x, y, radius, tone, sizeCategory } = bubble
              const logoSize =
                sizeCategory === "huge"
                  ? 40
                  : sizeCategory === "large"
                  ? 30
                  : sizeCategory === "medium"
                  ? 22
                  : 16

              const isFuchsia = tone === "fuchsia"
              const isEmerald = tone === "emerald"
              const isRose = tone === "rose"

              return (
                <button
                  key={stock.ticker}
                  type="button"
                  onClick={() => onOpenStockDetail?.(stock.ticker)}
                  onMouseEnter={(e) => handleBubbleHover(stock.ticker, e)}
                  onMouseLeave={handleBubbleLeave}
                  style={{
                    left: `${x}%`,
                    top: `${y}%`,
                    width: `${radius * 2}px`,
                    height: `${radius * 2}px`,
                    transform: "translate(-50%, -50%)",
                  }}
                  className={cn(
                    "group absolute flex flex-col items-center justify-center rounded-full text-center transition-transform duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300",
                    rank <= 12 && "market-bubble-float",
                    hoveredTicker === stock.ticker ? "z-30 scale-110" : "hover:z-20 hover:scale-105",
                    isFuchsia &&
                      "border-2 border-fuchsia-400/90 shadow-[0_0_26px_rgba(217,70,239,0.5),inset_0_0_24px_rgba(217,70,239,0.18)] bg-[radial-gradient(circle_at_35%_30%,rgba(255,255,255,0.15),transparent_50%),#120417]",
                    isEmerald &&
                      "border-2 border-emerald-400/90 shadow-[0_0_20px_rgba(16,185,129,0.4),inset_0_0_20px_rgba(16,185,129,0.15)] bg-[radial-gradient(circle_at_35%_30%,rgba(255,255,255,0.12),transparent_50%),#02120e]",
                    isRose &&
                      "border-2 border-rose-500/90 shadow-[0_0_20px_rgba(244,63,94,0.4),inset_0_0_20px_rgba(244,63,94,0.15)] bg-[radial-gradient(circle_at_35%_30%,rgba(255,255,255,0.12),transparent_50%),#140307]",
                    !isFuchsia &&
                      !isEmerald &&
                      !isRose &&
                      "border-2 border-slate-600/70 shadow-[0_0_12px_rgba(148,163,184,0.2)] bg-[#070f17]"
                  )}
                  title={`${stock.ticker} · ${stock.companyName} (${formatSigned(change, 2, "%")})`}
                >
                  <StockLogo symbol={stock.ticker} size={logoSize} className="mb-0.5 pointer-events-none" />
                  <strong
                    className={cn(
                      "font-mono font-black uppercase text-white tracking-wider leading-none",
                      sizeCategory === "huge"
                        ? "text-base sm:text-lg"
                        : sizeCategory === "large"
                        ? "text-xs sm:text-sm"
                        : sizeCategory === "medium"
                        ? "text-[10px] sm:text-xs"
                        : "text-[8px] sm:text-[9px]"
                    )}
                  >
                    {stock.ticker}
                  </strong>
                  <span
                    className={cn(
                      "font-mono font-bold leading-none mt-0.5",
                      sizeCategory === "huge"
                        ? "text-xs sm:text-sm"
                        : sizeCategory === "large"
                        ? "text-[10px] sm:text-xs"
                        : sizeCategory === "medium"
                        ? "text-[9px] sm:text-[10px]"
                        : "text-[8px]",
                      isFuchsia
                        ? "text-fuchsia-300"
                        : isEmerald
                        ? "text-emerald-300"
                        : isRose
                        ? "text-rose-300"
                        : "text-slate-400"
                    )}
                  >
                    {formatSigned(change, 2, "%")}
                  </span>
                </button>
              )
            })}

            {packedBubbles.length === 0 && (
              <div className="flex h-full min-h-[500px] flex-col items-center justify-center text-center text-slate-500">
                <p className="text-sm font-medium">Không tìm thấy mã cổ phiếu phù hợp với từ khóa.</p>
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="mt-2 text-xs text-teal-300 underline"
                >
                  Xoá bộ lọc tìm kiếm
                </button>
              </div>
            )}
          </div>

          {/* Floating Rich Tooltip */}
          {hoveredBubble && tooltipPos && (
            <div
              className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-xl border border-white/15 bg-[#0a1820]/95 p-3.5 text-xs shadow-2xl backdrop-blur-none"
              style={{
                left: `${tooltipPos.x}px`,
                top: `${tooltipPos.y}px`,
              }}
            >
              <div className="flex items-center gap-2.5">
                <StockLogo symbol={hoveredBubble.stock.ticker} size={28} />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-black text-white">{hoveredBubble.stock.ticker}</span>
                    <span className="rounded bg-white/[0.08] px-1.5 py-0.5 text-[9px] font-bold text-teal-300">
                      {hoveredBubble.stock.sector}
                    </span>
                  </div>
                  <p className="line-clamp-1 text-[11px] text-slate-400 max-w-[200px]">
                    {hoveredBubble.stock.companyName}
                  </p>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2 border-t border-white/[0.08] pt-2 text-center font-mono">
                <div>
                  <span className="block text-[9px] text-slate-500">1D</span>
                  <strong
                    className={cn(
                      "text-xs",
                      (hoveredBubble.stock.change1d ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"
                    )}
                  >
                    {formatSigned(hoveredBubble.stock.change1d, 2, "%")}
                  </strong>
                </div>
                <div>
                  <span className="block text-[9px] text-slate-500">1W</span>
                  <strong
                    className={cn(
                      "text-xs",
                      (hoveredBubble.stock.change1w ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"
                    )}
                  >
                    {formatSigned(hoveredBubble.stock.change1w, 2, "%")}
                  </strong>
                </div>
                <div>
                  <span className="block text-[9px] text-slate-500">KLGD</span>
                  <strong className="text-xs text-white">
                    {hoveredBubble.stock.volume != null
                      ? `${(hoveredBubble.stock.volume / 1000000).toFixed(1)}M`
                      : "—"}
                  </strong>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Columns / List Ranking View */
        <div className="rounded-2xl border border-white/[0.08] bg-[#020b12] p-4">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredStocks.map((stock, index) => {
              const change = getStockChange(stock, period)
              const isPos = (change ?? 0) >= 0
              return (
                <button
                  key={stock.ticker}
                  type="button"
                  onClick={() => onOpenStockDetail?.(stock.ticker)}
                  className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-left transition-colors hover:border-teal-300/25 hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300/40"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-mono text-[10px] font-bold text-slate-500">#{index + 1}</span>
                    <StockLogo symbol={stock.ticker} size={32} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <strong className="font-mono text-sm font-black text-white">{stock.ticker}</strong>
                        <span className="truncate text-[9px] text-slate-500 max-w-[90px]">{stock.sector}</span>
                      </div>
                      <p className="truncate text-[10px] text-slate-400 max-w-[140px]">{stock.companyName}</p>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <strong className={cn("font-mono text-sm font-black", isPos ? "text-emerald-300" : "text-rose-300")}>
                      {formatSigned(change, 2, "%")}
                    </strong>
                    <span className="block font-mono text-[9px] text-slate-500">
                      {stock.volume != null ? `${(stock.volume / 1000000).toFixed(1)}M cp` : "—"}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
