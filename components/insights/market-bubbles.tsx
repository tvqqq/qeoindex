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
    const scale = period === "15M" ? 0.25 : 0.5
    return stock.change1d != null ? Number((stock.change1d * scale).toFixed(2)) : null
  }
  return stock.change1d
}

// 2D Physics node for collision-free circle packing
interface SimBubble {
  stock: MarketBubbleStock
  rank: number
  change: number | null
  x: number // in px
  y: number // in px
  vx: number
  vy: number
  r: number // radius in px
  tone: "fuchsia" | "emerald" | "rose" | "neutral"
}

export function MarketBubbles({
  stocks,
  onOpenStockDetail,
  defaultPeriod = "1D",
  defaultRank = 100,
}: MarketBubblesProps) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = React.useState<{ width: number; height: number }>({
    width: 1100,
    height: 680,
  })

  const [viewMode, setViewMode] = React.useState<"bubbles" | "columns">("bubbles")
  const [period, setPeriod] = React.useState<BubblePeriod>(defaultPeriod)
  const [rankFilter, setRankFilter] = React.useState<BubbleRank>(defaultRank)
  const [searchQuery, setSearchQuery] = React.useState("")
  const [hoveredTicker, setHoveredTicker] = React.useState<string | null>(null)
  const [tooltipPos, setTooltipPos] = React.useState<{ x: number; y: number } | null>(null)

  // Track container pixel size
  React.useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 200 && height > 200) {
          setDimensions({ width, height })
        }
      }
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

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
    return [...list]
      .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
      .slice(0, rankFilter)
  }, [stocks, searchQuery, rankFilter])

  // Physics Simulation: 100% Collision-free circle packing
  const bubbles: SimBubble[] = React.useMemo(() => {
    const count = filteredStocks.length
    if (count === 0) return []

    const W = Math.max(dimensions.width, 600)
    const H = Math.max(dimensions.height, 600)
    const centerX = W / 2
    const centerY = H / 2

    // Find highest gainer for special fuchsia aura
    let maxGain = -Infinity
    let topGainerTicker = ""
    for (const stock of filteredStocks) {
      const chg = getStockChange(stock, period) ?? 0
      if (chg > maxGain) {
        maxGain = chg
        topGainerTicker = stock.ticker
      }
    }

    // Determine radii based on rank and available area
    const totalArea = W * H * 0.48 // Fill 48% of canvas
    // Weight by index: leaders get significantly larger radius
    const rawWeights = filteredStocks.map((_, i) => {
      if (i === 0) return 6.0
      if (i < 3) return 4.2
      if (i < 8) return 2.8
      if (i < 20) return 1.8
      if (i < 50) return 1.2
      return 0.85
    })
    const sumWeights = rawWeights.reduce((acc, w) => acc + w * w, 0)
    const baseScale = Math.sqrt(totalArea / (Math.PI * sumWeights))

    const nodes: SimBubble[] = filteredStocks.map((stock, index) => {
      const change = getStockChange(stock, period)
      const weight = rawWeights[index]
      let r = Math.max(18, Math.min(75, Math.round(weight * baseScale)))

      // On narrow mobile screens, cap radius slightly
      if (W < 640) {
        r = Math.max(14, Math.min(48, Math.round(r * 0.75)))
      }

      // Determine tone
      let tone: SimBubble["tone"] = "neutral"
      if (stock.ticker === topGainerTicker && maxGain >= 3.5) {
        tone = "fuchsia"
      } else if ((change ?? 0) >= 5) {
        tone = "fuchsia"
      } else if ((change ?? 0) > 0) {
        tone = "emerald"
      } else if ((change ?? 0) < 0) {
        tone = "rose"
      }

      // Initial placement in concentric spiral outward from center
      const phi = index * 2.39996322972865332
      const dist = Math.sqrt(index + 0.5) * (baseScale * 1.8)
      const x = centerX + Math.cos(phi) * dist * 1.3
      const y = centerY + Math.sin(phi) * dist * 0.9

      return {
        stock,
        rank: index + 1,
        change,
        x,
        y,
        vx: 0,
        vy: 0,
        r,
        tone,
      }
    })

    // Iterative 2D Force-Collision Relaxation (150 iterations)
    const iterations = 150
    const padding = 4 // 4px safety gap between bubbles

    for (let iter = 0; iter < iterations; iter++) {
      const alpha = 1 - iter / iterations // Cooling factor

      // 1. Center attraction force
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        const dx = centerX - node.x
        const dy = centerY - node.y
        node.x += dx * 0.035 * alpha
        node.y += dy * 0.035 * alpha
      }

      // 2. Strict Pairwise Circle Collision Resolution
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const n1 = nodes[i]
          const n2 = nodes[j]
          const dx = n2.x - n1.x
          const dy = n2.y - n1.y
          const dist = Math.hypot(dx, dy)
          const minDist = n1.r + n2.r + padding

          if (dist < minDist) {
            const overlap = minDist - dist
            const nx = dist > 0.001 ? dx / dist : Math.cos(i + j)
            const ny = dist > 0.001 ? dy / dist : Math.sin(i + j)

            // Push apart proportionally to relative radii
            const totalR = n1.r + n2.r
            const ratio1 = n2.r / totalR
            const ratio2 = n1.r / totalR

            n1.x -= nx * overlap * ratio1 * 0.85
            n1.y -= ny * overlap * ratio1 * 0.85
            n2.x += nx * overlap * ratio2 * 0.85
            n2.y += ny * overlap * ratio2 * 0.85
          }
        }
      }

      // 3. Boundary containment
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        node.x = Math.max(node.r + 10, Math.min(W - node.r - 10, node.x))
        node.y = Math.max(node.r + 10, Math.min(H - node.r - 10, node.y))
      }
    }

    return nodes
  }, [filteredStocks, period, dimensions])

  const hoveredBubble = React.useMemo(
    () => bubbles.find((b) => b.stock.ticker === hoveredTicker),
    [bubbles, hoveredTicker]
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
          ref={containerRef}
          className="market-bubble-field relative min-h-[650px] sm:min-h-[720px] w-full overflow-hidden rounded-2xl border border-white/[0.08] bg-[#020b12] select-none"
          aria-label={`Bản đồ Top ${filteredStocks.length} cổ phiếu ${period}`}
        >
          {/* Radar sweep background */}
          <div className="market-radar-sweep pointer-events-none absolute inset-0" aria-hidden="true" />

          {/* Compass / grid rings */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
            <div className="size-[280px] sm:size-[380px] rounded-full border border-cyan-500/[0.06]" />
            <div className="absolute size-[520px] sm:size-[680px] rounded-full border border-cyan-500/[0.04]" />
          </div>

          {/* Collision-Resolved Bubbles Canvas */}
          <div className="relative z-10 size-full min-h-[650px] sm:min-h-[720px]">
            {bubbles.map((bubble) => {
              const { stock, rank, change, x, y, r, tone } = bubble
              const diameter = r * 2
              const logoSize = r >= 50 ? 34 : r >= 38 ? 26 : r >= 26 ? 18 : 13

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
                    left: `${x}px`,
                    top: `${y}px`,
                    width: `${diameter}px`,
                    height: `${diameter}px`,
                    transform: "translate(-50%, -50%)",
                  }}
                  className={cn(
                    "group absolute flex flex-col items-center justify-center rounded-full text-center transition-transform duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300",
                    rank <= 14 && "market-bubble-float",
                    hoveredTicker === stock.ticker ? "z-30 scale-110" : "hover:z-20 hover:scale-105",
                    isFuchsia &&
                      "border-2 border-fuchsia-400/90 shadow-[0_0_26px_rgba(217,70,239,0.5),inset_0_0_22px_rgba(217,70,239,0.18)] bg-[radial-gradient(circle_at_35%_30%,rgba(255,255,255,0.15),transparent_50%),#120417]",
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
                      r >= 50
                        ? "text-sm sm:text-base"
                        : r >= 38
                        ? "text-xs sm:text-sm"
                        : r >= 26
                        ? "text-[10px] sm:text-xs"
                        : "text-[8px] sm:text-[9px]"
                    )}
                  >
                    {stock.ticker}
                  </strong>
                  <span
                    className={cn(
                      "font-mono font-bold leading-none mt-0.5",
                      r >= 50
                        ? "text-xs sm:text-sm"
                        : r >= 38
                        ? "text-[10px] sm:text-xs"
                        : r >= 26
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

            {bubbles.length === 0 && (
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
