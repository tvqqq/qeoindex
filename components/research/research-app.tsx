"use client"

import Link from "next/link"
import { useMemo, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import {
  Activity,
  AlertTriangle,
  Clock,
  Database,
  ExternalLink,
  RefreshCw,
  Search,
  ShieldCheck,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react"

import { TopNav } from "@/components/top-nav"
import type {
  Bias,
  MarketRegime,
  ProbabilitySet,
  ResearchData,
  Thesis,
} from "@/lib/research-types"

type Mode = "overview" | "changes" | "log" | "review" | "ticker"

const SUBNAV: { label: string; href: string; mode: Exclude<Mode, "ticker"> }[] = [
  { label: "Overview", href: "/research", mode: "overview" },
  { label: "Thesis Changes", href: "/research/changes", mode: "changes" },
  { label: "Analysis Log", href: "/research/log", mode: "log" },
  { label: "Review", href: "/research/review", mode: "review" },
]

function compactDate(value: string) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: value.includes("T") ? "2-digit" : undefined,
    minute: value.includes("T") ? "2-digit" : undefined,
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(date)
}

function pct(value: number | null) {
  return value == null ? "—" : `${value}%`
}

function delta(current: number | null, previous: number | null) {
  if (current == null || previous == null) return null
  return current - previous
}

function biasClasses(bias: Bias) {
  switch (bias) {
    case "Bullish":
      return "border-up/25 bg-up/10 text-up"
    case "Bearish":
      return "border-down/25 bg-down/10 text-down"
    case "Mixed":
      return "border-ref/25 bg-ref/10 text-ref"
    default:
      return "border-border-strong bg-panel-2 text-muted-2"
  }
}

function regimeClasses(regime: MarketRegime) {
  switch (regime) {
    case "Risk-On":
      return "border-up/25 bg-up/10 text-up"
    case "Risk-Off":
      return "border-down/25 bg-down/10 text-down"
    default:
      return "border-ref/25 bg-ref/10 text-ref"
  }
}

function BiasPill({ label, bias }: { label: string; bias: Bias }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium ${biasClasses(bias)}`}>
      <span className="text-[10px] uppercase opacity-60">{label}</span>
      {bias || "—"}
    </span>
  )
}

function RegimePill({ regime }: { regime: MarketRegime }) {
  return (
    <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${regimeClasses(regime)}`}>
      {regime || "—"}
    </span>
  )
}

function ScenarioBars({ probabilities, compact = false }: { probabilities: ProbabilitySet; compact?: boolean }) {
  const rows = [
    { label: "Bull", value: probabilities.bull, cls: "bg-up" },
    { label: "Base", value: probabilities.base, cls: "bg-ref" },
    { label: "Bear", value: probabilities.bear, cls: "bg-down" },
  ]
  return (
    <div className={compact ? "w-[150px] space-y-1" : "space-y-3"}>
      {rows.map((row) => (
        <div key={row.label}>
          <div className="mb-1 flex items-center justify-between text-[11px]">
            <span className="text-muted-2">{row.label}</span>
            <span className="font-mono text-foreground">{pct(row.value)}</span>
          </div>
          <div className={`${compact ? "h-1" : "h-1.5"} overflow-hidden rounded-full bg-panel-2`}>
            <div className={`h-full rounded-full ${row.cls}`} style={{ width: `${Math.max(0, Math.min(100, row.value ?? 0))}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function MetricCard({ title, value, detail, icon }: { title: string; value: string; detail: string; icon: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted">{title}</span>
        <span className="text-muted-2">{icon}</span>
      </div>
      <div className="text-2xl font-semibold text-foreground">{value}</div>
      <p className="mt-1 text-xs leading-5 text-muted-2">{detail}</p>
    </div>
  )
}

function ResearchHeader({ data, mode }: { data: ResearchData; mode: Mode }) {
  const router = useRouter()
  return (
    <div className="border-b border-border bg-panel/70">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-3 px-4 py-3 lg:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold text-foreground">Research Command Center</h1>
              <span className={["rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", data.connection.notionLive ? "border-up/25 bg-up/10 text-up" : "border-ref/25 bg-ref/10 text-ref"].join(" ")}>
                {data.connection.notionLive ? "Notion live" : "Snapshot fallback"}
              </span>
            </div>
            <p className="mt-1 max-w-3xl text-xs text-muted-2">{data.connection.message}</p>
          </div>
          <button type="button" onClick={() => router.refresh()} className="inline-flex items-center gap-2 rounded-md border border-border-strong bg-panel-2 px-3 py-2 text-xs font-medium text-muted-2 transition-colors hover:text-foreground">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
        <div className="flex items-center gap-1 overflow-x-auto">
          {SUBNAV.map((item) => {
            const active = mode === item.mode || (mode === "ticker" && item.mode === "overview")
            return (
              <Link key={item.href} href={item.href} className={["whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors", active ? "bg-brand/15 text-brand" : "text-muted-2 hover:bg-panel-2 hover:text-foreground"].join(" ")}>
                {item.label}
              </Link>
            )
          })}
          <span className="ml-auto hidden whitespace-nowrap text-[11px] text-muted lg:block">Synced {compactDate(data.generatedAt)}</span>
        </div>
      </div>
    </div>
  )
}

function MarketContext({ vnindex }: { vnindex?: Thesis }) {
  if (!vnindex) return null
  return (
    <div className="rounded-lg border border-border bg-panel p-4">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-lg font-bold text-foreground">VNINDEX</span>
            <RegimePill regime={vnindex.marketRegime} />
            <BiasPill label="TA" bias={vnindex.taBias} />
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-2">{vnindex.baseCase}</p>
        </div>
        <div className="flex items-start gap-6">
          {vnindex.price && (
            <div className="text-right">
              <div className="font-mono text-2xl font-semibold text-foreground">{vnindex.price.value.toLocaleString("en-US", { maximumFractionDigits: 2 })}</div>
              <div className={`text-xs ${vnindex.price.changePct >= 0 ? "text-up" : "text-down"}`}>{vnindex.price.changePct >= 0 ? "+" : ""}{vnindex.price.changePct.toFixed(2)}%</div>
              <div className="mt-1 text-[10px] text-muted">{vnindex.price.source} · {compactDate(vnindex.price.timestamp)}</div>
            </div>
          )}
          <ScenarioBars probabilities={vnindex.probabilities} compact />
        </div>
      </div>
    </div>
  )
}

function Overview({ data }: { data: ResearchData }) {
  const vnindex = data.theses.find((row) => row.ticker === "VNINDEX")
  const stockTheses = data.theses.filter((row) => row.ticker !== "VNINDEX")
  const pendingReviews = data.logs.filter((row) => !row.actualScenario || row.actualScenario === "Unresolved").length
  const changed = data.theses.filter((row) => row.whatChanged).length
  return (
    <div className="space-y-4">
      <MarketContext vnindex={vnindex} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Market state" value={vnindex?.marketRegime || "—"} detail="Market context từ canonical VNINDEX thesis." icon={<Activity className="h-4 w-4" />} />
        <MetricCard title="Tracked theses" value={String(stockTheses.length)} detail="Không tính VNINDEX market-context row." icon={<Database className="h-4 w-4" />} />
        <MetricCard title="Thesis changes" value={String(changed)} detail="Ticker có What Changed trong current thesis." icon={<TrendingUp className="h-4 w-4" />} />
        <MetricCard title="Pending review" value={String(pendingReviews)} detail="Analysis chưa có actual scenario." icon={<Clock className="h-4 w-4" />} />
      </div>
      <section className="overflow-hidden rounded-lg border border-border bg-panel">
        <div className="border-b border-border px-4 py-3"><h2 className="text-sm font-semibold text-foreground">Research Overview</h2><p className="mt-0.5 text-xs text-muted">Canonical thesis read-model</p></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-xs">
            <thead className="bg-panel-2 text-[10px] uppercase tracking-[0.1em] text-muted"><tr><th className="px-4 py-2.5">Ticker</th><th className="px-3 py-2.5">Bias</th><th className="px-3 py-2.5">Wyckoff / Structure</th><th className="px-3 py-2.5">Scenarios</th><th className="px-3 py-2.5">Support</th><th className="px-3 py-2.5">Resistance</th><th className="px-3 py-2.5">Confidence</th><th className="px-3 py-2.5">Updated</th></tr></thead>
            <tbody>
              {data.theses.map((thesis) => (
                <tr key={thesis.id} className="border-t border-border/70 align-top transition-colors hover:bg-panel-2/60">
                  <td className="px-4 py-3"><Link href={`/research/${thesis.ticker.toLowerCase()}`} className="group inline-flex items-center gap-2"><span className="font-mono text-sm font-bold text-foreground group-hover:text-brand">{thesis.ticker}</span>{thesis.price && <span className="font-mono text-[11px] text-muted-2">{thesis.price.value.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>}</Link><div className="mt-1 max-w-[170px] truncate text-[11px] text-muted">{thesis.company}</div></td>
                  <td className="px-3 py-3"><div className="flex flex-col items-start gap-1.5"><BiasPill label="TA" bias={thesis.taBias} />{thesis.faBias && <BiasPill label="FA" bias={thesis.faBias} />}</div></td>
                  <td className="max-w-[310px] px-3 py-3"><p className="line-clamp-3 leading-5 text-muted-2">{thesis.wyckoffState || "—"}</p></td>
                  <td className="px-3 py-3"><ScenarioBars probabilities={thesis.probabilities} compact /></td>
                  <td className="max-w-[190px] px-3 py-3 leading-5 text-muted-2">{thesis.support || "—"}</td>
                  <td className="max-w-[210px] px-3 py-3 leading-5 text-muted-2">{thesis.resistance || "—"}</td>
                  <td className="px-3 py-3"><span className="rounded-md border border-border-strong bg-panel-2 px-2 py-1 font-mono text-[11px] text-foreground">{thesis.confidence || "—"}</span></td>
                  <td className="whitespace-nowrap px-3 py-3 text-muted-2">{compactDate(thesis.updated)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="grid gap-3 lg:grid-cols-2">
        {data.theses.filter((row) => row.whatChanged).slice(0, 4).map((thesis) => (
          <Link href={`/research/${thesis.ticker.toLowerCase()}`} key={thesis.id} className="rounded-lg border border-border bg-panel p-4 transition-colors hover:border-border-strong hover:bg-panel-2/40">
            <div className="flex items-center justify-between gap-4"><div className="font-mono text-sm font-bold text-foreground">{thesis.ticker}</div><span className="text-[10px] uppercase tracking-[0.1em] text-muted">What changed</span></div>
            <p className="mt-2 text-sm leading-6 text-muted-2">{thesis.whatChanged}</p>
          </Link>
        ))}
      </section>
    </div>
  )
}

function ProbabilityDelta({ label, value }: { label: string; value: number | null }) {
  if (value == null) return <span className="rounded border border-border bg-panel-2 px-2 py-1 text-[11px] text-muted">{label} —</span>
  const cls = value > 0 ? "text-up" : value < 0 ? "text-down" : "text-muted-2"
  return <span className={`rounded border border-border bg-panel-2 px-2 py-1 font-mono text-[11px] ${cls}`}>{label} {value > 0 ? "+" : ""}{value}%</span>
}

function ThesisChanges({ data }: { data: ResearchData }) {
  const changes = useMemo(() => data.theses.map((thesis) => {
    const logs = data.logs.filter((row) => row.ticker === thesis.ticker).sort((a, b) => new Date(b.date || b.updated || 0).getTime() - new Date(a.date || a.updated || 0).getTime())
    const latest = logs[0]
    const previous = logs[1]
    return { thesis, latest, previous, deltas: previous ? { bull: delta(latest?.probabilities.bull ?? null, previous.probabilities.bull), base: delta(latest?.probabilities.base ?? null, previous.probabilities.base), bear: delta(latest?.probabilities.bear ?? null, previous.probabilities.bear) } : { bull: null, base: null, bear: null } }
  }), [data])
  return (
    <div className="space-y-3">
      {changes.map(({ thesis, latest, previous, deltas }) => (
        <article key={thesis.id} className="rounded-lg border border-border bg-panel p-4">
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
            <div><div className="flex flex-wrap items-center gap-2"><Link href={`/research/${thesis.ticker.toLowerCase()}`} className="font-mono text-base font-bold text-foreground hover:text-brand">{thesis.ticker}</Link><BiasPill label="TA" bias={thesis.taBias} /><RegimePill regime={thesis.marketRegime} /></div><p className="mt-2 max-w-4xl text-sm leading-6 text-muted-2">{thesis.whatChanged || latest?.summary || "Chưa có change note."}</p></div>
            <div className="flex shrink-0 flex-wrap gap-1.5"><ProbabilityDelta label="Bull" value={deltas.bull} /><ProbabilityDelta label="Base" value={deltas.base} /><ProbabilityDelta label="Bear" value={deltas.bear} /></div>
          </div>
          <div className="mt-4 grid gap-3 border-t border-border/70 pt-4 lg:grid-cols-3">
            <div><div className="text-[10px] uppercase tracking-[0.1em] text-muted">Current base</div><p className="mt-1 text-xs leading-5 text-muted-2">{thesis.baseCase}</p></div>
            <div><div className="text-[10px] uppercase tracking-[0.1em] text-muted">Confirmation</div><p className="mt-1 text-xs leading-5 text-muted-2">{thesis.confirmation || "—"}</p></div>
            <div><div className="text-[10px] uppercase tracking-[0.1em] text-muted">Invalidation</div><p className="mt-1 text-xs leading-5 text-muted-2">{thesis.invalidation || "—"}</p></div>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted">{latest && <span>Latest: {latest.analysis}</span>}{previous && <span>Previous: {previous.analysis}</span>}</div>
        </article>
      ))}
    </div>
  )
}

function LogView({ data }: { data: ResearchData }) {
  const [query, setQuery] = useState("")
  const rows = data.logs.filter((row) => `${row.ticker} ${row.analysis} ${row.summary} ${row.type.join(" ")}`.toLowerCase().includes(query.toLowerCase()))
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-panel">
      <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-sm font-semibold text-foreground">Analysis Log</h2><p className="mt-0.5 text-xs text-muted">Prediction history is preserved; no hindsight rewrite.</p></div>
        <label className="flex w-full items-center gap-2 rounded-md border border-border-strong bg-background px-3 py-2 sm:w-[300px]"><Search className="h-3.5 w-3.5 text-muted" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ticker, TA, FA..." className="w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted" /></label>
      </div>
      <div className="divide-y divide-border/70">
        {rows.map((row) => (
          <article key={row.id} className="p-4">
            <div className="flex flex-col justify-between gap-3 lg:flex-row">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-sm font-bold text-foreground">{row.ticker || "—"}</span>{row.type.map((type) => <span key={type} className="rounded border border-border-strong bg-panel-2 px-1.5 py-0.5 text-[10px] text-muted-2">{type}</span>)}{row.timeframes.map((tf) => <span key={tf} className="text-[10px] text-muted">{tf}</span>)}</div><a href={row.notionUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-foreground hover:text-brand">{row.analysis}<ExternalLink className="h-3 w-3" /></a><p className="mt-2 max-w-5xl text-xs leading-5 text-muted-2">{row.summary}</p></div>
              <div className="shrink-0"><ScenarioBars probabilities={row.probabilities} compact /></div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] text-muted"><span>{compactDate(row.date)}</span><span>Outcome: {row.outcome || "—"}</span><span>Actual: {row.actualScenario || "—"}</span>{row.errorClass && <span>Error: {row.errorClass}</span>}</div>
          </article>
        ))}
        {rows.length === 0 && <div className="p-8 text-center text-sm text-muted-2">Không tìm thấy analysis phù hợp.</div>}
      </div>
    </section>
  )
}

function ReviewView({ data }: { data: ResearchData }) {
  const resolved = data.logs.filter((row) => row.actualScenario && row.actualScenario !== "Unresolved")
  const pending = data.logs.length - resolved.length
  const baseOccurred = resolved.filter((row) => row.actualScenario === "Base").length
  const invalidated = data.logs.filter((row) => row.outcome === "Invalidated").length
  const errors = data.logs.reduce<Record<string, number>>((acc, row) => { if (row.errorClass) acc[row.errorClass] = (acc[row.errorClass] ?? 0) + 1; return acc }, {})
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Evaluated" value={String(resolved.length)} detail="Logs đã được gắn Actual Scenario." icon={<ShieldCheck className="h-4 w-4" />} />
        <MetricCard title="Base occurred" value={String(baseOccurred)} detail="Actual Scenario = Base trong các case đã review." icon={<Target className="h-4 w-4" />} />
        <MetricCard title="Invalidated" value={String(invalidated)} detail="Outcome được đánh dấu Invalidated." icon={<TrendingDown className="h-4 w-4" />} />
        <MetricCard title="Unresolved" value={String(pending)} detail="Chưa đủ outcome để review." icon={<Clock className="h-4 w-4" />} />
      </div>
      {resolved.length === 0 && <div className="rounded-lg border border-ref/25 bg-ref/5 p-4"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-4 w-4 text-ref" /><div><h2 className="text-sm font-semibold text-foreground">Review engine đã sẵn sàng</h2><p className="mt-1 text-xs leading-5 text-muted-2">Hiện chưa có case nào được gắn Actual Scenario, nên StockOS không tự tạo hit-rate giả. Khi outcome rõ, cập nhật Actual Scenario / Outcome / Error Class / Lesson Learned trong Notion; scoreboard sẽ phản ánh trực tiếp.</p></div></div></div>}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-border bg-panel p-4"><h2 className="text-sm font-semibold text-foreground">Error taxonomy</h2><p className="mt-1 text-xs text-muted">Chỉ tính những log đã có Error Class.</p><div className="mt-4 space-y-2">{Object.entries(errors).length === 0 ? <div className="rounded-md border border-border bg-panel-2 p-3 text-xs text-muted-2">Chưa có error classification.</div> : Object.entries(errors).sort(([, aCount], [, bCount]) => Number(bCount) - Number(aCount)).map(([name, count]) => <div key={name} className="flex items-center justify-between text-xs"><span className="text-muted-2">{name}</span><span className="font-mono text-foreground">{count}</span></div>)}</div></section>
        <section className="rounded-lg border border-border bg-panel p-4"><h2 className="text-sm font-semibold text-foreground">Reusable lessons</h2><p className="mt-1 text-xs text-muted">Latest reviewed lessons from Analysis Log.</p><div className="mt-4 space-y-3">{data.logs.filter((row) => row.lessonLearned).length === 0 ? <div className="rounded-md border border-border bg-panel-2 p-3 text-xs text-muted-2">Chưa có lesson learned được ghi nhận.</div> : data.logs.filter((row) => row.lessonLearned).slice(0, 5).map((row) => <div key={row.id} className="border-l border-brand/50 pl-3"><div className="font-mono text-[10px] text-brand">{row.ticker}</div><p className="mt-1 text-xs leading-5 text-muted-2">{row.lessonLearned}</p></div>)}</div></section>
      </div>
    </div>
  )
}

function InfoBlock({ title, children, tone = "default" }: { title: string; children: ReactNode; tone?: "default" | "positive" | "warning" | "danger" }) {
  const border = tone === "positive" ? "border-up/25" : tone === "warning" ? "border-ref/25" : tone === "danger" ? "border-down/25" : "border-border"
  return <section className={`rounded-lg border ${border} bg-panel p-4`}><h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">{title}</h3><div className="mt-2 text-sm leading-6 text-muted-2">{children}</div></section>
}

function TickerDetail({ data, ticker }: { data: ResearchData; ticker: string }) {
  const thesis = data.theses.find((row) => row.ticker.toLowerCase() === ticker.toLowerCase())
  if (!thesis) return <div className="rounded-lg border border-border bg-panel p-8 text-center"><div className="text-lg font-semibold text-foreground">Ticker chưa có canonical thesis</div><p className="mt-2 text-sm text-muted-2">Không tìm thấy {ticker.toUpperCase()} trong Stock Thesis.</p><Link href="/research" className="mt-4 inline-block text-sm font-medium text-brand">Quay lại Research Overview</Link></div>
  const logs = data.logs.filter((row) => row.ticker === thesis.ticker).sort((a, b) => new Date(b.date || b.updated || 0).getTime() - new Date(a.date || a.updated || 0).getTime())
  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-panel p-5">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-2xl font-bold text-foreground">{thesis.ticker}</span><span className="text-sm text-muted-2">{thesis.company}</span><RegimePill regime={thesis.marketRegime} /></div><div className="mt-3 flex flex-wrap gap-2"><BiasPill label="TA" bias={thesis.taBias} />{thesis.faBias && <BiasPill label="FA" bias={thesis.faBias} />}<span className="rounded-md border border-border-strong bg-panel-2 px-2 py-1 text-xs text-muted-2">Confidence <span className="font-mono text-foreground">{thesis.confidence || "—"}</span></span><span className="rounded-md border border-border-strong bg-panel-2 px-2 py-1 text-xs text-muted-2">{thesis.status || "—"}</span></div>{thesis.price && <div className="mt-5 flex items-baseline gap-3"><span className="font-mono text-3xl font-semibold text-foreground">{thesis.price.value.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span><span className={`font-mono text-sm ${thesis.price.changePct >= 0 ? "text-up" : "text-down"}`}>{thesis.price.changePct >= 0 ? "+" : ""}{thesis.price.changePct.toFixed(2)}%</span><span className="text-[10px] text-muted">{thesis.price.source} · {compactDate(thesis.price.timestamp)}</span></div>}</div>
          <div className="w-full lg:w-[300px]"><div className="mb-2 text-[10px] uppercase tracking-[0.12em] text-muted">Scenario allocation</div><ScenarioBars probabilities={thesis.probabilities} /></div>
        </div>
      </section>
      <div className="grid gap-4 xl:grid-cols-[1.3fr_0.7fr]">
        <div className="space-y-4"><InfoBlock title="What changed" tone="warning">{thesis.whatChanged || "Chưa có change note."}</InfoBlock><InfoBlock title="Base case">{thesis.baseCase || "—"}</InfoBlock><InfoBlock title="Wyckoff / Structure">{thesis.wyckoffState || "—"}</InfoBlock>
          <section className="rounded-lg border border-border bg-panel"><div className="border-b border-border px-4 py-3"><h3 className="text-sm font-semibold text-foreground">Recent Analysis</h3></div><div className="divide-y divide-border/70">{logs.map((row) => <div key={row.id} className="p-4"><div className="flex flex-col justify-between gap-3 md:flex-row"><div className="min-w-0"><a href={row.notionUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-foreground hover:text-brand">{row.analysis}<ExternalLink className="h-3 w-3" /></a><p className="mt-1.5 text-xs leading-5 text-muted-2">{row.summary}</p></div><ScenarioBars probabilities={row.probabilities} compact /></div></div>)}{logs.length === 0 && <div className="p-4 text-xs text-muted-2">Chưa có Analysis Log.</div>}</div></section>
        </div>
        <div className="space-y-4"><InfoBlock title="Support">{thesis.support || "—"}</InfoBlock><InfoBlock title="Resistance">{thesis.resistance || "—"}</InfoBlock><InfoBlock title="Confirmation" tone="positive">{thesis.confirmation || "—"}</InfoBlock><InfoBlock title="Invalidation" tone="danger">{thesis.invalidation || "—"}</InfoBlock>
          <section className="rounded-lg border border-border bg-panel p-4"><h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Sources</h3><div className="mt-3 flex flex-col gap-2"><a href={thesis.notionUrl} target="_blank" rel="noreferrer" className="inline-flex items-center justify-between rounded-md border border-border-strong bg-panel-2 px-3 py-2 text-xs text-muted-2 hover:text-foreground">Canonical Notion thesis<ExternalLink className="h-3 w-3" /></a>{thesis.driveFolder && <a href={thesis.driveFolder} target="_blank" rel="noreferrer" className="inline-flex items-center justify-between rounded-md border border-border-strong bg-panel-2 px-3 py-2 text-xs text-muted-2 hover:text-foreground">Drive evidence<ExternalLink className="h-3 w-3" /></a>}</div><div className="mt-3 text-[10px] leading-4 text-muted">Current thesis updated {compactDate(thesis.updated)}. Price snapshot is timestamped separately and is not assumed realtime.</div></section>
        </div>
      </div>
    </div>
  )
}

export function ResearchApp({ data, mode, ticker = "" }: { data: ResearchData; mode: Mode; ticker?: string }) {
  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <ResearchHeader data={data} mode={mode} />
      <main className="mx-auto max-w-[1600px] p-4 lg:p-6">
        {mode === "overview" && <Overview data={data} />}
        {mode === "changes" && <ThesisChanges data={data} />}
        {mode === "log" && <LogView data={data} />}
        {mode === "review" && <ReviewView data={data} />}
        {mode === "ticker" && <TickerDetail data={data} ticker={ticker} />}
      </main>
    </div>
  )
}
