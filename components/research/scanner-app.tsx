"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Activity, AlertTriangle, BarChart3, Database, Search, ShieldCheck } from "lucide-react"
import { TopNav } from "@/components/top-nav"
import type { DailyScanRow, ScannerData } from "@/lib/scanner-data"

function number(value: number | null | undefined, digits = 1) {
  return typeof value === "number" ? value.toLocaleString("en-US", { maximumFractionDigits: digits }) : "—"
}

function biasClass(bias: string) {
  if (bias === "Bullish") return "text-up border-up/30 bg-up/10"
  if (bias === "Bearish") return "text-down border-down/30 bg-down/10"
  if (bias === "Mixed") return "text-ref border-ref/30 bg-ref/10"
  return "text-foreground/70 border-border-strong bg-panel-2"
}

function ScenarioBar({ scan }: { scan?: DailyScanRow }) {
  const bull = scan?.bullProbability ?? 0
  const base = scan?.baseProbability ?? 0
  const bear = scan?.bearProbability ?? 0
  if (!scan) return <span className="text-sm text-foreground/45">Chưa quét</span>
  return (
    <div className="min-w-[170px]">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-panel-2">
        <div className="bg-up" style={{ width: `${bull}%` }} />
        <div className="bg-ref" style={{ width: `${base}%` }} />
        <div className="bg-down" style={{ width: `${bear}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-xs text-foreground/65">
        <span>T {bull || "—"}</span><span>CS {base || "—"}</span><span>G {bear || "—"}</span>
      </div>
    </div>
  )
}

function Metric({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-panel p-5">
      <div className="flex items-center justify-between gap-3 text-sm font-semibold text-foreground/70"><span>{label}</span><span className="text-foreground/50">{icon}</span></div>
      <div className="mt-3 text-3xl font-semibold text-foreground">{value}</div>
      <p className="mt-2 text-sm leading-6 text-foreground/60">{detail}</p>
    </div>
  )
}

export function ScannerApp({ data }: { data: ScannerData }) {
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState("all")
  const rows = useMemo(() => data.universe.filter((stock) => {
    const scan = data.latestScans[stock.ticker]
    const q = query.trim().toUpperCase()
    if (q && !stock.ticker.includes(q) && !(scan?.wyckoffState ?? "").toUpperCase().includes(q)) return false
    if (filter === "pending") return !scan
    if (filter === "incomplete") return scan?.status === "Incomplete"
    if (filter === "bullish") return scan?.taBias === "Bullish"
    if (filter === "bearish") return scan?.taBias === "Bearish"
    if (filter === "events") return Boolean(scan && /(Spring|SOS|UT\/UTAD|SOW)/i.test(scan.wyckoffState))
    return true
  }), [data, query, filter])

  const scans = Object.values(data.latestScans)
  const complete = scans.filter((scan) => scan.status === "Complete").length
  const incomplete = scans.filter((scan) => scan.status === "Incomplete").length
  const events = scans.filter((scan) => /(Spring|SOS|UT\/UTAD|SOW)/i.test(scan.wyckoffState)).length
  const bullish = scans.filter((scan) => scan.taBias === "Bullish").length

  return (
    <div className="min-h-screen bg-background text-[15px]">
      <TopNav />
      <div className="border-b border-border bg-panel/75">
        <div className="mx-auto max-w-[1600px] px-4 py-5 lg:px-6">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-2xl font-semibold text-foreground">Wyckoff Scanner — Top 50 HOSE</h1>
                <span className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${data.providerHealth.currentProvider === "DNSE" ? "border-up/30 bg-up/10 text-up" : "border-ref/30 bg-ref/10 text-ref"}`}>
                  Provider thực tế: {data.providerHealth.currentProvider}
                </span>
                <span className="rounded-md border border-border-strong bg-panel-2 px-2.5 py-1 text-xs font-semibold text-foreground/65">Nguồn: {data.source === "supabase" ? "Supabase" : data.source === "notion" ? "Notion" : "Fallback"}</span>
              </div>
              <p className="mt-2 max-w-4xl text-sm leading-6 text-foreground/65">
                Universe chốt ngày {data.universeDate}. Daily scanner ưu tiên cấu trúc → Price Action → Volume → Wyckoff event → Confirmation/Invalidation; không coi một breakout đơn lẻ là xác nhận.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/research" className="rounded-md border border-border-strong bg-panel-2 px-4 py-2.5 text-sm font-medium text-foreground/75 hover:text-foreground">Trung tâm Nghiên cứu</Link>
              <Link href="/research/log" className="rounded-md border border-border-strong bg-panel-2 px-4 py-2.5 text-sm font-medium text-foreground/75 hover:text-foreground">Nhật ký phân tích</Link>
            </div>
          </div>
          {(data.providerHealth.status === "degraded" || data.providerHealth.status === "unavailable" || !scans.length) && (
            <div className="mt-4 flex items-start gap-3 rounded-lg border border-ref/25 bg-ref/5 p-4 text-sm leading-6 text-foreground/70">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-ref" />
              <span>{data.providerHealth.message} Scanner không nâng dữ liệu thiếu thành Complete và không tạo scan giả khi OHLC không hợp lệ.</span>
            </div>
          )}
        </div>
      </div>

      <main className="mx-auto max-w-[1600px] space-y-5 p-4 lg:p-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
          <Metric label="Universe" value={String(data.universe.length)} detail="Top 50 vốn hóa HOSE, có rank cố định theo snapshot." icon={<Database className="h-5 w-5" />} />
          <Metric label="Dòng dữ liệu" value={String(scans.length)} detail="Số ticker có Daily scan gần nhất trong nguồn operational." icon={<Database className="h-5 w-5" />} />
          <Metric label="Complete" value={String(complete)} detail="Có ít nhất 200 completed Daily bars." icon={<ShieldCheck className="h-5 w-5" />} />
          <Metric label="Incomplete" value={String(incomplete)} detail="Có 60–199 bars; confidence luôn LOW." icon={<AlertTriangle className="h-5 w-5" />} />
          <Metric label="Wyckoff events" value={String(events)} detail="Spring / SOS / UT-UTAD / SOW candidate đang được gắn cờ." icon={<Activity className="h-5 w-5" />} />
          <Metric label="Bullish" value={String(bullish)} detail="Bias kỹ thuật Bullish theo bộ rule chuẩn hóa." icon={<BarChart3 className="h-5 w-5" />} />
        </div>

        <section className="overflow-hidden rounded-xl border border-border bg-panel">
          <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Bảng quét Daily</h2>
              <p className="mt-1 text-sm text-foreground/55">Sort theo vốn hóa; dùng bộ lọc để tìm setup cần review sâu.</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="flex min-w-[260px] items-center gap-2 rounded-md border border-border-strong bg-background px-3 py-2.5">
                <Search className="h-4 w-4 text-foreground/45" />
                <input aria-label="Tìm mã hoặc Wyckoff state" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm mã hoặc Wyckoff state..." className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-foreground/35" />
              </label>
              <select aria-label="Lọc kết quả scanner" value={filter} onChange={(event) => setFilter(event.target.value)} className="rounded-md border border-border-strong bg-background px-3 py-2.5 text-sm text-foreground outline-none">
                <option value="all">Tất cả</option>
                <option value="events">Có Wyckoff event</option>
                <option value="bullish">Bullish</option>
                <option value="bearish">Bearish</option>
                <option value="incomplete">Incomplete</option>
                <option value="pending">Chưa quét</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1570px] text-left text-sm">
              <thead className="bg-panel-2 text-xs font-semibold text-foreground/65">
                <tr>
                  <th className="px-4 py-3"># / Mã</th><th className="px-4 py-3">Vốn hóa</th><th className="px-4 py-3">Giá</th><th className="px-4 py-3">Bias</th>
                  <th className="px-4 py-3">Wyckoff / Phase</th><th className="px-4 py-3">Kịch bản</th><th className="px-4 py-3">RSI / RVOL</th>
                  <th className="px-4 py-3">MA20 / 50 / 200</th><th className="px-4 py-3">Hỗ trợ / Kháng cự</th><th className="px-4 py-3">Provider / Status</th><th className="px-4 py-3">Ngày scan</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((stock) => {
                  const scan = data.latestScans[stock.ticker]
                  return (
                    <tr key={stock.ticker} className="border-t border-border/70 align-top transition-colors hover:bg-panel-2/55">
                      <td className="px-4 py-4"><div className="flex items-center gap-3"><span className="w-6 font-mono text-xs text-foreground/40">{stock.rank}</span><Link href={`/research/${stock.ticker.toLowerCase()}`} className="font-mono text-base font-bold text-foreground hover:text-brand">{stock.ticker}</Link></div></td>
                      <td className="px-4 py-4 font-mono text-foreground/70">{number(stock.marketCapT, 2)}T</td>
                      <td className="px-4 py-4"><div className="font-mono font-semibold text-foreground">{number(scan?.price, 2)}</div>{scan?.changePct != null && <div className={`mt-1 font-mono text-xs ${scan.changePct >= 0 ? "text-up" : "text-down"}`}>{scan.changePct >= 0 ? "+" : ""}{scan.changePct.toFixed(2)}%</div>}</td>
                      <td className="px-4 py-4">{scan ? <span className={`rounded-md border px-2.5 py-1.5 text-sm font-semibold ${biasClass(scan.taBias)}`}>{scan.taBias}</span> : <span className="text-foreground/40">Pending</span>}</td>
                      <td className="max-w-[330px] px-4 py-4"><p className="line-clamp-3 leading-6 text-foreground/75">{scan?.wyckoffState || "Chưa có scan hoàn chỉnh."}</p>{scan?.phase && <div className="mt-1.5 text-xs text-foreground/45">{scan.phase}</div>}</td>
                      <td className="px-4 py-4"><ScenarioBar scan={scan} /></td>
                      <td className="px-4 py-4 font-mono text-foreground/70"><div>RSI {number(scan?.rsi14)}</div><div className="mt-1">RVOL {number(scan?.relVolume, 2)}x</div></td>
                      <td className="px-4 py-4 font-mono text-xs leading-6 text-foreground/65"><div>{number(scan?.ma20, 2)}</div><div>{number(scan?.ma50, 2)}</div><div>{number(scan?.ma200, 2)}</div></td>
                      <td className="max-w-[250px] px-4 py-4 text-xs leading-5 text-foreground/65"><div><span className="font-semibold text-up">H:</span> {scan?.support || "—"}</div><div className="mt-1"><span className="font-semibold text-down">KC:</span> {scan?.resistance || "—"}</div></td>
                      <td className="whitespace-nowrap px-4 py-4"><div className="font-medium text-foreground/70">{scan?.provider === "Fallback" ? "Yahoo fallback" : scan?.provider || "—"}</div>{scan && <span className={`mt-1.5 inline-block rounded border px-2 py-0.5 text-xs font-semibold ${scan.status === "Complete" ? "border-up/25 bg-up/10 text-up" : "border-ref/25 bg-ref/10 text-ref"}`}>{scan.status}</span>}</td>
                      <td className="whitespace-nowrap px-4 py-4 text-foreground/55">{scan?.date || "—"}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-panel p-5">
          <h2 className="text-lg font-semibold text-foreground">Quy tắc đọc Scanner</h2>
          <div className="mt-4 grid gap-4 text-sm leading-6 text-foreground/65 md:grid-cols-3">
            <p><strong className="text-foreground">Candidate ≠ xác nhận.</strong> Spring/SOS/UT/SOW chỉ là cờ ưu tiên review. Confirmation vẫn cần hành vi tiếp theo.</p>
            <p><strong className="text-foreground">Volume = effort.</strong> Scanner không suy diễn “tổ chức mua/bán” từ một cây nến hay một phiên volume lớn.</p>
            <p><strong className="text-foreground">Daily = screening.</strong> Các mã quan trọng sẽ được mở rộng sang Weekly/4H và so với VNINDEX trước khi trở thành canonical thesis.</p>
          </div>
        </section>
      </main>
    </div>
  )
}
