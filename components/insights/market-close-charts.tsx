"use client"

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts"

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import type {
  MarketCloseDashboardData,
  MarketHistoryPoint,
  MarketIndexCard,
  MarketLeaderItem,
  MarketSectorRow,
} from "@/modules/research/market-insight/data"
import type { InstitutionalFlowPersistenceContext, InstitutionalFlowPersistenceRow } from "@/modules/research/market-insight/institutional-flow-persistence"

const GRID = "rgba(148,163,184,0.10)"
const AXIS = "rgba(148,163,184,0.62)"
const POSITIVE = "#34d399"
const NEGATIVE = "#fb7185"
const NEUTRAL = "#94a3b8"
const ACCENT = "#38bdf8"

const breadthConfig = {
  advances: { label: "Tăng", color: POSITIVE },
  unchanged: { label: "Đứng giá", color: NEUTRAL },
  declines: { label: "Giảm", color: NEGATIVE },
} satisfies ChartConfig

export function IndexBreadthChart({ indexes }: { indexes: MarketIndexCard[] }) {
  const data = indexes.map((item) => ({
    name: item.indexCode,
    advances: item.advances,
    unchanged: item.unchanged,
    declines: item.declines,
  }))

  return (
    <ChartContainer config={breadthConfig} className="h-[220px] w-full" initialDimension={{ width: 420, height: 220 }}>
      <BarChart accessibilityLayer data={data} layout="vertical" margin={{ left: 4, right: 10 }}>
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" hide />
        <YAxis dataKey="name" type="category" width={62} axisLine={false} tickLine={false} tick={{ fill: AXIS, fontSize: 11, fontWeight: 700 }} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="advances" stackId="breadth" fill="var(--color-advances)" radius={[5, 0, 0, 5]} />
        <Bar dataKey="unchanged" stackId="breadth" fill="var(--color-unchanged)" />
        <Bar dataKey="declines" stackId="breadth" fill="var(--color-declines)" radius={[0, 5, 5, 0]} />
      </BarChart>
    </ChartContainer>
  )
}

const indexConfig = {
  changePct: { label: "Biến động", color: POSITIVE },
  tradedValue: { label: "GTGD (tỷ)", color: ACCENT },
} satisfies ChartConfig

const vnindexHistoryConfig = {
  vnindexClose: { label: "VNINDEX", color: "#5eead4" },
} satisfies ChartConfig

export function VnindexHistoryChart({ history }: { history: MarketHistoryPoint[] }) {
  const data = history.filter((item) => item.vnindexClose != null)

  if (!data.length) return <EmptyChart message="Lịch sử VNINDEX sẽ hiển thị sau khi đủ snapshot." />

  return (
    <ChartContainer config={vnindexHistoryConfig} className="h-[260px] w-full" initialDimension={{ width: 860, height: 260 }}>
      <AreaChart accessibilityLayer data={data} margin={{ top: 12, right: 12, left: -20, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="3 6" />
        <XAxis dataKey="sessionDate" axisLine={false} tickLine={false} tick={{ fill: AXIS, fontSize: 10 }} tickFormatter={shortDate} minTickGap={28} />
        <YAxis domain={["dataMin - 8", "dataMax + 8"]} axisLine={false} tickLine={false} tick={{ fill: AXIS, fontSize: 10 }} />
        <ChartTooltip content={<ChartTooltipContent indicator="line" labelFormatter={(value) => shortDate(String(value))} />} />
        <Area dataKey="vnindexClose" type="monotone" fill="var(--color-vnindexClose)" fillOpacity={0.08} stroke="var(--color-vnindexClose)" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} connectNulls />
      </AreaChart>
    </ChartContainer>
  )
}

export function IndexPerformanceChart({ indexes }: { indexes: MarketIndexCard[] }) {
  const data = indexes.map((item) => ({
    name: item.indexCode,
    changePct: item.changePct,
    tradedValue: item.tradedValue,
  }))

  return (
    <ChartContainer config={indexConfig} className="h-[220px] w-full" initialDimension={{ width: 420, height: 220 }}>
      <ComposedChart accessibilityLayer data={data} margin={{ top: 8, right: 6, left: -18, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: AXIS, fontSize: 11, fontWeight: 700 }} />
        <YAxis yAxisId="change" axisLine={false} tickLine={false} tick={{ fill: AXIS, fontSize: 10 }} tickFormatter={(value) => `${value}%`} />
        <YAxis yAxisId="value" orientation="right" axisLine={false} tickLine={false} tick={{ fill: AXIS, fontSize: 10 }} tickFormatter={(value) => `${Math.round(value / 1000)}k`} />
        <ReferenceLine yAxisId="change" y={0} stroke="rgba(148,163,184,.28)" />
        <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
        <Bar yAxisId="value" dataKey="tradedValue" fill="var(--color-tradedValue)" fillOpacity={0.18} radius={[5, 5, 0, 0]} />
        <Line yAxisId="change" dataKey="changePct" type="monotone" stroke="var(--color-changePct)" strokeWidth={2.5} dot={{ r: 4, fill: "var(--color-changePct)" }} />
      </ComposedChart>
    </ChartContainer>
  )
}

const maConfig = {
  value: { label: "Tỷ lệ cổ phiếu trên MA", color: POSITIVE },
} satisfies ChartConfig

export function MaBreadthChart({ daily }: { daily: MarketCloseDashboardData["dailySummary"] }) {
  const data = [
    { name: "MA10", value: daily.aboveMa10Pct },
    { name: "MA20", value: daily.aboveMa20Pct },
    { name: "MA50", value: daily.aboveMa50Pct },
    { name: "MA200", value: daily.aboveMa200Pct },
  ]

  return (
    <ChartContainer config={maConfig} className="h-[220px] w-full" initialDimension={{ width: 420, height: 220 }}>
      <BarChart accessibilityLayer data={data} margin={{ top: 8, right: 6, left: -18, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: AXIS, fontSize: 11, fontWeight: 700 }} />
        <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fill: AXIS, fontSize: 10 }} tickFormatter={(value) => `${value}%`} />
        <ReferenceLine y={50} stroke="rgba(148,163,184,.45)" strokeDasharray="4 5" />
        <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
        <Bar dataKey="value" radius={[7, 7, 0, 0]}>
          {data.map((item) => <Cell key={item.name} fill={(item.value ?? 0) >= 50 ? POSITIVE : NEUTRAL} />)}
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}

function formatFlowValue(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "Chưa đủ dữ liệu"
  const absolute = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(Math.abs(value))
  return `${value > 0 ? "+" : value < 0 ? "-" : ""}${absolute} tỷ`
}

function flowStateLabel(row: InstitutionalFlowPersistenceRow) {
  if (row.state === "persistent_buying") return "Duy trì mua ròng"
  if (row.state === "persistent_selling") return "Duy trì bán ròng"
  if (row.state === "reversal_to_buying") return "Đảo chiều → mua"
  if (row.state === "reversal_to_selling") return "Đảo chiều → bán"
  return row.fiveDay != null && row.twentyDay != null ? "Chưa xác nhận" : "Chưa đủ dữ liệu"
}

function flowStateClass(row: InstitutionalFlowPersistenceRow) {
  if (row.state === "persistent_buying" || row.state === "reversal_to_buying") return "border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-300"
  if (row.state === "persistent_selling" || row.state === "reversal_to_selling") return "border-rose-300/20 bg-rose-300/[0.08] text-rose-300"
  return "border-white/[0.08] bg-white/[0.03] text-slate-400"
}

function FlowPersistenceValue({ value, maxAbs }: { value: number | null; maxAbs: number }) {
  const available = value != null && Number.isFinite(value)
  const width = available && maxAbs > 0 ? Math.min(100, Math.abs(value) / maxAbs * 100) : 0
  const tone = !available || value === 0 ? "text-slate-300" : value > 0 ? "text-emerald-300" : "text-rose-300"
  const barTone = !available || value === 0 ? "bg-slate-500" : value > 0 ? "bg-emerald-400" : "bg-rose-400"

  return (
    <div className="min-w-[78px] px-2 py-2.5">
      <span className={`block whitespace-nowrap font-mono text-[11px] font-bold ${tone}`}>{formatFlowValue(value)}</span>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.05]">
        {width > 0 ? <span className={`block h-full rounded-full ${barTone}`} style={{ width: `${width}%` }} /> : null}
      </div>
    </div>
  )
}

export function InstitutionalFlowChart({ context }: { context: InstitutionalFlowPersistenceContext }) {
  const maxFor = (field: "today" | "fiveDay" | "twentyDay") => Math.max(
    1,
    ...context.rows.flatMap((row) => row[field] != null && Number.isFinite(row[field]) ? [Math.abs(row[field] as number)] : []),
  )
  const todayMax = maxFor("today")
  const fiveDayMax = maxFor("fiveDay")
  const twentyDayMax = maxFor("twentyDay")

  return (
    <div data-institutional-flow-persistence className="overflow-x-auto rounded-xl border border-white/[0.07] bg-[#07131d]/70" role="table" aria-label="Institutional flow persistence · Khối ngoại · Tự doanh · Khác · Today · 5D · 20D · Chưa đủ dữ liệu khi window thiếu observation">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-[minmax(92px,1.15fr)_repeat(3,minmax(88px,1fr))_minmax(132px,1.35fr)] border-b border-white/[0.07] bg-black/10 px-2 text-[10px] font-black uppercase tracking-[0.12em] text-slate-400" role="row">
          <span className="px-2 py-2.5">Nhóm</span>
          <span className="px-2 py-2.5">Today</span>
          <span className="px-2 py-2.5">5D</span>
          <span className="px-2 py-2.5">20D</span>
          <span className="px-2 py-2.5">Xu hướng</span>
        </div>
        {context.rows.map((row) => (
          <div key={row.key} className="grid grid-cols-[minmax(92px,1.15fr)_repeat(3,minmax(88px,1fr))_minmax(132px,1.35fr)] items-center border-b border-white/[0.05] px-2 last:border-b-0" role="row">
            <strong className="px-2 py-2.5 text-xs font-bold text-white">{row.label}</strong>
            <FlowPersistenceValue value={row.today} maxAbs={todayMax} />
            <FlowPersistenceValue value={row.fiveDay} maxAbs={fiveDayMax} />
            <FlowPersistenceValue value={row.twentyDay} maxAbs={twentyDayMax} />
            <div className="px-2 py-2.5">
              <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-bold ${flowStateClass(row)}`}>
                {flowStateLabel(row)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const sectorConfig = {
  change: { label: "Biến động TB (%)", color: POSITIVE },
} satisfies ChartConfig

export function SectorPerformanceChart({ sectors }: { sectors: MarketSectorRow[] }) {
  const data = [...sectors]
    .filter((item) => item.timeWindow === "1d" && item.averageChangePct != null)
    .sort((a, b) => (b.averageChangePct ?? 0) - (a.averageChangePct ?? 0))
    .slice(0, 12)
    .map((item) => ({ name: item.displayName, change: item.averageChangePct }))

  if (!data.length) return <EmptyChart message="Chưa có hiệu suất ngành hợp lệ." />

  return (
    <ChartContainer config={sectorConfig} className="h-[310px] w-full" initialDimension={{ width: 680, height: 310 }}>
      <BarChart accessibilityLayer data={data} layout="vertical" margin={{ left: 18, right: 12 }}>
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: AXIS, fontSize: 10 }} tickFormatter={(value) => `${value}%`} />
        <YAxis dataKey="name" type="category" width={112} axisLine={false} tickLine={false} tick={{ fill: AXIS, fontSize: 10 }} />
        <ReferenceLine x={0} stroke="rgba(148,163,184,.38)" />
        <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
        <Bar dataKey="change" radius={[0, 6, 6, 0]}>
          {data.map((item) => <Cell key={item.name} fill={(item.change ?? 0) >= 0 ? POSITIVE : NEGATIVE} />)}
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}

export function SectorBreadthChart({ sectors }: { sectors: MarketSectorRow[] }) {
  const data = [...sectors]
    .filter((item) => item.timeWindow === "1d")
    .sort((a, b) => (b.advances + b.declines) - (a.advances + a.declines))
    .slice(0, 10)
    .map((item) => ({ name: item.displayName, advances: item.advances, unchanged: item.unchanged, declines: item.declines }))

  if (!data.length) return <EmptyChart message="Chưa có breadth ngành hợp lệ." />

  return (
    <ChartContainer config={breadthConfig} className="h-[310px] w-full" initialDimension={{ width: 680, height: 310 }}>
      <BarChart accessibilityLayer data={data} layout="vertical" margin={{ left: 18, right: 12 }}>
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" hide />
        <YAxis dataKey="name" type="category" width={112} axisLine={false} tickLine={false} tick={{ fill: AXIS, fontSize: 10 }} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="advances" stackId="sector" fill="var(--color-advances)" radius={[5, 0, 0, 5]} />
        <Bar dataKey="unchanged" stackId="sector" fill="var(--color-unchanged)" />
        <Bar dataKey="declines" stackId="sector" fill="var(--color-declines)" radius={[0, 5, 5, 0]} />
      </BarChart>
    </ChartContainer>
  )
}

const leaderConfig = {
  volume: { label: "Khối lượng", color: ACCENT },
} satisfies ChartConfig

export function LiquidityLeadersChart({ leaders }: { leaders: MarketLeaderItem[] }) {
  const data = leaders
    .filter((item) => item.category === "top_volume" && item.metricValue != null)
    .slice(0, 12)
    .reverse()
    .map((item) => ({ ticker: item.ticker, volume: item.metricValue }))

  if (!data.length) return <EmptyChart message="Chưa có dữ liệu thanh khoản cổ phiếu." />

  return (
    <ChartContainer config={leaderConfig} className="h-[300px] w-full" initialDimension={{ width: 560, height: 300 }}>
      <BarChart accessibilityLayer data={data} layout="vertical" margin={{ left: 2, right: 12 }}>
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: AXIS, fontSize: 10 }} tickFormatter={(value) => `${Math.round(value / 1_000_000)}M`} />
        <YAxis dataKey="ticker" type="category" width={52} axisLine={false} tickLine={false} tick={{ fill: AXIS, fontSize: 11, fontWeight: 800 }} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
        <Bar dataKey="volume" fill="var(--color-volume)" radius={[0, 6, 6, 0]} />
      </BarChart>
    </ChartContainer>
  )
}

const impactConfig = {
  impact: { label: "Tác động (điểm)", color: ACCENT },
} satisfies ChartConfig

export function IndexImpactChart({ leaders }: { leaders: MarketLeaderItem[] }) {
  const data = leaders
    .filter((item) => (item.category === "index_up" || item.category === "index_down") && item.estimatedIndexPoints != null)
    .sort((left, right) => (right.estimatedIndexPoints ?? 0) - (left.estimatedIndexPoints ?? 0))
    .map((item) => ({ ticker: item.ticker, impact: item.estimatedIndexPoints }))

  if (!data.length) return <EmptyChart message="Chưa có dữ liệu đóng góp chỉ số." />

  return (
    <ChartContainer config={impactConfig} className="h-[300px] w-full" initialDimension={{ width: 560, height: 300 }}>
      <BarChart accessibilityLayer data={data} layout="vertical" margin={{ left: 2, right: 12 }}>
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: AXIS, fontSize: 10 }} />
        <YAxis dataKey="ticker" type="category" width={52} axisLine={false} tickLine={false} tick={{ fill: AXIS, fontSize: 11, fontWeight: 800 }} />
        <ReferenceLine x={0} stroke="rgba(148,163,184,.38)" />
        <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
        <Bar dataKey="impact" radius={[0, 5, 5, 0]}>
          {data.map((item) => <Cell key={item.ticker} fill={(item.impact ?? 0) >= 0 ? POSITIVE : NEGATIVE} />)}
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}

const historyConfig = {
  sentimentScore: { label: "Tâm lý", color: ACCENT },
  riskScore: { label: "Rủi ro", color: NEGATIVE },
  aboveMa20Pct: { label: "Trên MA20", color: POSITIVE },
} satisfies ChartConfig

function shortDate(value: string) {
  const parts = value.split("-")
  return parts.length === 3 ? `${parts[2]}/${parts[1]}` : value
}

export function MarketHistoryChart({ history }: { history: MarketHistoryPoint[] }) {
  if (!history.length) return <EmptyChart message="Lịch sử sẽ được tích lũy sau mỗi phiên đóng cửa." />

  return (
    <ChartContainer config={historyConfig} className="h-[280px] w-full" initialDimension={{ width: 720, height: 280 }}>
      <AreaChart accessibilityLayer data={history} margin={{ top: 10, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="sessionDate" axisLine={false} tickLine={false} tick={{ fill: AXIS, fontSize: 10 }} tickFormatter={shortDate} />
        <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fill: AXIS, fontSize: 10 }} />
        <ReferenceLine y={50} stroke="rgba(148,163,184,.45)" strokeDasharray="4 5" />
        <ChartTooltip content={<ChartTooltipContent indicator="line" labelFormatter={(value) => shortDate(String(value))} />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Area dataKey="sentimentScore" type="monotone" fill="var(--color-sentimentScore)" fillOpacity={0.08} stroke="var(--color-sentimentScore)" strokeWidth={2.2} connectNulls />
        <Line dataKey="riskScore" type="monotone" stroke="var(--color-riskScore)" strokeWidth={2} dot={false} connectNulls />
        <Line dataKey="aboveMa20Pct" type="monotone" stroke="var(--color-aboveMa20Pct)" strokeWidth={2} dot={false} connectNulls />
      </AreaChart>
    </ChartContainer>
  )
}

const historyFlowConfig = {
  foreignNetValue: { label: "Khối ngoại", color: ACCENT },
  proprietaryNetValue: { label: "Tự doanh", color: NEUTRAL },
} satisfies ChartConfig

export function MarketHistoryFlowChart({ history }: { history: MarketHistoryPoint[] }) {
  if (!history.length) return <EmptyChart message="Chưa có lịch sử dòng tiền." />

  return (
    <ChartContainer config={historyFlowConfig} className="h-[280px] w-full" initialDimension={{ width: 720, height: 280 }}>
      <BarChart accessibilityLayer data={history} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="sessionDate" axisLine={false} tickLine={false} tick={{ fill: AXIS, fontSize: 10 }} tickFormatter={shortDate} />
        <YAxis axisLine={false} tickLine={false} tick={{ fill: AXIS, fontSize: 10 }} />
        <ReferenceLine y={0} stroke="rgba(148,163,184,.38)" />
        <ChartTooltip content={<ChartTooltipContent indicator="line" labelFormatter={(value) => shortDate(String(value))} />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="foreignNetValue" fill="var(--color-foreignNetValue)" radius={[4, 4, 0, 0]} />
        <Bar dataKey="proprietaryNetValue" fill="var(--color-proprietaryNetValue)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  )
}

function EmptyChart({ message }: { message: string }) {
  return <div className="flex h-[250px] items-center justify-center rounded-xl border border-dashed border-border/60 text-sm text-muted-foreground">{message}</div>
}
