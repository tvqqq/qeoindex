"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { Activity, AlertTriangle, Database, Search, ShieldCheck } from "lucide-react"
import { TickerResearchLink } from "@/components/ticker-research-link"
import { TopNav } from "@/components/top-nav"
import type { DailyScanRow, ScannerData } from "@/modules/signals/scanner/data"

function n(value: number | null | undefined, digits = 1) { return typeof value === "number" ? value.toLocaleString("en-US", { maximumFractionDigits: digits }) : "—" }
function biasClass(bias: string) { return bias === "Bullish" ? "text-up" : bias === "Bearish" ? "text-down" : bias === "Mixed" ? "text-ref" : "text-foreground/70" }
function Scenario({ scan }: { scan?: DailyScanRow }) {
  if (!scan) return <span className="text-foreground/40">Chưa quét</span>
  return <span className="font-mono text-xs">T {scan.bullProbability ?? "—"} · CS {scan.baseProbability ?? "—"} · G {scan.bearProbability ?? "—"}</span>
}

export function ScannerApp({ data }: { data: ScannerData }) {
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState("all")
  const scans = Object.values(data.latestScans)
  const rows = useMemo(() => data.universe.filter((stock) => {
    const scan = data.latestScans[stock.ticker]
    const q = query.trim().toUpperCase()
    if (q && !stock.ticker.includes(q) && !(scan?.wyckoffState ?? "").toUpperCase().includes(q)) return false
    if (filter === "pending") return !scan
    if (filter === "bullish") return scan?.taBias === "Bullish"
    if (filter === "bearish") return scan?.taBias === "Bearish"
    if (filter === "events") return Boolean(scan && /(Spring|SOS|UT\/UTAD|SOW)/i.test(scan.wyckoffState))
    return true
  }), [data, query, filter])
  const complete = scans.filter((scan) => scan.status === "Complete").length
  const incomplete = scans.filter((scan) => scan.status === "Incomplete").length
  const events = scans.filter((scan) => /(Spring|SOS|UT\/UTAD|SOW)/i.test(scan.wyckoffState)).length

  return <div className="min-h-screen bg-background text-[15px]"><TopNav />
    <main className="mx-auto max-w-[1600px] space-y-5 p-4 lg:p-6">
      <header className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
        <div><div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-semibold">Wyckoff Scanner — Top 100 HOSE</h1><span className="rounded border border-border bg-panel-2 px-2 py-1 text-xs">Data · Notion</span></div><p className="mt-2 text-sm text-foreground/60">Metadata và kết quả scan được đọc trực tiếp từ Notion. Market history vẫn lấy từ provider chuyên dụng. 60–199 nến Daily được lưu Incomplete với LOW confidence; từ 200 nến trở lên là Complete.</p></div>
        <Link href="/research" className="rounded border border-border px-3 py-2 text-sm">Trung tâm Nghiên cứu</Link>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[['Universe', data.universe.length, <Database key="u" className="h-4 w-4"/>], ['Scanned', scans.length, <Activity key="s" className="h-4 w-4"/>], ['Complete ≥200', complete, <ShieldCheck key="c" className="h-4 w-4"/>], ['Incomplete 60–199', incomplete, <AlertTriangle key="i" className="h-4 w-4"/>], ['Events', events, <AlertTriangle key="e" className="h-4 w-4"/>]].map(([label,value,icon]) => <div key={String(label)} className="rounded-xl border border-border bg-panel p-4"><div className="flex items-center justify-between text-sm text-foreground/55"><span>{label}</span>{icon}</div><div className="mt-2 font-mono text-2xl font-semibold">{String(value)}</div></div>)}
      </section>

      <section className="overflow-hidden rounded-xl border border-border bg-panel">
        <div className="flex flex-col gap-2 border-b border-border p-4 sm:flex-row"><label className="flex flex-1 items-center gap-2 rounded border border-border bg-background px-3 py-2"><Search className="h-4 w-4 text-foreground/40"/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Ticker / Wyckoff state" className="w-full bg-transparent outline-none"/></label><select value={filter} onChange={(e)=>setFilter(e.target.value)} className="rounded border border-border bg-background px-3 py-2"><option value="all">Tất cả</option><option value="events">Wyckoff event</option><option value="bullish">Bullish</option><option value="bearish">Bearish</option><option value="pending">Chưa quét</option></select></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[1250px] text-sm"><thead className="bg-panel-2 text-left text-xs text-foreground/50"><tr><th className="px-4 py-3"># / Mã</th><th className="px-4 py-3">Giá</th><th className="px-4 py-3">Bias</th><th className="px-4 py-3">Wyckoff / Phase</th><th className="px-4 py-3">Scenario</th><th className="px-4 py-3">RSI / RVOL</th><th className="px-4 py-3">Support / Resistance</th><th className="px-4 py-3">Provider</th><th className="px-4 py-3">Date</th></tr></thead><tbody>{rows.map((stock)=>{const scan=data.latestScans[stock.ticker];return <tr key={stock.ticker} className="border-t border-border/70 align-top"><td className="px-4 py-3"><span className="mr-2 text-xs text-foreground/35">{stock.rank}</span><TickerResearchLink ticker={stock.ticker} className="font-mono font-bold hover:text-brand">{stock.ticker}</TickerResearchLink></td><td className="px-4 py-3 font-mono">{n(scan?.price,2)}</td><td className={`px-4 py-3 font-semibold ${biasClass(scan?.taBias ?? '')}`}>{scan?.taBias || 'Pending'}</td><td className="max-w-[340px] px-4 py-3"><div className="line-clamp-2">{scan?.wyckoffState || '—'}</div><div className="mt-1 text-xs text-foreground/40">{scan?.phase}</div></td><td className="px-4 py-3"><Scenario scan={scan}/></td><td className="px-4 py-3 font-mono">{n(scan?.rsi14)} / {n(scan?.relVolume,2)}x</td><td className="max-w-[270px] px-4 py-3 text-xs"><div>{scan?.support || '—'}</div><div className="mt-1">{scan?.resistance || '—'}</div></td><td className="px-4 py-3">{scan?.provider || '—'}<div className="text-xs text-foreground/40">{scan?.status === 'Incomplete' ? 'Incomplete · LOW confidence' : scan?.status}</div></td><td className="px-4 py-3">{scan?.date || '—'}</td></tr>})}</tbody></table></div>
      </section>
    </main>
  </div>
}