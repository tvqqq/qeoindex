import { TrendingDown, TrendingUp } from "lucide-react"

import type { InsightsRatingRow } from "@/modules/research/insights/data"
import { cn } from "@/modules/shared/ui/cn"

function normalizeScore(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return Math.max(0, Math.min(100, value))
}

export function QeoCompositeTrend({
  row,
  className,
}: {
  row?: InsightsRatingRow | null
  className?: string
}) {
  const score = row ? normalizeScore(row.ratingScore) : null
  const history = row
    ? [...(row.scoreHistory || [])]
        .filter((item) => normalizeScore(item.ratingScore) != null)
        .sort((a, b) => a.asOfDate.localeCompare(b.asOfDate))
        .slice(-12)
    : []

  const latestHistoryScore = history.length
    ? normalizeScore(history[history.length - 1]?.ratingScore)
    : null
  const previousHistoryScore = history.length > 1
    ? normalizeScore(history[history.length - 2]?.ratingScore)
    : null
  const baseline =
    score != null && latestHistoryScore != null && Math.abs(score - latestHistoryScore) < 0.001
      ? previousHistoryScore
      : latestHistoryScore
  const delta = score != null && baseline != null ? score - baseline : null

  const chartWidth = 132
  const chartHeight = 38
  const chartPadding = 3
  const points = history.map((item, index) => {
    const value = normalizeScore(item.ratingScore) ?? 0
    const x = chartPadding + (index * (chartWidth - chartPadding * 2)) / Math.max(1, history.length - 1)
    const y = chartPadding + ((100 - value) / 100) * (chartHeight - chartPadding * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })

  return (
    <div
      data-qeo-composite-trend
      className={cn(
        "min-w-0 rounded-2xl border border-violet-300/[0.12] bg-violet-300/[0.04] px-3 py-2.5",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 shrink-0">
          <div className="text-[9px] font-black uppercase tracking-[0.18em] text-violet-200/75">
            QEO COMPOSITE
          </div>
          <div className="mt-0.5 flex items-baseline gap-1.5">
            <strong className="font-mono text-2xl font-black leading-none text-violet-100">
              {score == null ? "—" : Math.round(score)}
            </strong>
            <span className="font-mono text-[10px] text-slate-500">/100</span>
            {delta != null && Math.abs(delta) >= 0.01 ? (
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 font-mono text-[10px] font-black",
                  delta > 0 ? "text-up" : "text-down",
                )}
                title="Thay đổi so với snapshot trước"
              >
                {delta > 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                {delta > 0 ? "+" : ""}{delta.toFixed(0)}
              </span>
            ) : null}
          </div>
        </div>

        {history.length >= 2 ? (
          <svg
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            className="h-9 min-w-0 flex-1"
            preserveAspectRatio="none"
            role="img"
            aria-label={`Xu hướng Qeo Composite ${row?.ticker || ""}`.trim()}
          >
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
            {points.length ? (() => {
              const [x, y] = points[points.length - 1].split(",").map(Number)
              return <circle cx={x} cy={y} r="2.5" className="fill-emerald-300" />
            })() : null}
          </svg>
        ) : (
          <span className="max-w-24 text-right text-[9px] leading-tight text-slate-500">
            Chưa đủ lịch sử
          </span>
        )}
      </div>
    </div>
  )
}
