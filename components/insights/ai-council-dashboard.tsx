"use client"

import { useMemo, useState } from "react"
import { Activity, BarChart3, BrainCircuit, CircleAlert, Crown, Database, Gauge, LineChart, Radar, Search, ShieldCheck, Target, TrendingDown, TrendingUp, X, Zap } from "lucide-react"

import { StockIdentity } from "@/components/stock-identity"
import { TopNav } from "@/components/top-nav"
import type { AiCouncilData } from "@/lib/ai-council-data"
import type { AiCouncilStock, CouncilAgentOpinion, CouncilSignal } from "@/lib/ai-council-model"
import { cn } from "@/lib/utils"

const AGENT_ICON = { wyckoff: Radar, momentum: LineChart, fundamental: BarChart3, flow: Activity, market: Gauge, risk: ShieldCheck } as const
const SIGNAL_TONE: Record<CouncilSignal, string> = {
  BUY: "border-emerald-400/35 bg-emerald-400/10 text-emerald-300",
  BUY_ON_CONFIRMATION: "border-cyan-400/35 bg-cyan-400/10 text-cyan-200",
  WAIT: "border-slate-400/25 bg-slate-400/[0.08] text-slate-200",
  REDUCE: "border-amber-400/35 bg-amber-400/10 text-amber-300",
  SELL: "border-rose-400/35 bg-rose-400/10 text-rose-300",
}

function price(value: number | null) { return value == null ? "—" : value.toLocaleString("vi-VN", { minimumFractionDigits: 1, maximumFractionDigits: 2 }) }
function pct(value: number | null) { return value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%` }
function signalTone(signal: CouncilSignal) { return signal === "BUY" ? "text-emerald-300" : signal === "BUY_ON_CONFIRMATION" ? "text-cyan-300" : signal === "REDUCE" ? "text-amber-300" : signal === "SELL" ? "text-rose-300" : "text-slate-300" }
function stanceTone(stance: CouncilAgentOpinion["stance"]) { return stance === "bullish" || stance === "approve" ? "text-emerald-300 border-emerald-400/20" : stance === "bearish" || stance === "veto" ? "text-rose-300 border-rose-400/20" : stance === "caution" ? "text-amber-300 border-amber-400/20" : "text-slate-300 border-slate-400/20" }
function stanceLabel(stance: CouncilAgentOpinion["stance"]) { return stance.toUpperCase() }

function AgentCard({ agent }: { agent: CouncilAgentOpinion }) {
  const Icon = AGENT_ICON[agent.key]
  return (
    <article className="rounded-2xl border border-white/[0.08] bg-[#0a0f16] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-violet-400/20 bg-violet-400/[0.08] text-violet-300"><Icon className="size-4" /></span><div className="min-w-0"><h3 className="truncate text-sm font-bold text-white">{agent.label}</h3><p className="truncate text-[10px] text-slate-500">{agent.role}</p></div></div>
        <span className={cn("rounded-full border px-2 py-1 text-[9px] font-black", stanceTone(agent.stance))}>{stanceLabel(agent.stance)}</span>
      </div>
      <div className="mt-4 flex items-end justify-between"><div><div className="text-[9px] font-black uppercase tracking-wider text-slate-600">Score</div><div className={cn("font-mono text-2xl font-black", agent.score >= 60 ? "text-emerald-300" : agent.score <= 40 ? "text-rose-300" : "text-white")}>{agent.score}<span className="text-xs text-slate-600">/100</span></div></div><div className="text-right text-[10px] text-slate-500">Confidence<br/><span className="font-mono text-sm font-bold text-slate-300">{agent.confidence}%</span></div></div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.06]"><div className={cn("h-full rounded-full", agent.score >= 60 ? "bg-emerald-400" : agent.score <= 40 ? "bg-rose-400" : "bg-slate-400")} style={{ width: `${agent.score}%` }} /></div>
      <p className="mt-3 text-[12px] leading-5 text-slate-300">{agent.summary}</p>
      {agent.evidenceFor[0] ? <p className="mt-2 rounded-lg bg-emerald-400/[0.035] px-2.5 py-2 text-[10px] leading-4 text-emerald-100/75">+ {agent.evidenceFor[0]}</p> : null}
      {agent.evidenceAgainst[0] ? <p className="mt-2 rounded-lg bg-rose-400/[0.035] px-2.5 py-2 text-[10px] leading-4 text-rose-100/70">− {agent.evidenceAgainst[0]}</p> : null}
    </article>
  )
}

function Debate({ title, items, bull }: { title: string; items: string[]; bull: boolean }) {
  const Icon = bull ? TrendingUp : TrendingDown
  return <section className={cn("rounded-2xl border p-4", bull ? "border-emerald-400/15 bg-emerald-400/[0.03]" : "border-rose-400/15 bg-rose-400/[0.03]")}><h3 className={cn("flex items-center gap-2 text-sm font-extrabold", bull ? "text-emerald-300" : "text-rose-300")}><Icon className="size-4" />{title}</h3><div className="mt-3 space-y-2">{items.length ? items.map((item, i) => <p key={i} className="text-[11px] leading-5 text-slate-300">• {item}</p>) : <p className="text-[11px] text-slate-500">Chưa có evidence đủ mạnh.</p>}</div></section>
}

function CouncilWorkspace({ stock }: { stock: AiCouncilStock }) {
  return <div className="min-w-0 space-y-4">
    <section className="rounded-3xl border border-white/[0.09] bg-[radial-gradient(circle_at_top_right,rgba(139,92,246,.13),transparent_34%),linear-gradient(145deg,#0b1119,#070b10)]">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.06] px-5 py-4"><StockIdentity ticker={stock.ticker} companyName={stock.companyName} exchange={stock.exchange} detail={stock.sector} logoSize={40} className="min-w-0 flex-1"/><div className="text-right"><div className="font-mono text-2xl font-black">{price(stock.price)}</div><div className={cn("font-mono text-sm font-bold", (stock.changePct ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300")}>{pct(stock.changePct)}</div></div></div>
      <div className="grid gap-5 px-5 py-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,.65fr)]">
        <div><div className="flex flex-wrap gap-2 text-[9px] font-black uppercase tracking-wider"><span className="text-violet-300">Council verdict</span>{stock.confirmationPending ? <span className="rounded-full border border-cyan-400/20 px-2 py-0.5 text-cyan-300">Confirmation pending</span> : null}<span className="rounded-full border border-white/10 px-2 py-0.5 text-slate-400">Data {stock.dataQuality}</span></div><div className={cn("mt-3 inline-flex rounded-2xl border px-4 py-2.5 font-ticker text-xl font-black sm:text-2xl", SIGNAL_TONE[stock.signal])}>{stock.signalLabel}</div><p className="mt-4 max-w-3xl text-[12px] leading-5 text-slate-300">{stock.dissent}</p></div>
        <div className="grid grid-cols-3 gap-2"><div className="rounded-xl border border-white/[0.07] bg-black/10 p-3 text-center"><div className="text-[9px] uppercase text-slate-600">Score</div><div className="mt-1 font-mono text-xl font-black text-white">{stock.councilScore}</div></div><div className="rounded-xl border border-white/[0.07] bg-black/10 p-3 text-center"><div className="text-[9px] uppercase text-slate-600">Consensus</div><div className="mt-1 font-mono text-xl font-black text-violet-300">{stock.consensus}%</div></div><div className="rounded-xl border border-white/[0.07] bg-black/10 p-3 text-center"><div className="text-[9px] uppercase text-slate-600">Confidence</div><div className="mt-1 font-mono text-xl font-black text-cyan-300">{stock.confidence}%</div></div><div className="col-span-3 rounded-xl border border-white/[0.07] bg-black/10 px-3 py-2 text-center text-[10px] text-slate-400"><span className="text-emerald-300">{stock.bullVotes} Bull</span> · {stock.neutralVotes} Neutral · <span className="text-rose-300">{stock.bearVotes} Bear</span> · Risk <span className={stock.riskStatus === "approve" ? "text-emerald-300" : stock.riskStatus === "veto" ? "text-rose-300" : "text-amber-300"}>{stock.riskStatus.toUpperCase()}</span></div></div>
      </div>
    </section>

    <section><div className="mb-2 flex items-center gap-2"><BrainCircuit className="size-4 text-violet-300"/><h2 className="text-sm font-extrabold">Independent specialist opinions</h2></div><div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">{stock.agents.map(agent => <AgentCard key={agent.key} agent={agent}/>)}</div></section>
    <section className="grid gap-3 lg:grid-cols-2"><Debate title="Bull Researcher" items={stock.bullCase} bull/><Debate title="Bear Researcher" items={stock.bearCase} bull={false}/></section>
    <section className="grid gap-3 lg:grid-cols-[.8fr_1.2fr]"><div className="rounded-2xl border border-amber-400/15 bg-amber-400/[0.03] p-4"><h3 className="flex items-center gap-2 text-sm font-extrabold text-amber-300"><CircleAlert className="size-4"/>Minority / Risk view</h3><p className="mt-3 text-[11px] leading-5 text-slate-300">{stock.dissent}</p></div><div className="rounded-2xl border border-white/[0.08] bg-[#080d13] p-4"><h3 className="flex items-center gap-2 text-sm font-extrabold"><Target className="size-4 text-cyan-300"/>Decision levels</h3><div className="mt-3 grid gap-2 sm:grid-cols-2"><Level label="Support" value={stock.support} tone="text-emerald-300"/><Level label="Resistance" value={stock.resistance} tone="text-amber-300"/><Level label="Confirmation" value={stock.confirmation} tone="text-cyan-300"/><Level label="Invalidation" value={stock.invalidation} tone="text-rose-300"/></div></div></section>
    <section className="rounded-2xl border border-white/[0.08] bg-[#080d13] p-4"><h3 className="flex items-center gap-2 text-sm font-extrabold"><Zap className="size-4 text-cyan-300"/>What changes the decision?</h3><div className="mt-3 grid gap-2 md:grid-cols-3">{stock.whatChangesDecision.map((item, i) => <p key={i} className="rounded-xl border border-white/[0.06] bg-black/10 p-3 text-[10px] leading-5 text-slate-300">{item}</p>)}</div><p className="mt-3 border-t border-white/[0.06] pt-3 text-[9px] leading-4 text-slate-600">{stock.dataQualityDetail}</p></section>
  </div>
}

function Level({ label, value, tone }: { label: string; value: string; tone: string }) { return <div className="rounded-xl border border-white/[0.07] bg-black/10 p-3"><div className="text-[9px] font-black uppercase tracking-wider text-slate-600">{label}</div><p className={cn("mt-1.5 text-[10px] leading-4", tone)}>{value || "—"}</p></div> }

export function AiCouncilDashboard({ data, initialTicker = "" }: { data: AiCouncilData; initialTicker?: string }) {
  const initial = data.stocks.find(stock => stock.ticker === initialTicker.toUpperCase())?.ticker || data.stocks[0]?.ticker || ""
  const [activeTicker, setActiveTicker] = useState(initial)
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<"all" | "bull" | "wait" | "risk">("all")
  const filtered = useMemo(() => data.stocks.filter(stock => {
    const q = query.trim().toUpperCase()
    if (q && !stock.ticker.includes(q) && !stock.companyName.toUpperCase().includes(q)) return false
    if (filter === "bull") return stock.signal === "BUY" || stock.signal === "BUY_ON_CONFIRMATION"
    if (filter === "wait") return stock.signal === "WAIT"
    if (filter === "risk") return stock.signal === "REDUCE" || stock.signal === "SELL" || stock.riskStatus !== "approve"
    return true
  }), [data.stocks, filter, query])
  const active = data.stocks.find(stock => stock.ticker === activeTicker) || data.stocks[0]
  function selectTicker(ticker: string) { setActiveTicker(ticker); const next = new URL(window.location.href); next.searchParams.set("ticker", ticker); window.history.replaceState(null, "", `${next.pathname}${next.search}`) }

  return <div className="min-h-screen bg-[#06090d] text-white"><TopNav/><main className="mx-auto max-w-[1720px] px-3 py-4 sm:px-5 lg:px-6">
    <header className="mb-4 flex flex-wrap items-end justify-between gap-4"><div className="flex items-center gap-2"><span className="flex size-9 items-center justify-center rounded-xl border border-violet-400/25 bg-violet-400/[0.09] text-violet-300"><BrainCircuit className="size-[18px]"/></span><div><div className="flex items-center gap-2"><h1 className="font-ticker text-xl font-black sm:text-2xl">AI Council</h1><span className="rounded-full border border-violet-400/20 bg-violet-400/[0.08] px-2 py-0.5 text-[9px] font-black text-violet-300">BETA</span></div><p className="text-[10px] text-slate-500">Independent evidence agents → Bull/Bear debate → Risk audit → deterministic signal.</p></div></div><div className="flex gap-2 text-[9px] text-slate-500"><span className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.07] px-2.5 py-1.5"><Database className="size-3.5 text-cyan-400"/>Rating {data.ratingDate || "—"}</span><span className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.07] px-2.5 py-1.5"><Crown className="size-3.5 text-violet-400"/>Evidence Ensemble V1</span></div></header>
    {data.stocks.length && active ? <div className="grid gap-4 xl:grid-cols-[290px_minmax(0,1fr)]"><aside className="xl:sticky xl:top-[72px] xl:h-[calc(100vh-88px)]"><div className="flex h-full min-h-[520px] flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#080d13]"><div className="border-b border-white/[0.06] p-3"><div className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-600"/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Tìm mã / công ty..." className="w-full rounded-xl border border-white/[0.08] bg-[#05080c] py-2.5 pl-9 pr-8 text-xs outline-none focus:border-violet-400/35"/>{query ? <button type="button" onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-600"><X className="size-3.5"/></button> : null}</div><div className="mt-2 flex gap-1">{([['all','Tất cả'],['bull','Bull'],['wait','Wait'],['risk','Risk']] as const).map(([value,label]) => <button key={value} onClick={() => setFilter(value)} className={cn("rounded-lg px-2.5 py-1.5 text-[9px] font-bold", filter === value ? "bg-violet-400/15 text-violet-300" : "text-slate-500")}>{label}</button>)}</div></div><div className="min-h-0 flex-1 overflow-y-auto">{filtered.map(stock => <button key={stock.ticker} onClick={() => selectTicker(stock.ticker)} className={cn("grid w-full grid-cols-[44px_1fr_74px] items-center border-b border-white/[0.04] px-3 py-2.5 text-left", stock.ticker === activeTicker ? "border-l-2 border-l-violet-400 bg-violet-400/[0.08]" : "hover:bg-white/[0.03]")}><span className="font-mono text-[9px] text-slate-600">#{stock.rank ?? "—"}</span><span><b className="font-ticker text-sm">{stock.ticker}</b><small className="block text-[9px] text-slate-600">Score {stock.councilScore} · {pct(stock.changePct)}</small></span><span className={cn("truncate text-right text-[8px] font-black", signalTone(stock.signal))}>{stock.signal === "BUY_ON_CONFIRMATION" ? "CONFIRM" : stock.signal}</span></button>)}</div></div></aside><CouncilWorkspace stock={active}/></div> : <section className="rounded-2xl border border-rose-400/15 bg-rose-400/[0.04] p-6 text-sm text-rose-200"><CircleAlert className="mr-2 inline size-4"/>AI Council chưa có dữ liệu. <span className="text-slate-400">{data.message}</span></section>}
    <footer className="mt-4 rounded-2xl border border-white/[0.06] bg-[#080d13] px-4 py-3 text-[9px] leading-5 text-slate-600"><b className="text-slate-400">Methodology:</b> V1 không để LLM tự tính indicator hoặc tự fetch dữ liệu. Specialist đọc cùng point-in-time evidence nhưng chấm độc lập; Risk có quyền CAUTION/VETO; Chair dùng policy cố định để tránh majority-vote và judge bias. Signal là analytical decision support, không phải cam kết lợi nhuận.</footer>
  </main></div>
}
