"use client"

import { useActionState } from "react"
import { AlertCircle, CheckCircle2, Play, X } from "lucide-react"

import { runJobAction, type AdminActionResult } from "@/app/admin/actions"
import type { AdminJobView } from "@/modules/admin/types"

export interface AdminManualJobModalProps {
  job: AdminJobView
  onClose: () => void
}

export function AdminManualJobModal({ job, onClose }: AdminManualJobModalProps) {
  const [state, formAction, isPending] = useActionState<AdminActionResult | null, FormData>(
    async (prev, formData) => {
      const res = await runJobAction(prev, formData)
      if (res.ok) {
        setTimeout(() => onClose(), 1500)
      }
      return res
    },
    null,
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/[0.12] bg-[#0c1017] p-5 sm:p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
              <Play className="h-3.5 w-3.5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Chạy Tác vụ Thủ công</h3>
              <p className="font-mono text-xs text-emerald-400">{job.key}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {state?.error ? (
          <div className="mt-3.5 flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
            <span>{state.error}</span>
          </div>
        ) : null}

        {state?.ok ? (
          <div className="mt-3.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs text-emerald-300">
            <div className="flex items-center gap-1.5 font-bold">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <span>{state.message}</span>
            </div>
            {state.summary ? (
              <pre className="mt-2 max-h-36 overflow-auto rounded-lg bg-black/50 p-2.5 font-mono text-[10px] text-slate-300">
                {JSON.stringify(state.summary, null, 2)}
              </pre>
            ) : null}
          </div>
        ) : null}

        <form action={formAction} className="mt-4 space-y-4">
          <input type="hidden" name="key" value={job.key} />
          <input type="hidden" name="confirmed" value={job.manualPolicy === "confirm" ? "true" : "false"} />

          <div className="space-y-2">
            <p className="text-xs leading-relaxed text-slate-300">{job.description}</p>
            <div className="rounded-xl border border-white/[0.06] bg-[#080c11] p-3 text-[11px] text-slate-400">
              <div className="flex items-center justify-between">
                <span>Lịch chạy (ICT):</span>
                <span className="font-mono text-slate-200">{job.scheduleIct || "Thủ công"}</span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span>Nhà cung cấp:</span>
                <span className="font-mono text-slate-200">{job.provider}</span>
              </div>
            </div>
          </div>

          {job.manualPolicy === "confirm" ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
              Thao tác này có tác động vận hành. Gửi biểu mẫu đồng nghĩa bạn xác nhận chạy ngay lập tức.
            </div>
          ) : null}

          {job.key === "kfsp.ttai_history" ? (
            <div className="space-y-3 rounded-xl border border-sky-500/20 bg-sky-500/[0.06] p-3">
              <div>
                <label className="block text-xs font-medium text-slate-300">
                  Mã TTAI cần refresh <span className="text-emerald-400">*</span>
                </label>
                <textarea
                  name="tickers"
                  required
                  rows={3}
                  placeholder="VCB, FPT, MSN (tối đa 50 mã)"
                  className="mt-1.5 w-full rounded-xl border border-white/[0.1] bg-[#080c11] p-3 font-mono text-xs uppercase text-white placeholder-slate-500 focus:border-sky-500/50 focus:outline-none"
                />
                <p className="mt-1 text-[10px] text-slate-500">Phân cách bằng dấu phẩy, khoảng trắng hoặc xuống dòng. Chỉ mã trong canonical universe mới được Edge Function xử lý.</p>
              </div>
              <label className="flex items-start gap-2.5 text-xs text-slate-300">
                <input
                  type="checkbox"
                  name="force"
                  value="true"
                  className="mt-0.5 h-4 w-4 rounded border-white/20 bg-[#080c11]"
                />
                <span>
                  <span className="font-medium text-white">Force refresh</span>
                  <span className="mt-0.5 block text-[10px] text-slate-500">Bỏ qua financial-period state hiện tại và fetch lại lịch sử cho batch đã nhập.</span>
                </span>
              </label>
            </div>
          ) : null}

          <div>
            <label className="block text-xs font-medium text-slate-300">
              Lý do thực thi <span className="text-emerald-400">*</span> (8–240 ký tự)
            </label>
            <textarea
              name="reason"
              required
              minLength={8}
              maxLength={240}
              rows={3}
              placeholder="Ví dụ: Kích hoạt đồng bộ lại dữ liệu sau sự cố đường truyền..."
              className="mt-1.5 w-full rounded-xl border border-white/[0.1] bg-[#080c11] p-3 text-xs text-white placeholder-slate-400 focus:border-emerald-500/50 focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-white/[0.08] px-3.5 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-white/[0.04]"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={isPending || Boolean(state?.ok)}
              className="flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/20 px-4 py-2 text-xs font-bold text-emerald-300 transition-colors hover:bg-emerald-500/30 disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" />
              <span>{isPending ? "Đang thực thi..." : "Chạy ngay"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
