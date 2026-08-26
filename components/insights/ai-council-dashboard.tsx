"use client"

import { useMemo, useState } from "react"
import {
  Activity,
  BarChart3,
  BrainCircuit,
  CalendarDays,
  ChevronDown,
  CircleAlert,
  Crown,
  Database,
  Gauge,
  History,
  LineChart,
  Radar,
  Search,
  ShieldCheck,
  Target,
  TrendingDown,
  TrendingUp,
  X,
  Zap,
} from "lucide-react"

import { AiCouncilInvestorReport } from "@/components/insights/ai-council-investor-report"
import { TopNav } from "@/components/top-nav"
import type { AiCouncilData, AiCouncilHistoryEntry } from "@/lib/ai-council-data"
import type { AiCouncilStock, CouncilAgentOpinion, CouncilSignal } from "@/lib/ai-council-model"
import { cn } from "@/lib/utils"

const DATE_FORMAT = new Intl.DateTimeFormat("vi-VN", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

const AGENT_ICON = { wyckoff: Radar, momentum: LineChart, fundamental: BarChart3, flow: Activity, market: Gauge, risk: ShieldCheck } as const

function pct(value: number | null) {
  return value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`
}

function signalTone(signal: CouncilSignal) {
  return signal === "BUY" ? "text-emerald-300" : signal === "BUY_ON_CONFIRMATION" ? "text-cyan-300" : signal === "REDUCE" ? "text-amber-300" : signal === "SELL" ? "text-rose-300" : "text-slate-300"
}

function stanceTone(stance: CouncilAgentOpinion["stance"]) {
  return stance === "bullish" || stance === "approve" ? "text-emerald-300 border-emerald-400/20" : stance === "bearish" || stance === "veto" ? "text-rose-300 border-rose-400/20" : stance === "caution" ? "text-amber-300 border-amber-400/20" : "text-slate-300 border-slate-400/20"
}

function stanceLabel(stance: CouncilAgentOpinion["stance"]) {
  return stance.toUpperCase()
}

function compactSignal(signal: CouncilSignal) {
  return signal === "BUY_ON_CONFIRMATION" ? "CONFIRM" : signal
}

function AgentCard({ agent }: { agent: CouncilAgentOpinion }) {
  const Icon = AGENT_ICON[agent.key]
  return (
    <article className="rounded-2xl border border-white/[0.08] bg-[#0a0f16] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-violet-400/20 bg-violet-400/[0.08] text-violet-300"><Icon className="size-4" /></span>
          <div className="min-w-0"><h3 className="truncate text-sm font-bold text-white">{agent.label}</h3><p className="truncate text-[10px] text-slate-500">{agent.role}</p></div>
        </div>
        <span className={cn("rounded-full border px-2 py-1 text-[9px] font-black", stanceTone(agent.stance))}>{stanceLabel(agent.stance)}</span>
      </div>
      <div className="mt-4 flex items-end justify-between">
        <div><div className="text-[9px] font-black uppercase tracking-wider text-slate-600">Score</div><div className={cn("font-mono text-2xl font-black", agent.score >= 60 ? "text-emerald-300" : agent.score <= 40 ? "text-rose-300" : "text-white")}>{agent.score}<span className="text-xs text-slate-600">/100</span></div></div>
        <div className="text-right text-[10px] text-slate-500">Confidence<br/><span className="font-mono text-sm font-bold text-slate-300">{agent.confidence}%</span></div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.06]"><div className={cn("h-full rounded-full", agent.score >= 60 ? "bg-emerald-400" : agent.score <= 40 ? "bg-rose-400" : "bg-slate-400")} style={{ width: `${agent.score}%` }} /></div>
      <p className="mt-3 text-[12px] leading-5 text-slate-300">{agent.summary}</p>
      {agent.evidenceFor[0] ? <p className="mt-2 rounded-lg bg-emerald-400/[0.035] px-2.5 py-2 text-[10px] leading-4 text-emerald-100/75">+ {agent.evidenceFor[0]}</p> : null}
      {agent.evidenceAgainst[0] ? <p className="mt-2 rounded-lg bg-rose-400/[0.035] px-2.5 py-2 text-[10px] leading-4 text-rose-100/70">− {agent.evidenceAgainst[0]}</p> : null}
    </article>
  )
}

function Debate({ title, items, bull }: { title: string; items: string[]; bull: boolean }) {
  const Icon = bull ? TrendingUp : TrendingDown
  return (
    <section className={cn("rounded-2xl border p-4", bull ? "border-emerald-400/15 bg-emerald-400/[0.03]" : "border-rose-400/15 bg-rose-400/[0.03]")}>
      <h3 className={cn("flex items-center gap-2 text-sm font-extrabold", bull ? "text-emerald-300" : "text-rose-300")}><Icon className="size-4" />{title}</h3>
      <div className="mt-3 space-y-2">{items.length ? items.map((item, index) => <p key={index} className="text-[11px] leading-5 text-slate-300">• {item}</p>) : <p className="text-[11px] text-slate-500">Chưa có evidence đủ mạnh.</p>}</div>
    </section>
  )
}

function Level({ label, value, tone }: { label: string; value: string; tone: string }) {
  return <div className="rounded-xl border border-white/[0.07] bg-black/10 p-3"><div className="text-[9px] font-black uppercase tracking-wider text-slate-600">{label}</div><p className={cn("mt-1.5 text-[10px] leading-4", tone)}>{value || "—"}</p></div>
}

function HistoryPanel({ rows, message }: { rows: AiCouncilHistoryEntry[]; message: string }) {
  return (
    <section className="rounded-2xl border border-white/[0.08] bg-[#080d13] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-extrabold"><History className="size-4 text-violet-300"/>Historical audit trail</h3>
        <span className="text-[9px] text-slate-600">Immutable revisions · close-to-close outcomes</span>
      </div>
      {rows.length ? (
        <div className="mt-3 overflow-x-auto rounded-xl border border-white/[0.06]">
          <table className="w-full min-w-[760px] text-left text-[10px]">
            <thead className="bg-black/20 uppercase tracking-wide text-slate-600"><tr><th className="px-3 py-2">Ngày</th><th className="px-3 py-2">Signal</th><th className="px-3 py-2 text-right">Score</th><th className="px-3 py-2 text-right">D+1</th><th className="px-3 py-2 text-right">D+5</th><th className="px-3 py-2 text-right">D+20</th><th className="px-3 py-2">Outcome</th><th className="px-3 py-2">Revision</th></tr></thead>
            <tbody>{rows.map((row) => <tr key={row.id} className="border-t border-white/[0.05] text-slate-300"><td className="whitespace-nowrap px-3 py-2.5 font-mono">{row.asOfDate}</td><td className={cn("px-3 py-2.5 font-black", signalTone(row.signal))}>{compactSignal(row.signal)}</td><td className="px-3 py-2.5 text-right font-mono font-bold text-white">{row.councilScore}</td><td className={cn("px-3 py-2.5 text-right font-mono", (row.outcome?.return1dPct ?? 0) > 0 ? "text-emerald-300" : (row.outcome?.return1dPct ?? 0) < 0 ? "text-rose-300" : "text-slate-500")}>{pct(row.outcome?.return1dPct ?? null)}</td><td className={cn("px-3 py-2.5 text-right font-mono", (row.outcome?.return5dPct ?? 0) > 0 ? "text-emerald-300" : (row.outcome?.return5dPct ?? 0) < 0 ? "text-rose-300" : "text-slate-500")}>{pct(row.outcome?.return5dPct ?? null)}</td><td className={cn("px-3 py-2.5 text-right font-mono", (row.outcome?.return20dPct ?? 0) > 0 ? "text-emerald-300" : (row.outcome?.return20dPct ?? 0) < 0 ? "text-rose-300" : "text-slate-500")}>{pct(row.outcome?.return20dPct ?? null)}</td><td className="px-3 py-2.5"><span className="rounded-full border border-white/[0.08] px-2 py-1 text-[8px] font-black uppercase text-slate-400">{row.outcome?.status || "pending"} · {row.outcome?.sessionsObserved ?? 0}D</span></td><td className="px-3 py-2.5 font-mono text-[9px] text-slate-600" title={row.evidenceHash}>{row.evidenceHash.slice(0, 8)}</td></tr>)}</tbody>
          </table>
        </div>
      ) : <p className="mt-3 rounded-xl border border-dashed border-white/[0.08] px-3 py-4 text-[10px] leading-5 text-slate-500">{message || "Chưa có historical Council run cho mã này."}</p>}
      <p className="mt-3 text-[9px] leading-4 text-slate-600">D+1/D+5/D+20 dùng published KFSP close snapshots. MFE/MAE trong database hiện là close-to-close 20 phiên, không phải intraday. BUY ON CONFIRMATION và WAIT chưa được chấm direction_correct cho tới khi confirmation trigger được cấu trúc hóa.</p>
    </section>
  )
}

function CouncilWorkspace({ stock, history, historyMessage }: { stock: AiCouncilStock; history: AiCouncilHistoryEntry[]; historyMessage: string }) {
  return (
    <div className="min-w-0 space-y-4">
      <AiCouncilInvestorReport stock={stock} />

      <details className="group overflow-hidden rounded-2xl border border-white/[0.08] bg-[#080d13]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3.5 marker:hidden">
          <div>
            <div className="flex items-center gap-2 text-sm font-extrabold text-slate-200"><BrainCircuit className="size-4 text-violet-300" />Phân tích chuyên sâu</div>
            <p className="mt-1 text-[10px] text-slate-600">Specialist Council · Bull/Bear · Risk · Decision levels · Historical audit</p>
          </div>
          <ChevronDown className="size-4 shrink-0 text-slate-500 transition-transform group-open:rotate-180" />
        </summary>

        <div className="space-y-4 border-t border-white/[0.06] p-4">
          <section><div className="mb-2 flex items-center gap-2"><BrainCircuit className="size-4 text-violet-300"/><h2 className="text-sm font-extrabold">Independent specialist opinions</h2></div><div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">{stock.agents.map((agent) => <AgentCard key={agent.key} agent={agent}/>)}</div></section>
          <section className="grid gap-3 lg:grid-cols-2"><Debate title="Bull Researcher" items={stock.bullCase} bull/><Debate title="Bear Researcher" items={stock.bearCase} bull={false}/></section>
          <section className="grid gap-3 lg:grid-cols-[.8fr_1.2fr]"><div className="rounded-2xl border border-amber-400/15 bg-amber-400/[0.03] p-4"><h3 className="flex items-center gap-2 text-sm font-extrabold text-amber-300"><CircleAlert className="size-4"/>Minority / Risk view</h3><p className="mt-3 text-[11px] leading-5 text-slate-300">{stock.dissent}</p></div><div className="rounded-2xl border border-white/[0.08] bg-[#080d13] p-4"><h3 className="flex items-center gap-2 text-sm font-extrabold"><Target className="size-4 text-cyan-300"/>Decision levels</h3><div className="mt-3 grid gap-2 sm:grid-cols-2"><Level label="Support" value={stock.support} tone="text-emerald-300"/><Level label="Resistance" value={stock.resistance} tone="text-amber-300"/><Level label="Confirmation" value={stock.confirmation} tone="text-cyan-300"/><Level label="Invalidation" value={stock.invalidation} tone="text-rose-300"/></div></div></section>
          <section className="rounded-2xl border border-white/[0.08] bg-[#080d13] p-4"><h3 className="flex items-center gap-2 text-sm font-extrabold"><Zap className="size-4 text-cyan-300"/>What changes the decision?</h3><div className="mt-3 grid gap-2 md:grid-cols-3">{stock.whatChangesDecision.map((item, index) => <p key={index} className="rounded-xl border border-white/[0.06] bg-black/10 p-3 text-[10px] leading-5 text-slate-300">{item}</p>)}</div><p className="mt-3 border-t border-white/[0.06] pt-3 text-[9px] leading-4 text-slate-600">{stock.dataQualityDetail}</p></section>
          <HistoryPanel rows={history} message={historyMessage}/>
        </div>
      </details>
    </div>
  )
}

export function AiCouncilDashboard({ data, initialTicker = "" }: { data: AiCouncilData; initialTicker?: string }) {
  const initial = data.stocks.find((stock) => stock.ticker === initialTicker.toUpperCase())?.ticker || data.stocks[0]?.ticker || ""
  const [activeTicker, setActiveTicker] = useState(initial)
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<"all" | "bull" | "wait" | "risk">("all")
  const filtered = useMemo(() => data.stocks.filter((stock) => {
    const q = query.trim().toUpperCase()
    if (q && !stock.ticker.includes(q) && !stock.companyName.toUpperCase().includes(q)) return false
    if (filter === "bull") return stock.signal === "BUY" || stock.signal === "BUY_ON_CONFIRMATION"
    if (filter === "wait") return stock.signal === "WAIT"
    if (filter === "risk") return stock.signal === "REDUCE" || stock.signal === "SELL" || stock.riskStatus !== "approve"
    return true
  }), [data.stocks, filter, query])
  const active = data.stocks.find((stock) => stock.ticker === activeTicker) || data.stocks[0]
  const activeHistory = active ? data.history.filter((entry) => entry.ticker === active.ticker) : []

  const formattedDate = useMemo(() => {
    if (data.ratingDate) {
      const [y, m, d] = data.ratingDate.split("-").map(Number)
      if (y && m && d) {
        const dt = new Date(y, m - 1, d, 9, 0, 0)
        return DATE_FORMAT.format(dt)
      }
    }
    return DATE_FORMAT.format(new Date())
  }, [data.ratingDate])

  function selectTicker(ticker: string) {
    setActiveTicker(ticker)
    const next = new URL(window.location.href)
    next.searchParams.set("ticker", ticker)
    window.history.replaceState(null, "", `${next.pathname}${next.search}`)
  }

  return (
    <div className="min-h-screen bg-[#06090d] text-white">
      <TopNav />
      <main className="mx-auto max-w-[1720px] px-3 py-4 sm:px-5 lg:px-6">
        <header className="mb-6 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <div className="flex items-center gap-3.5 sm:gap-4">
              <div className="relative flex size-10 sm:size-12 shrink-0 items-center justify-center rounded-2xl border border-violet-400/30 bg-gradient-to-br from-violet-500/20 via-purple-500/15 to-cyan-500/20 shadow-[0_0_24px_-4px_rgba(168,85,247,0.45),inset_0_1px_0_rgba(255,255,255,0.22)] transition-transform duration-300 hover:scale-105">
                <div className="absolute inset-0 rounded-2xl bg-violet-400/10 animate-pulse" />
                <BrainCircuit className="relative size-5 sm:size-6 text-violet-300 drop-shadow-[0_0_10px_rgba(168,85,247,0.6)] animate-[pulse_3s_ease-in-out_infinite]" />
              </div>
              <h1 className="font-ticker text-3xl font-extrabold italic tracking-[-0.03em] text-white sm:text-4xl lg:text-5xl">
                AI Council
              </h1>
            </div>
            <p className="mt-2.5 max-w-3xl text-sm font-medium leading-6 text-slate-400 sm:text-base">
              Khuyến nghị đơn giản trước; specialist reasoning, Bull/Bear, Risk và audit được giữ ở lớp phân tích chuyên sâu.
            </p>
          </div>

          <div className="flex flex-col items-start gap-2.5 sm:items-end">
            <div className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-wider text-slate-400">
              <CalendarDays className="size-4 text-violet-400" />
              <span>{formattedDate}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.08] bg-[#080d13] px-3.5 py-2 text-xs text-slate-400">
              <span className="inline-flex items-center gap-1.5"><Database className="size-3.5 text-cyan-400" />Rating {data.ratingDate || "—"}</span>
              <span className="text-white/20">·</span>
              <span className="inline-flex items-center gap-1.5"><Crown className="size-3.5 text-violet-400" />Evidence Ensemble V1</span>
              <span className="text-white/20">·</span>
              <span className="inline-flex items-center gap-1.5"><History className="size-3.5 text-emerald-400" />Audit {data.history.length}</span>
            </div>
          </div>
        </header>
      {data.stocks.length && active ? <div className="grid gap-4 xl:grid-cols-[290px_minmax(0,1fr)]"><aside className="xl:sticky xl:top-[72px] xl:h-[calc(100vh-88px)]"><div className="flex h-full min-h-[520px] flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#080d13]"><div className="border-b border-white/[0.06] p-3"><div className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-600"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm mã / công ty..." className="w-full rounded-xl border border-white/[0.08] bg-[#05080c] py-2.5 pl-9 pr-8 text-xs outline-none focus:border-violet-400/35"/>{query ? <button type="button" onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-600"><X className="size-3.5"/></button> : null}</div><div className="mt-2 flex gap-1">{([['all','Tất cả'],['bull','Bull'],['wait','Wait'],['risk','Risk']] as const).map(([value, label]) => <button key={value} onClick={() => setFilter(value)} className={cn("rounded-lg px-2.5 py-1.5 text-[9px] font-bold", filter === value ? "bg-violet-400/15 text-violet-300" : "text-slate-500")}>{label}</button>)}</div></div><div className="min-h-0 flex-1 overflow-y-auto">{filtered.map((stock) => <button key={stock.ticker} onClick={() => selectTicker(stock.ticker)} className={cn("grid w-full grid-cols-[44px_1fr_74px] items-center border-b border-white/[0.04] px-3 py-2.5 text-left", stock.ticker === activeTicker ? "border-l-2 border-l-violet-400 bg-violet-400/[0.08]" : "hover:bg-white/[0.03]")}><span className="font-mono text-[9px] text-slate-600">#{stock.rank ?? "—"}</span><span><b className="font-ticker text-sm">{stock.ticker}</b><small className="block text-[9px] text-slate-600">Score {stock.councilScore} · {pct(stock.changePct)}</small></span><span className={cn("truncate text-right text-[8px] font-black", signalTone(stock.signal))}>{compactSignal(stock.signal)}</span></button>)}</div></div></aside><CouncilWorkspace stock={active} history={activeHistory} historyMessage={data.historyMessage}/></div> : <section className="rounded-2xl border border-rose-400/15 bg-rose-400/[0.04] p-6 text-sm text-rose-200"><CircleAlert className="mr-2 inline size-4"/>AI Council chưa có dữ liệu. <span className="text-slate-400">{data.message}</span></section>}
      <footer className="mt-4 rounded-2xl border border-white/[0.06] bg-[#080d13] px-4 py-3 text-[9px] leading-5 text-slate-600"><b className="text-slate-400">Methodology:</b> Investor View chỉ trình bày lại deterministic Council theo ngôn ngữ dễ đọc. V1 không để LLM tự tính indicator hoặc tự fetch dữ liệu; specialist đọc cùng point-in-time evidence nhưng chấm độc lập, Risk có quyền CAUTION/VETO, và historical revisions vẫn immutable.</footer>
    </main></div>
  )
}
