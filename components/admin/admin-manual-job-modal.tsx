"use client"

import { useActionState } from "react"
import { AlertCircle, Play, X } from "lucide-react"

import { runJobAction, type AdminActionResult } from "@/app/admin/actions"
import type { AdminJobView } from "@/lib/admin/types"

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-md rounded-xl border border-white/[0.12] bg-[#0d1218] p-5 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
          <div>
            <h3 className="text-sm font-bold text-white">Chạy Tác vụ Thủ công</h3>
            <p className="font-mono text-xs text-emerald-400">{job.key}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-white/[0.06] hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {state?.error ? (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
            <span>{state.error}</span>
          </div>
        ) : null}

        {state?.ok ? (
          <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300">
            <p className="font-bold">{state.message}</p>
            {state.summary ? (
              <pre className="mt-2 max-h-36 overflow-auto rounded bg-black/40 p-2 font-mono text-[10px] text-slate-300">
                {JSON.stringify(state.summary, null, 2)}
              </pre>
            ) : null}
          </div>
        ) : null}

        <form action={formAction} className="mt-4 space-y-4">
          <input type="hidden" name="key" value={job.key} />

          <div>
            <p className="text-xs text-slate-300">{job.description}</p>
            <div className="mt-2 rounded-lg border border-white/[0.06] bg-[#070b10] p-2.5 text-[11px] text-slate-400">
              <div>Lịch chạy: <span className="font-mono text-slate-300">{job.scheduleIct || "Thủ công"}</span></div>
              <div className="mt-1">Nhà cung cấp: <span className="font-mono text-slate-300">{job.provider}</span></div>
            </div>
          </div>

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
              className="mt-1 w-full rounded-lg border border-white/[0.1] bg-[#070b10] p-2.5 text-xs text-white placeholder-slate-400 focus:border-emerald-500/50 focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-white/[0.1] px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/[0.04]"
            >
              Đóng
            </button>
            <button
              type="submit"
              disabled={isPending || Boolean(state?.ok)}
              className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/20 px-4 py-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50"
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
