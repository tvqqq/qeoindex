import { AdminAuditTable } from "@/components/admin/admin-audit-table"
import { loadRecentAuditLogs } from "@/lib/admin/settings"

export const dynamic = "force-dynamic"

export default async function AdminAuditPage() {
  const logs = await loadRecentAuditLogs(100)

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-white">Nhật ký Audit Hệ thống</h2>
        <p className="text-xs text-slate-400">
          Lịch sử ghi nhận đầy đủ tất cả các hành động thay đổi tham số cài đặt và thực thi tác vụ thủ công.
        </p>
      </div>

      <AdminAuditTable logs={logs} />
    </div>
  )
}
