import Link from "next/link"
import { Activity, BellRing, ChartNoAxesCombined, ExternalLink, ShieldAlert, Target, Trophy } from "lucide-react"

import { TopNav } from "@/components/top-nav"
import type { TradeRecommendation, SignalEventRow } from "@/lib/signal-data"
import type { RecommendationPerformance } from "@/lib/signal-performance"

function pct(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "—"
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`
}
function num(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "—"
  return value.toLocaleString("en-US", { maximumFractionDigits: digits })
}
function time(value: string) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date)
}
function tone(value: number | null | undefined) {
  if (value == null) return "text-foreground/55"
  return value > 0 ? "text-up" : value < 0 ? "text-down" : "text-ref"
}
function Metric({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: React.ReactNode }) {
  return <div className="rounded-xl border border-border bg-panel p-5"><div className="flex items-center justify-between text-sm font-semibold text-foreground/60"><span>{label}</span><span className="text-foreground/40">{icon}</span></div><div className="mt-3 font-mono text-2xl font-semibold text-foreground">{value}</div><div className="mt-2 text-sm leading-6 text-foreground/50">{detail}</div></div>
}

function EquityCurve({ performance }: { performance: RecommendationPerformance }) {
  const points = performance.curve
  if (points.length < 2) return <div className="flex h-[250px] items-center justify-center rounded-lg border border-dashed border-border text-sm text-foreground/45">Chưa có recommendation đã đóng để tạo performance curve.</div>
  const width = 900, height = 280, left = 52, right = 20, top = 20, bottom = 36
  const values = points.flatMap((point) => [point.strategy, point.vnindex]).filter((value): value is number => value != null && Number.isFinite(value))
  const rawMin = Math.min(...values), rawMax = Math.max(...values), pad = Math.max((rawMax - rawMin) * 0.12, 2), min = rawMin - pad, max = rawMax + pad
  const x = (index: number) => left + index / Math.max(1, points.length - 1) * (width - left - right)
  const y = (value: number) => top + (max - value) / Math.max(1e-9, max - min) * (height - top - bottom)
  const path = (key: "strategy" | "vnindex") => {
    let started = false
    return points.map((point, index) => {
      const value = point[key]
      if (value == null) return ""
      const command = started ? "L" : "M"
      started = true
      return `${command} ${x(index)} ${y(value)}`
    }).join(" ")
  }
  return <div className="overflow-x-auto"><svg viewBox={`0 0 ${width} ${height}`} className="min-w-[720px] w-full" role="img" aria-label="Performance recommendations so với VNINDEX">
    {[min, (min + max) / 2, max].map((tick) => <g key={tick}><line x1={left} x2={width-right} y1={y(tick)} y2={y(tick)} stroke="var(--color-border-strong)" strokeDasharray="4 6" opacity="0.45"/><text x={left-7} y={y(tick)+4} textAnchor="end" fill="currentColor" fontSize="10" opacity="0.55">{tick.toFixed(1)}</text></g>)}
    <path d={path("strategy")} fill="none" stroke="var(--color-brand)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/>
    <path d={path("vnindex")} fill="none" stroke="var(--color-ref)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    {points.map((point, index) => <g key={`${point.label}-${index}`}><circle cx={x(index)} cy={y(point.strategy)} r="3" fill="var(--color-brand)"/>{index === points.length - 1 && <text x={x(index)} y={height-10} textAnchor="end" fill="currentColor" fontSize="10" opacity="0.5">{point.label}</text>}</g>)}
  </svg><div className="mt-2 flex gap-5 text-xs text-foreground/55"><span className="text-brand">StockOS recommendation index</span><span className="text-ref">VNINDEX same holding-window index</span><span>Base = 100; sequential per recommendation, không phải portfolio NAV khi các trade overlap.</span></div></div>
}

function WinRate({ performance }: { performance: RecommendationPerformance }) {
  const closed = Math.max(1, performance.closed)
  const win = performance.wins / closed * 100
  const loss = performance.losses / closed * 100
  return <div className="grid gap-5 sm:grid-cols-[180px_1fr] sm:items-center">
    <div className="relative mx-auto h-40 w-40 rounded-full" style={{ background: `conic-gradient(var(--color-up) 0 ${win}%, var(--color-down) ${win}% ${win+loss}%, var(--color-ref) ${win+loss}% 100%)` }}><div className="absolute inset-5 flex flex-col items-center justify-center rounded-full bg-panel"><span className="font-mono text-2xl font-bold text-foreground">{performance.winRate == null ? "—" : `${performance.winRate.toFixed(1)}%`}</span><span className="text-xs text-foreground/45">Win rate</span></div></div>
    <div className="space-y-3 text-sm"><div className="flex justify-between border-b border-border pb-2"><span className="text-up">Win</span><span className="font-mono">{performance.wins}</span></div><div className="flex justify-between border-b border-border pb-2"><span className="text-down">Loss</span><span className="font-mono">{performance.losses}</span></div><div className="flex justify-between"><span className="text-ref">Flat</span><span className="font-mono">{performance.flats}</span></div></div>
  </div>
}

function StatusBadge({ value }: { value: string }) {
  const cls = value === "Open" ? "border-brand/30 bg-brand/10 text-brand" : value === "Stopped" ? "border-down/30 bg-down/10 text-down" : value === "Closed" ? "border-up/30 bg-up/10 text-up" : "border-border bg-panel-2 text-foreground/55"
  return <span className={`rounded border px-2 py-1 text-xs font-semibold ${cls}`}>{value || "—"}</span>
}

export function SignalsApp({ recommendations, events, performance, monitorReady, telegramReady, cronSecretReady }: { recommendations: TradeRecommendation[]; events: SignalEventRow[]; performance: RecommendationPerformance; monitorReady: boolean; telegramReady: boolean; cronSecretReady: boolean }) {
  const open = recommendations.filter((row) => row.status === "Open")
  return <div className="min-h-screen bg-background text-[15px]"><TopNav />
    <main className="mx-auto max-w-[1700px] px-4 py-6 lg:px-6">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start"><div><div className="flex items-center gap-2"><BellRing className="h-5 w-5 text-brand"/><h1 className="text-2xl font-semibold text-foreground">Khuyến nghị & Signal Monitor</h1></div><p className="mt-2 max-w-4xl text-sm leading-6 text-foreground/55">Daily Bullish → intraday price/volume confirmation → BUY → open recommendation → monitor thesis-fail → SELL/EXIT_FAIL. Notion là canonical ledger; Telegram là notification channel.</p></div><Link href="/research/scanner" className="rounded-md border border-border bg-panel px-3 py-2 text-sm text-foreground/65 hover:text-brand">← Daily Scanner</Link></div>

      <div className="mt-5 flex flex-wrap gap-2 text-xs"><span className={`rounded border px-2.5 py-1 ${monitorReady ? "border-up/30 bg-up/10 text-up" : "border-down/30 bg-down/10 text-down"}`}>DNSE live server · {monitorReady ? "configured" : "missing env"}</span><span className={`rounded border px-2.5 py-1 ${telegramReady ? "border-up/30 bg-up/10 text-up" : "border-ref/30 bg-ref/10 text-ref"}`}>Telegram · {telegramReady ? "configured" : "pending config"}</span><span className={`rounded border px-2.5 py-1 ${cronSecretReady ? "border-up/30 bg-up/10 text-up" : "border-ref/30 bg-ref/10 text-ref"}`}>Cron auth · {cronSecretReady ? "ready" : "pending"}</span><span className="rounded border border-border bg-panel-2 px-2.5 py-1 text-foreground/55">Engine intraday-v1.0 · fail-closed</span></div>

      <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-6"><Metric label="Open" value={String(performance.open)} detail="Recommendation đang được monitor SELL/fail." icon={<Activity className="h-4 w-4"/>}/><Metric label="Closed" value={String(performance.closed)} detail="Trade đã có BUY + SELL lifecycle." icon={<Target className="h-4 w-4"/>}/><Metric label="Win rate" value={performance.winRate == null ? "—" : `${performance.winRate.toFixed(1)}%`} detail={`${performance.wins} win · ${performance.losses} loss · ${performance.flats} flat`} icon={<Trophy className="h-4 w-4"/>}/><Metric label="Avg return" value={pct(performance.avgReturn)} detail={`VNINDEX cùng holding window: ${pct(performance.avgVnindexReturn)}`} icon={<ChartNoAxesCombined className="h-4 w-4"/>}/><Metric label="Avg alpha" value={pct(performance.avgAlpha)} detail={`Beat VNINDEX: ${performance.alphaWinRate == null ? "—" : `${performance.alphaWinRate.toFixed(1)}%`}`} icon={<ChartNoAxesCombined className="h-4 w-4"/>}/><Metric label="Payoff" value={performance.payoff == null ? "—" : `${performance.payoff.toFixed(2)}x`} detail={`Avg win ${pct(performance.avgWin)} · Avg loss ${pct(performance.avgLoss)}`} icon={<ShieldAlert className="h-4 w-4"/>}/></section>

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.6fr_0.8fr]"><section className="rounded-xl border border-border bg-panel p-5"><div className="mb-4"><h2 className="font-semibold text-foreground">Performance vs VNINDEX</h2><p className="mt-1 text-xs text-foreground/45">Mỗi trade dùng VNINDEX entry/exit cùng holding window. Chỉ tính recommendation đã đóng và có benchmark.</p></div><EquityCurve performance={performance}/></section><section className="rounded-xl border border-border bg-panel p-5"><h2 className="font-semibold text-foreground">Outcome ratio</h2><p className="mt-1 text-xs text-foreground/45">Win/Loss/Flat dựa trên realized recommendation return.</p><div className="mt-5"><WinRate performance={performance}/></div><div className="mt-5 grid grid-cols-2 gap-3 text-sm"><div className="rounded-lg bg-panel-2 p-3"><div className="text-foreground/45">Best</div><div className="mt-1 font-mono font-semibold text-up">{pct(performance.bestReturn)}</div></div><div className="rounded-lg bg-panel-2 p-3"><div className="text-foreground/45">Worst</div><div className="mt-1 font-mono font-semibold text-down">{pct(performance.worstReturn)}</div></div></div></section></div>

      <section className="mt-6 rounded-xl border border-border bg-panel"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 className="font-semibold text-foreground">Open recommendations</h2><p className="mt-1 text-xs text-foreground/45">Các mã này phải tiếp tục được monitor cho đến khi SELL/EXIT_FAIL.</p></div><span className="font-mono text-sm text-brand">{open.length}</span></div>{open.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-sm"><thead className="bg-panel-2 text-left text-xs uppercase tracking-wide text-foreground/45"><tr><th className="px-4 py-3">Ticker</th><th className="px-4 py-3">Buy</th><th className="px-4 py-3">Last</th><th className="px-4 py-3">PnL</th><th className="px-4 py-3">Stop</th><th className="px-4 py-3">Target 2R</th><th className="px-4 py-3">Vol pace</th><th className="px-4 py-3">MFE / MAE</th><th className="px-4 py-3">Last monitor</th></tr></thead><tbody className="divide-y divide-border">{open.map((row) => { const livePnl = row.lastPrice && row.buyPrice ? (row.lastPrice-row.buyPrice)/row.buyPrice*100 : null; return <tr key={row.id}><td className="px-4 py-3"><Link href={`/research/${row.ticker.toLowerCase()}`} className="font-mono font-bold text-foreground hover:text-brand">{row.ticker}</Link></td><td className="px-4 py-3 font-mono">{num(row.buyPrice)}</td><td className="px-4 py-3 font-mono">{num(row.lastPrice)}</td><td className={`px-4 py-3 font-mono font-semibold ${tone(livePnl)}`}>{pct(livePnl)}</td><td className="px-4 py-3 font-mono text-down">{num(row.stopPrice)}</td><td className="px-4 py-3 font-mono">{num(row.targetPrice)}</td><td className="px-4 py-3 font-mono">{row.lastRelVolume == null ? "—" : `${row.lastRelVolume.toFixed(2)}x`}</td><td className="px-4 py-3 font-mono">{pct(row.maxFavorablePct)} / {pct(row.maxAdversePct)}</td><td className="px-4 py-3 text-foreground/55">{time(row.lastMonitor)}</td></tr> })}</tbody></table></div> : <div className="p-6 text-sm text-foreground/50">Chưa có open recommendation.</div>}</section>

      <section className="mt-6 rounded-xl border border-border bg-panel"><div className="border-b border-border px-5 py-4"><h2 className="font-semibold text-foreground">Recommendation ledger</h2><p className="mt-1 text-xs text-foreground/45">Canonical BUY→SELL records từ Notion.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[1250px] text-sm"><thead className="bg-panel-2 text-left text-xs uppercase tracking-wide text-foreground/45"><tr><th className="px-4 py-3">Ticker</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">BUY</th><th className="px-4 py-3">SELL</th><th className="px-4 py-3">Return</th><th className="px-4 py-3">VNINDEX</th><th className="px-4 py-3">Alpha</th><th className="px-4 py-3">Outcome</th><th className="px-4 py-3">Scan</th><th className="px-4 py-3">Reason</th></tr></thead><tbody className="divide-y divide-border">{recommendations.map((row) => <tr key={row.id}><td className="px-4 py-3"><a href={row.notionUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono font-bold text-foreground hover:text-brand">{row.ticker}<ExternalLink className="h-3 w-3"/></a></td><td className="px-4 py-3"><StatusBadge value={row.status}/></td><td className="px-4 py-3"><div className="font-mono">{num(row.buyPrice)}</div><div className="text-xs text-foreground/45">{time(row.buySignal)}</div></td><td className="px-4 py-3"><div className="font-mono">{num(row.sellPrice)}</div><div className="text-xs text-foreground/45">{time(row.sellSignal)}</div></td><td className={`px-4 py-3 font-mono font-semibold ${tone(row.returnPct)}`}>{pct(row.returnPct)}</td><td className={`px-4 py-3 font-mono ${tone(row.vnindexReturnPct)}`}>{pct(row.vnindexReturnPct)}</td><td className={`px-4 py-3 font-mono font-semibold ${tone(row.alphaPct)}`}>{pct(row.alphaPct)}</td><td className="px-4 py-3">{row.outcome || "—"}</td><td className="px-4 py-3 text-foreground/55">{row.scanDate || "—"}</td><td className="max-w-[360px] px-4 py-3 text-xs leading-5 text-foreground/55">{row.status === "Open" ? row.buyReason : row.sellReason || row.buyReason}</td></tr>)}</tbody></table></div></section>

      <section className="mt-6 rounded-xl border border-border bg-panel"><div className="border-b border-border px-5 py-4"><h2 className="font-semibold text-foreground">Recent signal events</h2><p className="mt-1 text-xs text-foreground/45">Append-only BUY/SELL/EXIT_FAIL audit trail.</p></div><div className="divide-y divide-border">{events.slice(0, 30).map((event) => <div key={event.id} className="grid gap-2 px-5 py-4 md:grid-cols-[90px_70px_130px_110px_1fr]"><a href={event.notionUrl} target="_blank" rel="noreferrer" className="font-mono font-bold text-foreground hover:text-brand">{event.ticker}</a><span className={event.type === "BUY" ? "text-up" : "text-down"}>{event.type}</span><span className="font-mono">{num(event.price)}</span><span className="text-xs text-foreground/45">{time(event.signalTime)}</span><span className="text-sm text-foreground/60">{event.rule}</span></div>)}{!events.length && <div className="p-6 text-sm text-foreground/50">Chưa có signal event.</div>}</div></section>
    </main>
  </div>
}
