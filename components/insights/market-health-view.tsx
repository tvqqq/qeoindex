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
import { ChevronDown, Gauge, HeartPulse, ShieldAlert } from "lucide-react"

import type { MarketCloseDashboardData, MarketHistoryPoint } from "@/lib/market-insight-data"
import { MarketWidgetChildHeader } from "@/components/insights/market-widget-child-header"

interface MarketHealthViewProps {
  data: MarketCloseDashboardData
  history: MarketHistoryPoint[]
}

const GRID_COLOR = "rgba(148, 163, 184, 0.08)"
const AXIS_COLOR = "rgba(148, 163, 184, 0.55)"

function stableSvgCoordinate(value: number) {
  return Number(value.toFixed(6))
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Semi-Circular Sentiment Gauge Speedometer (Chỉ báo tâm lý)
// ─────────────────────────────────────────────────────────────────────────────
interface SentimentGaugeProps {
  score: number // 0 to 100
}

function SentimentGauge({ score }: SentimentGaugeProps) {
  const clampedScore = Math.max(0, Math.min(100, Math.round(score * 100) / 100))

  // Map 0 -> 100 to angle in radians (-Math.PI to 0) or degrees (-180 to 0)
  // Angle: 0 score = 180 deg (left), 50 score = 90 deg (top), 100 score = 0 deg (right)
  const angleDeg = 180 - (clampedScore / 100) * 180
  const angleRad = (angleDeg * Math.PI) / 180

  const cx = 200
  const cy = 180
  const outerR = 135
  const innerR = 104
  const tickR = 92

  // Sentiment label & color determination
  let scoreColor = "#eab308" // yellow

  if (clampedScore <= 20) {
    scoreColor = "#10b981"
  } else if (clampedScore <= 40) {
    scoreColor = "#84cc16"
  } else if (clampedScore <= 60) {
    scoreColor = "#eab308"
  } else if (clampedScore <= 80) {
    scoreColor = "#f97316"
  } else {
    scoreColor = "#ef4444"
  }

  // Arrow triangle vertices
  const arrowLen = 14
  const arrowWidth = 7
  const tipX = stableSvgCoordinate(cx + (innerR - 4) * Math.cos(angleRad))
  const tipY = stableSvgCoordinate(cy - (innerR - 4) * Math.sin(angleRad))
  const baseLeftX = stableSvgCoordinate(cx + (innerR + arrowLen) * Math.cos(angleRad) - arrowWidth * Math.sin(angleRad))
  const baseLeftY = stableSvgCoordinate(cy - (innerR + arrowLen) * Math.sin(angleRad) - arrowWidth * Math.cos(angleRad))
  const baseRightX = stableSvgCoordinate(cx + (innerR + arrowLen) * Math.cos(angleRad) + arrowWidth * Math.sin(angleRad))
  const baseRightY = stableSvgCoordinate(cy - (innerR + arrowLen) * Math.sin(angleRad) + arrowWidth * Math.cos(angleRad))

  // Generate 5 colored Arc Segments:
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

    const x1Out = stableSvgCoordinate(cx + rOut * Math.cos(a1))
    const y1Out = stableSvgCoordinate(cy - rOut * Math.sin(a1))
    const x2Out = stableSvgCoordinate(cx + rOut * Math.cos(a2))
    const y2Out = stableSvgCoordinate(cy - rOut * Math.sin(a2))

    const x1In = stableSvgCoordinate(cx + rIn * Math.cos(a2))
    const y1In = stableSvgCoordinate(cy - rIn * Math.sin(a2))
    const x2In = stableSvgCoordinate(cx + rIn * Math.cos(a1))
    const y2In = stableSvgCoordinate(cy - rIn * Math.sin(a1))

    return `M ${x1Out} ${y1Out} A ${rOut} ${rOut} 0 0 1 ${x2Out} ${y2Out} L ${x1In} ${y1In} A ${rIn} ${rIn} 0 0 0 ${x2In} ${y2In} Z`
  }

  // Inner tick marks
  const ticks = []
  for (let i = 0; i <= 36; i++) {
    const tPct = (i / 36) * 100
    const tRad = (180 - (tPct / 100) * 180) * (Math.PI / 180)
    const len = i % 4 === 0 ? 7 : 4
    const x1 = stableSvgCoordinate(cx + tickR * Math.cos(tRad))
    const y1 = stableSvgCoordinate(cy - tickR * Math.sin(tRad))
    const x2 = stableSvgCoordinate(cx + (tickR - len) * Math.cos(tRad))
    const y2 = stableSvgCoordinate(cy - (tickR - len) * Math.sin(tRad))
    ticks.push({ x1, y1, x2, y2, major: i % 4 === 0 })
  }

  return (
    <div className="relative flex flex-col items-center justify-center py-1">
      <div className="relative w-full max-w-[380px] select-none">
        <svg viewBox="0 0 400 220" className="w-full h-auto overflow-visible">
          {/* Background Arc track */}
          <path
            d={`M ${cx - outerR} ${cy} A ${outerR} ${outerR} 0 0 1 ${cx + outerR} ${cy}`}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="32"
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
            y={cy - 10}
            textAnchor="middle"
            fill={scoreColor}
            className="font-mono font-black"
            fontSize="42"
            style={{ fontWeight: 900 }}
          >
            {clampedScore.toFixed(0)}
          </text>

          {/* Surrounding Labels */}
          {/* Top Center: Trung lập */}
          <text x={cx} y="26" textAnchor="middle" fill="#cbd5e1" fontSize="10" fontWeight="600">
            Trung lập
          </text>

          {/* Left Top: Sợ hãi */}
          <text x="138" y="48" textAnchor="middle" fill="#94a3b8" fontSize="9" fontWeight="500">
            Sợ hãi
          </text>

          {/* Right Top: Tham lam */}
          <text x="262" y="48" textAnchor="middle" fill="#94a3b8" fontSize="9" fontWeight="500">
            Tham lam
          </text>

          {/* Far Left: Sợ hãi tột độ */}
          <text x="50" y="112" textAnchor="middle" fill="#94a3b8" fontSize="9" fontWeight="500">
            <tspan x="50" dy="0">Sợ hãi</tspan>
            <tspan x="50" dy="11">tột độ</tspan>
          </text>

          {/* Far Right: Tham lam tột độ */}
          <text x="350" y="112" textAnchor="middle" fill="#94a3b8" fontSize="9" fontWeight="500">
            <tspan x="350" dy="0">Tham lam</tspan>
            <tspan x="350" dy="11">tột độ</tspan>
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
}

function RiskIndicatorChart({ data }: RiskChartProps) {
  return (
    <div className="w-full">
      <div className="h-[210px] w-full">
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
              tick={{ fill: AXIS_COLOR, fontSize: 9, fontFamily: "monospace" }}
              minTickGap={28}
            />

            <YAxis
              domain={[0, 1]}
              ticks={[0, 0.2, 0.4, 0.6, 0.8, 1.0]}
              axisLine={false}
              tickLine={false}
              tick={{ fill: AXIS_COLOR, fontSize: 9, fontFamily: "monospace" }}
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
                fontSize: 10,
                fontWeight: 600,
                offset: 6,
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
                fontSize: 10,
                fontWeight: 600,
                offset: 6,
              }}
            />

            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const item = payload[0].payload
                  return (
                    <div className="rounded-lg border border-white/15 bg-[#08131e] p-2 shadow-xl font-mono text-xs">
                      <p className="text-slate-400 text-[10px] mb-0.5">{item.date}</p>
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
  pe1StdUp: number | null
  pe1StdDown: number | null
  pe2StdUp: number | null
  pe2StdDown: number | null
  pb1StdUp: number | null
  pb1StdDown: number | null
  pb2StdUp: number | null
  pb2StdDown: number | null
}

interface ValuationChartProps {
  data: ValuationPoint[]
}

function ValuationBandChart({ data }: ValuationChartProps) {
  const [metric, setMetric] = React.useState<"PE" | "PB">("PE")
  const [show1SD, setShow1SD] = React.useState(true)
  const [show2SD, setShow2SD] = React.useState(false)

  if (data.length === 0) {
    return <div className="flex h-[260px] items-center justify-center rounded-xl border border-dashed border-white/10 text-sm text-slate-500">KFSP chưa trả lịch sử định giá hợp lệ.</div>
  }

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
      <div className="h-[260px] w-full">
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
              domain={["dataMin - 1", "dataMax + 1"]}
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

            {/* 1 SD Bands (Đứt nét) */}
            {show1SD && (
              <>
                <Line
                  yAxisId="valuation"
                  type="monotone"
                  dataKey={metric === "PE" ? "pe1StdUp" : "pb1StdUp"}
                  stroke="#fb7185"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  dot={false}
                  name="+1 SD"
                />
                <Line
                  yAxisId="valuation"
                  type="monotone"
                  dataKey={metric === "PE" ? "pe1StdDown" : "pb1StdDown"}
                  stroke="#f43f5e"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  dot={false}
                  name="-1 SD"
                />
              </>
            )}

            {/* 2 SD Bands (Đứt nét) */}
            {show2SD && (
              <>
                <Line
                  yAxisId="valuation"
                  type="monotone"
                  dataKey={metric === "PE" ? "pe2StdUp" : "pb2StdUp"}
                  stroke="#f43f5e"
                  strokeDasharray="3 3"
                  strokeWidth={1.2}
                  dot={false}
                  name="+2 SD"
                />
                <Line
                  yAxisId="valuation"
                  type="monotone"
                  dataKey={metric === "PE" ? "pe2StdDown" : "pb2StdDown"}
                  stroke="#e11d48"
                  strokeDasharray="3 3"
                  strokeWidth={1.2}
                  dot={false}
                  name="-2 SD"
                />
              </>
            )}

            {/* VNINDEX Line (Blue - Đậm hơn) */}
            <Line
              yAxisId="vnindex"
              type="monotone"
              dataKey="vnindex"
              stroke="#3b82f6"
              strokeWidth={2.8}
              dot={false}
              activeDot={{ r: 4.5, fill: "#3b82f6" }}
              name="VNINDEX"
            />

            {/* Valuation Line (Lime Green - Đậm hơn) */}
            <Line
              yAxisId="valuation"
              type="monotone"
              dataKey={metric === "PE" ? "pe" : "pb"}
              stroke="#84cc16"
              strokeWidth={2.8}
              dot={false}
              activeDot={{ r: 4.5, fill: "#84cc16" }}
              name={metric}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Main Market Health View (Tâm lý & Rủi ro trên 1 Row + Định giá)
// ─────────────────────────────────────────────────────────────────────────────
export function MarketHealthView({ data, history = [] }: MarketHealthViewProps) {
  const currentRisk = data.dailySummary.riskScore

  // Build historical series for Risk Chart from real Supabase market close history
  const riskSeries = React.useMemo(() => {
    if (data.dailySummary.riskHistory.length > 0) {
      return data.dailySummary.riskHistory.map((item) => {
        const parts = item.tradingDate.split("-")
        const formattedDate = parts.length === 3 ? `${parts[2]}-${parts[1]}` : item.tradingDate
        return {
          date: formattedDate,
          risk: Number(item.risk.toFixed(4)),
        }
      })
    }
    return history.flatMap((item) => {
      if (item.riskScore == null || item.riskScore < 0 || item.riskScore > 1) return []
      const parts = item.sessionDate.split("-")
      return [{ date: parts.length === 3 ? `${parts[2]}-${parts[1]}` : item.sessionDate, risk: item.riskScore }]
    })
  }, [data.dailySummary.riskHistory, history])

  // Build Valuation Series (P/E, P/B, VNINDEX, 1SD, 2SD) from real VN-Index and market P/E
  const valuationSeries: ValuationPoint[] = React.useMemo(() => {
    return data.dailySummary.valuationHistory.flatMap((item) => {
      if (item.price == null || item.pe == null || item.pb == null) return []
      const parts = item.tradingDate.split("-")
      return [{
        date: parts.length === 3 ? `${parts[2]}-${parts[1]}` : item.tradingDate,
        vnindex: item.price,
        pe: item.pe,
        pb: item.pb,
        pe1StdUp: item.pe1StdUp,
        pe1StdDown: item.pe1StdDown,
        pe2StdUp: item.pe2StdUp,
        pe2StdDown: item.pe2StdDown,
        pb1StdUp: item.pb1StdUp,
        pb1StdDown: item.pb1StdDown,
        pb2StdUp: item.pb2StdUp,
        pb2StdDown: item.pb2StdDown,
      }]
    })
  }, [data.dailySummary.valuationHistory])

  return (
    <div className="space-y-4 pt-1">
      {/* Risk and valuation form the second responsive market-health row. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/[0.08] bg-[#07131d]/90 shadow-xl flex flex-col justify-between">
          <MarketWidgetChildHeader icon={ShieldAlert} title="Chỉ báo rủi ro" description="Mức độ rủi ro phân phối ngắn hạn" asOf={data.asOf} quality={data.qualityStatus} actions={<span className="font-mono text-xs text-slate-400">Hiện tại: <strong className="font-bold text-rose-400">{currentRisk == null ? "—" : currentRisk.toFixed(2)}</strong></span>} />

          {riskSeries.length === 0
            ? <div className="flex h-[210px] items-center justify-center p-4 text-sm text-slate-500">KFSP chưa trả lịch sử rủi ro.</div>
            : <div className="p-4 sm:p-5"><RiskIndicatorChart data={riskSeries} /></div>}
        </div>
        <div className="rounded-2xl border border-white/[0.08] bg-[#07131d]/90 shadow-xl">
        <MarketWidgetChildHeader icon={Gauge} title="Định giá thị trường (P/E & P/B)" description="Đa dải độ lệch chuẩn P/E, P/B so với chỉ số VN-Index" asOf={data.asOf} quality={data.qualityStatus} />

        <div className="p-4 sm:p-5"><ValuationBandChart data={valuationSeries} /></div>
        </div>
      </div>
    </div>
  )
}

export function MarketSentimentCard({ data }: { data: MarketCloseDashboardData }) {
  const score = data.dailySummary.sentimentScore
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[#07131d]/90 p-4 sm:p-5 shadow-xl">
      <MarketWidgetChildHeader icon={HeartPulse} title="Chỉ báo tâm lý" description="Đo lường mức độ hưng phấn / sợ hãi" asOf={data.asOf} quality={data.qualityStatus} />
      {score == null ? <div className="flex h-[210px] items-center justify-center text-sm text-slate-500">KFSP chưa trả chỉ báo tâm lý.</div> : <SentimentGauge score={score} />}
    </div>
  )
}
