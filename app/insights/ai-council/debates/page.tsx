import type { Metadata } from "next"
import Link from "next/link"
import type { ReactNode } from "react"
import { ArrowLeft, BrainCircuit, CircleAlert, Coins, Gauge, Scale, ShieldCheck, Swords, Target, TrendingDown, TrendingUp, Zap } from "lucide-react"

import { LandingLogin } from "@/components/auth/landing-login"
import { TopNav } from "@/components/top-nav"
import { getAiCouncilDebateDashboardData } from "@/lib/ai-council-debate-data"
import type { AiCouncilLlmDebateRecord, DebateSelectionReason } from "@/lib/ai-council-llm"
import { getServerAuthContext } from "@/lib/auth/server"
import { cn } from "@/lib/utils"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "AI Council LLM Debate — QeoIndex",
  description: "Event-selected Bull/Bear/Risk LLM debates with an advisory Chair attached to immutable deterministic Council runs.",
  alternates: { canonical: "/insights/ai-council/debates" },
}

const REASON_LABEL: Record<DebateSelectionReason, string> = {
  explicit_watchlist: "Pinned",
  signal_changed: "Signal changed",
  high_disagreement: "High disagreement",
  breakout_watch: "Confirmation watch",
  risk_conflict: "Risk conflict",
}

function statusTone(status: AiCouncilLlmDebateRecord["status"]) {
  if (status === "completed") return "border-emerald-400/25 bg-emerald-400/[0.06] text-emerald-300"
  if (status === "partial") return "border-amber-400/25 bg-amber-400/[0.06] text-amber-300"
  if (status === "failed") return "border-rose-400/25 bg-rose-400/[0.06] text-rose-300"
  return "border-slate-400/20 bg-slate-400/[0.05] text-slate-400"
}

function leanTone(lean: "bull" | "base" | "bear") {
  if (lean === "bull") return "text-emerald-300"
  if (lean === "bear") return "text-rose-300"
  return "text-amber-300"
}

function money(value: number | null) {
  if (value == null) return "—"
  if (value < 0.01) return `$${value.toFixed(4)}`
  return `$${value.toFixed(3)}`
}

function RolePanel({
  title,
  tone,
  icon,
  summary,
  confidence,
  bullets,
}: {
  title: string
  tone: string
  icon: ReactNode
  summary: string
  confidence: number | null
  bullets: string[]
}) {
  return (
    <section className="rounded-2xl border border-white/[0.07] bg-black/15 p-3.5">
      <div className="flex items-center justify-between gap-3">
        <h3 className={cn("flex items-center gap-1.5 text-[11px] font-extrabold", tone)}>{icon}{title}</h3>
        <span className="font-mono text-[9px] text-slate-600">{confidence == null ? "—" : `${confidence}%`}</span>
      </div>
      <p className="mt-2 text-[11px] leading-5 text-slate-300">{summary || "Không có output."}</p>
      {bullets.length ? <div className="mt-2 space-y-1.5">{bullets.slice(0, 3).map((item, index) => <p key={`${title}-${index}`} className="text-[10px] leading-4 text-slate-500">• {item}</p>)}</div> : null}
    </section>
  )
}

function DebateCard({ row }: { row: AiCouncilLlmDebateRecord }) {
  const cacheRate = row.inputTokens > 0 ? Math.min(100, (row.cachedInputTokens / row.inputTokens) * 100) : 0
  return (
    <article className="overflow-hidden rounded-3xl border border-white/[0.08] bg-[radial-gradient(circle_at_top_right,rgba(139,92,246,.09),transparent_30%),#080d13]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3.5">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl border border-violet-400/20 bg-violet-400/[0.08] font-mono text-sm font-black text-violet-200">{row.ticker}</div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-black text-white">{row.asOfDate}</span>
              <span className={cn("rounded-full border px-2 py-0.5 text-[8px] font-black uppercase", statusTone(row.status))}>{row.status}</span>
              {row.escalated ? <span className="rounded-full border border-fuchsia-400/25 bg-fuchsia-400/[0.06] px-2 py-0.5 text-[8px] font-black text-fuchsia-300">SOL ESCALATION</span> : null}
              {row.fallbackUsed ? <span className="rounded-full border border-amber-400/20 bg-amber-400/[0.05] px-2 py-0.5 text-[8px] font-black text-amber-300">FALLBACK</span> : null}
              {row.selectionReasons.map((reason) => <span key={reason} className="rounded-full border border-white/[0.08] px-2 py-0.5 text-[8px] font-bold text-slate-500">{REASON_LABEL[reason]}</span>)}
            </div>
            <p className="mt-1 text-[9px] text-slate-600">{row.promptVersion} · {row.totalTokens.toLocaleString("vi-VN")} tokens · cache {cacheRate.toFixed(0)}% · est. {money(row.estimatedCostUsd)}</p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[8px] font-black uppercase tracking-wider text-slate-600">Deterministic final authority</div>
          <div className="mt-1 flex items-center justify-end gap-2"><span className="font-mono text-sm font-black text-cyan-300">{row.deterministicSignal}</span><span className="font-mono text-[10px] text-slate-500">{row.deterministicScore}/100 · Risk {row.deterministicRiskStatus.toUpperCase()}</span></div>
        </div>
      </header>

      <div className="grid gap-3 p-4 lg:grid-cols-3">
        <RolePanel
          title={`Bull · ${row.modelRoute?.bull.model || "LLM"}`}
          tone="text-emerald-300"
          icon={<TrendingUp className="size-3.5" />}
          summary={row.bull?.thesis || ""}
          confidence={row.bull?.confidence ?? null}
          bullets={row.bull?.evidence || []}
        />
        <RolePanel
          title={`Bear · ${row.modelRoute?.bear.model || "LLM"}`}
          tone="text-rose-300"
          icon={<TrendingDown className="size-3.5" />}
          summary={row.bear?.thesis || ""}
          confidence={row.bear?.confidence ?? null}
          bullets={row.bear?.evidence || []}
        />
        <RolePanel
          title={`Risk · ${row.risk?.stance?.toUpperCase() || "—"} · ${row.modelRoute?.risk.model || "LLM"}`}
          tone={row.risk?.stance === "veto" ? "text-rose-300" : row.risk?.stance === "caution" ? "text-amber-300" : "text-cyan-300"}
          icon={<ShieldCheck className="size-3.5" />}
          summary={row.risk?.riskSummary || ""}
          confidence={row.risk?.confidence ?? null}
          bullets={row.risk?.keyRisks || []}
        />
      </div>

      <section className="mx-4 mb-4 rounded-2xl border border-violet-400/15 bg-violet-400/[0.035] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-violet-300"><Scale className="size-4" />Advisory LLM Chair · {row.escalated ? row.modelRoute?.escalation.model : row.modelRoute?.chair.model}</div>
            <p className="mt-2 max-w-5xl text-[12px] leading-5 text-slate-300">{row.chair?.summary || (row.error ? "Chair chưa hoàn tất; xem audit error bên dưới." : "Chưa có Chair output.")}</p>
          </div>
          <div className="text-right">
            <div className={cn("font-mono text-lg font-black uppercase", row.chair ? leanTone(row.chair.lean) : "text-slate-600")}>{row.chair?.lean || "—"}</div>
            <div className="text-[9px] text-slate-600">Chair confidence {row.chair ? `${row.chair.confidence}%` : "—"}</div>
          </div>
        </div>
        {row.chair ? (
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            <div className="rounded-xl border border-white/[0.06] bg-black/15 p-3"><div className="text-[8px] font-black uppercase text-slate-600">Key disagreement</div><p className="mt-1.5 text-[10px] leading-4 text-slate-400">{row.chair.keyDisagreement}</p></div>
            <div className="rounded-xl border border-white/[0.06] bg-black/15 p-3"><div className="text-[8px] font-black uppercase text-slate-600">Risk gate</div><p className="mt-1.5 text-[10px] leading-4 text-slate-400">{row.chair.riskGate}</p></div>
            <div className="rounded-xl border border-white/[0.06] bg-black/15 p-3"><div className="text-[8px] font-black uppercase text-slate-600">Policy alignment</div><p className={cn("mt-1.5 text-[10px] font-bold", row.chair.agreesWithDeterministic ? "text-emerald-300" : "text-amber-300")}>{row.chair.agreesWithDeterministic ? "Agrees with deterministic signal" : "Disagrees — advisory only, no override"}</p></div>
          </div>
        ) : null}
        {row.escalationReason ? <p className="mt-3 rounded-xl border border-fuchsia-400/10 bg-fuchsia-400/[0.025] px-3 py-2 text-[9px] leading-4 text-fuchsia-200/70">Sol escalation reason: {row.escalationReason}</p> : null}
        {row.error ? <p className="mt-3 rounded-xl border border-rose-400/10 bg-rose-400/[0.025] px-3 py-2 text-[9px] leading-4 text-rose-200/60">{row.error}</p> : null}
      </section>
    </article>
  )
}

export default async function AiCouncilDebatesPage() {
  const auth = await getServerAuthContext()
  if (!auth) return <LandingLogin />
  const data = await getAiCouncilDebateDashboardData(auth.supabase)
  const latestRows = data.latestDate ? data.rows.filter((row) => row.asOfDate === data.latestDate) : []
  const totalInputTokens = latestRows.reduce((sum, row) => sum + row.inputTokens, 0)
  const cacheRate = totalInputTokens > 0 ? (data.cachedInputTokens / totalInputTokens) * 100 : 0

  return (
    <div className="min-h-screen bg-[#06090d] text-white">
      <TopNav />
      <main className="mx-auto max-w-[1550px] px-3 py-5 sm:px-5 lg:px-6">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <Link href="/insights/ai-council" className="mb-3 inline-flex items-center gap-1.5 text-[10px] font-bold text-slate-500 hover:text-violet-300"><ArrowLeft className="size-3.5" />AI Council</Link>
            <div className="flex items-center gap-2.5">
              <span className="flex size-10 items-center justify-center rounded-xl border border-violet-400/20 bg-violet-400/[0.08] text-violet-300"><Swords className="size-5" /></span>
              <div><h1 className="font-ticker text-2xl font-black">LLM Debate Lab</h1><p className="text-[10px] text-slate-500">P4.1 hybrid router · Luna Bull/Bear · Terra Risk/Chair · Sol severe-conflict escalation · deterministic policy remains final.</p></div>
            </div>
          </div>
          <div className="max-w-2xl rounded-xl border border-white/[0.07] bg-[#080d13] px-3 py-2 text-[9px] text-slate-500"><div className="flex items-center gap-2"><Gauge className="size-3.5 shrink-0 text-cyan-300"/><span>{data.enabledByConfiguration ? "Runtime enabled" : "Runtime disabled"} · {data.model}</span></div></div>
        </header>

        <section className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-2xl border border-white/[0.08] bg-[#080d13] p-4"><div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-wider text-slate-600"><BrainCircuit className="size-4 text-violet-300"/>Latest debate date</div><div className="mt-3 font-mono text-xl font-black">{data.latestDate || "—"}</div><p className="mt-1 text-[9px] text-slate-600">{latestRows.length} event-selected runs</p></div>
          <div className="rounded-2xl border border-white/[0.08] bg-[#080d13] p-4"><div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-wider text-slate-600"><Target className="size-4 text-emerald-300"/>Completed</div><div className="mt-3 font-mono text-2xl font-black text-emerald-300">{data.completed}</div><p className="mt-1 text-[9px] text-slate-600">{data.partial} partial · {data.failed} failed</p></div>
          <div className="rounded-2xl border border-white/[0.08] bg-[#080d13] p-4"><div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-wider text-slate-600"><Gauge className="size-4 text-cyan-300"/>Prompt cache</div><div className="mt-3 font-mono text-2xl font-black text-cyan-300">{cacheRate.toFixed(0)}%</div><p className="mt-1 text-[9px] text-slate-600">{data.cachedInputTokens.toLocaleString("vi-VN")} cached input tokens</p></div>
          <div className="rounded-2xl border border-white/[0.08] bg-[#080d13] p-4"><div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-wider text-slate-600"><Coins className="size-4 text-amber-300"/>List-cost estimate</div><div className="mt-3 font-mono text-2xl font-black text-amber-300">{money(data.estimatedCostUsd)}</div><p className="mt-1 text-[9px] text-slate-600">Promotions / cache-write billing may differ</p></div>
          <div className="rounded-2xl border border-white/[0.08] bg-[#080d13] p-4"><div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-wider text-slate-600"><Zap className="size-4 text-fuchsia-300"/>Escalation</div><div className="mt-3 font-mono text-2xl font-black text-fuchsia-300">{data.escalated}</div><p className="mt-1 text-[9px] text-slate-600">Sol attempts · {data.fallbackUsed} fallback runs</p></div>
        </section>

        <section className="mb-4 rounded-2xl border border-cyan-400/12 bg-cyan-400/[0.025] px-4 py-3">
          <div className="flex items-start gap-2"><CircleAlert className="mt-0.5 size-4 shrink-0 text-cyan-300"/><p className="text-[10px] leading-5 text-slate-400">{data.message} P4 chỉ chọn run có signal change, disagreement, BUY_ON_CONFIRMATION, risk conflict hoặc ticker được pin. Prompt cache dùng stable evidence key; Sol chỉ chạy khi compound conflict vượt escalation gate.</p></div>
        </section>

        <section className="mb-4 grid gap-3 lg:grid-cols-3">
          <div className="rounded-2xl border border-emerald-400/12 bg-emerald-400/[0.025] p-3.5"><div className="text-[9px] font-black uppercase tracking-wider text-emerald-300">Cheap divergence layer</div><p className="mt-2 text-[11px] leading-5 text-slate-400">Bull + Bear: <span className="font-mono text-slate-200">{data.modelRoute.bull.model}</span> · effort {data.modelRoute.bull.reasoningEffort}. Hai vai trò dùng cùng evidence prefix để tối đa cache reuse.</p></div>
          <div className="rounded-2xl border border-cyan-400/12 bg-cyan-400/[0.025] p-3.5"><div className="text-[9px] font-black uppercase tracking-wider text-cyan-300">Reasoning layer</div><p className="mt-2 text-[11px] leading-5 text-slate-400">Risk + Chair: <span className="font-mono text-slate-200">{data.modelRoute.risk.model}</span> · effort {data.modelRoute.risk.reasoningEffort}/{data.modelRoute.chair.reasoningEffort}.</p></div>
          <div className="rounded-2xl border border-fuchsia-400/12 bg-fuchsia-400/[0.025] p-3.5"><div className="text-[9px] font-black uppercase tracking-wider text-fuchsia-300">Severe conflict only</div><p className="mt-2 text-[11px] leading-5 text-slate-400">Escalation: <span className="font-mono text-slate-200">{data.modelRoute.escalation.model}</span> · effort {data.modelRoute.escalation.reasoningEffort}. Final signal vẫn là deterministic Council.</p></div>
        </section>

        <div className="space-y-4">
          {data.rows.length ? data.rows.map((row) => <DebateCard key={row.id} row={row} />) : (
            <div className="rounded-3xl border border-dashed border-white/[0.1] bg-[#080d13] px-5 py-16 text-center"><Swords className="mx-auto size-8 text-slate-700"/><h2 className="mt-3 text-sm font-extrabold text-slate-300">Chưa có LLM debate</h2><p className="mx-auto mt-2 max-w-xl text-[10px] leading-5 text-slate-600">Nếu OPENAI_API_KEY đã được thêm, trạng thái này vẫn bình thường trước deterministic Council run kế tiếp hoặc khi không có event vượt P4 selection gates.</p></div>
          )}
        </div>
      </main>
    </div>
  )
}
