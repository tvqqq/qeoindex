"use client"

import { CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts"

import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart"
import type { MarketCloseDashboardData } from "@/modules/research/market-insight/data"
import type {
  BreadthDivergenceContext,
  BreadthDivergenceState,
} from "@/modules/research/market-insight/breadth-divergence"

const GRID = "rgba(148,163,184,0.10)"
const AXIS = "rgba(148,163,184,0.62)"
const INDEX = "#5eead4"
const BREADTH = "#fbbf24"

const breadthTrendConfig = {
  vnindexClose: { label: "VNINDEX", color: INDEX },
  aboveMa50Pct: { label: "Trên MA50", color: BREADTH },
} satisfies ChartConfig

function shortDate(value: string) {
  const parts = value.split("-")
  return parts.length === 3 ? `${parts[2]}/${parts[1]}` : value
}

function formatSigned(value: number | null, suffix: string) {
  if (value == null || !Number.isFinite(value)) return "—"
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}${suffix}`
}

const badgeStyles: Record<BreadthDivergenceState, { label: string; className: string }> = {
  confirmation: {
    label: "Xác nhận",
    className: "border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-300",
  },
  bearish_divergence: {
    label: "Phân kỳ giảm",
    className: "border-rose-400/25 bg-rose-400/[0.08] text-rose-300",
  },
  recovery_divergence: {
    label: "Phân kỳ hồi phục",
    className: "border-cyan-400/25 bg-cyan-400/[0.08] text-cyan-300",
  },
  neutral: {
    label: "Trung tính",
    className: "border-slate-400/20 bg-slate-400/[0.07] text-slate-300",
  },
  unknown: {
    label: "Chưa đủ dữ liệu",
    className: "border-slate-400/20 bg-slate-400/[0.07] text-slate-400",
  },
}

export function BreadthDivergenceBadge({ state }: { state: BreadthDivergenceState }) {
  const badge = badgeStyles[state]
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 font-mono text-[10px] font-black uppercase tracking-wide ${badge.className}`}>
      {badge.label}
    </span>
  )
}

export function MaBreadthChart({
  daily,
  context,
}: {
  daily: MarketCloseDashboardData["dailySummary"]
  context: BreadthDivergenceContext
}) {
  const snapshots = [
    { name: "MA10", value: daily.aboveMa10Pct },
    { name: "MA20", value: daily.aboveMa20Pct },
    { name: "MA50", value: daily.aboveMa50Pct },
    { name: "MA200", value: daily.aboveMa200Pct },
  ]

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 font-mono text-[10px] font-bold text-slate-400">
        <span>10 phiên</span>
        <span className="text-teal-300">VNINDEX {formatSigned(context.vnindexChangePct, "%")}</span>
        <span className="text-amber-300">MA50 {formatSigned(context.ma50ChangePp, "pp")}</span>
        <span>MA20 {formatSigned(context.ma20ChangePp, "pp")}</span>
      </div>

      {context.pairedSessions < 8 ? (
        <div className="flex h-[150px] items-center justify-center rounded-xl border border-dashed border-white/[0.08] px-4 text-center text-xs text-slate-500">
          Cần ít nhất 8 phiên có đồng thời VNINDEX và độ rộng MA50 để xác định phân kỳ.
        </div>
      ) : (
        <ChartContainer config={breadthTrendConfig} className="h-[150px] w-full" initialDimension={{ width: 420, height: 150 }}>
          <ComposedChart accessibilityLayer data={context.points} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="3 6" />
            <XAxis
              dataKey="sessionDate"
              axisLine={false}
              tickLine={false}
              tick={{ fill: AXIS, fontSize: 9 }}
              tickFormatter={shortDate}
              minTickGap={20}
            />
            <YAxis
              yAxisId="index"
              domain={["dataMin - 8", "dataMax + 8"]}
              axisLine={false}
              tickLine={false}
              tick={{ fill: AXIS, fontSize: 9 }}
              width={42}
            />
            <YAxis
              yAxisId="breadth"
              orientation="right"
              domain={[0, 100]}
              axisLine={false}
              tickLine={false}
              tick={{ fill: AXIS, fontSize: 9 }}
              tickFormatter={(value) => `${value}%`}
              width={34}
            />
            <ChartTooltip
              cursor={{ stroke: "rgba(148,163,184,0.25)", strokeDasharray: "3 3" }}
              content={({ active, payload }) => {
                const point = payload?.[0]?.payload as BreadthDivergenceContext["points"][number] | undefined
                if (!active || !point) return null
                return (
                  <div className="min-w-36 rounded-lg border border-white/15 bg-[#08131e] p-2 font-mono text-[10px] shadow-xl">
                    <p className="mb-1 font-bold text-slate-300">{point.sessionDate}</p>
                    <p className="text-teal-300">VNINDEX: {point.vnindexClose?.toFixed(2) ?? "—"}</p>
                    <p className="text-amber-300">MA50: {point.aboveMa50Pct != null ? `${point.aboveMa50Pct.toFixed(1)}%` : "—"}</p>
                    <p className="text-slate-300">MA20: {point.aboveMa20Pct != null ? `${point.aboveMa20Pct.toFixed(1)}%` : "—"}</p>
                  </div>
                )
              }}
            />
            <Line
              yAxisId="index"
              dataKey="vnindexClose"
              type="monotone"
              stroke="var(--color-vnindexClose)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3 }}
              connectNulls={false}
            />
            <Line
              yAxisId="breadth"
              dataKey="aboveMa50Pct"
              type="monotone"
              stroke="var(--color-aboveMa50Pct)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3 }}
              connectNulls={false}
            />
          </ComposedChart>
        </ChartContainer>
      )}

      <div className="grid grid-cols-4 gap-1.5" aria-label="Độ rộng thị trường hiện tại">
        {snapshots.map((item) => (
          <div key={item.name} className="rounded-lg border border-white/[0.07] bg-white/[0.025] px-1.5 py-1.5 text-center">
            <p className="font-mono text-[9px] font-black text-slate-500">{item.name}</p>
            <p className="mt-0.5 font-mono text-xs font-black text-slate-200">
              {item.value != null && Number.isFinite(item.value) ? `${item.value.toFixed(1)}%` : "—"}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
