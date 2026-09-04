"use client"

import { useMemo, useState } from "react"
import { Search } from "lucide-react"

import { StockLogo } from "@/components/stock-logo"
import type { CanonicalUniverseStock } from "@/modules/market/universe/index"

const nf = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 })

export function AdminUniverseTable({ stocks }: { stocks: CanonicalUniverseStock[] }) {
  const [query, setQuery] = useState("")
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return stocks
    return stocks.filter((stock) => [stock.ticker, stock.companyName, stock.exchange, stock.sector].some((value) => String(value || "").toLowerCase().includes(needle)))
  }, [query, stocks])

  return (
    <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#090d13]">
      <div className="flex flex-col gap-3 border-b border-white/[0.08] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-bold text-white">Current membership</h2>
          <p className="mt-1 text-xs text-slate-500">{rows.length}/{stocks.length} mã đang hiển thị</p>
        </div>
        <label className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ticker, công ty, sàn, ngành..." className="w-full rounded-xl border border-white/[0.08] bg-[#0c1119] py-2 pl-9 pr-3 text-xs text-slate-100 outline-none focus:border-emerald-500/50" />
        </label>
      </div>
      <div className="max-h-[68vh] overflow-auto">
        <table className="w-full min-w-[1060px] text-left text-xs">
          <thead className="sticky top-0 z-10 bg-[#0b1017] text-[10px] uppercase tracking-[0.14em] text-slate-500">
            <tr>
              <th className="px-3 py-2.5">Rank</th><th className="px-3 py-2.5">Cổ phiếu</th><th className="px-3 py-2.5">Sàn</th><th className="px-3 py-2.5">Ngành</th><th className="px-3 py-2.5 text-right">Vốn hóa (tỷ)</th><th className="px-3 py-2.5 text-right">KLTB 50D</th><th className="px-3 py-2.5">Detail</th><th className="px-3 py-2.5">Logo</th><th className="px-3 py-2.5">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.05]">
            {rows.map((stock) => (
              <tr key={stock.ticker} className="hover:bg-white/[0.025]">
                <td className="px-3 py-2 font-mono font-bold text-slate-400">#{stock.rank}</td>
                <td className="px-3 py-2"><div className="flex items-center gap-2.5"><StockLogo symbol={stock.ticker} logoPath={stock.logoPath} size={30} /><div><div className="font-mono font-bold text-white">{stock.ticker}</div><div className="max-w-64 truncate text-[11px] text-slate-500">{stock.companyName || stock.ticker}</div></div></div></td>
                <td className="px-3 py-2 text-slate-300">{stock.exchange || "—"}</td>
                <td className="px-3 py-2 text-slate-400">{stock.sector || "—"}</td>
                <td className="px-3 py-2 text-right font-mono text-slate-200">{nf.format(stock.marketCapBillion)}</td>
                <td className="px-3 py-2 text-right font-mono text-slate-200">{nf.format(stock.averageVolume50d)}</td>
                <td className="px-3 py-2"><span className={stock.detailComplete ? "text-emerald-400" : "text-rose-400"}>{stock.detailComplete ? "Complete" : "Missing"}</span></td>
                <td className="px-3 py-2"><span className={stock.logoKind === "official" ? "text-cyan-300" : "text-amber-300"}>{stock.logoKind === "official" ? "Official" : "Generated"}</span></td>
                <td className="px-3 py-2 font-mono text-slate-500">{stock.sourceAsOfDate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
