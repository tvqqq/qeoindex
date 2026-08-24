import type { SystemJobRunRow } from "@/lib/admin/job-health"

export interface AdminJobHistoryTableProps {
  runs: SystemJobRunRow[]
}

export function AdminJobHistoryTable({ runs }: AdminJobHistoryTableProps) {
  if (!runs.length) {
    return (
      <div className="rounded-xl border border-white/[0.08] bg-[#0c1016] p-8 text-center text-xs text-slate-400">
        Chưa có lịch sử thực thi nào được ghi nhận cho tác vụ này.
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#0c1016] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-white/[0.06] bg-[#080c10]">
            <tr className="text-[11px] font-medium text-slate-400">
              <th className="px-4 py-3 font-medium">Run ID</th>
              <th className="px-4 py-3 font-medium">Kích hoạt</th>
              <th className="px-4 py-3 font-medium">Trạng thái</th>
              <th className="px-4 py-3 font-medium">Bắt đầu</th>
              <th className="px-4 py-3 font-medium">Thời lượng</th>
              <th className="px-4 py-3 font-medium">Người thực thi</th>
              <th className="px-4 py-3 font-medium">Chi tiết / Kết quả</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            {runs.map((run) => {
              const isSucceeded = run.status === "succeeded"
              const isFailed = run.status === "failed"

              return (
                <tr key={run.id} className="text-slate-300 hover:bg-white/[0.02]">
                  <td className="px-4 py-3 font-mono text-[11px] text-slate-400">
                    {run.id.slice(0, 8)}...
                  </td>

                  <td className="px-4 py-3 font-mono text-[11px] uppercase text-slate-300">
                    <span className="rounded border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5">
                      {run.trigger}
                    </span>
                  </td>

                  <td className="px-4 py-3">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                        isSucceeded
                          ? "bg-emerald-500/10 text-emerald-400"
                          : isFailed
                            ? "bg-rose-500/10 text-rose-400"
                            : "bg-amber-500/10 text-amber-400"
                      }`}
                    >
                      {run.status}
                    </span>
                  </td>

                  <td className="px-4 py-3 font-mono text-[11px] text-slate-400">
                    {new Date(run.started_at).toLocaleString("vi-VN")}
                  </td>

                  <td className="px-4 py-3 font-mono text-slate-300">
                    {run.duration_ms !== null && run.duration_ms !== undefined ? `${run.duration_ms}ms` : "—"}
                  </td>

                  <td className="px-4 py-3 font-mono text-[11px] text-slate-400">
                    {run.actor_user_id ? `${run.actor_user_id.slice(0, 8)}...` : "System / Cron"}
                  </td>

                  <td className="px-4 py-3">
                    {run.error_message ? (
                      <span className="text-rose-400" title={run.error_message}>
                        {run.error_code ? `[${run.error_code}] ` : ""}{run.error_message.slice(0, 80)}
                      </span>
                    ) : run.summary ? (
                      <pre className="max-h-16 max-w-xs overflow-auto rounded bg-black/30 p-1 font-mono text-[10px] text-slate-400">
                        {JSON.stringify(run.summary, null, 2)}
                      </pre>
                    ) : (
                      <span className="text-slate-400">—</span>
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
