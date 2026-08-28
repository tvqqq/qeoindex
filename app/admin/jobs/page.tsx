import { Activity } from "lucide-react"

import { AdminCronTimeline } from "@/components/admin/admin-cron-timeline"
import { AdminJobAuditSummary } from "@/components/admin/admin-job-audit-summary"
import { AdminJobsTable } from "@/components/admin/admin-jobs-table"
import { loadAdminJobsSnapshot } from "@/lib/admin/job-health"

export const dynamic = "force-dynamic"

export default async function AdminJobsPage() {
  const snapshot = await loadAdminJobsSnapshot()

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-white sm:text-lg">Tác vụ & Lịch Cron Hệ thống</h2>
            <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-400">
              {snapshot.counts.total} JOBS
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-400">
            Giám sát trạng thái {snapshot.counts.total} tác vụ, chu kỳ làm mới, thời lượng thực thi và kích hoạt thủ công các tác vụ an toàn.
          </p>
        </div>
      </div>

      <AdminJobAuditSummary jobs={snapshot.jobs} />

      <AdminCronTimeline jobs={snapshot.jobs} />

      <div className="space-y-3.5">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-emerald-400" />
          <h3 className="text-sm font-bold text-white">Danh mục Chi tiết Tác vụ & Vận hành</h3>
        </div>
        <AdminJobsTable jobs={snapshot.jobs} />
      </div>
    </div>
  )
}
