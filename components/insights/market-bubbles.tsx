"use client"

import * as React from "react"
import { CircleDot, LayoutGrid } from "lucide-react"

import { StockLogo } from "@/components/stock-logo"
import { AnimatedTabs, type AnimatedTab } from "@/components/smoothui/animated-tabs"
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

export type BubblePeriod = "1D" | "1W" | "1M" | "1Y"

interface MarketBubblesProps {
  stocks: MarketBubbleStock[]
  onOpenStockDetail?: (ticker: string) => void
  defaultPeriod?: BubblePeriod
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
  return stock.change1d
}

interface SimBubble {
  stock: MarketBubbleStock
  rank: number
  change: number | null
  x: number // in px
  y: number // in px
  r: number // radius in px
  tone: "fuchsia" | "emerald" | "rose" | "neutral"
}

const PERIOD_TABS: AnimatedTab<BubblePeriod>[] = [
  { value: "1D", label: "1D" },
  { value: "1W", label: "1W" },
  { value: "1M", label: "1M" },
  { value: "1Y", label: "1Y" },
]

export function MarketBubbles({
  stocks,
  onOpenStockDetail,
  defaultPeriod = "1D",
}: MarketBubblesProps) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = React.useState<{ width: number; height: number }>({
    width: 1200,
    height: 740,
  })

  const [viewMode, setViewMode] = React.useState<"bubbles" | "columns">("bubbles")
  const [period, setPeriod] = React.useState<BubblePeriod>(defaultPeriod)
  const [hoveredTicker, setHoveredTicker] = React.useState<string | null>(null)
  const [tooltipPos, setTooltipPos] = React.useState<{ x: number; y: number } | null>(null)

  // Track container pixel size via ResizeObserver
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

  // Auto Top 100 stocks
  const topStocks = React.useMemo(() => {
    return [...stocks]
      .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
      .slice(0, 100)
  }, [stocks])

  // Physics Simulation: High density tight-packing filling 76% of canvas without gaps
  const bubbles: SimBubble[] = React.useMemo(() => {
    const count = topStocks.length
    if (count === 0) return []

    const W = Math.max(dimensions.width, 600)
    const H = Math.max(dimensions.height, 600)

    // Calculate changes & extremes
    const changes = topStocks.map((s) => getStockChange(s, period) ?? 0)
    const absChanges = changes.map((c) => Math.abs(c))
    const maxAbsChange = Math.max(2.5, ...absChanges)
    const minAbsChange = Math.min(...absChanges)

    // Target coverage: 76% of available viewport area for dense edge-to-edge bubbles
    const targetTotalArea = W * H * 0.76

    // Calculate raw radii based on price change
    const rawRadii = topStocks.map((stock, i) => {
      const chg = changes[i]
      const absChg = Math.abs(chg)
      const norm = Math.max(0, (absChg - minAbsChange) / (maxAbsChange - minAbsChange || 1))
      const scale = Math.pow(norm, 0.52) // smooth power curve

      // Base radius from 26px up to 105px on desktop
      let r = 26 + scale * 74

      // Ceiling bonus: >6.5% gains get extra size
      if (chg >= 6.5) {
        r = Math.min(115, r * 1.15)
      }

      if (W < 640) {
        r = Math.max(16, Math.min(60, Math.round(r * 0.72)))
      }
      return r
    })

    // Scale so total area matches target area (76% density)
    const currentSumArea = rawRadii.reduce((acc, r) => acc + Math.PI * r * r, 0)
    const areaMultiplier = Math.sqrt(targetTotalArea / (currentSumArea || 1))

    // Initialize bubbles evenly distributed across full grid
    const cols = Math.ceil(Math.sqrt(count * (W / H)))
    const rows = Math.ceil(count / cols)
    const cellW = (W - 30) / cols
    const cellH = (H - 30) / rows

    const indexedStocks = topStocks.map((stock, index) => ({
      stock,
      index,
      change: changes[index],
      r: Math.round(rawRadii[index] * areaMultiplier),
    }))

    const nodes: SimBubble[] = indexedStocks.map((item, i) => {
      const { stock, change, r } = item
      const col = i % cols
      const row = Math.floor(i / cols)

      // Jittered grid covering full bounding box
      const x = 15 + (col + 0.5) * cellW + (Math.sin(i * 3.7) * cellW * 0.2)
      const y = 15 + (row + 0.5) * cellH + (Math.cos(i * 4.3) * cellH * 0.2)

      let tone: SimBubble["tone"] = "neutral"
      if (change >= 6.5) {
        tone = "fuchsia"
      } else if (change > 0) {
        tone = "emerald"
      } else if (change < 0) {
        tone = "rose"
      }

      return {
        stock,
        rank: i + 1,
        change,
        x,
        y,
        r,
        tone,
      }
    })

    // Iterative 2D Collision-Free Physics (250 passes, minimal 2px gap)
    const iterations = 250
    const padding = 2 // 2px tight contact gap like real foam bubbles

    for (let iter = 0; iter < iterations; iter++) {
      const alpha = Math.max(0.06, 1 - iter / iterations)

      // 1. Soft boundary expansion (keeps bubbles spread to edges)
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        if (node.x < node.r + 15) node.x += (node.r + 15 - node.x) * 0.08 * alpha
        if (node.x > W - node.r - 15) node.x -= (node.x - (W - node.r - 15)) * 0.08 * alpha
        if (node.y < node.r + 15) node.y += (node.r + 15 - node.y) * 0.08 * alpha
        if (node.y > H - node.r - 15) node.y -= (node.y - (H - node.r - 15)) * 0.08 * alpha
      }

      // 2. Strict Pairwise Circle Collision Push
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
            const nx = dist > 0.0001 ? dx / dist : Math.cos((i * 19 + j * 13) % 6.28)
            const ny = dist > 0.0001 ? dy / dist : Math.sin((i * 19 + j * 13) % 6.28)

            const totalR = n1.r + n2.r
            const ratio1 = n2.r / totalR
            const ratio2 = n1.r / totalR

            n1.x -= nx * overlap * ratio1
            n1.y -= ny * overlap * ratio1
            n2.x += nx * overlap * ratio2
            n2.y += ny * overlap * ratio2
          }
        }
      }

      // 3. Strict Boundary Containment
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        node.x = Math.max(node.r + 4, Math.min(W - node.r - 4, node.x))
        node.y = Math.max(node.r + 4, Math.min(H - node.r - 4, node.y))
      }
    }

    return nodes
  }, [topStocks, period, dimensions])

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
      {/* Top Toolbar with SmoothUI AnimatedTabs */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Left Side: View Mode & Timeframe Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* View Mode Switcher */}
          <div className="flex items-center rounded-xl border border-white/[0.08] bg-black/40 p-1 shadow-inner backdrop-blur-none">
            <button
              type="button"
              onClick={() => setViewMode("bubbles")}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors",
                viewMode === "bubbles"
                  ? "bg-teal-400/20 text-teal-200 shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
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
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors",
                viewMode === "columns"
                  ? "bg-teal-400/20 text-teal-200 shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              )}
              aria-label="Chế độ Columns"
            >
              <LayoutGrid className="size-3.5 text-teal-300" />
              <span>Columns</span>
            </button>
          </div>

          {/* Timeframe Animated Tabs (1D, 1W, 1M, 1Y) */}
          <AnimatedTabs
            tabs={PERIOD_TABS}
            value={period}
            onValueChange={setPeriod}
            variant="segment"
            ariaLabel="Chọn khung thời gian"
            className="border-white/[0.08] bg-black/40 p-1 font-mono text-xs font-bold"
            tabClassName="px-3 py-1.5 text-slate-400 data-[state=active]:text-white"
            indicatorClassName="bg-white/[0.14] rounded-lg shadow-sm"
          />
        </div>

        {/* Right Side: Status Badge */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.08] px-3.5 py-1.5 font-mono text-[10px] font-black uppercase tracking-wider text-cyan-300 shadow-sm">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-cyan-400 shadow-[0_0_8px_#22d3ee]" />
            </span>
            <span>Top 100 · {period}</span>
          </div>
        </div>
      </div>

      {/* Main Viewport */}
      {viewMode === "bubbles" ? (
        <div
          ref={containerRef}
          className="market-bubble-field relative min-h-[650px] sm:min-h-[780px] w-full overflow-hidden rounded-2xl border border-white/[0.09] bg-[radial-gradient(ellipse_80%_60%_at_50%_40%,#051824_0%,#020b13_50%,#01050a_100%)] select-none shadow-2xl"
          aria-label={`Bản đồ Top 100 cổ phiếu ${period}`}
        >
          {/* Ambient Liquid Glass background aura */}
          <div className="pointer-events-none absolute -left-20 -top-20 size-96 rounded-full bg-teal-500/[0.04] blur-3xl" aria-hidden="true" />
          <div className="pointer-events-none absolute -bottom-20 -right-20 size-96 rounded-full bg-indigo-500/[0.04] blur-3xl" aria-hidden="true" />

          {/* Compass / grid coordinate rings */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-30" aria-hidden="true">
            <div className="size-[320px] sm:size-[460px] rounded-full border border-cyan-400/[0.08]" />
            <div className="absolute size-[600px] sm:size-[800px] rounded-full border border-cyan-400/[0.05]" />
          </div>

          {/* Collision-Resolved Bubbles Canvas */}
          <div className="relative z-10 size-full min-h-[650px] sm:min-h-[780px]">
            {bubbles.map((bubble) => {
              const { stock, change, x, y, r, tone } = bubble
              const diameter = r * 2
              const logoSize = r >= 55 ? 38 : r >= 40 ? 30 : r >= 28 ? 22 : r >= 20 ? 16 : 12

              const isFuchsia = tone === "fuchsia"
              const isEmerald = tone === "emerald"
              const isRose = tone === "rose"
              const isBigBubble = r >= 38

              return (
                <button
                  key={stock.ticker}
                  type="button"
                  onClick={() => onOpenStockDetail?.(stock.ticker)}
                  onMouseEnter={(e) => handleBubbleHover(stock.ticker, e)}
                  onMouseLeave={handleBubbleLeave}
                  style={{
                    left: `${Math.round(x - r)}px`,
                    top: `${Math.round(y - r)}px`,
                    width: `${diameter}px`,
                    height: `${diameter}px`,
                  }}
                  className={cn(
                    "group absolute flex flex-col items-center justify-center rounded-full text-center transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300",
                    hoveredTicker === stock.ticker ? "z-30 scale-110" : "hover:z-20 hover:scale-105",

                    // Fuchsia / Purple ceiling glass
                    isFuchsia && [
                      "border-2 border-fuchsia-300/90",
                      "bg-[radial-gradient(135%_135%_at_30%_25%,rgba(232,121,249,0.48)_0%,rgba(217,70,239,0.28)_45%,rgba(112,26,117,0.75)_100%)]",
                      isBigBubble
                        ? "shadow-[0_0_35px_rgba(217,70,239,0.65),0_0_12px_rgba(232,121,249,0.9),inset_0_0_22px_rgba(232,121,249,0.4)]"
                        : "shadow-[0_0_18px_rgba(217,70,239,0.4),inset_0_0_12px_rgba(232,121,249,0.25)]",
                    ],

                    // Emerald / Green gainer glass
                    isEmerald && [
                      "border-2 border-emerald-400/90",
                      "bg-[radial-gradient(135%_135%_at_30%_25%,rgba(52,211,153,0.42)_0%,rgba(16,185,129,0.22)_45%,rgba(6,78,59,0.65)_100%)]",
                      isBigBubble
                        ? "shadow-[0_0_30px_rgba(16,185,129,0.55),0_0_10px_rgba(52,211,153,0.85),inset_0_0_20px_rgba(52,211,153,0.35)]"
                        : "shadow-[0_0_15px_rgba(16,185,129,0.35),inset_0_0_10px_rgba(52,211,153,0.2)]",
                    ],

                    // Rose / Red loser glass
                    isRose && [
                      "border-2 border-rose-400/90",
                      "bg-[radial-gradient(135%_135%_at_30%_25%,rgba(251,113,133,0.42)_0%,rgba(244,63,94,0.22)_45%,rgba(136,19,55,0.65)_100%)]",
                      isBigBubble
                        ? "shadow-[0_0_30px_rgba(244,63,94,0.55),0_0_10px_rgba(251,113,133,0.85),inset_0_0_20px_rgba(251,113,133,0.35)]"
                        : "shadow-[0_0_15px_rgba(244,63,94,0.35),inset_0_0_10px_rgba(251,113,133,0.2)]",
                    ],

                    // Neutral / Flat glass
                    !isFuchsia &&
                      !isEmerald &&
                      !isRose && [
                        "border-2 border-slate-500/70",
                        "bg-[radial-gradient(135%_135%_at_30%_25%,rgba(148,163,184,0.25)_0%,rgba(71,85,105,0.2)_45%,rgba(15,23,42,0.7)_100%)]",
                        "shadow-[0_0_14px_rgba(148,163,184,0.2),inset_0_0_10px_rgba(148,163,184,0.15)]",
                      ]
                  )}
                  title={`${stock.ticker} · ${stock.companyName} (${formatSigned(change, 2, "%")})`}
                >
                  {/* Top-left specular liquid glass glare */}
                  <div
                    className="pointer-events-none absolute left-1.5 top-1.5 rounded-full bg-gradient-to-b from-white/30 to-transparent"
                    style={{
                      width: `${Math.round(r * 0.7)}px`,
                      height: `${Math.round(r * 0.45)}px`,
                    }}
                    aria-hidden="true"
                  />

                  <StockLogo
                    symbol={stock.ticker}
                    size={logoSize}
                    fallback="none"
                    className="mb-0.5 pointer-events-none drop-shadow-sm"
                  />
                  <strong
                    className={cn(
                      "font-mono font-black uppercase text-white tracking-wider leading-none drop-shadow",
                      r >= 55
                        ? "text-base sm:text-2xl"
                        : r >= 40
                        ? "text-sm sm:text-lg"
                        : r >= 28
                        ? "text-xs sm:text-sm font-extrabold"
                        : r >= 20
                        ? "text-[10px] font-bold"
                        : "text-[9px] font-bold"
                    )}
                  >
                    {stock.ticker}
                  </strong>
                  <span
                    className={cn(
                      "font-mono font-bold leading-none mt-0.5 drop-shadow-sm",
                      r >= 55
                        ? "text-xs sm:text-base font-extrabold"
                        : r >= 40
                        ? "text-[11px] sm:text-sm font-bold"
                        : r >= 28
                        ? "text-[10px] font-bold"
                        : r >= 20
                        ? "text-[9px]"
                        : "text-[8px]",
                      isFuchsia
                        ? "text-fuchsia-200"
                        : isEmerald
                        ? "text-emerald-200"
                        : isRose
                        ? "text-rose-200"
                        : "text-slate-300"
                    )}
                  >
                    {formatSigned(change, 2, "%")}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Floating Rich Tooltip */}
          {hoveredBubble && tooltipPos && (
            <div
              className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-xl border border-white/20 bg-[#071520]/95 p-3.5 text-xs shadow-2xl backdrop-blur-none"
              style={{
                left: `${tooltipPos.x}px`,
                top: `${tooltipPos.y}px`,
              }}
            >
              <div className="flex items-center gap-2.5">
                <StockLogo symbol={hoveredBubble.stock.ticker} size={28} fallback="none" />
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
            {topStocks.map((stock, index) => {
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
