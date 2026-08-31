import { AdminAuditTable } from "@/components/admin/admin-audit-table"
import { loadRecentAuditLogs } from "@/lib/admin/settings"
import { requireRootPageContext } from "@/lib/auth/root"

export const dynamic = "force-dynamic"

export default async function AdminAuditPage() {
  await requireRootPageContext()
  const logs = await loadRecentAuditLogs(100)

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-white sm:text-lg">Nhật ký Audit Hệ thống</h2>
            <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-400">
              {logs.length} EVENTS (MAX 100)
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-400">
            Lịch sử ghi nhận đầy đủ tất cả các hành động thay đổi tham số cài đặt và thực thi tác vụ thủ công.
          </p>
        </div>
      </div>

      <AdminAuditTable logs={logs} />
    </div>
  )
}
