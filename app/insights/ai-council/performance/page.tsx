import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft, BarChart3, BrainCircuit, Gauge, ShieldCheck, Target, TrendingUp } from "lucide-react"

import { LandingLogin } from "@/components/auth/landing-login"
import { TopNav } from "@/components/top-nav"
import { getAiCouncilPerformanceData, type CouncilAgentStat } from "@/modules/ai-council/learning"
import { getServerAuthContext } from "@/modules/auth/server"
import { cn } from "@/modules/shared/ui/cn"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "AI Council Performance — QeoIndex",
  description: "Audit confirmation states, VNINDEX alpha regime and calibrated specialist-agent performance.",
  alternates: { canonical: "/insights/ai-council/performance" },
}

const AGENT_LABEL: Record<CouncilAgentStat["agentKey"], string> = {
  wyckoff: "Wyckoff Strategist",
  momentum: "Momentum Quant",
  fundamental: "Fundamental Analyst",
  flow: "Flow Analyst",
  market: "Market Strategist",
}

function pct(value: number | null, digits = 1) {
  return value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`
}

function num(value: number | null, digits = 3) {
  return value == null ? "—" : value.toFixed(digits)
}

function StatTable({ rows, title }: { rows: CouncilAgentStat[]; title: string }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#080d13]">
      <div className="border-b border-white/[0.06] px-4 py-3">
        <h2 className="text-sm font-extrabold text-white">{title}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-[11px]">
          <thead className="bg-white/[0.025] text-[9px] uppercase tracking-wider text-slate-600">
            <tr>
              <th className="px-4 py-2.5">Agent</th>
              <th className="px-3 py-2.5">Regime</th>
              <th className="px-3 py-2.5 text-right">Samples</th>
              <th className="px-3 py-2.5 text-right">Hit rate</th>
              <th className="px-3 py-2.5 text-right">Brier ↓</th>
              <th className="px-3 py-2.5 text-right">Signed D+5</th>
              <th className="px-3 py-2.5 text-right">Weight</th>
              <th className="px-4 py-2.5 text-right">State</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((row) => (
              <tr key={`${row.marketRegime}-${row.agentKey}`} className="border-t border-white/[0.045] text-slate-300">
                <td className="px-4 py-3 font-bold text-white">{AGENT_LABEL[row.agentKey]}</td>
                <td className="px-3 py-3 font-mono text-[10px] text-slate-500">{row.marketRegime}</td>
                <td className="px-3 py-3 text-right font-mono">{row.sampleCount}</td>
                <td className="px-3 py-3 text-right font-mono">{row.hitRatePct == null ? "—" : `${row.hitRatePct.toFixed(1)}%`}</td>
                <td className="px-3 py-3 text-right font-mono">{num(row.brierScore)}</td>
                <td className={cn("px-3 py-3 text-right font-mono", (row.averageSignedReturn5dPct ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300")}>{pct(row.averageSignedReturn5dPct, 2)}</td>
                <td className="px-3 py-3 text-right font-mono font-bold text-cyan-300">{(row.recommendedWeight * 100).toFixed(1)}%</td>
                <td className="px-4 py-3 text-right"><span className={cn("rounded-full border px-2 py-1 text-[9px] font-black", row.calibrated ? "border-emerald-400/20 text-emerald-300" : "border-slate-400/15 text-slate-500")}>{row.calibrated ? "CALIBRATED" : "STATIC PRIOR"}</span></td>
              </tr>
            )) : (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-600">Chưa có đủ outcome để tạo regime-specific statistics.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default async function AiCouncilPerformancePage() {
  const auth = await getServerAuthContext()
  if (!auth) return <LandingLogin />
  const data = await getAiCouncilPerformanceData(auth.supabase)
  const c = data.confirmations

  return (
    <div className="min-h-screen bg-[#06090d] text-white">
      <TopNav />
      <main className="mx-auto max-w-[1500px] px-3 py-5 sm:px-5 lg:px-6">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <Link href="/insights/ai-council" className="mb-3 inline-flex items-center gap-1.5 text-[10px] font-bold text-slate-500 hover:text-violet-300"><ArrowLeft className="size-3.5" />AI Council</Link>
            <div className="flex items-center gap-2.5"><span className="flex size-10 items-center justify-center rounded-xl border border-violet-400/20 bg-violet-400/[0.08] text-violet-300"><BarChart3 className="size-5" /></span><div><h1 className="font-ticker text-2xl font-black">Council Performance Lab</h1><p className="text-[10px] text-slate-500">Confirmation state machine · VNINDEX benchmark alpha · Brier calibration · bounded dynamic weights.</p></div></div>
          </div>
          <div className="text-right text-[10px] text-slate-500">Stats as of<br/><span className="font-mono text-sm font-bold text-slate-300">{data.asOfDate || "—"}</span></div>
        </header>

        <section className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-white/[0.08] bg-[#080d13] p-4"><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500"><BrainCircuit className="size-4 text-violet-300"/>Audit runs</div><div className="mt-3 font-mono text-3xl font-black">{data.totalRuns}</div><p className="mt-1 text-[10px] text-slate-600">{data.maturedRuns} matured to D+20</p></div>
          <div className="rounded-2xl border border-white/[0.08] bg-[#080d13] p-4"><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500"><Gauge className="size-4 text-cyan-300"/>VNINDEX regime</div><div className="mt-3 font-mono text-2xl font-black text-cyan-300">{data.benchmark.regime}</div><p className="mt-1 text-[10px] text-slate-600">Close {data.benchmark.close?.toLocaleString("vi-VN") || "—"} · 20D {pct(data.benchmark.return20dPct)}</p></div>
          <div className="rounded-2xl border border-white/[0.08] bg-[#080d13] p-4"><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500"><Target className="size-4 text-emerald-300"/>Confirmations</div><div className="mt-3 font-mono text-2xl font-black text-emerald-300">{c.triggered}</div><p className="mt-1 text-[10px] text-slate-600">{c.pending} pending · {c.failed} failed · {c.expired} expired</p></div>
          <div className="rounded-2xl border border-white/[0.08] bg-[#080d13] p-4"><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500"><TrendingUp className="size-4 text-amber-300"/>Trigger D+5 hit rate</div><div className="mt-3 font-mono text-2xl font-black text-amber-300">{c.triggerHitRatePct == null ? "—" : `${c.triggerHitRatePct.toFixed(1)}%`}</div><p className="mt-1 text-[10px] text-slate-600">Only resolved BUY_ON_CONFIRMATION triggers.</p></div>
        </section>

        <div className="space-y-4">
          <StatTable rows={data.overallStats} title="Directional agent leaderboard — all regimes" />
          <StatTable rows={data.regimeStats} title="Regime-specific calibration" />
        </div>

        <section className="mt-4 grid gap-3 lg:grid-cols-3">
          <div className="rounded-2xl border border-cyan-400/15 bg-cyan-400/[0.03] p-4"><h3 className="flex items-center gap-2 text-sm font-extrabold text-cyan-300"><Gauge className="size-4"/>P3.2 Benchmark rule</h3><p className="mt-2 text-[11px] leading-5 text-slate-400">Alpha = stock close-to-close return − VNINDEX return trên cùng published-session horizon. Regime: RISK_ON khi VNINDEX trên SMA20 và 20D &gt; +2%; RISK_OFF khi dưới SMA20 và 20D &lt; −2%; còn lại NEUTRAL.</p></div>
          <div className="rounded-2xl border border-amber-400/15 bg-amber-400/[0.03] p-4"><h3 className="flex items-center gap-2 text-sm font-extrabold text-amber-300"><Target className="size-4"/>P3.1 Confirmation rule</h3><p className="mt-2 text-[11px] leading-5 text-slate-400">BUY_ON_CONFIRMATION chỉ trigger khi một daily Council run sau đó đạt BUY + Risk APPROVE + confirmation_pending=false. REDUCE/SELL hoặc Risk VETO trước trigger = failed; 10 phiên không trigger = expired.</p></div>
          <div className="rounded-2xl border border-violet-400/15 bg-violet-400/[0.03] p-4"><h3 className="flex items-center gap-2 text-sm font-extrabold text-violet-300"><ShieldCheck className="size-4"/>P3.3–P3.4 Calibration guardrail</h3><p className="mt-2 text-[11px] leading-5 text-slate-400">Brier score dùng agent score như probability-up proxy. Dynamic weights chỉ bật sau ≥30 D+5 samples overall hoặc ≥20 samples trong một regime; trước đó giữ static priors 30/20/20/15/15 và luôn shrink về prior.</p></div>
        </section>
      </main>
    </div>
  )
}
