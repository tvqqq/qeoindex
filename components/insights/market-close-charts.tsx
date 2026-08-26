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
} from "@/lib/market-insight-data"

const GRID = "rgba(148,163,184,0.10)"
const AXIS = "rgba(148,163,184,0.62)"

const breadthConfig = {
  advances: { label: "Tăng", color: "#22c98a" },
  unchanged: { label: "Đứng giá", color: "#f4b84b" },
  declines: { label: "Giảm", color: "#ff5b6e" },
} satisfies ChartConfig

export function IndexBreadthChart({ indexes }: { indexes: MarketIndexCard[] }) {
  const data = indexes.map((item) => ({
    name: item.indexCode,
    advances: item.advances,
    unchanged: item.unchanged,
    declines: item.declines,
  }))

  return (
    <ChartContainer config={breadthConfig} className="h-[260px] w-full" initialDimension={{ width: 720, height: 260 }}>
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
  changePct: { label: "Biến động", color: "#22c98a" },
  tradedValue: { label: "GTGD (tỷ)", color: "#38bdf8" },
} satisfies ChartConfig

export function IndexPerformanceChart({ indexes }: { indexes: MarketIndexCard[] }) {
  const data = indexes.map((item) => ({
    name: item.indexCode,
    changePct: item.changePct,
    tradedValue: item.tradedValue,
  }))

  return (
    <ChartContainer config={indexConfig} className="h-[260px] w-full" initialDimension={{ width: 720, height: 260 }}>
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
  value: { label: "Tỷ lệ cổ phiếu trên MA", color: "#22c98a" },
} satisfies ChartConfig

export function MaBreadthChart({ daily }: { daily: MarketCloseDashboardData["dailySummary"] }) {
  const data = [
    { name: "MA10", value: daily.aboveMa10Pct },
    { name: "MA20", value: daily.aboveMa20Pct },
    { name: "MA50", value: daily.aboveMa50Pct },
    { name: "MA200", value: daily.aboveMa200Pct },
  ]

  return (
    <ChartContainer config={maConfig} className="h-[250px] w-full" initialDimension={{ width: 720, height: 250 }}>
      <BarChart accessibilityLayer data={data} margin={{ top: 8, right: 6, left: -18, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: AXIS, fontSize: 11, fontWeight: 700 }} />
        <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fill: AXIS, fontSize: 10 }} tickFormatter={(value) => `${value}%`} />
        <ReferenceLine y={50} stroke="rgba(244,184,75,.5)" strokeDasharray="4 5" />
        <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
        <Bar dataKey="value" radius={[7, 7, 0, 0]}>
          {data.map((item) => <Cell key={item.name} fill={(item.value ?? 0) >= 50 ? "#22c98a" : "#f4b84b"} />)}
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}

const flowConfig = {
  value: { label: "Giá trị ròng (tỷ)", color: "#38bdf8" },
} satisfies ChartConfig

export function InstitutionalFlowChart({ daily }: { daily: MarketCloseDashboardData["dailySummary"] }) {
  const data = [
    { name: "Khối ngoại", value: daily.foreignNetValue },
    { name: "Tự doanh", value: daily.proprietaryNetValue },
    { name: "Khác", value: daily.otherFlowNetValue },
  ].filter((item) => item.value != null)

  if (!data.length) return <EmptyChart message="Chưa có dữ liệu dòng tiền tổ chức." />

  return (
    <ChartContainer config={flowConfig} className="h-[250px] w-full" initialDimension={{ width: 720, height: 250 }}>
      <BarChart accessibilityLayer data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: AXIS, fontSize: 11, fontWeight: 700 }} />
        <YAxis axisLine={false} tickLine={false} tick={{ fill: AXIS, fontSize: 10 }} />
        <ReferenceLine y={0} stroke="rgba(148,163,184,.38)" />
        <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
        <Bar dataKey="value" radius={[7, 7, 3, 3]}>
          {data.map((item) => <Cell key={item.name} fill={(item.value ?? 0) >= 0 ? "#22c98a" : "#ff5b6e"} />)}
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}

const sectorConfig = {
  change: { label: "Biến động TB (%)", color: "#22c98a" },
} satisfies ChartConfig

export function SectorPerformanceChart({ sectors }: { sectors: MarketSectorRow[] }) {
  const data = [...sectors]
    .filter((item) => item.timeWindow === "1d" && item.averageChangePct != null)
    .sort((a, b) => (b.averageChangePct ?? 0) - (a.averageChangePct ?? 0))
    .slice(0, 12)
    .map((item) => ({ name: item.displayName, change: item.averageChangePct }))

  if (!data.length) return <EmptyChart message="Chưa có hiệu suất ngành hợp lệ." />

  return (
    <ChartContainer config={sectorConfig} className="h-[390px] w-full" initialDimension={{ width: 760, height: 390 }}>
      <BarChart accessibilityLayer data={data} layout="vertical" margin={{ left: 18, right: 12 }}>
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: AXIS, fontSize: 10 }} tickFormatter={(value) => `${value}%`} />
        <YAxis dataKey="name" type="category" width={112} axisLine={false} tickLine={false} tick={{ fill: AXIS, fontSize: 10 }} />
        <ReferenceLine x={0} stroke="rgba(148,163,184,.38)" />
        <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
        <Bar dataKey="change" radius={[0, 6, 6, 0]}>
          {data.map((item) => <Cell key={item.name} fill={(item.change ?? 0) >= 0 ? "#22c98a" : "#ff5b6e"} />)}
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
    <ChartContainer config={breadthConfig} className="h-[390px] w-full" initialDimension={{ width: 760, height: 390 }}>
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
  volume: { label: "Khối lượng", color: "#38bdf8" },
} satisfies ChartConfig

export function LiquidityLeadersChart({ leaders }: { leaders: MarketLeaderItem[] }) {
  const data = leaders
    .filter((item) => item.category === "top_volume" && item.metricValue != null)
    .slice(0, 12)
    .reverse()
    .map((item) => ({ ticker: item.ticker, volume: item.metricValue }))

  if (!data.length) return <EmptyChart message="Chưa có dữ liệu thanh khoản cổ phiếu." />

  return (
    <ChartContainer config={leaderConfig} className="h-[360px] w-full" initialDimension={{ width: 760, height: 360 }}>
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

const historyConfig = {
  sentimentScore: { label: "Tâm lý", color: "#38bdf8" },
  riskScore: { label: "Rủi ro", color: "#ff5b6e" },
  aboveMa20Pct: { label: "Trên MA20", color: "#22c98a" },
} satisfies ChartConfig

function shortDate(value: string) {
  const parts = value.split("-")
  return parts.length === 3 ? `${parts[2]}/${parts[1]}` : value
}

export function MarketHistoryChart({ history }: { history: MarketHistoryPoint[] }) {
  if (!history.length) return <EmptyChart message="Lịch sử sẽ được tích lũy sau mỗi phiên đóng cửa." />

  return (
    <ChartContainer config={historyConfig} className="h-[330px] w-full" initialDimension={{ width: 980, height: 330 }}>
      <AreaChart accessibilityLayer data={history} margin={{ top: 10, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="sentiment-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-sentimentScore)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--color-sentimentScore)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="sessionDate" axisLine={false} tickLine={false} tick={{ fill: AXIS, fontSize: 10 }} tickFormatter={shortDate} />
        <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fill: AXIS, fontSize: 10 }} />
        <ReferenceLine y={50} stroke="rgba(244,184,75,.45)" strokeDasharray="4 5" />
        <ChartTooltip content={<ChartTooltipContent indicator="line" labelFormatter={(value) => shortDate(String(value))} />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Area dataKey="sentimentScore" type="monotone" fill="url(#sentiment-fill)" stroke="var(--color-sentimentScore)" strokeWidth={2.4} connectNulls />
        <Line dataKey="riskScore" type="monotone" stroke="var(--color-riskScore)" strokeWidth={2} dot={false} connectNulls />
        <Line dataKey="aboveMa20Pct" type="monotone" stroke="var(--color-aboveMa20Pct)" strokeWidth={2} dot={false} connectNulls />
      </AreaChart>
    </ChartContainer>
  )
}

const historyFlowConfig = {
  foreignNetValue: { label: "Khối ngoại", color: "#38bdf8" },
  proprietaryNetValue: { label: "Tự doanh", color: "#a78bfa" },
} satisfies ChartConfig

export function MarketHistoryFlowChart({ history }: { history: MarketHistoryPoint[] }) {
  if (!history.length) return <EmptyChart message="Chưa có lịch sử dòng tiền." />

  return (
    <ChartContainer config={historyFlowConfig} className="h-[300px] w-full" initialDimension={{ width: 980, height: 300 }}>
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
