import { AdminJobsTable } from "@/components/admin/admin-jobs-table"
import { loadAdminJobsSnapshot } from "@/lib/admin/job-health"

export const dynamic = "force-dynamic"

export default async function AdminJobsPage() {
  const snapshot = await loadAdminJobsSnapshot()

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-white">Tác vụ & Lịch Cron Hệ thống</h2>
        <p className="text-xs text-slate-400">
          Giám sát trạng thái {snapshot.counts.total} tác vụ, chu kỳ làm mới, thời lượng thực thi và kích hoạt thủ công các tác vụ an toàn.
        </p>
      </div>

      <AdminJobsTable jobs={snapshot.jobs} />
    </div>
  )
}
