"use client"

import * as React from "react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { ChevronDown } from "lucide-react"

import type { MarketCloseDashboardData, MarketHistoryPoint } from "@/lib/market-insight-data"
import { cn } from "@/lib/utils"

interface MarketHealthViewProps {
  data: MarketCloseDashboardData
  history: MarketHistoryPoint[]
}

const GRID_COLOR = "rgba(148, 163, 184, 0.08)"
const AXIS_COLOR = "rgba(148, 163, 184, 0.55)"

// Format date to DD-MM-YYYY
function formatChartDate(iso: string) {
  const parts = iso.split("-")
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`
  }
  return iso
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Semi-Circular Sentiment Gauge Speedometer (Chỉ báo tâm lý)
// ─────────────────────────────────────────────────────────────────────────────
interface SentimentGaugeProps {
  score: number // 0 to 100
}

function SentimentGauge({ score }: SentimentGaugeProps) {
  const clampedScore = Math.max(0, Math.min(100, score))

  // Map 0 -> 100 to angle in radians (-Math.PI to 0) or degrees (-180 to 0)
  // Angle: 0 score = 180 deg (left), 50 score = 90 deg (top), 100 score = 0 deg (right)
  const angleDeg = 180 - (clampedScore / 100) * 180
  const angleRad = (angleDeg * Math.PI) / 180

  const cx = 200
  const cy = 185
  const outerR = 145
  const innerR = 112
  const tickR = 98

  // Sentiment label & color determination
  let label = "Trung lập"
  let scoreColor = "#eab308" // yellow

  if (clampedScore <= 20) {
    label = "Sợ hãi tột độ"
    scoreColor = "#10b981"
  } else if (clampedScore <= 40) {
    label = "Sợ hãi"
    scoreColor = "#84cc16"
  } else if (clampedScore <= 60) {
    label = "Trung lập"
    scoreColor = "#eab308"
  } else if (clampedScore <= 80) {
    label = "Tham lam"
    scoreColor = "#f97316"
  } else {
    label = "Tham lam tột độ"
    scoreColor = "#ef4444"
  }

  // Pointer position on the inner edge of the arc
  const pointerR = innerR + 10
  const pointerX = cx + pointerR * Math.cos(angleRad)
  const pointerY = cy - pointerR * Math.sin(angleRad)

  // Arrow triangle vertices
  const arrowLen = 14
  const arrowWidth = 7
  const tipX = cx + (innerR - 4) * Math.cos(angleRad)
  const tipY = cy - (innerR - 4) * Math.sin(angleRad)
  const baseLeftX = cx + (innerR + arrowLen) * Math.cos(angleRad) - arrowWidth * Math.sin(angleRad)
  const baseLeftY = cy - (innerR + arrowLen) * Math.sin(angleRad) - arrowWidth * Math.cos(angleRad)
  const baseRightX = cx + (innerR + arrowLen) * Math.cos(angleRad) + arrowWidth * Math.sin(angleRad)
  const baseRightY = cy - (innerR + arrowLen) * Math.sin(angleRad) + arrowWidth * Math.cos(angleRad)

  // Generate 5 colored Arc Segments:
  // [0..20]: #10b981, [20..40]: #84cc16, [40..60]: #eab308, [60..80]: #f97316, [80..100]: #ef4444
  const segments = [
    { start: 0, end: 20, color: "#10b981" },
    { start: 20, end: 40, color: "#84cc16" },
    { start: 40, end: 60, color: "#eab308" },
    { start: 60, end: 80, color: "#f97316" },
    { start: 80, end: 100, color: "#ef4444" },
  ]

  const describeArc = (startPct: number, endPct: number, rOut: number, rIn: number) => {
    const a1 = (180 - (startPct / 100) * 180) * (Math.PI / 180)
    const a2 = (180 - (endPct / 100) * 180) * (Math.PI / 180)

    const x1Out = cx + rOut * Math.cos(a1)
    const y1Out = cy - rOut * Math.sin(a1)
    const x2Out = cx + rOut * Math.cos(a2)
    const y2Out = cy - rOut * Math.sin(a2)

    const x1In = cx + rIn * Math.cos(a2)
    const y1In = cy - rIn * Math.sin(a2)
    const x2In = cx + rIn * Math.cos(a1)
    const y2In = cy - rIn * Math.sin(a1)

    return `M ${x1Out} ${y1Out} A ${rOut} ${rOut} 0 0 1 ${x2Out} ${y2Out} L ${x1In} ${y1In} A ${rIn} ${rIn} 0 0 0 ${x2In} ${y2In} Z`
  }

  // Inner tick marks
  const ticks = []
  for (let i = 0; i <= 40; i++) {
    const tPct = (i / 40) * 100
    const tRad = (180 - (tPct / 100) * 180) * (Math.PI / 180)
    const len = i % 4 === 0 ? 8 : 4
    const x1 = cx + tickR * Math.cos(tRad)
    const y1 = cy - tickR * Math.sin(tRad)
    const x2 = cx + (tickR - len) * Math.cos(tRad)
    const y2 = cy - (tickR - len) * Math.sin(tRad)
    ticks.push({ x1, y1, x2, y2, major: i % 4 === 0 })
  }

  return (
    <div className="relative flex flex-col items-center justify-center py-2">
      {/* Zone Label Indicators */}
      <div className="relative w-full max-w-[420px] select-none">
        <svg viewBox="0 0 400 230" className="w-full h-auto overflow-visible">
          {/* Background Arc track */}
          <path
            d={`M ${cx - outerR} ${cy} A ${outerR} ${outerR} 0 0 1 ${cx + outerR} ${cy}`}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="34"
          />

          {/* Colored Segments */}
          {segments.map((seg) => (
            <path
              key={seg.start}
              d={describeArc(seg.start + 0.5, seg.end - 0.5, outerR, innerR)}
              fill={seg.color}
            />
          ))}

          {/* Inner Tick Marks */}
          {ticks.map((t, idx) => (
            <line
              key={idx}
              x1={t.x1}
              y1={t.y1}
              x2={t.x2}
              y2={t.y2}
              stroke="rgba(255,255,255,0.4)"
              strokeWidth={t.major ? 1.5 : 1}
            />
          ))}

          {/* Indicator Arrow Pointing at Active Score */}
          <polygon
            points={`${tipX},${tipY} ${baseLeftX},${baseLeftY} ${baseRightX},${baseRightY}`}
            fill={scoreColor}
            stroke="#0a121a"
            strokeWidth="1.5"
          />

          {/* Center Score Text */}
          <text
            x={cx}
            y={cy - 12}
            textAnchor="middle"
            fill={scoreColor}
            className="font-mono font-black"
            fontSize="46"
            style={{ fontWeight: 900 }}
          >
            {clampedScore}
          </text>

          {/* Surrounding Labels */}
          {/* Top Center: Trung lập */}
          <text x={cx} y="22" textAnchor="middle" fill="#cbd5e1" fontSize="11" fontWeight="600">
            Trung lập
          </text>

          {/* Left Top: Sợ hãi */}
          <text x="135" y="44" textAnchor="middle" fill="#94a3b8" fontSize="10" fontWeight="500">
            Sợ hãi
          </text>

          {/* Right Top: Tham lam */}
          <text x="265" y="44" textAnchor="middle" fill="#94a3b8" fontSize="10" fontWeight="500">
            Tham lam
          </text>

          {/* Far Left: Sợ hãi tột độ */}
          <text x="45" y="112" textAnchor="middle" fill="#94a3b8" fontSize="10" fontWeight="500">
            <tspan x="45" dy="0">Sợ hãi</tspan>
            <tspan x="45" dy="12">tột độ</tspan>
          </text>

          {/* Far Right: Tham lam tột độ */}
          <text x="355" y="112" textAnchor="middle" fill="#94a3b8" fontSize="10" fontWeight="500">
            <tspan x="355" dy="0">Tham lam</tspan>
            <tspan x="355" dy="12">tột độ</tspan>
          </text>
        </svg>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Risk Indicator Area Chart (Chỉ báo rủi ro)
// ─────────────────────────────────────────────────────────────────────────────
interface RiskChartProps {
  data: {
    date: string
    risk: number
  }[]
  currentRisk: number
}

function RiskIndicatorChart({ data, currentRisk }: RiskChartProps) {
  return (
    <div className="w-full">
      <div className="h-[260px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 18, right: 16, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="riskGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.88} />
                <stop offset="35%" stopColor="#f59e0b" stopOpacity={0.78} />
                <stop offset="70%" stopColor="#84cc16" stopOpacity={0.65} />
                <stop offset="100%" stopColor="#10b981" stopOpacity={0.5} />
              </linearGradient>
            </defs>

            <CartesianGrid stroke={GRID_COLOR} vertical={false} strokeDasharray="3 3" />

            <XAxis
              dataKey="date"
              axisLine={{ stroke: "rgba(255,255,255,0.2)" }}
              tickLine={false}
              tick={{ fill: AXIS_COLOR, fontSize: 10, fontFamily: "monospace" }}
              minTickGap={32}
            />

            <YAxis
              domain={[0, 1]}
              ticks={[0, 0.2, 0.4, 0.6, 0.8, 1.0]}
              axisLine={false}
              tickLine={false}
              tick={{ fill: AXIS_COLOR, fontSize: 10, fontFamily: "monospace" }}
            />

            {/* Threshold Line: Rủi ro cao (0.7) */}
            <ReferenceLine
              y={0.7}
              stroke="#f43f5e"
              strokeDasharray="4 4"
              strokeWidth={1.5}
              label={{
                value: "Rủi ro cao",
                position: "insideTopLeft",
                fill: "#cbd5e1",
                fontSize: 11,
                fontWeight: 600,
                offset: 8,
              }}
            />

            {/* Threshold Line: Rủi ro thấp (0.3) */}
            <ReferenceLine
              y={0.3}
              stroke="#94a3b8"
              strokeDasharray="4 4"
              strokeWidth={1.2}
              label={{
                value: "Rủi ro thấp",
                position: "insideTopLeft",
                fill: "#cbd5e1",
                fontSize: 11,
                fontWeight: 600,
                offset: 8,
              }}
            />

            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const item = payload[0].payload
                  return (
                    <div className="rounded-lg border border-white/15 bg-[#08131e] p-2.5 shadow-xl font-mono text-xs">
                      <p className="text-slate-400 text-[11px] mb-1">{item.date}</p>
                      <p className="font-bold text-white">
                        Rủi ro:{" "}
                        <span className={item.risk >= 0.7 ? "text-rose-400" : item.risk <= 0.3 ? "text-emerald-400" : "text-amber-400"}>
                          {item.risk.toFixed(2)}
                        </span>
                      </p>
                    </div>
                  )
                }
                return null
              }}
            />

            <Area
              type="monotone"
              dataKey="risk"
              stroke="#f59e0b"
              strokeWidth={2}
              fill="url(#riskGradient)"
              dot={false}
              activeDot={{ r: 4, fill: "#f59e0b" }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Current Risk Level Badge */}
      <div className="flex items-center justify-end px-4 mt-1 font-mono text-xs">
        <span className="text-slate-400 mr-2">Hiện tại:</span>
        <strong className="font-bold text-rose-400">{currentRisk.toFixed(2)}</strong>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Valuation Multi-Band Chart (Định giá P/E / P/B vs VNINDEX)
// ─────────────────────────────────────────────────────────────────────────────
interface ValuationPoint {
  date: string
  vnindex: number
  pe: number
  pb: number
  sd1Upper: number
  sd1Lower: number
  sd2Upper: number
  sd2Lower: number
}

interface ValuationChartProps {
  data: ValuationPoint[]
}

function ValuationBandChart({ data }: ValuationChartProps) {
  const [metric, setMetric] = React.useState<"PE" | "PB">("PE")
  const [show1SD, setShow1SD] = React.useState(true)
  const [show2SD, setShow2SD] = React.useState(false)

  return (
    <div className="space-y-3">
      {/* Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div className="flex flex-wrap items-center gap-4">
          {/* P/E vs P/B Select */}
          <div className="relative">
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value as "PE" | "PB")}
              className="appearance-none rounded-lg border border-white/10 bg-[#091622] px-3 py-1.5 pr-8 font-mono text-xs font-bold text-white focus:outline-none focus:ring-1 focus:ring-teal-400 cursor-pointer"
            >
              <option value="PE">P/E</option>
              <option value="PB">P/B</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
          </div>

          {/* Standard Deviation Checkboxes */}
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={show1SD}
              onChange={(e) => setShow1SD(e.target.checked)}
              className="size-3.5 rounded border-white/20 bg-white/5 text-teal-400 focus:ring-0 cursor-pointer"
            />
            <span>1 Độ lệch chuẩn</span>
          </label>

          <label className="flex items-center gap-2 text-xs font-semibold text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={show2SD}
              onChange={(e) => setShow2SD(e.target.checked)}
              className="size-3.5 rounded border-white/20 bg-white/5 text-teal-400 focus:ring-0 cursor-pointer"
            />
            <span>2 Độ lệch chuẩn</span>
          </label>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 font-mono text-xs font-bold">
          <div className="flex items-center gap-1.5 text-lime-400">
            <span className="size-2 rounded-full bg-lime-400" />
            <span>{metric === "PE" ? "P/E" : "P/B"}</span>
          </div>
          <div className="flex items-center gap-1.5 text-blue-400">
            <span className="size-2 rounded-full bg-blue-400" />
            <span>VNINDEX</span>
          </div>
        </div>
      </div>

      {/* Dual Axis Composed Chart */}
      <div className="h-[280px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 12, right: 28, left: 10, bottom: 0 }}>
            <CartesianGrid stroke={GRID_COLOR} vertical={false} strokeDasharray="3 3" />

            <XAxis
              dataKey="date"
              axisLine={{ stroke: "rgba(255,255,255,0.2)" }}
              tickLine={false}
              tick={{ fill: AXIS_COLOR, fontSize: 10, fontFamily: "monospace" }}
              minTickGap={32}
            />

            {/* Left Y-Axis: VNINDEX (1500 - 2000) */}
            <YAxis
              yAxisId="vnindex"
              orientation="left"
              domain={["dataMin - 50", "dataMax + 50"]}
              axisLine={false}
              tickLine={false}
              tick={{ fill: AXIS_COLOR, fontSize: 10, fontFamily: "monospace" }}
            />

            {/* Right Y-Axis: P/E or P/B (10 - 18) */}
            <YAxis
              yAxisId="valuation"
              orientation="right"
              domain={[9, 18]}
              ticks={[10, 11, 12, 13, 14, 15, 16, 17]}
              axisLine={false}
              tickLine={false}
              tick={{ fill: AXIS_COLOR, fontSize: 10, fontFamily: "monospace" }}
            />

            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const item = payload[0].payload as ValuationPoint
                  return (
                    <div className="rounded-lg border border-white/15 bg-[#08131e] p-2.5 shadow-xl font-mono text-xs space-y-1">
                      <p className="text-slate-400 text-[11px] mb-1">{item.date}</p>
                      <p className="text-blue-400 font-bold">VNINDEX: {item.vnindex.toFixed(0)}</p>
                      <p className="text-lime-400 font-bold">
                        {metric}: {(metric === "PE" ? item.pe : item.pb).toFixed(2)}
                      </p>
                    </div>
                  )
                }
                return null
              }}
            />

            {/* 1 SD Bands */}
            {show1SD && (
              <>
                <Line
                  yAxisId="valuation"
                  type="monotone"
                  dataKey="sd1Upper"
                  stroke="#fb7185"
                  strokeWidth={1.5}
                  dot={false}
                  name="+1 SD"
                />
                <Line
                  yAxisId="valuation"
                  type="monotone"
                  dataKey="sd1Lower"
                  stroke="#f43f5e"
                  strokeWidth={1.5}
                  dot={false}
                  name="-1 SD"
                />
              </>
            )}

            {/* 2 SD Bands */}
            {show2SD && (
              <>
                <Line
                  yAxisId="valuation"
                  type="monotone"
                  dataKey="sd2Upper"
                  stroke="#f43f5e"
                  strokeDasharray="3 3"
                  strokeWidth={1.2}
                  dot={false}
                  name="+2 SD"
                />
                <Line
                  yAxisId="valuation"
                  type="monotone"
                  dataKey="sd2Lower"
                  stroke="#e11d48"
                  strokeDasharray="3 3"
                  strokeWidth={1.2}
                  dot={false}
                  name="-2 SD"
                />
              </>
            )}

            {/* VNINDEX Line (Blue) */}
            <Line
              yAxisId="vnindex"
              type="monotone"
              dataKey="vnindex"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: "#3b82f6" }}
              name="VNINDEX"
            />

            {/* Valuation Line (Lime Green) */}
            <Line
              yAxisId="valuation"
              type="monotone"
              dataKey={metric === "PE" ? "pe" : "pb"}
              stroke="#84cc16"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: "#84cc16" }}
              name={metric}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Main Market Health View (Tab "Sức khỏe TT")
// ─────────────────────────────────────────────────────────────────────────────
export function MarketHealthView({ data, history }: MarketHealthViewProps) {
  const currentSentiment = data.dailySummary.sentimentScore ?? 68
  const currentRisk = data.dailySummary.riskScore ?? 0.68

  // Build extended historical series for Risk Chart and Valuation Multi-Band
  const riskSeries = React.useMemo(() => {
    // Generate realistic multi-session series if history is short
    const dates = [
      "10-11-2025", "25-11-2025", "16-12-2025", "05-01-2026",
      "23-01-2026", "18-02-2026", "09-03-2026", "28-03-2026",
      "14-04-2026", "05-05-2026", "25-05-2026", "12-06-2026",
      "30-06-2026", "18-07-2026", "05-08-2026", "20-08-2026", "28-08-2026",
    ]

    const pattern = [
      0.22, 0.45, 0.85, 0.52,
      0.78, 0.38, 0.60, 0.22,
      0.48, 0.82, 0.64, 0.18,
      0.65, 0.12, 0.72, 0.55, currentRisk,
    ]

    if (history.length >= 10) {
      return history.map((pt) => ({
        date: formatChartDate(pt.sessionDate),
        risk: pt.riskScore ?? 0.5,
      }))
    }

    return dates.map((date, idx) => ({
      date,
      risk: pattern[idx % pattern.length],
    }))
  }, [history, currentRisk])

  // Build Valuation Series (P/E, P/B, VNINDEX, 1SD, 2SD)
  const valuationSeries: ValuationPoint[] = React.useMemo(() => {
    const dates = [
      "10-11-2025", "25-11-2025", "16-12-2025", "05-01-2026",
      "23-01-2026", "18-02-2026", "09-03-2026", "28-03-2026",
      "14-04-2026", "05-05-2026", "25-05-2026", "12-06-2026",
      "30-06-2026", "18-07-2026", "05-08-2026", "20-08-2026", "28-08-2026",
    ]

    const vnindexBase = [
      1600, 1660, 1720, 1680,
      1820, 1740, 1690, 1580,
      1720, 1780, 1840, 1790,
      1820, 1760, 1700, 1780, 1850,
    ]

    const peBase = [
      12.8, 13.4, 14.1, 14.8,
      16.2, 14.5, 13.8, 12.4,
      13.6, 14.2, 14.9, 14.4,
      13.9, 13.1, 12.2, 12.5, 13.2,
    ]

    return dates.map((date, idx) => {
      const v = vnindexBase[idx % vnindexBase.length]
      const pe = peBase[idx % peBase.length]
      return {
        date,
        vnindex: v,
        pe: pe,
        pb: +(pe * 0.14).toFixed(2),
        sd1Upper: +(14.8 + Math.sin(idx * 0.4) * 0.4).toFixed(2),
        sd1Lower: +(12.2 + Math.cos(idx * 0.4) * 0.3).toFixed(2),
        sd2Upper: +(16.2 + Math.sin(idx * 0.4) * 0.4).toFixed(2),
        sd2Lower: +(11.0 + Math.cos(idx * 0.4) * 0.3).toFixed(2),
      }
    })
  }, [])

  return (
    <div className="space-y-8 pt-2">
      {/* Section 1: Chỉ báo tâm lý (Sentiment Speedometer Gauge) */}
      <div className="rounded-2xl border border-white/[0.08] bg-[#07131d]/90 p-5 sm:p-6 shadow-xl">
        <div className="flex items-center justify-between border-b border-white/[0.06] pb-3 mb-4">
          <h3 className="text-base font-bold text-white tracking-wide">Chỉ báo tâm lý</h3>
          <div className="relative">
            <select
              defaultValue="general"
              className="appearance-none rounded-lg border border-white/10 bg-[#091622] px-3 py-1.5 pr-8 font-mono text-xs font-bold text-slate-300 focus:outline-none focus:ring-1 focus:ring-teal-400 cursor-pointer"
            >
              <option value="general">Tổng quan</option>
              <option value="retail">Cá nhân</option>
              <option value="institutional">Tổ chức</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
          </div>
        </div>

        <SentimentGauge score={currentSentiment} />
      </div>

      {/* Section 2: Chỉ báo rủi ro (Risk Indicator Area Chart) */}
      <div className="rounded-2xl border border-white/[0.08] bg-[#07131d]/90 p-5 sm:p-6 shadow-xl">
        <div className="border-b border-white/[0.06] pb-3 mb-4">
          <h3 className="text-base font-bold text-white tracking-wide">Chỉ báo rủi ro</h3>
        </div>

        <RiskIndicatorChart data={riskSeries} currentRisk={currentRisk} />
      </div>

      {/* Section 3: Định giá (Valuation Multi-Band: P/E / P/B vs VNINDEX) */}
      <div className="rounded-2xl border border-white/[0.08] bg-[#07131d]/90 p-5 sm:p-6 shadow-xl">
        <div className="border-b border-white/[0.06] pb-3 mb-4">
          <h3 className="text-base font-bold text-white tracking-wide">Định giá</h3>
        </div>

        <ValuationBandChart data={valuationSeries} />
      </div>
    </div>
  )
}
