"use client"

import { useMemo, useState, useTransition, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { Activity, ArrowUpRight, BarChart3, CheckCircle2, GitCompareArrows, ShieldCheck } from "lucide-react"

import { TradingWorkstationChart } from "@/components/research/trading-workstation-chart"
import type { TimeframeKey, TimeframeStudy } from "@/lib/multi-timeframe"
import type { OhlcvBar } from "@/lib/technical-indicators"

const ORDER: TimeframeKey[] = ["Weekly", "Daily", "4H", "1H"]

function num(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "—"
  return value.toLocaleString("en-US", { maximumFractionDigits: digits })
}

function barTimestamp(bar?: OhlcvBar) {
  if (!bar) return "—"
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(bar.time * 1000))
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

function EvidenceCard({ title, children }: { title: string; children: ReactNode }) {
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
          <p className="mt-2 max-w-4xl text-sm leading-6 text-foreground/55">Structure → Price Action → Volume → Wyckoff → Confirmation → Scenario. Trading chart hiển thị candlestick, Volume, MA20/50/200, vùng S/R, Wyckoff candidate markers, RSI14 và MACD. Mỗi timeframe chỉ dùng bar hoàn tất; 4H là derived từ 1H.</p>
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

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-xs text-foreground/50"><div>{current.detail}</div><div>Latest completed: {barTimestamp(current.bars.at(-1))} · {current.bars.length} bars · {current.scan?.confidence || "insufficient"}</div></div>
      <div className="mt-4"><TradingWorkstationChart bars={current.bars} scan={scan} label={`${ticker} ${current.key}`} /></div>

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
