"use client"

import { CalendarRange, CircleHelp } from "lucide-react"

import type {
  AccountLedgerSet,
  PeriodLedgerSet,
} from "@/modules/portfolio/performance/types"

export type PerformancePeriod = "daily" | "weekly" | "monthly" | "annual"

function formatVnd(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A"
  return `${Math.round(value).toLocaleString("vi-VN")} ₫`
}

function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A"
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`
}

export function PerformanceLedger({
  trading,
  account,
  period,
}: {
  trading: PeriodLedgerSet
  account: AccountLedgerSet
  period: PerformancePeriod
}) {
  const tradingRows = trading[period].slice(-8).reverse()
  const accountRows = account[period].slice(-8).reverse()

  return (
    <section className="rounded-3xl border border-[#2a2e40] bg-[#0c1017] p-5 shadow-sm sm:p-6">
      <div className="mb-5 flex items-end justify-between gap-3 border-b border-white/[0.07] pb-4">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.15em] text-indigo-400">
            <CalendarRange className="h-4 w-4" /> Period Ledger
          </div>
          <h2 className="font-ticker text-lg font-black text-white">Sổ hiệu suất theo kỳ</h2>
        </div>
        <div className="flex items-center gap-1 text-[11px] text-slate-600" title="Trading ledger dùng Trade logic đã đóng; Account ledger dùng Account Equity toàn danh mục.">
          <CircleHelp className="h-3.5 w-3.5" /> Hai hệ quy chiếu
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="min-w-0 rounded-2xl border border-white/[0.07] bg-[#090d13] p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">Trading Ledger</h3>
            <span className="text-[10px] text-slate-600">Trade đã đóng</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-slate-600">
                <tr>
                  <th className="pb-2 pr-3">Kỳ</th>
                  <th className="pb-2 pr-3 text-right">Trade</th>
                  <th className="pb-2 pr-3 text-right">W/L/BE</th>
                  <th className="pb-2 pr-3 text-right">Phí</th>
                  <th className="pb-2 pr-3 text-right">P/L ròng</th>
                  <th className="pb-2 text-right">Lũy kế</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {tradingRows.map((row) => (
                  <tr key={row.key}>
                    <td className="py-2.5 pr-3 font-bold text-slate-300">{row.key}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-slate-400">{row.tradeCount}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-slate-500">{row.winnerCount}/{row.loserCount}/{row.breakevenCount}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-slate-500">{formatVnd(row.commissionVnd)}</td>
                    <td className="py-2.5 pr-3 text-right font-bold tabular-nums text-slate-200">{formatVnd(row.netPnlVnd)}</td>
                    <td className="py-2.5 text-right font-bold tabular-nums text-slate-200">{formatVnd(row.runningNetPnlVnd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {tradingRows.length === 0 && (
            <div className="py-8 text-center text-xs text-slate-500">Không đủ dữ liệu Trade đã đóng.</div>
          )}
        </div>

        <div className="min-w-0 rounded-2xl border border-white/[0.07] bg-[#090d13] p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">Account Ledger</h3>
            <span className="text-[10px] text-slate-600">toàn danh mục</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-slate-600">
                <tr>
                  <th className="pb-2 pr-3">Kỳ</th>
                  <th className="pb-2 pr-3 text-right">Equity đầu</th>
                  <th className="pb-2 pr-3 text-right">Equity cuối</th>
                  <th className="pb-2 pr-3 text-right">Return</th>
                  <th className="pb-2 text-right">Worst DD</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {accountRows.map((row) => (
                  <tr key={row.key}>
                    <td className="py-2.5 pr-3 font-bold text-slate-300">{row.key}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-slate-500">{formatVnd(row.startEquityVnd)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-slate-300">{formatVnd(row.endEquityVnd)}</td>
                    <td className="py-2.5 pr-3 text-right font-bold tabular-nums text-slate-200">{formatPercent(row.returnPercent)}</td>
                    <td className="py-2.5 text-right font-bold tabular-nums text-rose-300">{row.worstDrawdownPercent == null ? "N/A" : `${row.worstDrawdownPercent.toFixed(2)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {accountRows.length === 0 && (
            <div className="py-8 text-center text-xs text-slate-500">Không đủ dữ liệu Account Equity.</div>
          )}
        </div>
      </div>
    </section>
  )
}
