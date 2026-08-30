"use client"

import * as React from "react"
import {
  CircleDot,
  Flame,
  Gem,
  LayoutGrid,
  Layers,
  Search,
} from "lucide-react"

import { AnimatedTabs, type AnimatedTab } from "@/components/smoothui/animated-tabs"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { getSectorIcon } from "@/components/insights/sector-map-panel"

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
  r: number // radius in px (Price Change magnitude)
  borderWidth: number // border width in px (Volume magnitude)
  bobClass: string
  animDelay: string
  tone: "fuchsia" | "emerald" | "rose" | "neutral"
  volNorm: number
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
    height: 850,
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

  // Filter to Top 200 liquid stocks (sorted by volume descending)
  const topStocks = React.useMemo(() => {
    return [...stocks]
      .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
      .slice(0, 200)
  }, [stocks])

  // Group stocks by volume tiers for Columns view
  const volumeGroups = React.useMemo(() => {
    const g1: { stock: MarketBubbleStock; rank: number }[] = [] // > 10M cp
    const g2: { stock: MarketBubbleStock; rank: number }[] = [] // 3M - 10M cp
    const g3: { stock: MarketBubbleStock; rank: number }[] = [] // 1M - 3M cp
    const g4: { stock: MarketBubbleStock; rank: number }[] = [] // < 1M cp

    topStocks.forEach((stock, index) => {
      const vol = stock.volume ?? 0
      const rank = index + 1
      if (vol >= 10_000_000) {
        g1.push({ stock, rank })
      } else if (vol >= 3_000_000) {
        g2.push({ stock, rank })
      } else if (vol >= 1_000_000) {
        g3.push({ stock, rank })
      } else {
        g4.push({ stock, rank })
      }
    })

    return [
      {
        id: "ultra",
        icon: Flame,
        title: "Khối lượng cực lớn (> 10 Triệu cp)",
        badge: `${g1.length} mã`,
        badgeClass: "border-cyan-400/40 bg-cyan-400/10 text-cyan-300",
        items: g1,
      },
      {
        id: "high",
        icon: Gem,
        title: "Khối lượng cao (3M – 10M cp)",
        badge: `${g2.length} mã`,
        badgeClass: "border-teal-400/40 bg-teal-400/10 text-teal-300",
        items: g2,
      },
      {
        id: "medium",
        icon: Layers,
        title: "Khối lượng tích cực (1M – 3M cp)",
        badge: `${g3.length} mã`,
        badgeClass: "border-amber-400/40 bg-amber-400/10 text-amber-300",
        items: g3,
      },
      {
        id: "normal",
        icon: Search,
        title: "Khối lượng vừa & nhỏ (< 1M cp)",
        badge: `${g4.length} mã`,
        badgeClass: "border-slate-500/40 bg-slate-500/10 text-slate-300",
        items: g4,
      },
    ].filter((group) => group.items.length > 0)
  }, [topStocks])

  // Physics Simulation: Airy, spacious, well-distributed bubbles with guaranteed 10px spacing (no clumping!)
  const bubbles: SimBubble[] = React.useMemo(() => {
    const count = topStocks.length
    if (count === 0) return []

    const W = Math.max(dimensions.width, 600)
    const H = Math.max(dimensions.height, 700)
    const centerX = W / 2
    const centerY = H / 2

    // Calculate changes & extremes
    const changes = topStocks.map((s) => getStockChange(s, period) ?? 0)
    const absChanges = changes.map((c) => Math.abs(c))
    const maxAbsChange = Math.max(2.5, ...absChanges)
    const minAbsChange = Math.min(...absChanges)

    // Volume statistics for border thickness
    const volumes = topStocks.map((s) => s.volume ?? 0)
    const maxVol = Math.max(1_000_000, ...volumes)
    const minVol = Math.min(...volumes.filter((v) => v > 0)) || 10_000

    // Target area coverage: 40% of available viewport area for very spacious, airy spacing
    const targetTotalArea = W * H * 0.40

    // Calculate dynamic radii with strong visual amplification for stock price gains
    const rawRadii = topStocks.map((stock, i) => {
      const chg = changes[i]
      const absChg = Math.abs(chg)
      const norm = Math.max(0, (absChg - minAbsChange) / (maxAbsChange - minAbsChange || 1))

      // Base radius from 14px to 48px
      let r = 14 + Math.pow(norm, 0.48) * 34

      // Price gain scaling (Tăng mạnh kích thước theo % tăng giá của cổ phiếu)
      if (chg > 0) {
        if (chg >= 6.5) {
          // Ceiling / massive gainers (>6.5% - 10%)
          r *= 1.95 + (chg - 6.5) * 0.12
        } else if (chg >= 4.0) {
          // Strong gainers (4.0% - 6.5%)
          r *= 1.6 + (chg - 4.0) * 0.09
        } else if (chg >= 2.0) {
          // Solid gainers (2.0% - 4.0%)
          r *= 1.32 + (chg - 2.0) * 0.06
        } else if (chg >= 0.5) {
          // Moderate gainers
          r *= 1.15
        }
      } else if (chg < 0) {
        // Losers scaled based on decline magnitude
        if (absChg >= 5.0) {
          r *= 1.4
        } else if (absChg >= 2.5) {
          r *= 1.18
        }
      }

      if (W < 640) {
        r = Math.max(11, Math.min(44, Math.round(r * 0.68)))
      }
      return r
    })

    // Scale so total area matches target area
    const currentSumArea = rawRadii.reduce((acc, r) => acc + Math.PI * r * r, 0)
    const areaMultiplier = Math.sqrt(targetTotalArea / (currentSumArea || 1))

    const indexedStocks = topStocks.map((stock, index) => {
      const vol = stock.volume ?? 0
      const volNorm = Math.max(0, Math.min(1, (vol - minVol) / (maxVol - minVol || 1)))

      // Volume-driven border width
      let borderWidth = 1.5
      if (vol >= 15_000_000 || volNorm >= 0.6) {
        borderWidth = 4.0
      } else if (vol >= 6_000_000 || volNorm >= 0.32) {
        borderWidth = 3.0
      } else if (vol >= 1_500_000 || volNorm >= 0.12) {
        borderWidth = 2.2
      } else if (vol >= 300_000) {
        borderWidth = 1.8
      }

      return {
        stock,
        index,
        change: changes[index],
        r: Math.round(rawRadii[index] * areaMultiplier),
        borderWidth,
        volNorm,
      }
    })

    // Initialize with even area-preserving Fermat Golden Spiral across the full canvas
    const nodes: SimBubble[] = indexedStocks.map((item, i) => {
      const { stock, change, r, borderWidth, volNorm } = item

      const phi = i * 2.3999632 // Golden angle
      // Equal area dispersion: radDist grows with sqrt(i)
      const radDist = Math.sqrt((i + 0.5) / count) * Math.min(W, H) * 0.44
      const initX = centerX + Math.cos(phi) * radDist * (W / H)
      const initY = centerY + Math.sin(phi) * radDist

      let tone: SimBubble["tone"] = "neutral"
      if (change >= 6.5) {
        tone = "fuchsia"
      } else if (change > 0) {
        tone = "emerald"
      } else if (change < 0) {
        tone = "rose"
      }

      // Organic sway animation variation
      const bobClass = `bubble-bob-${(i % 4) + 1}`
      const animDelay = `${((i * 17) % 35) * 0.12}s`

      return {
        stock,
        rank: i + 1,
        change,
        x: initX,
        y: initY,
        r,
        borderWidth,
        bobClass,
        animDelay,
        tone,
        volNorm,
      }
    })

    // Iterative 2D Physics: Uniformly spread with guaranteed 16px spacing (no clumping!)
    const iterations = 220
    const padding = W < 640 ? 8.0 : 16.0 // Guaranteed 16px gap between all bubble boundaries

    for (let iter = 0; iter < iterations; iter++) {
      const alpha = Math.max(0.08, 1 - iter / iterations)

      // 1. Subtle centering force (keeps nodes inside canvas without squeezing into a clump)
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        node.x += (centerX - node.x) * 0.004 * alpha
        node.y += (centerY - node.y) * 0.004 * alpha
      }

      // 2. Strict Pairwise Circle Collision with Generous 16px Spacing Padding
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

      // 3. Strict Boundary Containment with Edge Margin
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        node.x = Math.max(node.r + 14, Math.min(W - node.r - 14, node.x))
        node.y = Math.max(node.r + 14, Math.min(H - node.r - 14, node.y))
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
          <div className="flex items-center rounded-xl border border-white/[0.08] bg-[#070e17] p-1 shadow-inner">
            <button
              type="button"
              onClick={() => setViewMode("bubbles")}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold transition-colors",
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
                "flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold transition-colors",
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
            className="border-white/[0.08] bg-[#070e17] p-1 font-mono text-xs font-bold"
            tabClassName="px-3 py-1.5 text-slate-400 data-[state=active]:text-white"
            indicatorClassName="bg-white/[0.12] rounded-lg shadow-sm"
          />
        </div>

        {/* Right Side: Status Badge */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.07] px-3.5 py-1.5 font-mono text-[10px] font-black uppercase tracking-wider text-cyan-300 shadow-sm">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-cyan-400 shadow-[0_0_8px_#22d3ee]" />
            </span>
            <span>Top 200 · {period}</span>
          </div>
        </div>
      </div>

      {/* Main Viewport: Professional Financial Terminal Grid */}
      {viewMode === "bubbles" ? (
        <div
          ref={containerRef}
          className="market-bubble-field relative min-h-[750px] sm:min-h-[850px] lg:min-h-[900px] w-full overflow-hidden rounded-2xl border border-white/[0.08] bg-[#070d15] select-none shadow-2xl"
          aria-label={`Bản đồ Top ${topStocks.length} cổ phiếu ${period}`}
        >
          {/* Institutional Financial Coordinate Grid Pattern */}
          <div
            className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:44px_44px]"
            aria-hidden="true"
          />
          {/* Subtle deep radial depth */}
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(13,33,54,0.35)_0%,rgba(7,13,21,0.85)_100%)]"
            aria-hidden="true"
          />

          {/* Collision-Resolved Bubbles Canvas */}
          <div className="relative z-10 size-full min-h-[750px] sm:min-h-[850px] lg:min-h-[900px]">
            {bubbles.map((bubble) => {
              const { stock, change, x, y, r, borderWidth, bobClass, animDelay, tone } = bubble
              const diameter = r * 2

              const isFuchsia = tone === "fuchsia"
              const isEmerald = tone === "emerald"
              const isRose = tone === "rose"
              const isHighVol = borderWidth >= 3.0

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
                    borderWidth: `${borderWidth}px`,
                    borderStyle: "solid",
                    animationDelay: animDelay,
                  }}
                  className={cn(
                    "group absolute flex flex-col items-center justify-center rounded-full text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300",
                    "market-bubble-item",
                    bobClass,
                    hoveredTicker === stock.ticker ? "z-40 scale-110" : "hover:z-30 hover:scale-105 active:scale-95",

                    // Fuchsia / Purple ceiling glass
                    isFuchsia && [
                      "border-fuchsia-300/90",
                      "bg-[radial-gradient(circle_at_35%_30%,rgba(232,121,249,0.55)_0%,rgba(168,85,247,0.3)_45%,rgba(74,4,78,0.8)_100%)]",
                      isHighVol
                        ? "shadow-[0_0_28px_rgba(217,70,239,0.65),0_0_8px_rgba(232,121,249,0.9),inset_0_0_16px_rgba(232,121,249,0.35)]"
                        : "shadow-[0_0_14px_rgba(217,70,239,0.35),inset_0_0_8px_rgba(232,121,249,0.2)]",
                    ],

                    // Emerald / Green gainer glass
                    isEmerald && [
                      "border-emerald-400/90",
                      "bg-[radial-gradient(circle_at_35%_30%,rgba(52,211,153,0.48)_0%,rgba(16,185,129,0.25)_45%,rgba(5,46,22,0.8)_100%)]",
                      isHighVol
                        ? "shadow-[0_0_26px_rgba(16,185,129,0.6),0_0_8px_rgba(52,211,153,0.9),inset_0_0_16px_rgba(52,211,153,0.35)]"
                        : "shadow-[0_0_12px_rgba(16,185,129,0.3),inset_0_0_8px_rgba(52,211,153,0.18)]",
                    ],

                    // Rose / Red loser glass
                    isRose && [
                      "border-rose-400/90",
                      "bg-[radial-gradient(circle_at_35%_30%,rgba(251,113,133,0.48)_0%,rgba(244,63,94,0.25)_45%,rgba(76,5,25,0.8)_100%)]",
                      isHighVol
                        ? "shadow-[0_0_26px_rgba(244,63,94,0.6),0_0_8px_rgba(251,113,133,0.9),inset_0_0_16px_rgba(251,113,133,0.35)]"
                        : "shadow-[0_0_12px_rgba(244,63,94,0.3),inset_0_0_8px_rgba(251,113,133,0.18)]",
                    ],

                    // Neutral / Flat glass
                    !isFuchsia &&
                      !isEmerald &&
                      !isRose && [
                        "border-slate-500/70",
                        "bg-[radial-gradient(circle_at_35%_30%,rgba(148,163,184,0.3)_0%,rgba(71,85,105,0.2)_45%,rgba(15,23,42,0.8)_100%)]",
                        "shadow-[0_0_10px_rgba(148,163,184,0.18),inset_0_0_6px_rgba(148,163,184,0.12)]",
                      ]
                  )}
                  title={`${stock.ticker} · ${stock.companyName} (${formatSigned(change, 2, "%")}) · KLGD: ${formatNumber(stock.volume)}`}
                >
                  <strong
                    className={cn(
                      "font-mono font-black uppercase text-white tracking-wider leading-none drop-shadow-md",
                      r >= 64
                        ? "text-3xl sm:text-4xl"
                        : r >= 48
                        ? "text-xl sm:text-2xl"
                        : r >= 34
                        ? "text-sm sm:text-base font-black"
                        : r >= 22
                        ? "text-xs sm:text-sm font-black"
                        : r >= 14
                        ? "text-[9px] sm:text-[10px] font-black"
                        : "text-[7px] font-bold"
                    )}
                  >
                    {stock.ticker}
                  </strong>
                  <span
                    className={cn(
                      "font-mono leading-none drop-shadow-sm font-black",
                      r >= 64
                        ? "text-sm sm:text-base mt-1.5"
                        : r >= 48
                        ? "text-xs sm:text-sm mt-1"
                        : r >= 34
                        ? "text-[10px] sm:text-xs font-bold mt-0.5"
                        : r >= 22
                        ? "text-[8px] sm:text-[9px] font-bold mt-0.5"
                        : r >= 14
                        ? "text-[7px] sm:text-[8px] font-bold mt-0.5"
                        : "text-[6px] mt-0.5",
                      isFuchsia
                        ? "text-fuchsia-100"
                        : isEmerald
                        ? "text-emerald-100"
                        : isRose
                        ? "text-rose-100"
                        : "text-slate-200"
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
              className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-xl border border-white/20 bg-[#08121c]/95 p-3.5 text-xs shadow-2xl backdrop-blur-none"
              style={{
                left: `${tooltipPos.x}px`,
                top: `${tooltipPos.y}px`,
              }}
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-black text-white text-sm">{hoveredBubble.stock.ticker}</span>
                  <span className="rounded bg-white/[0.08] px-1.5 py-0.5 text-[9px] font-bold text-teal-300">
                    {hoveredBubble.stock.sector}
                  </span>
                </div>
                <p className="line-clamp-1 text-[11px] text-slate-400 max-w-[200px] mt-0.5">
                  {hoveredBubble.stock.companyName}
                </p>
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
        /* Redesigned Columns View with Sector Icons and Large Typography */
        <div className="space-y-6 rounded-2xl border border-white/[0.08] bg-[#070d15] p-4 sm:p-5 shadow-xl">
          {volumeGroups.map((group) => {
            const GroupIcon = group.icon

            return (
              <div key={group.id} className="space-y-3">
                {/* Volume Tier Header */}
                <div className="flex items-center justify-between border-b border-white/[0.08] pb-2.5">
                  <div className="flex items-center gap-2.5">
                    <GroupIcon className="size-4 sm:size-5 text-teal-300" />
                    <h3 className="font-mono text-sm sm:text-base font-bold text-white tracking-wide">
                      {group.title}
                    </h3>
                  </div>
                  <Badge variant="outline" className={cn("text-xs font-mono font-bold px-2.5 py-0.5", group.badgeClass)}>
                    {group.badge}
                  </Badge>
                </div>

                {/* Grid of Readable Cards with Thematic Sector Icons */}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-2.5">
                  {group.items.map(({ stock, rank }) => {
                    const change = getStockChange(stock, period)
                    const chgVal = change ?? 0
                    const isFuchsia = chgVal >= 6.5
                    const isEmerald = chgVal > 0 && !isFuchsia
                    const isRose = chgVal < 0
                    const SectorIcon = getSectorIcon(stock.sector)

                    return (
                      <button
                        key={stock.ticker}
                        type="button"
                        onClick={() => onOpenStockDetail?.(stock.ticker)}
                        className={cn(
                          "group flex flex-col justify-between rounded-xl border p-2.5 sm:p-3 text-left transition-all duration-150 hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300/50",
                          isFuchsia && "border-fuchsia-500/40 bg-fuchsia-500/[0.07] hover:border-fuchsia-400/80 hover:bg-fuchsia-500/[0.14]",
                          isEmerald && "border-emerald-500/40 bg-emerald-500/[0.07] hover:border-emerald-400/80 hover:bg-emerald-500/[0.14]",
                          isRose && "border-rose-500/40 bg-rose-500/[0.07] hover:border-rose-400/80 hover:bg-rose-500/[0.14]",
                          !isFuchsia && !isEmerald && !isRose && "border-white/[0.08] bg-white/[0.025] hover:border-white/25 hover:bg-white/[0.06]"
                        )}
                      >
                        {/* Top Row: Rank & Ticker & Sector Icon */}
                        <div className="flex items-center justify-between gap-1">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-mono text-xs font-bold text-slate-400">#{rank}</span>
                            <strong className="font-mono text-sm sm:text-base font-black text-white group-hover:text-cyan-200 tracking-tight">
                              {stock.ticker}
                            </strong>
                          </div>
                          <div
                            className="flex items-center justify-center size-6 rounded-md bg-cyan-400/10 border border-cyan-400/20 shrink-0"
                            title={stock.sector}
                          >
                            <SectorIcon className="size-3.5 text-cyan-400" />
                          </div>
                        </div>

                        {/* Bottom Row: Volume & % Change */}
                        <div className="mt-2.5 flex items-baseline justify-between gap-1 font-mono">
                          <span className="text-xs font-semibold text-slate-300 truncate">
                            {stock.volume != null ? `${(stock.volume / 1000000).toFixed(1)}M` : "—"}
                          </span>
                          <strong
                            className={cn(
                              "text-sm sm:text-base font-black",
                              isFuchsia
                                ? "text-fuchsia-300"
                                : isEmerald
                                ? "text-emerald-400"
                                : isRose
                                ? "text-rose-400"
                                : "text-slate-300"
                            )}
                          >
                            {formatSigned(change, 2, "%")}
                          </strong>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
