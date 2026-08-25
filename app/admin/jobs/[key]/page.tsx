import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"

import { AdminJobHistoryTable } from "@/components/admin/admin-job-history-table"
import { AdminJobPhaseTimeline } from "@/components/admin/admin-job-phase-timeline"
import { getEffectiveAdminJobDefinition } from "@/lib/admin/effective-job-catalog"
import { loadAdminJobPhases } from "@/lib/admin/job-phase-data"
import { QEOINDEX_EOD_JOB_KEY } from "@/lib/admin/job-phases"
import { deriveAdminJobStatus, loadAdminJobHistory } from "@/lib/admin/job-health"

export const dynamic = "force-dynamic"

export default async function AdminJobDetailPage(props: { params: Promise<{ key: string }> }) {
  const { key } = await props.params
  const decodedKey = decodeURIComponent(key)
  const jobDefinition = getEffectiveAdminJobDefinition(decodedKey)

  if (!jobDefinition) {
    notFound()
  }

  const history = await loadAdminJobHistory(decodedKey, 50)
  const latestRun = history[0]
  const phases = decodedKey === QEOINDEX_EOD_JOB_KEY && latestRun?.id
    ? await loadAdminJobPhases(latestRun.id)
    : []
  const status = deriveAdminJobStatus(jobDefinition, latestRun ? { status: latestRun.status, startedAt: latestRun.started_at, finishedAt: latestRun.finished_at } : null)

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/jobs"
            prefetch={false}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.1] bg-white/[0.03] text-slate-300 transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/10 hover:text-emerald-300"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white">{jobDefinition.label}</h2>
              <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-400">
                {status.toUpperCase()}
              </span>
            </div>
            <p className="font-mono text-xs text-slate-400">{jobDefinition.key}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <div className="rounded-lg border border-white/[0.08] bg-[#0c1016] px-3 py-1.5 text-slate-300">
            <span className="text-slate-400">Lịch (ICT): </span>
            <span className="font-mono text-white">{jobDefinition.scheduleIct || "Thủ công"}</span>
          </div>
          <div className="rounded-lg border border-white/[0.08] bg-[#0c1016] px-3 py-1.5 text-slate-300">
            <span className="text-slate-400">Độ tươi: </span>
            <span className="font-mono text-white">{jobDefinition.freshnessMinutes} phút</span>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-white/[0.08] bg-[#0c1016] p-4 text-xs text-slate-300">
        <h3 className="font-semibold text-white">Mô tả tác vụ</h3>
        <p className="mt-1 text-slate-400">{jobDefinition.description}</p>
      </div>

      {decodedKey === QEOINDEX_EOD_JOB_KEY ? <AdminJobPhaseTimeline rows={phases} /> : null}

      <div className="space-y-3">
        <h3 className="text-sm font-bold text-white">Lịch sử Thực thi (50 lần gần nhất)</h3>
        <AdminJobHistoryTable runs={history} />
      </div>
    </div>
  )
}
