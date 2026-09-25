"use client"

import { useId } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
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
import { cn } from "@/modules/shared/ui/cn"

export type StockChartDatum = {
  label: string
  value: number | null
}

export type StockRadarDatum = {
  metric: string
  [key: string]: string | number | null
}

export type StockRadarSeries = {
  key: string
  label: string
  color: string
  strokeDasharray?: string
  fillOpacity?: number
}

const GRID_STROKE = "rgba(148,163,184,0.16)"
const AXIS_STROKE = "rgba(148,163,184,0.72)"
const CURSOR_FILL = "rgba(148,163,184,0.07)"

function finiteValue(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function chartId(prefix: string, id: string) {
  return `${prefix}-${id.replace(/:/g, "")}`
}

export function StockChartCnSparkline({
  data,
  seriesLabel,
  color = "#a78bfa",
  className,
  formatValue,
}: {
  data: StockChartDatum[]
  seriesLabel: string
  color?: string
  className?: string
  formatValue?: (value: number) => string
}) {
  const id = useId()
  const config = {
    value: { label: seriesLabel, color },
  } satisfies ChartConfig
  const rows = data.map((item) => ({
    ...item,
    value: finiteValue(item.value),
    missing: item.value == null,
  }))

  return (
    <ChartContainer
      id={chartId("stock-sparkline", id)}
      config={config}
      initialDimension={{ width: 240, height: 72 }}
      className={cn("h-[72px] w-full aspect-auto", className)}
    >
      <LineChart accessibilityLayer data={rows} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
        <ChartTooltip
          cursor={{ stroke: GRID_STROKE, strokeDasharray: "3 5" }}
          content={
            <ChartTooltipContent
              indicator="dot"
              labelFormatter={(label) => String(label ?? "")}
              formatter={(value, _name, item) => {
                const row = item.payload as { missing?: boolean }
                const numeric = Number(value)
                return (
                  <div className="flex min-w-28 items-center justify-between gap-4">
                    <span className="text-muted-foreground">{seriesLabel}</span>
                    <strong className="font-mono text-foreground tabular-nums">
                      {row.missing || !Number.isFinite(numeric)
                        ? "—"
                        : formatValue
                          ? formatValue(numeric)
                          : numeric.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}
                    </strong>
                  </div>
                )
              }}
            />
          }
        />
        <Line
          type="monotone"
          dataKey="value"
          stroke="var(--color-value)"
          strokeWidth={2.5}
          dot={{ r: 2.5, fill: "var(--color-value)", stroke: "#07111f", strokeWidth: 1.5 }}
          activeDot={{ r: 4.5, fill: "var(--color-value)", stroke: "#f8fafc", strokeWidth: 1.5 }}
          connectNulls
        />
        <XAxis dataKey="label" hide />
        <YAxis hide domain={["dataMin - 2", "dataMax + 2"]} />
      </LineChart>
    </ChartContainer>
  )
}

export function StockChartCnSignedBars({
  data,
  seriesLabel,
  positiveColor = "#34d399",
  negativeColor = "#fb7185",
  className,
  height = 250,
  formatValue,
}: {
  data: StockChartDatum[]
  seriesLabel: string
  positiveColor?: string
  negativeColor?: string
  className?: string
  height?: number
  formatValue?: (value: number | null) => string
}) {
  const id = useId()
  const normalizedId = chartId("stock-signed-bars", id)
  const maxAbs = Math.max(1, ...data.map((item) => Math.abs(item.value ?? 0)))
  const config = {
    value: { label: seriesLabel, color: positiveColor },
  } satisfies ChartConfig
  const rows = data.map((item) => ({
    ...item,
    value: finiteValue(item.value),
    missing: item.value == null,
  }))

  return (
    <ChartContainer
      id={normalizedId}
      config={config}
      initialDimension={{ width: 480, height }}
      className={cn("w-full aspect-auto", className)}
      style={{ height }}
    >
      <BarChart
        accessibilityLayer
        data={rows}
        layout="vertical"
        margin={{ top: 8, right: 14, bottom: 4, left: 4 }}
        barCategoryGap="30%"
      >
        <defs>
          <linearGradient id={`${normalizedId}-positive`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={positiveColor} stopOpacity={0.55} />
            <stop offset="100%" stopColor={positiveColor} stopOpacity={1} />
          </linearGradient>
          <linearGradient id={`${normalizedId}-negative`} x1="1" y1="0" x2="0" y2="0">
            <stop offset="0%" stopColor={negativeColor} stopOpacity={0.55} />
            <stop offset="100%" stopColor={negativeColor} stopOpacity={1} />
          </linearGradient>
        </defs>
        <CartesianGrid horizontal={false} stroke={GRID_STROKE} strokeDasharray="3 5" />
        <XAxis
          type="number"
          domain={[-maxAbs, maxAbs]}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tick={{ fill: AXIS_STROKE, fontSize: 10 }}
          tickFormatter={(value: number) => `${value > 0 ? "+" : ""}${Math.round(value)}`}
        />
        <YAxis
          type="category"
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={58}
          tick={{ fill: AXIS_STROKE, fontSize: 11, fontWeight: 700 }}
        />
        <ReferenceLine x={0} stroke="rgba(226,232,240,0.28)" strokeDasharray="3 4" />
        <ChartTooltip
          cursor={{ fill: CURSOR_FILL }}
          content={
            <ChartTooltipContent
              indicator="dot"
              formatter={(value, _name, item) => {
                const row = item.payload as { missing?: boolean; label?: string }
                const numeric = Number(value)
                const actual = row.missing || !Number.isFinite(numeric) ? null : numeric
                return (
                  <div className="flex min-w-36 items-center justify-between gap-4">
                    <span className="text-muted-foreground">{row.label || seriesLabel}</span>
                    <strong className={cn("font-mono tabular-nums", actual == null ? "text-muted-foreground" : actual >= 0 ? "text-emerald-300" : "text-rose-300")}>
                      {formatValue ? formatValue(actual) : actual == null ? "—" : actual.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}
                    </strong>
                  </div>
                )
              }}
            />
          }
        />
        <Bar dataKey="value" radius={[6, 6, 6, 6]} maxBarSize={24}>
          {rows.map((item, index) => (
            <Cell
              key={`${item.label}-${index}`}
              fill={item.value >= 0 ? `url(#${normalizedId}-positive)` : `url(#${normalizedId}-negative)`}
              fillOpacity={item.missing ? 0.2 : 1}
            />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}

export function StockChartCnBars({
  data,
  seriesLabel,
  color = "#22d3ee",
  className,
  height = 220,
  formatValue,
}: {
  data: StockChartDatum[]
  seriesLabel: string
  color?: string
  className?: string
  height?: number
  formatValue?: (value: number | null) => string
}) {
  const id = useId()
  const normalizedId = chartId("stock-bars", id)
  const config = {
    value: { label: seriesLabel, color },
  } satisfies ChartConfig
  const rows = data.map((item) => ({
    ...item,
    value: finiteValue(item.value),
    missing: item.value == null,
  }))

  return (
    <ChartContainer
      id={normalizedId}
      config={config}
      initialDimension={{ width: 480, height }}
      className={cn("w-full aspect-auto", className)}
      style={{ height }}
    >
      <BarChart
        accessibilityLayer
        data={rows}
        layout="vertical"
        margin={{ top: 8, right: 14, bottom: 4, left: 4 }}
        barCategoryGap="30%"
      >
        <defs>
          <linearGradient id={`${normalizedId}-fill`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={color} stopOpacity={0.5} />
            <stop offset="100%" stopColor={color} stopOpacity={1} />
          </linearGradient>
        </defs>
        <CartesianGrid horizontal={false} stroke={GRID_STROKE} strokeDasharray="3 5" />
        <XAxis
          type="number"
          domain={[0, "dataMax"]}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tick={{ fill: AXIS_STROKE, fontSize: 10 }}
          tickFormatter={(value: number) => new Intl.NumberFormat("vi-VN", { notation: "compact", maximumFractionDigits: 1 }).format(value)}
        />
        <YAxis
          type="category"
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={66}
          tick={{ fill: AXIS_STROKE, fontSize: 11, fontWeight: 700 }}
        />
        <ChartTooltip
          cursor={{ fill: CURSOR_FILL }}
          content={
            <ChartTooltipContent
              indicator="dot"
              formatter={(value, _name, item) => {
                const row = item.payload as { missing?: boolean; label?: string }
                const numeric = Number(value)
                const actual = row.missing || !Number.isFinite(numeric) ? null : numeric
                return (
                  <div className="flex min-w-40 items-center justify-between gap-4">
                    <span className="text-muted-foreground">{row.label || seriesLabel}</span>
                    <strong className="font-mono text-foreground tabular-nums">
                      {formatValue ? formatValue(actual) : actual == null ? "—" : actual.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}
                    </strong>
                  </div>
                )
              }}
            />
          }
        />
        <Bar dataKey="value" fill={`url(#${normalizedId}-fill)`} radius={[0, 8, 8, 0]} maxBarSize={24}>
          {rows.map((item, index) => (
            <Cell key={`${item.label}-${index}`} fillOpacity={item.missing ? 0.2 : 1} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}

export function StockChartCnRadar({
  data,
  series,
  className,
  height = 310,
}: {
  data: StockRadarDatum[]
  series: StockRadarSeries[]
  className?: string
  height?: number
}) {
  const id = useId()
  const config = Object.fromEntries(
    series.map((item) => [item.key, { label: item.label, color: item.color }]),
  ) satisfies ChartConfig

  return (
    <ChartContainer
      id={chartId("stock-radar", id)}
      config={config}
      initialDimension={{ width: 420, height }}
      className={cn("mx-auto w-full aspect-auto", className)}
      style={{ height }}
    >
      <RadarChart accessibilityLayer data={data} outerRadius="68%">
        <PolarGrid gridType="polygon" stroke={GRID_STROKE} />
        <PolarAngleAxis
          dataKey="metric"
          tick={{ fill: AXIS_STROKE, fontSize: 10, fontWeight: 700 }}
        />
        <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
        <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
        {series.map((item) => (
          <Radar
            key={item.key}
            dataKey={item.key}
            fill={`var(--color-${item.key})`}
            fillOpacity={item.fillOpacity ?? 0.04}
            stroke={`var(--color-${item.key})`}
            strokeWidth={item.key === "current" ? 2.5 : 1.5}
            strokeDasharray={item.strokeDasharray}
            dot={item.key === "current" ? { r: 2.5, fill: item.color, stroke: "#07111f", strokeWidth: 1.25 } : false}
          />
        ))}
        <ChartLegend content={<ChartLegendContent />} />
      </RadarChart>
    </ChartContainer>
  )
}
