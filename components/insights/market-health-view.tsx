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
import { BarChart3, ChevronDown, Gauge, HeartPulse, ShieldAlert } from "lucide-react"

import type { MarketCloseDashboardData, MarketHistoryPoint } from "@/modules/research/market-insight/data"
import {
  buildValuationSnapshot,
  filterValuationHistoryByRange,
  mergeValuationHistories,
  type MergedValuationHistoryPoint,
  type ValuationMetric,
  type ValuationRangeYears,
} from "@/modules/research/market-insight/valuation-snapshot"
import { MarketWidgetChildHeader } from "@/components/insights/market-widget-child-header"
import { ValuationSnapshot } from "@/components/insights/valuation-snapshot"

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
      <div className="h-[260px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 6, right: 16, left: -20, bottom: 0 }}>
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
type ValuationPoint = MergedValuationHistoryPoint

const VALUATION_HISTORY_RANGES = [
  { label: "1Y", years: 1 },
  { label: "3Y", years: 3 },
  { label: "5Y", years: 5 },
  { label: "Tất cả", years: 0 },
] as const

interface ValuationHeaderControlsProps {
  metric: ValuationMetric
  onMetricChange: (metric: ValuationMetric) => void
  rangeYears: ValuationRangeYears
  onRangeYearsChange: (rangeYears: ValuationRangeYears) => void
  show1SD: boolean
  onShow1SDChange: (show: boolean) => void
  show2SD: boolean
  onShow2SDChange: (show: boolean) => void
}

function ValuationHeaderControls({
  metric,
  onMetricChange,
  rangeYears,
  onRangeYearsChange,
  show1SD,
  onShow1SDChange,
  show2SD,
  onShow2SDChange,
}: ValuationHeaderControlsProps) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
      <div className="relative">
        <label htmlFor="market-valuation-range" className="sr-only">Khoảng lịch sử định giá</label>
        <select
          id="market-valuation-range"
          value={rangeYears}
          onChange={(event) => onRangeYearsChange(Number(event.target.value) as ValuationRangeYears)}
          className="h-8 appearance-none rounded-md border border-white/10 bg-[#08131e] px-2 pr-7 font-mono text-xs font-bold text-slate-200 outline-none focus:border-teal-400/50"
        >
          {VALUATION_HISTORY_RANGES.map((range) => <option key={range.years} value={range.years}>{range.label}</option>)}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
      </div>

      <div className="relative">
        <label htmlFor="market-valuation-metric" className="sr-only">Chỉ số định giá</label>
        <select
          id="market-valuation-metric"
          value={metric}
          onChange={(event) => onMetricChange(event.target.value as ValuationMetric)}
          className="h-8 appearance-none rounded-md border border-white/10 bg-[#08131e] px-2 pr-7 font-mono text-xs font-bold text-slate-200 outline-none focus:border-teal-400/50"
        >
          <option value="PE">P/E</option>
          <option value="PB">P/B</option>
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
      </div>

      <label htmlFor="market-valuation-1sd" className="flex cursor-pointer select-none items-center gap-2 text-xs font-semibold text-slate-300">
        <input
          id="market-valuation-1sd"
          type="checkbox"
          checked={show1SD}
          onChange={(event) => onShow1SDChange(event.target.checked)}
          className="size-3.5 cursor-pointer rounded border-white/20 bg-white/5 text-teal-400 focus:ring-0"
        />
        <span>1 Độ lệch chuẩn</span>
      </label>

      <label htmlFor="market-valuation-2sd" className="flex cursor-pointer select-none items-center gap-2 text-xs font-semibold text-slate-300">
        <input
          id="market-valuation-2sd"
          type="checkbox"
          checked={show2SD}
          onChange={(event) => onShow2SDChange(event.target.checked)}
          className="size-3.5 cursor-pointer rounded border-white/20 bg-white/5 text-teal-400 focus:ring-0"
        />
        <span>2 Độ lệch chuẩn</span>
      </label>
    </div>
  )
}

interface ValuationChartProps {
  data: ValuationPoint[]
  metric: ValuationMetric
  show1SD: boolean
  show2SD: boolean
}

function ValuationBandChart({ data, metric, show1SD, show2SD }: ValuationChartProps) {
  const metricPointCount = data.filter((item) => (metric === "PE" ? item.pe : item.pb) != null
    || (metric === "PE" ? item.qeoPe : item.qeoPb) != null).length
  const indexPointCount = data.filter((item) => item.vnindex != null || item.qeoEstimatedVnindexValue != null).length
  const hasVisibleValue = metricPointCount > 0 || indexPointCount > 0
  const isolatedDot = (
    key: "vnindex" | "pe" | "pb" | "qeoEstimatedVnindexValue" | "qeoPe" | "qeoPb",
    color: string,
  ) => function IsolatedDot(props: { cx?: number; cy?: number; index?: number }) {
    const index = props.index ?? -1
    const isolated = index >= 0 && data[index]?.[key] != null
      && data[index - 1]?.[key] == null && data[index + 1]?.[key] == null
    return isolated && props.cx != null && props.cy != null
      ? <circle cx={props.cx} cy={props.cy} r={3} fill={color} strokeWidth={0} />
      : <g />
  }

  if (data.length === 0 || !hasVisibleValue) {
    return <div className="flex h-[260px] items-center justify-center rounded-xl border border-dashed border-white/10 text-sm text-slate-500">Chưa có lịch sử định giá hoặc chỉ số hợp lệ.</div>
  }

  const qeoMetricValue = (item: ValuationPoint) => metric === "PE" ? item.qeoPe : item.qeoPb
  const qeoMetricLegend = metric === "PE" ? "P/E Qeo · loại VIC/VHM" : "P/B Qeo · loại VIC/VHM"
  const qeoMetricTooltip = metric === "PE" ? "P/E nhóm có P/E dương · loại VIC/VHM" : "P/B nhóm có P/B dương · loại VIC/VHM"
  const receivedAt = (value: string | null) => {
    if (!value || !Number.isFinite(new Date(value).getTime())) return null
    return new Date(value).toLocaleString("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
  }

  return (
    <div className="space-y-1" data-valuation-qeo-overlay>
      <div className="flex flex-wrap items-center justify-start gap-x-3 gap-y-1 px-1 font-mono text-[10px] font-bold sm:text-xs">
        <div className="flex items-center gap-1.5 text-blue-400">
          <span className="size-2 rounded-full bg-blue-400" />
          <span>VNINDEX</span>
        </div>
        <div className="flex items-center gap-1.5 text-lime-400">
          <span className="size-2 rounded-full bg-lime-400" />
          <span>{metric === "PE" ? "P/E KFSP" : "P/B KFSP"}</span>
        </div>
        <div className="flex items-center gap-1.5 text-orange-400">
          <span className="w-4 border-t-2 border-dashed border-orange-400" />
          <span>Qeo VNINDEX · loại VIC/VHM</span>
        </div>
        <div className="flex items-center gap-1.5 text-fuchsia-400">
          <span className="w-4 border-t-2 border-dotted border-fuchsia-400" />
          <span>{qeoMetricLegend}</span>
        </div>
      </div>

      <div className="h-[260px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 4, right: 28, left: 10, bottom: 0 }}>
            <CartesianGrid stroke={GRID_COLOR} vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="tradingDate"
              tickFormatter={(value) => {
                const parts = String(value).split("-")
                return parts.length === 3 ? `${parts[2]}-${parts[1]}` : String(value)
              }}
              axisLine={{ stroke: "rgba(255,255,255,0.2)" }}
              tickLine={false}
              tick={{ fill: AXIS_COLOR, fontSize: 10, fontFamily: "monospace" }}
              minTickGap={32}
            />

            <YAxis
              yAxisId="vnindex"
              orientation="left"
              domain={["dataMin - 50", "dataMax + 50"]}
              axisLine={false}
              tickLine={false}
              tick={{ fill: AXIS_COLOR, fontSize: 10, fontFamily: "monospace" }}
            />

            <YAxis
              yAxisId="valuation"
              orientation="right"
              domain={metricPointCount > 0 ? ["dataMin - 1", "dataMax + 1"] : [0, 1]}
              hide={metricPointCount === 0}
              axisLine={false}
              tickLine={false}
              tick={{ fill: AXIS_COLOR, fontSize: 10, fontFamily: "monospace" }}
              tickFormatter={(value) => Number(value).toFixed(2)}
            />

            <Tooltip
              position={{ x: 0 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const item = payload[0].payload as ValuationPoint
                const originalMetric = metric === "PE" ? item.pe : item.pb
                const estimateMetric = qeoMetricValue(item)
                const count = metric === "PE" ? item.qeoPeMemberCount : item.qeoPbMemberCount
                const total = metric === "PE" ? item.qeoPeTotalMemberCount : item.qeoPbTotalMemberCount
                const coverage = metric === "PE" ? item.qeoPeMarketCapCoveragePct : item.qeoPbMarketCapCoveragePct
                const receivedTimestamp = receivedAt(item.qeoSourceObservedTo)
                return (
                  <div className="max-w-[min(280px,calc(100vw-112px))] break-words space-y-1 rounded-lg border border-white/15 bg-[#08131e] p-2.5 font-mono text-xs shadow-xl">
                    <p className="mb-1 text-[11px] text-slate-400">{item.tradingDate}</p>
                    <p className="font-bold text-blue-400">VNINDEX: {item.vnindex?.toFixed(2) ?? "—"}</p>
                    <p className="font-bold text-lime-400">{metric} KFSP: {originalMetric?.toFixed(2) ?? "—"}</p>
                    <p className="font-bold text-orange-400">Qeo VNINDEX · loại VIC/VHM: {item.qeoEstimatedVnindexValue?.toFixed(2) ?? "—"}</p>
                    <p className="font-bold text-fuchsia-400">{qeoMetricTooltip}: {estimateMetric?.toFixed(2) ?? "—"}</p>
                    <p className="text-[10px] text-slate-400">
                      {count == null || total == null ? "— mã" : `${count}/${total} mã`}
                      {" · "}
                      {coverage == null ? "—" : `${coverage.toFixed(2)}% vốn hóa`}
                    </p>
                    {receivedTimestamp && (
                      <p className="text-[10px] text-slate-500">
                        Qeo nhận lúc {receivedTimestamp} ICT; không phải timestamp cập nhật từ nhà cung cấp.
                      </p>
                    )}
                  </div>
                )
              }}
            />

            {/* Original provider valuation bands remain attached to KFSP values only. */}
            {show1SD && (
              <>
                <Line
                  yAxisId="valuation"
                  type="monotone"
                  dataKey={metric === "PE" ? "pe1StdUp" : "pb1StdUp"}
                  stroke="#fb7185"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  isAnimationActive={false}
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
                  isAnimationActive={false}
                  dot={false}
                  name="-1 SD"
                />
              </>
            )}
            {show2SD && (
              <>
                <Line
                  yAxisId="valuation"
                  type="monotone"
                  dataKey={metric === "PE" ? "pe2StdUp" : "pb2StdUp"}
                  stroke="#f43f5e"
                  strokeDasharray="3 3"
                  strokeWidth={1.2}
                  isAnimationActive={false}
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
                  isAnimationActive={false}
                  dot={false}
                  name="-2 SD"
                />
              </>
            )}

            <Line
              yAxisId="vnindex"
              type="monotone"
              dataKey="vnindex"
              stroke="#3b82f6"
              strokeWidth={2.8}
              isAnimationActive={false}
              dot={isolatedDot("vnindex", "#3b82f6")}
              connectNulls={false}
              activeDot={{ r: 4.5, fill: "#3b82f6" }}
              name="VNINDEX"
            />
            <Line
              yAxisId="valuation"
              type="monotone"
              dataKey={metric === "PE" ? "pe" : "pb"}
              stroke="#84cc16"
              strokeWidth={2.8}
              isAnimationActive={false}
              dot={isolatedDot(metric === "PE" ? "pe" : "pb", "#84cc16")}
              connectNulls={false}
              activeDot={{ r: 4.5, fill: "#84cc16" }}
              name={metric === "PE" ? "P/E KFSP" : "P/B KFSP"}
            />
            <Line
              yAxisId="vnindex"
              type="monotone"
              dataKey="qeoEstimatedVnindexValue"
              stroke="#f97316"
              strokeDasharray="7 4"
              strokeWidth={2.5}
              isAnimationActive={false}
              dot={isolatedDot("qeoEstimatedVnindexValue", "#f97316")}
              connectNulls={false}
              activeDot={{ r: 4, fill: "#f97316" }}
              name="Qeo VNINDEX · loại VIC/VHM"
            />
            <Line
              yAxisId="valuation"
              type="monotone"
              dataKey={metric === "PE" ? "qeoPe" : "qeoPb"}
              stroke="#e879f9"
              strokeDasharray="3 3"
              strokeWidth={2.5}
              isAnimationActive={false}
              dot={isolatedDot(metric === "PE" ? "qeoPe" : "qeoPb", "#e879f9")}
              connectNulls={false}
              activeDot={{ r: 4, fill: "#e879f9" }}
              name={qeoMetricLegend}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function qeoUnavailableCopy(reason: string | null) {
  if (reason === "PROVIDER_MARKET_SESSION_GAP") return "Lịch sử phiên của KFSP không khớp với dữ liệu EOD đã lưu; chuỗi điểm dừng để tránh bỏ qua một phiên giao dịch."
  if (reason === "MARKET_SNAPSHOT_CHANGED") return "Ước tính đã lưu không còn khớp với nguồn thị trường hiện tại của phiên này."
  if (reason === "PREVIOUS_MARKET_SESSION_ESTIMATE_MISSING") return "Chuỗi ước tính đang dừng vì thiếu phiên EOD liền trước; hệ thống không nối qua ngày trống."
  if (reason === "CANDIDATE_FEED_COUNT_MISMATCH" || reason === "CANDIDATE_FEED_RUN_OR_FRESHNESS_MISMATCH" || reason === "HOSE_SOURCE_COVERAGE_INCOMPLETE") return "Độ phủ hoặc thời điểm của nguồn KFSP chưa đạt điều kiện tính."
  if (reason === "PUBLISHED_VNINDEX_VALUE_MISSING") return "Chưa có giá trị VNINDEX đã công bố để làm mốc."
  if (reason === "QEO_ESTIMATE_PERSIST_FAILED" || reason === "OPTIONAL_DERIVATION_FAILED") return "Chưa thể lưu bằng chứng cho phiên ước tính này."
  return "Nguồn dữ liệu phiên này chưa đủ điều kiện để tính ước tính."
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Main Market Health View (Tâm lý & Rủi ro trên 1 Row + Định giá)
// ─────────────────────────────────────────────────────────────────────────────
export function MarketHealthView({ data, history = [] }: MarketHealthViewProps) {
  const currentRisk = data.dailySummary.riskScore
  const [valuationMetric, setValuationMetric] = React.useState<ValuationMetric>("PE")
  const [valuationRangeYears, setValuationRangeYears] = React.useState<ValuationRangeYears>(0)
  const [showValuation1SD, setShowValuation1SD] = React.useState(true)
  const [showValuation2SD, setShowValuation2SD] = React.useState(false)

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

  const visibleValuationHistory = React.useMemo(
    () => filterValuationHistoryByRange(data.dailySummary.valuationHistory, valuationRangeYears, data.sessionDate),
    [data.dailySummary.valuationHistory, valuationRangeYears, data.sessionDate],
  )
  const visibleQeoExVnindexHistory = React.useMemo(
    () => filterValuationHistoryByRange(data.dailySummary.qeoExVnindexHistory, valuationRangeYears, data.sessionDate),
    [data.dailySummary.qeoExVnindexHistory, valuationRangeYears, data.sessionDate],
  )
  const latestQeoEstimate = visibleQeoExVnindexHistory.at(-1) || null

  // The original and Qeo series share this full-date union and the published market-session range.
  const visibleValuationSeries: ValuationPoint[] = React.useMemo(() => (
    mergeValuationHistories(visibleValuationHistory, visibleQeoExVnindexHistory)
  ), [visibleValuationHistory, visibleQeoExVnindexHistory])

  const valuationSnapshot = React.useMemo(() => buildValuationSnapshot({
    metric: valuationMetric,
    history: data.dailySummary.valuationHistory,
    rangeYears: valuationRangeYears,
  }), [data.dailySummary.valuationHistory, valuationMetric, valuationRangeYears])

  return (
    <div className="space-y-4 pt-1">
      {/* Risk and valuation form the second responsive market-health row. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/[0.08] bg-[#07131d]/90 shadow-xl flex flex-col">
          <MarketWidgetChildHeader icon={ShieldAlert} title="Chỉ báo rủi ro" description="Mức độ rủi ro phân phối ngắn hạn" asOf={data.asOf} quality={data.qualityStatus} actions={<span className="font-mono text-xs text-slate-400">Hiện tại: <strong className="font-bold text-rose-400">{currentRisk == null ? "—" : currentRisk.toFixed(2)}</strong></span>} />

          {riskSeries.length === 0
            ? <div className="flex h-[210px] items-center justify-center p-4 text-sm text-slate-500">KFSP chưa trả lịch sử rủi ro.</div>
            : <div className="px-4 pb-4 pt-2 sm:px-5 sm:pb-5 sm:pt-3"><RiskIndicatorChart data={riskSeries} /></div>}
        </div>
        <div className="rounded-2xl border border-white/[0.08] bg-[#07131d]/90 shadow-xl">
        <MarketWidgetChildHeader icon={Gauge}
          title="Định giá thị trường (P/E & P/B)"
          description="Đa dải độ lệch chuẩn P/E, P/B so với chỉ số VN-Index"
          asOf={data.asOf}
          quality={data.qualityStatus}
          actions={<ValuationHeaderControls
            metric={valuationMetric}
            onMetricChange={setValuationMetric}
            rangeYears={valuationRangeYears}
            onRangeYearsChange={setValuationRangeYears}
            show1SD={showValuation1SD}
            onShow1SDChange={setShowValuation1SD}
            show2SD={showValuation2SD}
            onShow2SDChange={setShowValuation2SD}
          />}
        />

        <div className="px-4 pb-4 pt-2 sm:px-5 sm:pb-5 sm:pt-3">
          <ValuationSnapshot snapshot={valuationSnapshot} />
          <ValuationBandChart data={visibleValuationSeries} metric={valuationMetric} show1SD={showValuation1SD} show2SD={showValuation2SD} />

          <section className="mt-5 space-y-3 border-t border-white/[0.08] pt-4" data-qeo-ex-vnindex-estimate>
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-slate-100">Qeo ước tính · HOSE loại VIC, VHM</h3>
              <p className="text-[11px] leading-5 text-slate-400">
                Ước tính độc lập của Qeo từ dữ liệu cổ phiếu HOSE của KFSP; không phải VNINDEX chính thức hoặc danh sách thành phần chính thức. Thời điểm ghi nhận là lúc Qeo nhận dữ liệu, không phải timestamp cập nhật từ nhà cung cấp.
              </p>
            </div>
              {latestQeoEstimate && latestQeoEstimate.tradingDate !== data.sessionDate && (
              <p role="status" className="text-[11px] leading-5 text-amber-100/80">
                Chưa có ước tính cho phiên {data.sessionDate}; giá trị bên dưới thuộc phiên {latestQeoEstimate.tradingDate}.
              </p>
            )}
            {latestQeoEstimate && (
              <div className="space-y-2 text-[11px] leading-5 text-slate-400">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {(["PE", "PB"] as const).map((metric) => {
                    const isPe = metric === "PE"
                    const value = isPe ? latestQeoEstimate.pe : latestQeoEstimate.pb
                    const memberCount = isPe ? latestQeoEstimate.peMemberCount : latestQeoEstimate.pbMemberCount
                    const totalMemberCount = isPe ? latestQeoEstimate.peTotalMemberCount : latestQeoEstimate.pbTotalMemberCount
                    const coverage = isPe ? latestQeoEstimate.peMarketCapCoveragePct : latestQeoEstimate.pbMarketCapCoveragePct
                    const ratioName = isPe ? "P/E" : "P/B"
                    return (
                      <div key={metric} className="rounded-lg border border-white/[0.07] bg-black/15 px-2.5 py-2">
                        <p className="font-semibold text-amber-200">{ratioName} nhóm có {ratioName} dương</p>
                        <p className="font-mono text-slate-200">{value == null ? "—" : value.toFixed(2)}</p>
                        <p>{memberCount}/{totalMemberCount} mã · {coverage == null ? "chưa có độ phủ vốn hóa" : `${coverage.toFixed(2)}% vốn hóa`}</p>
                      </div>
                    )
                  })}
                </div>
                {latestQeoEstimate.status === "unavailable" && (
                  <p className="rounded-lg border border-amber-300/20 bg-amber-300/[0.05] px-3 py-2 text-amber-100/80">
                    Phiên {latestQeoEstimate.tradingDate}: {qeoUnavailableCopy(latestQeoEstimate.unavailableReason)}
                  </p>
                )}
                <p>
                  Mốc gốc {latestQeoEstimate.baseSessionDate || "chưa có"}
                  {latestQeoEstimate.baseVnindexValue == null ? "" : ` · VNINDEX ${latestQeoEstimate.baseVnindexValue.toFixed(2)}`}
                  {` · ${latestQeoEstimate.sourceHoseCount} mã HOSE quan sát, ${latestQeoEstimate.retainedMemberCount} mã sau loại VIC/VHM`}
                  {latestQeoEstimate.providerBreadthCount == null ? "" : ` · đối chiếu độ rộng VNINDEX ${latestQeoEstimate.providerBreadthCount} mã`}
                </p>
                <p>
                  Chỉ số nối phiên theo vốn hóa tham chiếu từ biến động giá KFSP; P/E/P/B là trung bình điều hòa theo vốn hóa của nhóm có bội số dương. Mã thiếu, bằng 0 hoặc âm không tham gia mẫu số; số mã và độ phủ vốn hóa được hiển thị ở trên.
                </p>
              </div>
            )}
            {!latestQeoEstimate && (
              <p className="text-[11px] leading-5 text-slate-500">
                Lịch sử chỉ lưu các phiên EOD thực tế sau khi nguồn đầy đủ. Phiên thiếu dữ liệu không được nối qua hoặc dựng ngược từ lịch sử cũ.
              </p>
            )}
          </section>
        </div>
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
      {score == null ? <div className="flex h-[210px] items-center justify-center text-sm text-slate-500">Chưa có dữ liệu chỉ báo tâm lý.</div> : <SentimentGauge score={score} />}
    </div>
  )
}

const SENTIMENT_HISTORY_RANGES = [
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "12M", days: 360 },
  { label: "Tất cả", days: 0 },
] as const

function getSentimentHistoryLabel(score: number) {
  if (score < 30) return "Sợ hãi cực độ"
  if (score < 45) return "Sợ hãi"
  if (score < 56) return "Trung lập"
  if (score < 71) return "Tham lam"
  return "Tham lam cực độ"
}

function getSentimentScoreBadgeClass(score: number) {
  if (score < 45) return "bg-rose-400"
  if (score < 56) return "bg-amber-300"
  return "bg-emerald-400"
}

function SentimentHistoryTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: { tradingDate?: string; value?: number } }> }) {
  const point = payload?.[0]?.payload
  if (!active || !point || point.value == null) return null
  const sentimentLabel = getSentimentHistoryLabel(point.value)
  return (
    <div className="rounded-lg border border-white/15 bg-[#08131e] p-2.5 shadow-xl">
      <p className="font-mono text-[11px] text-slate-400">{point.tradingDate}</p>
      <div className="mt-1 flex items-center gap-2">
        <span className={`rounded ${getSentimentScoreBadgeClass(point.value)} px-1.5 py-0.5 font-mono text-sm font-black text-slate-950`}>{point.value.toFixed(0)}</span>
        <span className="text-sm font-semibold text-slate-100">{sentimentLabel}</span>
      </div>
    </div>
  )
}

export function MarketSentimentHistoryCard({ data }: { data: MarketCloseDashboardData }) {
  const [rangeDays, setRangeDays] = React.useState<number>(90)
  const history = data.dailySummary.sentimentHistory
  const visibleHistory = React.useMemo(() => {
    if (rangeDays === 0 || history.length < 2) return history
    const latest = Date.parse(history[history.length - 1]?.tradingDate || "")
    if (!Number.isFinite(latest)) return history
    const cutoff = latest - rangeDays * 24 * 60 * 60 * 1000
    return history.filter((point) => {
      const timestamp = Date.parse(point.tradingDate)
      return Number.isFinite(timestamp) && timestamp >= cutoff
    })
  }, [history, rangeDays])

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[#07131d]/90 p-4 shadow-xl sm:p-5">
      <MarketWidgetChildHeader
        icon={BarChart3}
        title="Lịch sử chỉ báo tâm lý"
        description="Diễn biến điểm tâm lý theo thời gian"
        asOf={data.asOf}
        quality={data.qualityStatus}
        actions={
          <div className="flex items-center gap-2">
            <label htmlFor="market-sentiment-history-range" className="text-xs font-medium text-slate-400">Hiển thị</label>
            <select
              id="market-sentiment-history-range"
              value={rangeDays}
              onChange={(event) => setRangeDays(Number(event.target.value))}
              className="h-8 rounded-md border border-white/10 bg-[#08131e] px-2 font-mono text-xs font-bold text-slate-200 outline-none focus:border-cyan-400/50"
            >
              {SENTIMENT_HISTORY_RANGES.map((range) => <option key={range.days} value={range.days}>{range.label}</option>)}
            </select>
          </div>
        }
      />
      {visibleHistory.length === 0 ? (
        <div className="flex h-[210px] items-center justify-center text-sm text-slate-500">Chưa có lịch sử chỉ báo tâm lý.</div>
      ) : (
        <div className="mt-2 h-[210px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={visibleHistory} margin={{ top: 12, right: 8, left: -24, bottom: 0 }}>
              <CartesianGrid stroke={GRID_COLOR} vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="tradingDate" axisLine={{ stroke: "rgba(255,255,255,0.16)" }} tickLine={false} tick={{ fill: AXIS_COLOR, fontSize: 9, fontFamily: "monospace" }} minTickGap={28} tickFormatter={(value) => String(value).slice(5)} />
              <YAxis domain={[0, 100]} ticks={[0, 30, 45, 56, 71, 100]} axisLine={false} tickLine={false} tick={{ fill: AXIS_COLOR, fontSize: 9, fontFamily: "monospace" }} />
              <ReferenceLine y={30} stroke="rgba(244,63,94,0.4)" strokeDasharray="3 3" />
              <ReferenceLine y={45} stroke="rgba(251,191,36,0.35)" strokeDasharray="3 3" />
              <ReferenceLine y={56} stroke="rgba(148,163,184,0.3)" strokeDasharray="3 3" />
              <ReferenceLine y={71} stroke="rgba(45,212,191,0.35)" strokeDasharray="3 3" />
              <Tooltip content={<SentimentHistoryTooltip />} />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#f8fafc"
                strokeWidth={2.2}
                dot={false}
                activeDot={{ r: 3.5, fill: "#f8fafc" }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
