import type { SystemJobRunRow } from "@/lib/admin/job-health"
import { formatAdminDateTime } from "@/lib/admin/time"

export interface AdminJobHistoryTableProps {
  runs: SystemJobRunRow[]
}

export function AdminJobHistoryTable({ runs }: AdminJobHistoryTableProps) {
  if (!runs.length) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-[#0c1017] p-8 text-center text-xs text-slate-400">
        Chưa có lịch sử thực thi nào được ghi nhận cho tác vụ này.
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0c1017]">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-white/[0.06] bg-[#080c11]">
            <tr className="text-[11px] font-medium text-slate-400">
              <th className="px-4 py-3.5 font-medium">Run ID</th>
              <th className="px-4 py-3.5 font-medium">Kích hoạt</th>
              <th className="px-4 py-3.5 font-medium">Trạng thái</th>
              <th className="px-4 py-3.5 font-medium">Bắt đầu (ICT)</th>
              <th className="px-4 py-3.5 font-medium">Thời lượng</th>
              <th className="px-4 py-3.5 font-medium">Người thực thi</th>
              <th className="px-4 py-3.5 font-medium">Chi tiết / Kết quả</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            {runs.map((run) => {
              const isSucceeded = run.status === "succeeded"
              const isFailed = run.status === "failed"

              return (
                <tr key={run.id} className="text-slate-300 transition-colors hover:bg-white/[0.02]">
                  <td className="px-4 py-3.5 font-mono text-[11px] text-slate-400">
                    <span className="rounded bg-white/[0.03] px-1.5 py-0.5 border border-white/[0.06] text-slate-300 font-medium">
                      {run.id.slice(0, 8)}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 font-mono text-[11px] uppercase">
                    <span className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-slate-300 font-semibold text-[10px]">
                      {run.trigger}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <span
                      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                        isSucceeded
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                          : isFailed
                            ? "border-rose-500/30 bg-rose-500/10 text-rose-400"
                            : "border-amber-500/30 bg-amber-500/10 text-amber-400"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          isSucceeded ? "bg-emerald-400" : isFailed ? "bg-rose-400" : "bg-amber-400"
                        }`}
                      />
                      {run.status}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 font-mono text-[11px] text-slate-400">
                    {formatAdminDateTime(run.started_at)}
                  </td>
                  <td className="px-4 py-3.5 font-mono text-slate-200">
                    {run.duration_ms !== null && run.duration_ms !== undefined ? (
                      <span className="font-semibold text-emerald-300">{run.duration_ms}ms</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3.5 font-mono text-[11px] text-slate-400">
                    {run.actor_user_id ? `${run.actor_user_id.slice(0, 8)}...` : "System / Cron"}
                  </td>
                  <td className="px-4 py-3.5">
                    {run.error_message ? (
                      <div className="rounded-lg border border-rose-500/25 bg-rose-500/10 p-2 text-rose-300 text-[11px]">
                        {run.error_code ? <span className="font-mono font-bold">[{run.error_code}] </span> : null}
                        <span title={run.error_message}>{run.error_message.slice(0, 100)}</span>
                      </div>
                    ) : run.summary ? (
                      <pre className="max-h-20 max-w-xs overflow-auto rounded-lg border border-white/[0.06] bg-black/40 p-2 font-mono text-[10px] text-slate-300">
                        {JSON.stringify(run.summary, null, 2)}
                      </pre>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
