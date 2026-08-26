import { AdminCronTimeline } from "@/components/admin/admin-cron-timeline"
import { AdminJobAuditSummary } from "@/components/admin/admin-job-audit-summary"
import { AdminJobsTable } from "@/components/admin/admin-jobs-table"
import { loadAdminJobsSnapshot } from "@/lib/admin/job-health"

export const dynamic = "force-dynamic"

export default async function AdminJobsPage() {
  const snapshot = await loadAdminJobsSnapshot()

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-bold text-white">Tác vụ & Lịch Cron Hệ thống</h2>
        <p className="text-xs text-slate-400">
          Giám sát trạng thái {snapshot.counts.total} tác vụ, chu kỳ làm mới, thời lượng thực thi và kích hoạt thủ công các tác vụ an toàn.
        </p>
      </div>

      <AdminJobAuditSummary jobs={snapshot.jobs} />

      <AdminCronTimeline jobs={snapshot.jobs} />

      <div className="space-y-3">
        <h3 className="text-sm font-bold text-white">Danh sách Chi tiết Tác vụ</h3>
        <AdminJobsTable jobs={snapshot.jobs} />
      </div>
    </div>
  )
}
