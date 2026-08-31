"use client"

import { useEffect, useState } from "react"
import { Bolt, Info, LoaderCircle, Radar, RefreshCw, Target, Zap } from "lucide-react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ComposedChart,
  Line,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar as RechartsRadar,
  RadarChart,
  ReferenceArea,
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { InsightsRatingRow } from "@/lib/insights-data"
import { cn } from "@/lib/utils"

type DailyHistoryPoint = {
  asOfDate: string
  stockRs: number | null
  sectorRs: number | null
  rsMedium: number | null
  stockRrgState: string | null
  sectorRrgState: string | null
}

type QuarterlyHistoryPoint = {
  period: string
  year: number
  quarter: number
  fourmScore: number | null
  canslimScore: number | null
  fourmComponents: Record<string, number>
  canslimComponents: Record<string, number>
  fetchedAt: string
}

type HistoryPayload = {
  ok: boolean
  ticker: string
  dailyHistory: DailyHistoryPoint[]
  quarterlyHistory: QuarterlyHistoryPoint[]
  quarterlyHistoryAvailable: boolean
}

const COMPONENT_HELP: Record<string, string> = {
  "%G Doanh thu": "Điểm thành phần KFSP cho tăng trưởng doanh thu. Response không công bố công thức chấm điểm chi tiết.",
  ROIC: "Điểm thành phần KFSP dựa trên hiệu quả vốn đầu tư (ROIC).",
  ROE: "Điểm thành phần KFSP dựa trên lợi nhuận trên vốn chủ sở hữu (ROE).",
  ROA: "Điểm thành phần KFSP dựa trên lợi nhuận trên tổng tài sản (ROA).",
  "Chất Lượng lợi nhuận": "Điểm chất lượng lợi nhuận do KFSP cung cấp; công thức chi tiết không có trong response.",
  "Biên lợi nhuận": "Điểm thành phần phản ánh biên lợi nhuận theo mô hình KFSP.",
  "Vòng quay tài sản": "Điểm thành phần phản ánh hiệu quả sử dụng tài sản.",
  "Nợ dài hạn": "Điểm thành phần đánh giá gánh nặng nợ dài hạn theo mô hình KFSP.",
  "%G OCF": "Điểm thành phần cho tăng trưởng dòng tiền từ hoạt động kinh doanh.",
  "%G BVPS": "Điểm thành phần cho tăng trưởng giá trị sổ sách trên mỗi cổ phiếu.",
  "%G EPS": "Điểm thành phần cho tăng trưởng lợi nhuận trên mỗi cổ phiếu.",
  "%G Doanh thu Q": "Điểm KFSP cho tăng trưởng doanh thu quý hiện tại.",
  "ROE TTM-1": "Điểm ROE trailing twelve months ở kỳ so sánh trước.",
  "ROE TTM": "Điểm ROE trailing twelve months hiện tại.",
  "%G EPS TTM-1": "Điểm tăng trưởng EPS TTM ở kỳ so sánh trước.",
  "%G EPS TTM": "Điểm tăng trưởng EPS TTM hiện tại.",
  "%G EPS Q-1": "Điểm tăng trưởng EPS quý ở kỳ so sánh trước.",
  "%G EPS Q": "Điểm tăng trưởng EPS quý hiện tại.",
  "%G Doanh thu TTM-1": "Điểm tăng trưởng doanh thu TTM ở kỳ so sánh trước.",
  "%G Doanh thu TTM": "Điểm tăng trưởng doanh thu TTM hiện tại.",
  "%G Doanh thu Q-1": "Điểm tăng trưởng doanh thu quý ở kỳ so sánh trước.",
}

const RRG_STATE = {
  "Phục hồi": { x: 25, y: 75, label: "PHỤC HỒI", fill: "rgba(67,56,202,.14)", stroke: "#818cf8" },
  "Dẫn dắt": { x: 75, y: 75, label: "DẪN DẮT", fill: "rgba(34,197,94,.12)", stroke: "#34d399" },
  "Đội sổ": { x: 25, y: 25, label: "ĐỘI SỔ", fill: "rgba(244,63,94,.12)", stroke: "#fb7185" },
  "Suy yếu": { x: 75, y: 25, label: "SUY YẾU", fill: "rgba(245,158,11,.12)", stroke: "#fbbf24" },
} as const

type RrgStateName = keyof typeof RRG_STATE

function formatScore(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "—" : value.toLocaleString("vi-VN", { maximumFractionDigits: 2 })
}

function EmptyChart({ label }: { label: string }) {
  return <div className="flex min-h-48 items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/[0.015] px-5 text-center text-sm font-semibold text-muted-2">{label}</div>
}

function RrgHistoryChart({ title, history, stateKey }: { title: string; history: DailyHistoryPoint[]; stateKey: "stockRrgState" | "sectorRrgState" }) {
  const points = history.slice(-20).flatMap((item, index) => {
    const state = item[stateKey] as RrgStateName | null
    const definition = state ? RRG_STATE[state] : null
    if (!definition) return []
    const wobble = ((index % 5) - 2) * 1.6
    return [{ date: item.asOfDate, state, x: definition.x + wobble, y: definition.y + wobble * 0.65 }]
  })
  if (!points.length) return <EmptyChart label={`Chưa có lịch sử ${title}.`} />

  const chartConfig = {
    state: { label: title, color: "#a78bfa" },
  } satisfies ChartConfig

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-[#07111f] p-4 sm:p-5 font-ticker">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.06] pb-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-violet-500/20 bg-violet-500/10">
            <Radar className="size-4 text-violet-300" />
          </span>
          <div className="min-w-0">
            <h4 className="text-base font-extrabold text-white">{title}</h4>
            <p className="mt-0.5 text-xs text-muted-2">Lịch sử chuyển dịch góc phần tư RRG (Dẫn dắt, Suy yếu, Đội sổ, Phục hồi).</p>
          </div>
        </div>
      </div>
      <ChartContainer config={chartConfig} className="h-[330px] w-full aspect-auto">
        <ComposedChart accessibilityLayer data={points} margin={{ top: 12, right: 12, bottom: 12, left: 12 }}>
          <XAxis type="number" dataKey="x" domain={[0, 100]} hide />
          <YAxis type="number" dataKey="y" domain={[0, 100]} hide />
          <ReferenceArea x1={0} x2={50} y1={50} y2={100} fill={RRG_STATE["Phục hồi"].fill} fillOpacity={1} label={{ value: "PHỤC HỒI", position: "insideTopLeft", fill: RRG_STATE["Phục hồi"].stroke, fontWeight: 800, fontSize: 11 }} />
          <ReferenceArea x1={50} x2={100} y1={50} y2={100} fill={RRG_STATE["Dẫn dắt"].fill} fillOpacity={1} label={{ value: "DẪN DẮT", position: "insideTopRight", fill: RRG_STATE["Dẫn dắt"].stroke, fontWeight: 800, fontSize: 11 }} />
          <ReferenceArea x1={0} x2={50} y1={0} y2={50} fill={RRG_STATE["Đội sổ"].fill} fillOpacity={1} label={{ value: "ĐỘI SỔ", position: "insideBottomLeft", fill: RRG_STATE["Đội sổ"].stroke, fontWeight: 800, fontSize: 11 }} />
          <ReferenceArea x1={50} x2={100} y1={0} y2={50} fill={RRG_STATE["Suy yếu"].fill} fillOpacity={1} label={{ value: "SUY YẾU", position: "insideBottomRight", fill: RRG_STATE["Suy yếu"].stroke, fontWeight: 800, fontSize: 11 }} />
          <ReferenceLine x={50} stroke="rgba(226,232,240,.36)" strokeDasharray="4 4" />
          <ReferenceLine y={50} stroke="rgba(226,232,240,.36)" strokeDasharray="4 4" />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                hideLabel
                indicator="line"
                formatter={(_value, _name, item) => {
                  const point = item.payload as { date?: string; state?: string }
                  return (
                    <div className="grid min-w-44 gap-1">
                      <span className="font-semibold text-white">{point.date || "—"}</span>
                      <span className="text-muted-foreground">Trạng thái <strong className="text-violet-200">{point.state || "—"}</strong></span>
                    </div>
                  )
                }}
              />
            }
          />
          <Line type="monotone" dataKey="y" stroke="var(--color-state)" strokeWidth={2.25} dot={{ r: 3, fill: "#93c5fd", strokeWidth: 0 }} activeDot={{ r: 5, fill: "#6ee7b7", stroke: "#07111f", strokeWidth: 2 }} />
        </ComposedChart>
      </ChartContainer>
      <p className="mt-2 text-[11px] leading-5 text-muted-2 font-ticker">Biểu đồ chỉ thể hiện lịch sử <strong className="text-slate-300">trạng thái quadrant</strong>. KFSP snapshot hiện không cung cấp tọa độ RRG gốc nên QeoIndex không tự suy diễn RS-Ratio/RS-Momentum.</p>
    </div>
  )
}

function RsHistoryChart({ history }: { history: DailyHistoryPoint[] }) {
  const source = history.slice(-90)
  const data = source.map((item) => ({ date: item.asOfDate, stock: item.stockRs, sector: item.sectorRs }))
  if (!data.some((item) => item.stock != null || item.sector != null)) return <EmptyChart label="Chưa có lịch sử RS-S cổ phiếu/ngành." />

  const chartConfig = {
    stock: { label: "RS-S cổ phiếu", color: "#22d3ee" },
    sector: { label: "RS-S ngành", color: "#a78bfa" },
  } satisfies ChartConfig

  return (
    <div className="rounded-2xl border border-cyan-300/10 bg-[#07111f] p-4 sm:p-5 font-ticker">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.06] pb-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-cyan-500/20 bg-cyan-500/10">
            <Zap className="size-4 text-cyan-300" />
          </span>
          <div className="min-w-0">
            <h4 className="text-base font-extrabold text-white">RS-S cổ phiếu vs RS-S ngành</h4>
            <p className="mt-0.5 text-xs text-muted-2">Lịch sử tương quan sức mạnh giá tối đa 90 snapshot daily từ Supabase.</p>
          </div>
        </div>
      </div>
      <ChartContainer config={chartConfig} className="mt-4 h-[280px] w-full aspect-auto">
        <AreaChart accessibilityLayer data={data} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={10} minTickGap={28} tickFormatter={(value) => String(value).slice(5)} />
          <YAxis domain={[0, 100]} tickLine={false} axisLine={false} tickMargin={8} width={30} />
          <ChartTooltip cursor={{ stroke: "rgba(148,163,184,.24)", strokeDasharray: "4 4" }} content={<ChartTooltipContent indicator="line" labelFormatter={(value) => String(value)} />} />
          <Area type="monotone" dataKey="stock" fill="var(--color-stock)" fillOpacity={0.12} stroke="var(--color-stock)" strokeWidth={2.25} connectNulls />
          <Area type="monotone" dataKey="sector" fill="var(--color-sector)" fillOpacity={0.07} stroke="var(--color-sector)" strokeWidth={2.25} connectNulls />
          <ChartLegend content={<ChartLegendContent />} />
        </AreaChart>
      </ChartContainer>
    </div>
  )
}

function ScoreHistoryChart({ title, history, scoreKey, fallbackScore, tone }: {
  title: string
  history: QuarterlyHistoryPoint[]
  scoreKey: "fourmScore" | "canslimScore"
  fallbackScore: number | null
  tone: "amber" | "emerald"
}) {
  const source = history.filter((item) => item[scoreKey] != null).slice(-12)
  const score = source.at(-1)?.[scoreKey] ?? fallbackScore
  const accent = tone === "amber" ? "#f59e0b" : "#22c55e"
  const data = source.map((item) => ({ period: item.period, score: item[scoreKey] }))
  const chartConfig = { score: { label: title, color: accent } } satisfies ChartConfig

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-[#07111f] p-4 sm:p-5 font-ticker">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.06] pb-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg border", tone === "amber" ? "border-amber-500/20 bg-amber-500/10" : "border-emerald-500/20 bg-emerald-500/10")}>
            {tone === "amber" ? <Bolt className="size-4 text-amber-300" /> : <Target className="size-4 text-emerald-300" />}
          </span>
          <div className="min-w-0">
            <h4 className="text-base font-extrabold text-white">{title}</h4>
            <p className="mt-0.5 text-xs text-muted-2">Lịch sử điểm số 0–100 do mô hình KFSP cung cấp theo từng quý.</p>
          </div>
        </div>
        <span className={cn("rounded-lg px-3 py-1 font-mono text-lg font-black", tone === "amber" ? "bg-amber-400/15 text-amber-300" : "bg-emerald-400/15 text-emerald-300")}>{formatScore(score)}</span>
      </div>
      <Tooltip>
        <TooltipTrigger render={<div className="mt-2 flex cursor-help items-center gap-2 text-xs font-bold text-muted-2" />}><Info className="size-3.5" /> Cách đọc điểm</TooltipTrigger>
        <TooltipContent className="w-80 max-w-sm border border-white/10 bg-[#090e19] p-3 text-xs leading-relaxed text-white shadow-2xl">Điểm và lịch sử lấy trực tiếp từ KFSP. Response cung cấp điểm 0–100 nhưng không công bố công thức trọng số đầy đủ; QeoIndex không tái tính điểm.</TooltipContent>
      </Tooltip>
      <div className="relative mt-4 h-3 overflow-hidden rounded-full"><div className="absolute inset-y-0 left-0 w-2/5 bg-rose-500" /><div className="absolute inset-y-0 left-[40%] w-1/5 bg-amber-400" /><div className="absolute inset-y-0 right-0 w-2/5 bg-emerald-500" />{score != null && <span className="absolute -top-1 h-5 w-1 rounded bg-white shadow-[0_0_10px_white]" style={{ left: `${Math.max(0, Math.min(100, score))}%` }} />}</div>
      {source.length >= 2 ? (
        <ChartContainer config={chartConfig} className="mt-4 h-[250px] w-full aspect-auto">
          <AreaChart accessibilityLayer data={data} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="period" tickLine={false} axisLine={false} tickMargin={10} minTickGap={14} />
            <YAxis domain={[0, 100]} tickLine={false} axisLine={false} tickMargin={8} width={30} />
            <ReferenceLine y={50} stroke="rgba(251,191,36,.24)" strokeDasharray="4 4" />
            <ChartTooltip cursor={{ stroke: "rgba(148,163,184,.24)", strokeDasharray: "4 4" }} content={<ChartTooltipContent indicator="line" labelFormatter={(value) => String(value)} />} />
            <Area type="natural" dataKey="score" fill="var(--color-score)" fillOpacity={0.16} stroke="var(--color-score)" strokeWidth={2.5} dot={{ r: 3, fill: accent, stroke: "#07111f", strokeWidth: 2 }} activeDot={{ r: 5, fill: accent, stroke: "#fff", strokeWidth: 1.5 }} />
          </AreaChart>
        </ChartContainer>
      ) : <EmptyChart label="Lịch sử quý sẽ xuất hiện sau khi TTAI history sync hoàn tất." />}
    </div>
  )
}

function componentShortLabel(label: string) {
  const aliases: Record<string, string> = {
    "Chất Lượng lợi nhuận": "CL lợi nhuận",
    "Vòng quay tài sản": "VQ tài sản",
    "%G Doanh thu TTM-1": "DT TTM-1",
    "%G Doanh thu TTM": "DT TTM",
    "%G Doanh thu Q-1": "DT Q-1",
    "%G Doanh thu Q": "DT Q",
    "%G EPS TTM-1": "EPS TTM-1",
    "%G EPS TTM": "EPS TTM",
    "%G EPS Q-1": "EPS Q-1",
    "%G EPS Q": "EPS Q",
  }
  return aliases[label] || label.replace("%G ", "")
}

function ComponentRadar({ title, components, tone }: { title: string; components: Record<string, number>; tone: "amber" | "emerald" }) {
  const entries = Object.entries(components).filter(([, value]) => Number.isFinite(value)).slice(0, 12)
  if (entries.length < 3) return <EmptyChart label={`Chưa có dữ liệu thành phần ${title}.`} />
  const accent = tone === "amber" ? "#f59e0b" : "#34d399"
  const data = entries.map(([label, score]) => ({ metric: componentShortLabel(label), fullLabel: label, score, help: COMPONENT_HELP[label] || "Điểm thành phần 0–100 do KFSP cung cấp; response không mô tả công thức chi tiết." }))
  const chartConfig = { score: { label: "Điểm", color: accent } } satisfies ChartConfig

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-[#07111f] p-4 sm:p-5 font-ticker">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.06] pb-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg border", tone === "amber" ? "border-amber-500/20 bg-amber-500/10" : "border-emerald-500/20 bg-emerald-500/10")}>
            <Radar className={cn("size-4", tone === "amber" ? "text-amber-300" : "text-emerald-300")} />
          </span>
          <div className="min-w-0">
            <h4 className="text-base font-extrabold text-white">{title}</h4>
            <p className="mt-0.5 text-xs text-muted-2">Radar phân bổ chi tiết các chỉ số thành phần của quý mới nhất.</p>
          </div>
        </div>
      </div>
      <ChartContainer config={chartConfig} className="mx-auto mt-3 h-[360px] w-full max-w-[560px] aspect-auto">
        <RadarChart accessibilityLayer data={data} outerRadius="72%">
          <PolarGrid gridType="polygon" stroke="rgba(203,213,225,.22)" />
          <PolarAngleAxis dataKey="metric" tick={{ fill: "#cbd5e1", fontSize: 10, fontWeight: 700 }} />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                hideLabel
                indicator="dot"
                formatter={(value, _name, item) => {
                  const point = item.payload as { fullLabel?: string; help?: string }
                  return (
                    <div className="grid max-w-72 gap-1">
                      <div className="flex items-center justify-between gap-4"><strong className="text-white">{point.fullLabel || "Chỉ số"}</strong><span className="font-mono font-black" style={{ color: accent }}>{formatScore(Number(value))}/100</span></div>
                      <span className="text-[11px] leading-4 text-muted-foreground">{point.help}</span>
                    </div>
                  )
                }}
              />
            }
          />
          <RechartsRadar dataKey="score" fill="var(--color-score)" fillOpacity={0.20} stroke="var(--color-score)" strokeWidth={2.25} dot={{ r: 3, fill: accent, stroke: "#fff", strokeWidth: 1 }} />
        </RadarChart>
      </ChartContainer>
      <div className="mt-3 flex flex-wrap gap-2">
        {entries.map(([label, value]) => (
          <Tooltip key={label}>
            <TooltipTrigger render={<span className="inline-flex cursor-help items-center gap-1 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] font-bold text-slate-300" />}>
              {componentShortLabel(label)} <b className={tone === "amber" ? "text-amber-300" : "text-emerald-300"}>{formatScore(value)}</b>
            </TooltipTrigger>
            <TooltipContent className="w-80 max-w-sm border border-white/10 bg-[#090e19] p-3 text-xs leading-relaxed text-white shadow-2xl space-y-1.5 pointer-events-none">
              <div className="font-bold text-cyan-300 border-b border-white/10 pb-1">{label}</div>
              <div className="text-slate-300 leading-relaxed">{COMPONENT_HELP[label] || "Điểm thành phần 0–100 do KFSP cung cấp; response không mô tả công thức chi tiết."}</div>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </div>
  )
}

function ScoreSection({ title, history, scoreKey, componentKey, fallbackScore, tone }: {
  title: string
  history: QuarterlyHistoryPoint[]
  scoreKey: "fourmScore" | "canslimScore"
  componentKey: "fourmComponents" | "canslimComponents"
  fallbackScore: number | null
  tone: "amber" | "emerald"
}) {
  const latest = [...history].reverse().find((item) => Object.keys(item[componentKey]).length > 0)
  return <div className="grid gap-4 xl:grid-cols-2"><ScoreHistoryChart title={title} history={history} scoreKey={scoreKey} fallbackScore={fallbackScore} tone={tone} /><ComponentRadar title={`${title} · thành phần`} components={latest?.[componentKey] || {}} tone={tone} /></div>
}

export function TtaiDashboard({ row }: { row: InsightsRatingRow }) {
  const [data, setData] = useState<HistoryPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/insights/stock-history?ticker=${encodeURIComponent(row.ticker)}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null)
        if (!response.ok || !payload?.ok) throw new Error("Không tải được TTAI history.")
        return payload as HistoryPayload
      })
      .then((payload) => setData(payload))
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return
        setError(reason instanceof Error ? reason.message : "Không tải được TTAI history.")
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [row.ticker])

  const daily = data?.dailyHistory ?? []
  const quarterly = data?.quarterlyHistory ?? []
  const currentSummary = {
    stockRs: daily.at(-1)?.stockRs ?? row.rsShort,
    sectorRs: daily.at(-1)?.sectorRs ?? null,
    stockRrg: daily.at(-1)?.stockRrgState ?? row.stockRrgState,
    sectorRrg: daily.at(-1)?.sectorRrgState ?? row.sectorRrgState,
  }

  return (
    <section id="rating-panel-ttai" role="tabpanel" aria-labelledby="rating-tab-ttai" className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-amber-300/15 bg-[#091321] p-4"><div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-amber-200/70"><Bolt className="size-4" />4M hiện tại</div><div className="mt-3 font-mono text-2xl font-black text-amber-300">{formatScore(row.score4m)}</div></div>
        <div className="rounded-xl border border-emerald-300/15 bg-[#091321] p-4"><div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-emerald-200/70"><Target className="size-4" />CANSLIM hiện tại</div><div className="mt-3 font-mono text-2xl font-black text-emerald-300">{formatScore(row.canslimScore)}</div></div>
        <div className="rounded-xl border border-cyan-300/15 bg-[#091321] p-4"><div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-cyan-200/70"><Zap className="size-4" />RS-S cổ phiếu</div><div className="mt-3 font-mono text-2xl font-black text-cyan-300">{formatScore(currentSummary.stockRs)}</div></div>
        <div className="rounded-xl border border-violet-300/15 bg-[#091321] p-4"><div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-violet-200/70"><Radar className="size-4" />RS-S ngành</div><div className="mt-3 font-mono text-2xl font-black text-violet-300">{formatScore(currentSummary.sectorRs)}</div></div>
      </div>

      {loading && <div className="flex min-h-56 items-center justify-center gap-2 rounded-2xl border border-white/[0.07] bg-[#07111f] text-sm font-semibold text-muted-2"><LoaderCircle className="size-5 animate-spin text-brand" /> Đang tải lịch sử TTAI…</div>}
      {error && <div className="flex items-center gap-3 rounded-2xl border border-rose-300/20 bg-rose-400/[0.06] p-4 text-sm font-semibold text-rose-200"><RefreshCw className="size-4" />{error}</div>}

      {!loading && !error && <>
        <RsHistoryChart history={daily} />
        <div className="grid gap-4 xl:grid-cols-2"><RrgHistoryChart title="RRG cổ phiếu" history={daily} stateKey="stockRrgState" /><RrgHistoryChart title="RRG ngành" history={daily} stateKey="sectorRrgState" /></div>
        <ScoreSection title="Điểm 4M" history={quarterly} scoreKey="fourmScore" componentKey="fourmComponents" fallbackScore={row.score4m} tone="amber" />
        <ScoreSection title="Điểm CANSLIM" history={quarterly} scoreKey="canslimScore" componentKey="canslimComponents" fallbackScore={row.canslimScore} tone="emerald" />
        {!data?.quarterlyHistoryAvailable && <div className="rounded-xl border border-amber-300/15 bg-amber-300/[0.05] p-3 text-xs font-semibold text-amber-100">Schema history quý chưa được apply ở environment này. Daily RS/RRG vẫn hoạt động; 4M/CANSLIM history sẽ tự xuất hiện sau migration + sync.</div>}
      </>}
    </section>
  )
}
