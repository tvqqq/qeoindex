"use client"

import { AlertTriangle, Landmark, PlusCircle } from "lucide-react"
import { FormEvent, useMemo, useState } from "react"

import { useExternalCashFlows, type ExternalCashFlowRow } from "./use-external-cash-flows"

const FLOW_LABELS: Record<ExternalCashFlowRow["flow_type"], string> = {
  deposit: "Nạp vốn",
  withdrawal: "Rút vốn",
  capital_adjustment: "Điều chỉnh vốn",
}

function localDateTimeValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function formatVnd(value: number | string): string {
  const number = Number(value)
  if (!Number.isFinite(number)) return "—"
  const prefix = number > 0 ? "+" : ""
  return `${prefix}${Math.round(number).toLocaleString("vi-VN")} đ`
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })
}

export function ExternalCashFlowPanel({ portfolioId }: { portfolioId: string }) {
  const {
    rows,
    fundingHistoryStatus,
    loading,
    submitting,
    error,
    addCashFlow,
  } = useExternalCashFlows(portfolioId)
  const [flowType, setFlowType] = useState<ExternalCashFlowRow["flow_type"]>("deposit")
  const [amount, setAmount] = useState("")
  const [effectiveAt, setEffectiveAt] = useState(() => localDateTimeValue(new Date()))
  const [note, setNote] = useState("")
  const [formError, setFormError] = useState<string | null>(null)

  const recentRows = useMemo(() => [...rows].reverse().slice(0, 8), [rows])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)
    const rawAmount = Number(amount)
    if (!Number.isFinite(rawAmount) || rawAmount === 0) {
      setFormError("Số tiền phải khác 0.")
      return
    }
    const effectiveDate = new Date(effectiveAt)
    if (Number.isNaN(effectiveDate.getTime())) {
      setFormError("Thời điểm dòng vốn không hợp lệ.")
      return
    }

    const signedAmount = flowType === "deposit"
      ? Math.abs(rawAmount)
      : flowType === "withdrawal"
        ? -Math.abs(rawAmount)
        : rawAmount

    try {
      await addCashFlow({
        flow_type: flowType,
        amount_vnd: signedAmount,
        effective_at: effectiveDate.toISOString(),
        note: note.trim() || null,
      })
      setAmount("")
      setNote("")
    } catch (cause: unknown) {
      setFormError(cause instanceof Error ? cause.message : "Không thể ghi nhận dòng vốn ngoài.")
    }
  }

  return (
    <div data-external-cash-flow-panel className="border-t border-white/[0.07] px-5 py-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Landmark className="h-4 w-4 text-cyan-300" />
            <h3 className="font-ticker text-sm font-black uppercase tracking-wide text-white">Dòng vốn ngoài</h3>
          </div>
          <p className="mt-1 max-w-2xl font-ticker text-[11px] leading-relaxed text-slate-400">
            Nạp/rút vốn thay đổi Account Equity nhưng không tính vào Trading P/L. Lịch sử là append-only; điều chỉnh sai bằng một dòng bù trừ mới.
          </p>
        </div>
        <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 font-ticker text-[10px] font-bold text-slate-400">
          {rows.length} dòng vốn
        </span>
      </div>

      {fundingHistoryStatus === "legacy_unrecorded" && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/[0.07] px-4 py-3 font-ticker text-xs text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span><strong>Legacy · lịch sử vốn chưa đầy đủ.</strong> Hệ thống không suy diễn các lần nạp/rút vốn trước đây từ giao dịch hay giá trị tài khoản.</span>
        </div>
      )}

      <form onSubmit={submit} className="mt-4 grid gap-3 rounded-2xl border border-white/[0.07] bg-[#090d13] p-4 md:grid-cols-2 xl:grid-cols-[0.9fr_1fr_1fr_1.4fr_auto]">
        <label className="block">
          <span className="mb-1 block font-ticker text-[10px] font-bold uppercase tracking-wide text-slate-500">Loại</span>
          <select
            value={flowType}
            onChange={(event) => setFlowType(event.target.value as ExternalCashFlowRow["flow_type"])}
            className="h-10 w-full rounded-xl border border-white/[0.1] bg-[#0c1118] px-3 font-ticker text-xs text-slate-200 outline-none focus:border-purple-500/60"
          >
            <option value="deposit">Nạp vốn</option>
            <option value="withdrawal">Rút vốn</option>
            <option value="capital_adjustment">Điều chỉnh vốn</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block font-ticker text-[10px] font-bold uppercase tracking-wide text-slate-500">Số tiền (VNĐ)</span>
          <input
            type="number"
            step="1000"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="VD: 100000000"
            className="h-10 w-full rounded-xl border border-white/[0.1] bg-[#0c1118] px-3 font-ticker text-xs text-slate-200 outline-none placeholder:text-slate-700 focus:border-purple-500/60"
          />
        </label>
        <label className="block">
          <span className="mb-1 block font-ticker text-[10px] font-bold uppercase tracking-wide text-slate-500">Hiệu lực</span>
          <input
            type="datetime-local"
            value={effectiveAt}
            onChange={(event) => setEffectiveAt(event.target.value)}
            className="h-10 w-full rounded-xl border border-white/[0.1] bg-[#0c1118] px-3 font-ticker text-xs text-slate-200 outline-none focus:border-purple-500/60"
          />
        </label>
        <label className="block">
          <span className="mb-1 block font-ticker text-[10px] font-bold uppercase tracking-wide text-slate-500">Ghi chú</span>
          <input
            type="text"
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Lý do / nguồn vốn"
            className="h-10 w-full rounded-xl border border-white/[0.1] bg-[#0c1118] px-3 font-ticker text-xs text-slate-200 outline-none placeholder:text-slate-700 focus:border-purple-500/60"
          />
        </label>
        <button
          type="submit"
          disabled={submitting || !portfolioId}
          className="mt-auto inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-purple-600 px-4 font-ticker text-xs font-black text-white transition hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <PlusCircle className="h-4 w-4" /> {submitting ? "Đang ghi..." : "Ghi nhận"}
        </button>
      </form>

      {(formError || error) && (
        <p className="mt-2 font-ticker text-xs text-red-300">{formError ?? error}</p>
      )}

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="font-ticker text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Lịch sử gần nhất</span>
          {loading && <span className="font-ticker text-[10px] text-slate-600">Đang tải...</span>}
        </div>
        {recentRows.length === 0 && !loading ? (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-3 font-ticker text-xs text-slate-500">Chưa ghi nhận Dòng vốn ngoài.</div>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {recentRows.map((row) => (
              <div key={row.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 font-ticker">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-bold text-slate-200">{FLOW_LABELS[row.flow_type]}</span>
                  <span className={Number(row.signed_amount_vnd) >= 0 ? "text-xs font-black text-emerald-300" : "text-xs font-black text-rose-300"}>
                    {formatVnd(row.signed_amount_vnd)}
                  </span>
                </div>
                <div className="mt-1 text-[10px] text-slate-500">{formatTime(row.effective_at)} · {row.provenance}</div>
                {row.note && <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-slate-400">{row.note}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
