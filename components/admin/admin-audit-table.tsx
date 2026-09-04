"use client"

import { useState } from "react"
import { Search } from "lucide-react"

import { formatAdminDateTime } from "@/modules/admin/time"
import type { AdminAuditView } from "@/modules/admin/types"

export interface AdminAuditTableProps {
  logs: AdminAuditView[]
}

export function AdminAuditTable({ logs }: AdminAuditTableProps) {
  const [searchTerm, setSearchTerm] = useState("")

  const filteredLogs = logs.filter((log) => {
    return (
      log.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.targetKey.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.reason.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (log.actorUserId && log.actorUserId.toLowerCase().includes(searchTerm.toLowerCase()))
    )
  })

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3.5 top-2.5 h-4 w-4 text-slate-400" />
        <input
          type="text"
          placeholder="Tìm kiếm audit log theo hành động, lý do, actor..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full rounded-xl border border-white/[0.08] bg-[#0c1017] py-2 pl-10 pr-3.5 text-xs text-white placeholder-slate-400 focus:border-emerald-500/50 focus:outline-none"
        />
      </div>

      {/* Modern Audit Data Table */}
      <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0c1017]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-white/[0.06] bg-[#080c11]">
              <tr className="text-[11px] font-medium text-slate-400">
                <th className="px-4 py-3.5 font-medium">Hành động & Đối tượng</th>
                <th className="px-4 py-3.5 font-medium">Lý do thay đổi</th>
                <th className="px-4 py-3.5 font-medium">Trước / Sau</th>
                <th className="px-4 py-3.5 font-medium">Người thực hiện</th>
                <th className="px-4 py-3.5 font-medium">Thời gian (ICT)</th>
                <th className="px-4 py-3.5 text-right font-medium">Kết quả</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-xs text-slate-400">
                    {logs.length === 0
                      ? "Chưa có bản ghi audit nào. Nhật ký sẽ tự động ghi nhận khi có thao tác thay đổi Cài đặt Runtime hoặc thực thi Tác vụ thủ công."
                      : "Không có bản ghi audit nào phù hợp với bộ lọc tìm kiếm."}
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.id} className="text-slate-300 transition-colors hover:bg-white/[0.02]">
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs font-bold text-emerald-400">{log.action}</span>
                      </div>
                      <div className="mt-0.5 font-mono text-[11px] text-slate-300">{log.targetKey}</div>
                    </td>

                    <td className="max-w-xs px-4 py-3.5 text-slate-300">
                      <p className="line-clamp-2 leading-relaxed" title={log.reason}>
                        {log.reason}
                      </p>
                    </td>

                    <td className="px-4 py-3.5 font-mono text-[11px]">
                      {log.beforeValue !== undefined && log.beforeValue !== null ? (
                        <div className="text-slate-400">
                          <span className="text-slate-500">Trước: </span>
                          {JSON.stringify(log.beforeValue).slice(0, 40)}
                        </div>
                      ) : null}
                      {log.afterValue !== undefined && log.afterValue !== null ? (
                        <div className="font-semibold text-emerald-300">
                          <span className="text-slate-500">Sau: </span>
                          {JSON.stringify(log.afterValue).slice(0, 40)}
                        </div>
                      ) : null}
                      {!log.beforeValue && !log.afterValue ? <span className="text-slate-500">—</span> : null}
                    </td>

                    <td className="px-4 py-3.5 font-mono text-[11px] text-slate-400">
                      {log.actorUserId ? (
                        <span className="rounded bg-white/[0.03] px-1.5 py-0.5 border border-white/[0.06] text-slate-300">
                          {log.actorUserId.slice(0, 8)}...
                        </span>
                      ) : (
                        <span className="text-slate-500">System</span>
                      )}
                    </td>

                    <td className="px-4 py-3.5 font-mono text-[11px] text-slate-400">
                      {formatAdminDateTime(log.createdAt)}
                    </td>

                    <td className="px-4 py-3.5 text-right">
                      <span
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                          log.success
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                            : "border-rose-500/30 bg-rose-500/10 text-rose-400"
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            log.success ? "bg-emerald-400" : "bg-rose-400"
                          }`}
                        />
                        {log.success ? "THÀNH CÔNG" : "THẤT BẠI"}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
