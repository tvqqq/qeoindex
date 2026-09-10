"use client"

import { useEffect, useMemo, useState } from "react"
import { TrendingDown, TrendingUp } from "lucide-react"

import type { InsightsRatingRow } from "@/modules/research/insights/data"
import { cn } from "@/modules/shared/ui/cn"

type CompositeHistoryPoint = {
  asOfDate: string
  compositeScore: number | null
  stockRs?: number | null
}

type StockHistoryPayload = {
  ok?: boolean
  dailyHistory?: CompositeHistoryPoint[]
}

function normalizeScore(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return Math.max(0, Math.min(100, value))
}

function rsRingColor(score: number) {
  if (score >= 80) return "#34d399"
  if (score >= 60) return "#a3e635"
  if (score >= 40) return "#facc15"
  return "#fb7185"
}

function formatSessionDate(asOfDate: string) {
  const day = asOfDate.slice(8, 10)
  const month = asOfDate.slice(5, 7)
  return day && month ? `${day}/${month}` : asOfDate
}

export function QeoCompositeTrend({
  row,
  className,
}: {
  row?: InsightsRatingRow | null
  className?: string
}) {
  const [remoteHistory, setRemoteHistory] = useState<CompositeHistoryPoint[] | null>(null)
  const [hoveredCompositeIndex, setHoveredCompositeIndex] = useState<number | null>(null)

  useEffect(() => {
    if (!row?.ticker) {
      setRemoteHistory([])
      return
    }

    const controller = new AbortController()
    setRemoteHistory(null)
    setHoveredCompositeIndex(null)

    fetch(`/api/insights/stock-history?ticker=${encodeURIComponent(row.ticker)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as StockHistoryPayload | null
        if (!response.ok || !payload?.ok || !Array.isArray(payload.dailyHistory)) {
          throw new Error("Không tải được lịch sử Qeo Composite.")
        }
        setRemoteHistory(payload.dailyHistory)
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return
        setRemoteHistory([])
      })

    return () => controller.abort()
  }, [row?.ticker])

  const fallbackHistory = useMemo<CompositeHistoryPoint[]>(() => {
    if (!row) return []
    return [...(row.scoreHistory || [])]
      .map((item) => ({
        asOfDate: item.asOfDate,
        compositeScore: normalizeScore(item.ratingScore),
      }))
      .filter((item) => item.compositeScore != null)
      .sort((a, b) => a.asOfDate.localeCompare(b.asOfDate))
  }, [row])

  const compositeHistory = useMemo(() => {
    const source = remoteHistory?.some((item) => normalizeScore(item.compositeScore) != null)
      ? remoteHistory
      : fallbackHistory

    return source
      .filter((item) => normalizeScore(item.compositeScore) != null)
      .sort((a, b) => a.asOfDate.localeCompare(b.asOfDate))
      .slice(-5)
  }, [fallbackHistory, remoteHistory])

  const rsHistory = useMemo(() => {
    return (remoteHistory || [])
      .flatMap((item) => {
        const stockRs = normalizeScore(item.stockRs)
        return stockRs == null ? [] : [{ asOfDate: item.asOfDate, stockRs }]
      })
      .sort((a, b) => a.asOfDate.localeCompare(b.asOfDate))
      .slice(-5)
  }, [remoteHistory])

  const latestHistoryScore = compositeHistory.length
    ? normalizeScore(compositeHistory[compositeHistory.length - 1]?.compositeScore)
    : null
  const previousHistoryScore = compositeHistory.length > 1
    ? normalizeScore(compositeHistory[compositeHistory.length - 2]?.compositeScore)
    : null
  const score = latestHistoryScore ?? (row ? normalizeScore(row.ratingScore) : null)
  const delta = score != null && previousHistoryScore != null ? score - previousHistoryScore : null

  const chartWidth = 176
  const chartHeight = 48
  const chartPaddingX = 7
  const chartPaddingY = 7
  const values = compositeHistory.flatMap((item) => {
    const value = normalizeScore(item.compositeScore)
    return value == null ? [] : [value]
  })
  const minValue = values.length ? Math.min(...values) : 0
  const maxValue = values.length ? Math.max(...values) : 100
  const rawSpread = Math.max(4, maxValue - minValue)
  const chartMin = Math.max(0, minValue - rawSpread * 0.25)
  const chartMax = Math.min(100, maxValue + rawSpread * 0.25)
  const chartRange = Math.max(1, chartMax - chartMin)
  const chartPoints = compositeHistory.map((item, index) => {
    const value = normalizeScore(item.compositeScore) ?? chartMin
    const x = chartPaddingX + (index * (chartWidth - chartPaddingX * 2)) / Math.max(1, compositeHistory.length - 1)
    const y = chartPaddingY + ((chartMax - value) / chartRange) * (chartHeight - chartPaddingY * 2)
    return { x, y }
  })
  const points = chartPoints.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
  const firstDate = compositeHistory[0]?.asOfDate?.slice(5) || ""
  const lastDate = compositeHistory[compositeHistory.length - 1]?.asOfDate?.slice(5) || ""
  const hoveredComposite = hoveredCompositeIndex == null ? null : compositeHistory[hoveredCompositeIndex]
  const hoveredScore = normalizeScore(hoveredComposite?.compositeScore)
  const hoveredPoint = hoveredCompositeIndex == null ? null : chartPoints[hoveredCompositeIndex]
  const tooltipAlignment = hoveredCompositeIndex === 0
    ? "translate-x-0"
    : hoveredCompositeIndex === compositeHistory.length - 1
      ? "-translate-x-full"
      : "-translate-x-1/2"

  return (
    <div
      data-qeo-composite-trend
      className={cn("flex min-w-0 flex-wrap items-center gap-3", className)}
    >
      <div data-rs-history className="shrink-0">
        <div className="mb-1.5 text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">
          RS · 5 PHIÊN
        </div>
        {rsHistory.length ? (
          <div className="flex items-center gap-1.5">
            {rsHistory.map((point, index) => {
              const isLatest = index === rsHistory.length - 1
              const roundedScore = Math.round(point.stockRs)
              const ringColor = rsRingColor(point.stockRs)
              return (
                <div
                  key={`${point.asOfDate}-${index}`}
                  data-rs-ring
                  data-current-rs={isLatest ? "true" : undefined}
                  className={cn(
                    "grid size-10 shrink-0 place-items-center rounded-full transition-shadow",
                    isLatest && "shadow-[0_0_18px_rgba(103,232,249,0.28)]",
                  )}
                  title={`RS ${point.asOfDate}: ${roundedScore}`}
                  aria-label={`RS ${point.asOfDate}: ${roundedScore}${isLatest ? ", mới nhất" : ""}`}
                >
                  <div
                    className="relative grid size-9 place-items-center rounded-full p-[2px]"
                    style={{
                      background: `conic-gradient(${ringColor} ${point.stockRs * 3.6}deg, rgba(51,65,85,0.5) 0deg)`,
                    }}
                  >
                    <span
                      className="grid size-full place-items-center rounded-full font-mono text-[14px] font-black text-slate-950 shadow-inner"
                      style={{ backgroundColor: rsRingColor(point.stockRs) }}
                    >
                      {roundedScore}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="flex h-10 min-w-[84px] items-center text-[9px] font-semibold text-slate-600">
            {remoteHistory == null ? "Đang tải RS…" : "Chưa có RS"}
          </div>
        )}
      </div>

      <div className="min-w-[220px] flex-1 overflow-hidden rounded-2xl border border-violet-300/[0.14] bg-[linear-gradient(145deg,rgba(139,92,246,0.09),rgba(15,23,42,0.28))] px-3 py-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 shrink-0 pt-0.5">
            <div className="text-[9px] font-black uppercase tracking-[0.18em] text-violet-200/80">
              QEO COMPOSITE
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <strong className="font-mono text-2xl font-black leading-none text-violet-100">
                {score == null ? "—" : Math.round(score)}
              </strong>
              {delta != null && Math.abs(delta) >= 0.01 ? (
                <span
                  className={cn(
                    "inline-flex items-center gap-0.5 font-mono text-[10px] font-black",
                    delta > 0 ? "text-up" : "text-down",
                  )}
                  title="Thay đổi so với phiên rating trước"
                >
                  {delta > 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                  {delta > 0 ? "+" : ""}{delta.toFixed(0)}
                </span>
              ) : null}
            </div>
            <div className="mt-1 text-[9px] font-semibold text-slate-500">Xu hướng Qeo Composite</div>
          </div>

          {compositeHistory.length >= 2 ? (
            <div className="relative min-w-0 flex-1">
              {hoveredComposite && hoveredScore != null && hoveredPoint ? (
                <div
                  data-qeo-composite-tooltip
                  className={cn(
                    "pointer-events-none absolute top-0 z-10 whitespace-nowrap rounded-md border border-violet-200/20 bg-slate-950/95 px-1.5 py-0.5 font-mono text-[11px] font-black text-violet-100 shadow-lg",
                    tooltipAlignment,
                  )}
                  style={{ left: `${(hoveredPoint.x / chartWidth) * 100}%` }}
                >
                  {Math.round(hoveredScore)} · {formatSessionDate(hoveredComposite.asOfDate)}
                </div>
              ) : null}
              <svg
                data-qeo-composite-chart
                viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                className="h-12 w-full min-w-[112px]"
                preserveAspectRatio="none"
                role="img"
                aria-label={`Xu hướng Qeo Composite ${row?.ticker || ""}`.trim()}
              >
                <line
                  x1={chartPaddingX}
                  x2={chartWidth - chartPaddingX}
                  y1={chartHeight - chartPaddingY}
                  y2={chartHeight - chartPaddingY}
                  stroke="rgba(148,163,184,0.12)"
                  vectorEffect="non-scaling-stroke"
                />
                <polyline
                  points={points.join(" ")}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  className="text-violet-300"
                  vectorEffect="non-scaling-stroke"
                />
                {chartPoints.map((point, index) => {
                  const isLatest = index === chartPoints.length - 1
                  const session = compositeHistory[index]
                  const sessionScore = normalizeScore(session?.compositeScore)
                  return (
                    <g key={`${session?.asOfDate}-${index}`}>
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r={isLatest ? 3.1 : 2.1}
                        className={isLatest ? "fill-emerald-300" : "fill-violet-200/80"}
                        pointerEvents="none"
                      />
                      <circle
                        data-qeo-composite-point
                        cx={point.x}
                        cy={point.y}
                        r={8}
                        fill="transparent"
                        stroke="transparent"
                        tabIndex={0}
                        aria-label={sessionScore == null ? undefined : `Qeo Composite ${formatSessionDate(session.asOfDate)}: ${Math.round(sessionScore)}`}
                        onMouseEnter={() => setHoveredCompositeIndex(index)}
                        onMouseLeave={() => setHoveredCompositeIndex(null)}
                        onFocus={() => setHoveredCompositeIndex(index)}
                        onBlur={() => setHoveredCompositeIndex(null)}
                      />
                    </g>
                  )
                })}
              </svg>
              <div className="mt-0.5 flex justify-between font-mono text-[8px] text-slate-600">
                <span>{firstDate}</span>
                <span>{compositeHistory.length} phiên</span>
                <span>{lastDate}</span>
              </div>
            </div>
          ) : (
            <span className="max-w-28 self-center text-right text-[9px] leading-tight text-slate-500">
              {remoteHistory == null ? "Đang tải lịch sử…" : "Chưa đủ dữ liệu chart"}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
