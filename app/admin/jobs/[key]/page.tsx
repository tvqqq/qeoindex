import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, Clock, Cpu, History, Timer } from "lucide-react"

import { AdminJobHistoryTable } from "@/components/admin/admin-job-history-table"
import { AdminJobPhaseTimeline } from "@/components/admin/admin-job-phase-timeline"
import { getEffectiveAdminJobDefinition } from "@/lib/admin/effective-job-catalog"
import { loadAdminJobPhases } from "@/lib/admin/job-phase-data"
import { QEOINDEX_EOD_JOB_KEY } from "@/lib/admin/job-phases"
import { loadAdminJobHistory, loadAdminJobView } from "@/lib/admin/job-health"
import { formatAdminDateTime } from "@/lib/admin/time"
import { requireRootPageContext } from "@/lib/auth/root"

export const dynamic = "force-dynamic"

export default async function AdminJobDetailPage(props: { params: Promise<{ key: string }> }) {
  await requireRootPageContext()
  const { key } = await props.params
  const decodedKey = decodeURIComponent(key)
  const jobDefinition = getEffectiveAdminJobDefinition(decodedKey)

  if (!jobDefinition) {
    notFound()
  }

  const [history, jobView] = await Promise.all([
    loadAdminJobHistory(decodedKey, 50),
    loadAdminJobView(decodedKey),
  ])

  if (!jobView) {
    notFound()
  }

  const latestRun = history[0]
  const phases = decodedKey === QEOINDEX_EOD_JOB_KEY && latestRun?.id
    ? await loadAdminJobPhases(latestRun.id)
    : []
  const status = jobView.status

  const isHealthy = status === "healthy"
  const isFailing = status === "failing"
  const currentRun = history.find((run) => run.status === "running" || run.status === "queued") ?? null
  const lastCompletedRun = history.find((run) => run.status !== "running" && run.status !== "queued") ?? null
  const currentSummary = currentRun?.summary ?? null
  const currentStage = typeof currentSummary?.stage === "string" ? currentSummary.stage : null
  const nextWakeAt = typeof currentSummary?.nextWakeAt === "string" ? currentSummary.nextWakeAt : null
  const quality = jobView.domainEvidence?.quality && typeof jobView.domainEvidence.quality === "object"
    ? jobView.domainEvidence.quality as {
        label?: string
        details?: {
          limitedCoverageCount?: number
          completed?: number
          skipped?: number
          errors?: number
        }
      }
    : null
  const qualityLabel = String(quality?.label || "unknown")
  const signalsQualityDetails = decodedKey === "signals.daily" && quality?.details
    ? `${Number(quality.details.completed || 0)} completed / ${Number(quality.details.skipped || 0)} skipped / ${Number(quality.details.errors || 0)} errors`
    : null
  const hasActiveExecution = Boolean(jobView.currentExecution)
  const isDurableWait = currentStage === "WAIT_OPEN" || currentStage === "LUNCH"

  return (
    <div className="space-y-6">
      {/* Header & Status Bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3.5">
          <Link
            href="/admin/jobs"
            prefetch={false}
            className="group flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-[#0c1017] text-slate-400 transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/10 hover:text-emerald-300"
            title="Quay lại danh sách tác vụ"
          >
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white sm:text-lg">{jobDefinition.label}</h2>
              <span
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${
                  isHealthy
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                    : isFailing
                      ? "border-rose-500/30 bg-rose-500/10 text-rose-400"
                      : "border-amber-500/30 bg-amber-500/10 text-amber-400"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    isHealthy ? "bg-emerald-400" : isFailing ? "bg-rose-400" : "bg-amber-400"
                  }`}
                />
                {status.toUpperCase()}
              </span>
            </div>
            <p className="font-mono text-xs text-slate-400">{jobDefinition.key}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2.5 text-xs">
          <div className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-[#0c1017] px-3.5 py-2 text-slate-300">
            <Clock className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-slate-400">Lịch (ICT):</span>
            <span className="font-mono font-semibold text-white">{jobDefinition.scheduleIct || "Thủ công"}</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-[#0c1017] px-3.5 py-2 text-slate-300">
            <Timer className="h-3.5 w-3.5 text-cyan-400" />
            <span className="text-slate-400">Độ tươi tối đa:</span>
            <span className="font-mono font-semibold text-white">{jobDefinition.freshnessMinutes} phút</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-[#0c1017] px-3.5 py-2 text-slate-300">
            <Cpu className="h-3.5 w-3.5 text-purple-400" />
            <span className="text-slate-400">Provider:</span>
            <span className="font-mono font-semibold text-white">{jobDefinition.provider}</span>
          </div>
        </div>
      </div>

      {/* Description card */}
      <div className="rounded-2xl border border-white/[0.08] bg-[#0c1017] p-5 text-xs text-slate-300">
        <h3 className="font-semibold text-white">Mô tả quy trình nghiệp vụ</h3>
        <p className="mt-1 leading-relaxed text-slate-400">{jobDefinition.description}</p>
        <div className="mt-3 grid gap-1 border-t border-white/[0.06] pt-3 text-[11px] text-slate-400 sm:grid-cols-3">
          <span>Health: <strong className="text-slate-200">{status}</strong></span>
          <span>Current execution: <strong className="text-slate-200">{jobView.currentExecution ? jobView.currentExecution.status : "none"}</strong></span>
          <span>Telemetry: <strong className="text-slate-200">{jobView.executionTelemetry?.source === "unavailable" ? "unavailable" : "recorded"}</strong></span>
          {hasActiveExecution ? (
            <>
              <span>Started at: <strong className="text-slate-200">{jobView.currentExecution?.startedAt ? formatAdminDateTime(jobView.currentExecution.startedAt) : "unknown"}</strong></span>
              <span>Current stage: <strong className="text-amber-300">{currentStage || "running"}</strong></span>
              <span>Next wake: <strong className="text-slate-200">{nextWakeAt ? formatAdminDateTime(nextWakeAt) : "active / pending"}</strong></span>
              {isDurableWait ? <span>Execution mode: <strong className="text-cyan-300">Durable wait (expected)</strong></span> : null}
              <span>Current run quality: <strong className="text-slate-200">pending</strong></span>
              <span>Last completed quality: <strong className="text-slate-200">{qualityLabel}</strong>{signalsQualityDetails ? ` — ${signalsQualityDetails}` : ""}{lastCompletedRun?.finished_at ? ` (${formatAdminDateTime(lastCompletedRun.finished_at)})` : ""}</span>
              {decodedKey === "signals.daily" ? <span>Expected completion: <strong className="text-slate-200">~14:45 ICT</strong></span> : null}
            </>
          ) : (
            <span>Data quality: <strong className="text-slate-200">{qualityLabel}</strong></span>
          )}
          {Number(quality?.details?.limitedCoverageCount || 0) > 0 ? <span>Coverage warning: <strong className="text-amber-300">{String(quality?.details?.limitedCoverageCount)} limited</strong></span> : null}
        </div>
      </div>

      {/* EOD Pipeline Phase Timeline if applicable */}
      {decodedKey === QEOINDEX_EOD_JOB_KEY ? <AdminJobPhaseTimeline rows={phases} /> : null}

      {/* History table */}
      <div className="space-y-3.5">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-emerald-400" />
          <h3 className="text-sm font-bold text-white">Lịch sử Thực thi (50 lần chạy gần nhất)</h3>
        </div>
        <AdminJobHistoryTable runs={history} />
      </div>
    </div>
  )
}
