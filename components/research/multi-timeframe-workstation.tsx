"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Activity, ArrowUpRight, BarChart3, CheckCircle2, GitCompareArrows, ShieldCheck } from "lucide-react"

import type { TimeframeKey, TimeframeStudy } from "@/lib/multi-timeframe"
import type { OhlcvBar } from "@/lib/technical-indicators"

const ORDER: TimeframeKey[] = ["Weekly", "Daily", "4H", "1H"]

function num(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "—"
  return value.toLocaleString("en-US", { maximumFractionDigits: digits })
}

function rollingAverage(bars: OhlcvBar[], period: number) {
  const out: Array<number | null> = Array(bars.length).fill(null)
  let sum = 0
  for (let i = 0; i < bars.length; i += 1) {
    sum += bars[i].close
    if (i >= period) sum -= bars[i - period].close
    if (i >= period - 1) out[i] = sum / period
  }
  return out
}

function StudyChart({ bars, label }: { bars: OhlcvBar[]; label: string }) {
  const shown = bars.slice(-120)
  if (shown.length < 2) return <div className="rounded-lg border border-border bg-panel-2 p-6 text-sm text-foreground/55">Chưa đủ OHLCV để vẽ chart {label}.</div>
  const ma20 = rollingAverage(bars, 20).slice(-shown.length)
  const ma50 = rollingAverage(bars, 50).slice(-shown.length)
  const width = 960
  const height = 330
  const left = 52
  const right = 16
  const top = 18
  const priceHeight = 225
  const volumeTop = 268
  const volumeHeight = 40
  const chartWidth = width - left - right
  const values = shown.flatMap((bar, index) => [bar.low, bar.high, ma20[index] ?? bar.close, ma50[index] ?? bar.close])
  const rawMin = Math.min(...values)
  const rawMax = Math.max(...values)
  const pad = Math.max((rawMax - rawMin) * 0.08, rawMax * 0.01)
  const min = rawMin - pad
  const max = rawMax + pad
  const maxVolume = Math.max(...shown.map((bar) => bar.volume), 1)
  const x = (i: number) => left + (i / Math.max(1, shown.length - 1)) * chartWidth
  const y = (v: number) => top + ((max - v) / Math.max(1e-9, max - min)) * priceHeight
  const path = (series: Array<number | null>) => series.map((value, i) => value == null ? "" : `${i === 0 || series[i - 1] == null ? "M" : "L"} ${x(i)} ${y(value)}`).join(" ")
  const closePath = shown.map((bar, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(bar.close)}`).join(" ")
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[760px] w-full" role="img" aria-label={`Biểu đồ ${label}`}>
        {[min, min + (max - min) / 2, max].map((tick) => <g key={tick}><line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} stroke="var(--color-border-strong)" strokeDasharray="4 6" opacity="0.55" /><text x={left - 7} y={y(tick) + 4} textAnchor="end" fill="currentColor" className="text-[11px] text-foreground/45">{num(tick, 0)}</text></g>)}
        {shown.map((bar, i) => {
          const w = Math.max(1.5, chartWidth / shown.length - 1)
          const h = (bar.volume / maxVolume) * volumeHeight
          return <rect key={bar.time} x={x(i) - w / 2} y={volumeTop + volumeHeight - h} width={w} height={h} fill={bar.close >= bar.open ? "var(--color-up)" : "var(--color-down)"} opacity="0.3" />
        })}
        <path d={closePath} fill="none" stroke="var(--color-foreground)" strokeWidth="2.4" strokeLinecap="round" />
        <path d={path(ma20)} fill="none" stroke="var(--color-brand)" strokeWidth="1.8" strokeLinecap="round" />
        <path d={path(ma50)} fill="none" stroke="var(--color-ref)" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-foreground/50"><span>Close</span><span className="text-brand">MA20</span><span className="text-ref">MA50</span><span>Volume</span></div>
    </div>
  )
}

function Scenario({ study }: { study: TimeframeStudy }) {
  const scan = study.scan
  if (!scan) return <div className="text-sm text-foreground/55">{study.error || "Chưa đủ dữ liệu để sinh scenario."}</div>
  const rows = [
    ["Bull", scan.bullProbability, "bg-up"],
    ["Base", scan.baseProbability, "bg-ref"],
    ["Bear", scan.bearProbability, "bg-down"],
  ] as const
  return <div className="space-y-2.5">{rows.map(([label, value, cls]) => <div key={label}><div className="mb-1 flex items-center justify-between text-sm"><span className="text-foreground/65">{label}</span><span className="font-mono font-semibold text-foreground">{value}%</span></div><div className="h-2 rounded-full bg-panel-2"><div className={`h-full rounded-full ${cls}`} style={{ width: `${value}%` }} /></div></div>)}</div>
}

function EvidenceCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-xl border border-border bg-panel p-5"><h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-foreground/45">{title}</h3><div className="mt-3 text-sm leading-6 text-foreground/72">{children}</div></section>
}

export function MultiTimeframeWorkstation({ ticker, studies, canPromote }: { ticker: string; studies: TimeframeStudy[]; canPromote: boolean }) {
  const router = useRouter()
  const availableDefault = studies.find((row) => row.key === "Daily")?.key ?? studies[0]?.key ?? "Daily"
  const [active, setActive] = useState<TimeframeKey>(availableDefault)
  const [message, setMessage] = useState("")
  const [isPending, startTransition] = useTransition()
  const current = useMemo(() => studies.find((row) => row.key === active) ?? studies[0], [active, studies])

  async function promote() {
    if (!window.confirm(`Promote ${ticker} thành Canonical Thesis? Hệ thống sẽ recompute MTF và tạo cả Stock Thesis + Analysis Log trên Notion.`)) return
    setMessage("")
    startTransition(async () => {
      try {
        const response = await fetch("/api/research/promote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticker }),
        })
        const payload = await response.json()
        if (!response.ok || !payload.ok) throw new Error(payload.error || "Promotion failed")
        setMessage(`Đã promote ${ticker}: ${payload.probabilities.bull}/${payload.probabilities.base}/${payload.probabilities.bear}.`)
        router.refresh()
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Promotion failed")
      }
    })
  }

  if (!current) return null
  const scan = current.scan
  const technical = current.technical

  return (
    <section className="rounded-xl border border-brand/25 bg-panel p-5 lg:p-6">
      <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-start">
        <div>
          <div className="flex flex-wrap items-center gap-2"><GitCompareArrows className="h-5 w-5 text-brand" /><h2 className="text-xl font-semibold text-foreground">Multi-Timeframe Workstation</h2><span className="rounded-md border border-brand/25 bg-brand/10 px-2 py-1 text-xs font-semibold text-brand">Weekly · Daily · 4H · 1H</span></div>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-foreground/55">Cùng một pipeline: Structure → Price Action → Volume → Wyckoff → Confirmation → Scenario. Mỗi tab giữ provenance riêng; 4H được đánh dấu derived từ 1H.</p>
        </div>
        {canPromote && <button type="button" disabled={isPending} onClick={promote} className="inline-flex shrink-0 items-center gap-2 rounded-md border border-brand/35 bg-brand/10 px-4 py-2.5 text-sm font-semibold text-brand transition-colors hover:bg-brand/15 disabled:opacity-50"><CheckCircle2 className="h-4 w-4" />{isPending ? "Đang promote…" : "Promote to Canonical Thesis"}</button>}
      </div>
      {message && <div className="mt-4 rounded-lg border border-border bg-panel-2 px-4 py-3 text-sm text-foreground/70">{message}</div>}

      <div className="mt-5 flex gap-2 overflow-x-auto border-b border-border pb-3">
        {ORDER.map((key) => {
          const row = studies.find((item) => item.key === key)
          return <button key={key} type="button" onClick={() => setActive(key)} className={`whitespace-nowrap rounded-md border px-4 py-2 text-sm font-semibold ${active === key ? "border-brand/35 bg-brand/12 text-brand" : "border-border bg-panel-2 text-foreground/55 hover:text-foreground"}`}>{key}{row?.derived ? " · derived" : ""}{!row?.available ? " · N/A" : ""}</button>
        })}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-xs text-foreground/50"><div>{current.detail}</div><div>{current.bars.length} bars · {current.scan?.confidence || "insufficient"}</div></div>
      <div className="mt-4"><StudyChart bars={current.bars} label={`${ticker} ${current.key}`} /></div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <EvidenceCard title="Price"><div className="font-mono text-xl font-semibold text-foreground">{num(technical?.price, 2)}</div><div className="mt-1">{technical?.changePct == null ? "—" : `${technical.changePct >= 0 ? "+" : ""}${technical.changePct.toFixed(2)}% / bar`}</div></EvidenceCard>
        <EvidenceCard title="RSI14"><div className="font-mono text-xl font-semibold text-foreground">{num(technical?.rsi14, 1)}</div><div className="mt-1">Momentum evidence, không phải signal độc lập.</div></EvidenceCard>
        <EvidenceCard title="Relative Volume"><div className="font-mono text-xl font-semibold text-foreground">{technical?.relVolume == null ? "—" : `${technical.relVolume.toFixed(2)}x`}</div><div className="mt-1">Effort so với 20 bars trước.</div></EvidenceCard>
        <EvidenceCard title="Wyckoff"><div className="font-semibold text-foreground">{scan?.phase || "Unclassified"}</div><div className="mt-1">{scan?.taBias || "Insufficient"}</div></EvidenceCard>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-3">
        <EvidenceCard title="1 · Structure"><BarChart3 className="mb-2 h-4 w-4 text-brand" />{current.structure}</EvidenceCard>
        <EvidenceCard title="2 · Price Action"><ArrowUpRight className="mb-2 h-4 w-4 text-brand" />{current.priceAction}</EvidenceCard>
        <EvidenceCard title="3 · Volume"><Activity className="mb-2 h-4 w-4 text-brand" />{current.volume}</EvidenceCard>
        <EvidenceCard title="4 · Wyckoff">{scan?.wyckoffState || current.error || "Chưa đủ dữ liệu để chạy rule-engine."}</EvidenceCard>
        <EvidenceCard title="5 · Confirmation"><ShieldCheck className="mb-2 h-4 w-4 text-up" />{scan?.confirmation || "Chờ thêm dữ liệu."}<div className="mt-3 border-t border-border pt-3 text-foreground/55"><strong>Invalidation:</strong> {scan?.invalidation || "—"}</div></EvidenceCard>
        <EvidenceCard title="6 · Scenario"><Scenario study={current} /></EvidenceCard>
      </div>

      {scan && <div className="mt-4 grid gap-4 lg:grid-cols-2"><EvidenceCard title="Support">{scan.support}</EvidenceCard><EvidenceCard title="Resistance">{scan.resistance}</EvidenceCard></div>}
    </section>
  )
}
