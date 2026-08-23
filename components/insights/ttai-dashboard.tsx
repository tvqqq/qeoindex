"use client"

import { useEffect, useState } from "react"
import { Bolt, Info, LoaderCircle, Radar, RefreshCw, Target, Zap } from "lucide-react"

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
  "Phục hồi": { x: 25, y: 25, label: "PHỤC HỒI", fill: "rgba(67,56,202,.16)", stroke: "#818cf8" },
  "Dẫn dắt": { x: 75, y: 25, label: "DẪN DẮT", fill: "rgba(34,197,94,.13)", stroke: "#34d399" },
  "Đội sổ": { x: 25, y: 75, label: "ĐỘI SỔ", fill: "rgba(244,63,94,.13)", stroke: "#fb7185" },
  "Suy yếu": { x: 75, y: 75, label: "SUY YẾU", fill: "rgba(245,158,11,.13)", stroke: "#fbbf24" },
} as const

type RrgStateName = keyof typeof RRG_STATE

function formatScore(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "—" : value.toLocaleString("vi-VN", { maximumFractionDigits: 2 })
}

function pointPath(values: Array<number | null>, width: number, height: number, padding = 28) {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value))
  if (!valid.length) return { points: "", coords: [] as Array<{ x: number; y: number; value: number; index: number }>, min: 0, max: 100 }
  const min = Math.min(0, ...valid)
  const max = Math.max(100, ...valid)
  const range = max - min || 1
  const coords = values.flatMap((value, index) => {
    if (value == null || !Number.isFinite(value)) return []
    const x = padding + index * (width - padding * 2) / Math.max(1, values.length - 1)
    const y = height - padding - (value - min) / range * (height - padding * 2)
    return [{ x, y, value, index }]
  })
  return { points: coords.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" "), coords, min, max }
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
    return [{ date: item.asOfDate, state, x: definition.x + wobble, y: definition.y - wobble * 0.65 }]
  })
  if (!points.length) return <EmptyChart label={`Chưa có lịch sử ${title}.`} />
  const path = points.map((point) => `${point.x},${point.y}`).join(" ")
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-[#07111f] p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div><h4 className="font-extrabold text-white">{title}</h4><p className="mt-1 text-xs text-muted-2">20 snapshot gần nhất · projection theo trạng thái KFSP.</p></div>
        <Radar className="size-5 text-violet-300" />
      </div>
      <svg viewBox="0 0 100 100" className="mx-auto aspect-square w-full max-w-[420px]" role="img" aria-label={`${title} theo thời gian`}>
        <rect x="1" y="1" width="49" height="49" fill={RRG_STATE["Phục hồi"].fill} />
        <rect x="50" y="1" width="49" height="49" fill={RRG_STATE["Dẫn dắt"].fill} />
        <rect x="1" y="50" width="49" height="49" fill={RRG_STATE["Đội sổ"].fill} />
        <rect x="50" y="50" width="49" height="49" fill={RRG_STATE["Suy yếu"].fill} />
        <line x1="50" x2="50" y1="1" y2="99" stroke="rgba(255,255,255,.35)" strokeDasharray="2 2" />
        <line x1="1" x2="99" y1="50" y2="50" stroke="rgba(255,255,255,.35)" strokeDasharray="2 2" />
        <text x="5" y="8" fill="#818cf8" fontSize="4" fontWeight="800">PHỤC HỒI</text>
        <text x="95" y="8" textAnchor="end" fill="#34d399" fontSize="4" fontWeight="800">DẪN DẮT</text>
        <text x="5" y="96" fill="#fb7185" fontSize="4" fontWeight="800">ĐỘI SỔ</text>
        <text x="95" y="96" textAnchor="end" fill="#fbbf24" fontSize="4" fontWeight="800">SUY YẾU</text>
        <polyline points={path} fill="none" stroke="#a78bfa" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" opacity=".9" />
        {points.map((point, index) => (
          <circle key={`${point.date}-${index}`} cx={point.x} cy={point.y} r={index === points.length - 1 ? 2.2 : 1.25} fill={index === points.length - 1 ? "#6ee7b7" : "#93c5fd"} stroke="#07111f" strokeWidth=".6">
            <title>{`${point.date}: ${point.state}`}</title>
          </circle>
        ))}
      </svg>
      <p className="mt-2 text-[11px] leading-5 text-muted-2">Biểu đồ chỉ thể hiện lịch sử <strong className="text-slate-300">trạng thái quadrant</strong>. KFSP snapshot hiện không cung cấp tọa độ RRG gốc nên QeoIndex không tự suy diễn RS-Ratio/RS-Momentum.</p>
    </div>
  )
}

function RsHistoryChart({ history }: { history: DailyHistoryPoint[] }) {
  const source = history.slice(-90)
  const stock = pointPath(source.map((item) => item.stockRs), 760, 270, 34)
  const sector = pointPath(source.map((item) => item.sectorRs), 760, 270, 34)
  if (!stock.coords.length && !sector.coords.length) return <EmptyChart label="Chưa có lịch sử RS-S cổ phiếu/ngành." />
  return (
    <div className="rounded-2xl border border-cyan-300/10 bg-[#07111f] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h4 className="font-extrabold text-white">RS-S cổ phiếu vs RS-S ngành</h4><p className="mt-1 text-xs text-muted-2">Tối đa 90 snapshot daily từ Supabase.</p></div>
        <div className="flex gap-3 text-xs font-bold"><span className="text-cyan-300">— Cổ phiếu</span><span className="text-violet-300">— Ngành</span></div>
      </div>
      <svg viewBox="0 0 760 270" className="mt-4 h-64 w-full" role="img" aria-label="Lịch sử RS-S cổ phiếu và RS-S ngành">
        {[0, 20, 40, 60, 80, 100].map((value) => {
          const y = 236 - value / 100 * 202
          return <g key={value}><line x1="34" x2="726" y1={y} y2={y} stroke="rgba(148,163,184,.10)" /><text x="5" y={y + 4} fill="#71818e" fontSize="10">{value}</text></g>
        })}
        {stock.points && <polyline points={stock.points} fill="none" stroke="#22d3ee" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
        {sector.points && <polyline points={sector.points} fill="none" stroke="#a78bfa" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
        {stock.coords.map((point) => <circle key={`s-${point.index}`} cx={point.x} cy={point.y} r="2.2" fill="#22d3ee"><title>{`${source[point.index]?.asOfDate}: cổ phiếu ${formatScore(point.value)}`}</title></circle>)}
        {sector.coords.map((point) => <circle key={`i-${point.index}`} cx={point.x} cy={point.y} r="2.2" fill="#a78bfa"><title>{`${source[point.index]?.asOfDate}: ngành ${formatScore(point.value)}`}</title></circle>)}
        {source.length > 0 && <><text x="34" y="260" fill="#71818e" fontSize="10">{source[0].asOfDate}</text><text x="726" y="260" textAnchor="end" fill="#71818e" fontSize="10">{source.at(-1)?.asOfDate}</text></>}
      </svg>
    </div>
  )
}

function ScoreHistoryChart({ title, history, scoreKey, fallbackScore, tone }: {
  title: string
  history: QuarterlyHistoryPoint[]
  scoreKey: "fourmScore" | "canslimScore"
  fallbackScore: number
  tone: "amber" | "emerald"
}) {
  const source = history.filter((item) => item[scoreKey] != null).slice(-12)
  const score = source.at(-1)?.[scoreKey] ?? fallbackScore
  const points = pointPath(source.map((item) => item[scoreKey]), 650, 260, 34)
  const accent = tone === "amber" ? "#f59e0b" : "#22c55e"
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-[#07111f] p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3"><div><h4 className="text-xl font-extrabold text-white">{title}</h4><p className="mt-1 text-xs text-muted-2">Điểm 0–100 do KFSP cung cấp.</p></div><span className={cn("rounded-lg px-3 py-1.5 font-mono text-xl font-black", tone === "amber" ? "bg-amber-400/15 text-amber-300" : "bg-emerald-400/15 text-emerald-300")}>{formatScore(score)}</span></div>
      <Tooltip>
        <TooltipTrigger render={<div className="mt-4 flex cursor-help items-center gap-2 text-xs font-bold text-muted-2" />}><Info className="size-3.5" /> Cách đọc điểm</TooltipTrigger>
        <TooltipContent className="max-w-80 border border-white/10 bg-[#090e19] p-3 text-xs leading-5 text-white">Điểm và lịch sử lấy trực tiếp từ KFSP. Response cung cấp điểm 0–100 nhưng không công bố công thức trọng số đầy đủ; QeoIndex không tái tính điểm.</TooltipContent>
      </Tooltip>
      <div className="relative mt-4 h-3 overflow-hidden rounded-full"><div className="absolute inset-y-0 left-0 w-2/5 bg-rose-500" /><div className="absolute inset-y-0 left-[40%] w-1/5 bg-amber-400" /><div className="absolute inset-y-0 right-0 w-2/5 bg-emerald-500" /><span className="absolute -top-1 h-5 w-1 rounded bg-white shadow-[0_0_10px_white]" style={{ left: `${Math.max(0, Math.min(100, Number(score) || 0))}%` }} /></div>
      {source.length >= 2 ? (
        <svg viewBox="0 0 650 260" className="mt-5 h-56 w-full" role="img" aria-label={`${title} theo quý`}>
          {[0, 20, 40, 60, 80, 100].map((value) => { const y = 226 - value / 100 * 192; return <g key={value}><line x1="34" x2="616" y1={y} y2={y} stroke="rgba(148,163,184,.10)" /><text x="6" y={y + 4} fill="#71818e" fontSize="10">{value}</text></g> })}
          <polyline points={points.points} fill="none" stroke={accent} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          {points.coords.map((point) => <g key={point.index}><circle cx={point.x} cy={point.y} r="4" fill={point.value >= 50 ? "#22c55e" : "#ef4444"} stroke="#07111f" strokeWidth="2"><title>{`${source[point.index]?.period}: ${formatScore(point.value)}`}</title></circle><text x={point.x} y={point.y - 9} textAnchor="middle" fill="#e5e7eb" fontSize="10">{formatScore(point.value)}</text></g>)}
          {source.map((item, index) => <text key={item.period} x={34 + index * 582 / Math.max(1, source.length - 1)} y="250" textAnchor="middle" fill="#71818e" fontSize="9">{item.period}</text>)}
        </svg>
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
  const center = 150
  const radius = 105
  const angle = (index: number) => -Math.PI / 2 + index * Math.PI * 2 / entries.length
  const polygon = (scale: number) => entries.map(([, value], index) => {
    const r = radius * scale * value / 100
    return `${center + Math.cos(angle(index)) * r},${center + Math.sin(angle(index)) * r}`
  }).join(" ")
  const grid = [0.2, 0.4, 0.6, 0.8, 1]
  const accent = tone === "amber" ? "#f59e0b" : "#34d399"
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-[#07111f] p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3"><div><h4 className="text-xl font-extrabold text-white">{title}</h4><p className="mt-1 text-xs text-muted-2">Radar thành phần của quý mới nhất.</p></div><Target className={cn("size-5", tone === "amber" ? "text-amber-300" : "text-emerald-300")} /></div>
      <svg viewBox="0 0 300 300" className="mx-auto mt-3 aspect-square w-full max-w-[460px]" role="img" aria-label={`${title} radar thành phần`}>
        {grid.map((scale) => {
          const points = entries.map(([,], index) => `${center + Math.cos(angle(index)) * radius * scale},${center + Math.sin(angle(index)) * radius * scale}`).join(" ")
          return <polygon key={scale} points={points} fill="none" stroke="rgba(203,213,225,.28)" strokeWidth="1" />
        })}
        {entries.map(([,], index) => <line key={index} x1={center} y1={center} x2={center + Math.cos(angle(index)) * radius} y2={center + Math.sin(angle(index)) * radius} stroke="rgba(203,213,225,.16)" />)}
        <polygon points={polygon(1)} fill={tone === "amber" ? "rgba(245,158,11,.26)" : "rgba(52,211,153,.22)"} stroke={accent} strokeWidth="2.5" />
        {entries.map(([label, value], index) => {
          const x = center + Math.cos(angle(index)) * radius * value / 100
          const y = center + Math.sin(angle(index)) * radius * value / 100
          const lx = center + Math.cos(angle(index)) * (radius + 23)
          const ly = center + Math.sin(angle(index)) * (radius + 23)
          return <g key={label}><circle cx={x} cy={y} r="3.5" fill={accent} stroke="#fff" strokeWidth="1"><title>{`${label}: ${formatScore(value)}/100 — ${COMPONENT_HELP[label] || "Điểm thành phần KFSP."}`}</title></circle><text x={lx} y={ly} textAnchor={lx < center - 8 ? "end" : lx > center + 8 ? "start" : "middle"} dominantBaseline="middle" fill="#cbd5e1" fontSize="8.5"><title>{COMPONENT_HELP[label] || "Điểm thành phần KFSP."}</title>{componentShortLabel(label)}</text></g>
        })}
      </svg>
      <div className="mt-3 flex flex-wrap gap-2">{entries.map(([label, value]) => <Tooltip key={label}><TooltipTrigger render={<span className="inline-flex cursor-help items-center gap-1 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] font-bold text-slate-300" />}>{componentShortLabel(label)} <b className={tone === "amber" ? "text-amber-300" : "text-emerald-300"}>{formatScore(value)}</b></TooltipTrigger><TooltipContent className="max-w-72 border border-white/10 bg-[#090e19] p-3 text-xs leading-5 text-white"><strong>{label}</strong><div className="mt-1 text-slate-300">{COMPONENT_HELP[label] || "Điểm thành phần 0–100 do KFSP cung cấp; response không mô tả công thức chi tiết."}</div></TooltipContent></Tooltip>)}</div>
    </div>
  )
}

function ScoreSection({ title, history, scoreKey, componentKey, fallbackScore, tone }: {
  title: string
  history: QuarterlyHistoryPoint[]
  scoreKey: "fourmScore" | "canslimScore"
  componentKey: "fourmComponents" | "canslimComponents"
  fallbackScore: number
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
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-violet-300/15 bg-violet-400/[0.05] p-5">
        <div className="flex items-start gap-3"><span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-violet-300/20 bg-violet-300/10"><Radar className="size-5 text-violet-200" /></span><div><h3 className="text-lg font-extrabold text-white">TTAI</h3><p className="mt-1 max-w-3xl text-sm leading-6 text-muted-2">Lịch sử RS-S, RRG, 4M và CANSLIM. Dữ liệu provider được chuẩn hóa vào Supabase; QeoIndex không tái tính các điểm KFSP.</p></div></div>
        <div className="flex flex-wrap gap-2 text-xs font-bold"><span className="rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-2.5 py-1.5 text-cyan-200">RS-S {formatScore(currentSummary.stockRs)}</span><span className="rounded-lg border border-violet-300/20 bg-violet-300/10 px-2.5 py-1.5 text-violet-200">Ngành {formatScore(currentSummary.sectorRs)}</span><span className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-slate-300">RRG {currentSummary.stockRrg || "—"}</span></div>
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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-amber-300/15 bg-[#091321] p-4"><div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-amber-200/70"><Bolt className="size-4" />4M hiện tại</div><div className="mt-3 font-mono text-2xl font-black text-amber-300">{formatScore(row.score4m)}</div></div>
        <div className="rounded-xl border border-emerald-300/15 bg-[#091321] p-4"><div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-emerald-200/70"><Target className="size-4" />CANSLIM hiện tại</div><div className="mt-3 font-mono text-2xl font-black text-emerald-300">{formatScore(row.canslimScore)}</div></div>
        <div className="rounded-xl border border-cyan-300/15 bg-[#091321] p-4"><div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-cyan-200/70"><Zap className="size-4" />RS-S cổ phiếu</div><div className="mt-3 font-mono text-2xl font-black text-cyan-300">{formatScore(currentSummary.stockRs)}</div></div>
        <div className="rounded-xl border border-violet-300/15 bg-[#091321] p-4"><div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-violet-200/70"><Radar className="size-4" />RS-S ngành</div><div className="mt-3 font-mono text-2xl font-black text-violet-300">{formatScore(currentSummary.sectorRs)}</div></div>
      </div>
    </section>
  )
}
