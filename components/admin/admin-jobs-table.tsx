"use client"

import { useState } from "react"
import Link from "next/link"
import { AlertTriangle, ExternalLink, Play, Search } from "lucide-react"

import { formatAdminModelLabel } from "@/lib/admin/job-ai-usage"
import { formatAdminDate, formatAdminDuration, formatAdminTime, formatAdminTokenCount } from "@/lib/admin/time"
import type { AdminJobView } from "@/lib/admin/types"
import { AdminManualJobModal } from "./admin-manual-job-modal"

export interface AdminJobsTableProps {
  jobs: AdminJobView[]
}

const STATUS_BADGE_STYLES = {
  healthy: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  degraded: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  failing: "border-rose-500/30 bg-rose-500/10 text-rose-400",
  stale: "border-orange-500/30 bg-orange-500/10 text-orange-400",
  in_progress: "border-cyan-500/30 bg-cyan-500/10 text-cyan-300",
  unknown: "border-white/[0.08] bg-white/[0.04] text-slate-400",
}

function formatDateKey(value: string) {
  const [year, month, day] = value.split("-")
  return year && month && day ? `${day}/${month}` : value
}

export function AdminJobsTable({ jobs }: AdminJobsTableProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedGroup, setSelectedGroup] = useState<string>("all")
  const [runningJob, setRunningJob] = useState<AdminJobView | null>(null)

  const groups = ["all", ...Array.from(new Set(jobs.map((j) => j.group)))]

  const filteredJobs = jobs.filter((j) => {
    const matchesGroup = selectedGroup === "all" || j.group === selectedGroup
    const matchesSearch =
      j.key.toLowerCase().includes(searchTerm.toLowerCase()) ||
      j.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
      j.description.toLowerCase().includes(searchTerm.toLowerCase())
    return matchesGroup && matchesSearch
  })

  return (
    <div className="space-y-4">
      {/* Search & Filter Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3.5 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Tìm kiếm tác vụ theo tên, key, mô tả..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-xl border border-white/[0.08] bg-[#0c1017] py-2 pl-10 pr-3.5 text-xs text-white placeholder-slate-400 focus:border-emerald-500/50 focus:outline-none"
          />
        </div>

        <div className="flex overflow-x-auto gap-1.5">
          {groups.map((group) => (
            <button
              key={group}
              type="button"
              onClick={() => setSelectedGroup(group)}
              className={`rounded-xl px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
                selectedGroup === group
                  ? "border border-emerald-500/40 bg-emerald-500/15 text-emerald-300 shadow-sm"
                  : "border border-transparent text-slate-400 hover:border-white/[0.06] hover:bg-white/[0.03] hover:text-white"
              }`}
            >
              {group}
            </button>
          ))}
        </div>
      </div>

      {/* Modern Data Table */}
      <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0c1017]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-white/[0.06] bg-[#080c11]">
              <tr className="text-[11px] font-medium text-slate-400">
                <th className="px-4 py-3.5 font-medium">Tác vụ & Mô tả</th>
                <th className="px-4 py-3.5 font-medium">Lịch chạy (ICT)</th>
                <th className="px-4 py-3.5 font-medium">Trạng thái</th>
                <th className="px-4 py-3.5 font-medium">Lần chạy cuối (ICT)</th>
                <th className="px-4 py-3.5 font-medium">Thời lượng</th>
                <th className="px-4 py-3.5 font-medium">AI Usage</th>
                <th className="px-4 py-3.5 text-right font-medium">Hành động</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {filteredJobs.map((job) => {
                const isManualAllowed = job.manualPolicy !== "disabled"
                const badgeStyle = STATUS_BADGE_STYLES[job.status] || STATUS_BADGE_STYLES.unknown
                const lastRunAt = job.lastFinishedAt || job.lastStartedAt

                return (
                  <tr key={job.key} className="text-slate-300 transition-colors hover:bg-white/[0.02]">
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/admin/jobs/${job.key}`}
                          prefetch={false}
                          className="font-mono font-bold text-white transition-colors hover:text-emerald-400"
                        >
                          {job.label}
                        </Link>
                        <span className="rounded-md border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.2 font-mono text-[9px] text-slate-400">
                          {job.provider}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-slate-400">{job.description}</p>
                      {job.healthReason ? (
                        <p className="mt-1 text-[11px] font-medium text-slate-300">{job.healthReason}</p>
                      ) : null}
                      {job.currentExecution ? (
                        <p className="mt-1 text-[10px] font-medium text-cyan-300">Execution: {job.currentExecution.status}</p>
                      ) : null}
                      {job.executionTelemetry?.source === "unavailable" ? (
                        <p className="mt-1 text-[10px] font-medium text-slate-500">Execution telemetry: unavailable</p>
                      ) : null}
                      {job.domainEvidence?.quality && typeof job.domainEvidence.quality === "object" ? (
                        (() => {
                          const quality = job.domainEvidence.quality as { label?: string; details?: { limitedCoverageCount?: number } }
                          return <p className="mt-1 text-[10px] font-medium text-amber-300">
                            Data quality: {String(quality.label || "unknown")}{quality.details?.limitedCoverageCount ? ` · Coverage giới hạn: ${quality.details.limitedCoverageCount}` : ""}
                          </p>
                        })()
                      ) : null}
                      {job.conflictWarning ? (
                        <div className="mt-1 flex items-center gap-1 text-[10px] font-medium text-amber-400">
                          <AlertTriangle className="h-3 w-3 shrink-0" />
                          <span>{job.conflictWarning}</span>
                        </div>
                      ) : null}
                    </td>

                    <td className="px-4 py-3.5 font-mono text-slate-300">
                      <div className="font-semibold text-white">{job.scheduleIct || "Thủ công"}</div>
                      {job.schedulerStatus && job.schedulerStatus !== "unscheduled" ? (
                        <div className="mt-0.5 text-[10px] text-slate-400">
                          Scheduler:{" "}
                          <span
                            className={
                              job.schedulerEvidence?.status === "live_verified"
                                ? "font-bold text-emerald-400"
                                : job.schedulerEvidence?.status === "config_only"
                                  ? "font-bold text-sky-300"
                                  : "font-bold text-amber-300"
                            }
                          >
                            {job.schedulerEvidence?.availability === "unavailable"
                              ? "EVIDENCE UNAVAILABLE"
                              : job.schedulerEvidence?.status === "config_only"
                                ? "CONFIGURED IN DEPLOYED REVISION"
                                : job.schedulerEvidence?.status === "live_verified"
                                  ? "LIVE VERIFIED"
                                  : (job.schedulerEvidence?.status || job.schedulerStatus)}
                          </span>
                        </div>
                      ) : null}
                    </td>

                    <td className="px-4 py-3.5">
                      <span
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${badgeStyle}`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            job.status === "healthy"
                              ? "bg-emerald-400"
                              : job.status === "failing"
                                ? "bg-rose-400"
                                : job.status === "in_progress"
                                  ? "bg-cyan-300"
                                : "bg-amber-400"
                          }`}
                        />
                        {job.status}
                      </span>
                    </td>

                    <td className="px-4 py-3.5 font-mono text-[11px] text-slate-400">
                      {lastRunAt ? (
                        <div>
                          <div className="font-medium text-slate-200">{formatAdminTime(lastRunAt)}</div>
                          <div className="text-[10px] text-slate-400">{formatAdminDate(lastRunAt)}</div>
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>

                    <td className="px-4 py-3.5 font-mono text-slate-300">
                      {formatAdminDuration(job.lastDurationMs)}
                    </td>

                    <td className="min-w-[150px] px-4 py-3.5">
                      {job.aiUsage ? (
                        <div
                          className="space-y-0.5"
                          title={`${job.aiUsage.models.join(" · ")} | input ${job.aiUsage.inputTokens}, output ${job.aiUsage.outputTokens}, reasoning ${job.aiUsage.reasoningTokens}, cost $${job.aiUsage.estimatedCostUsd.toFixed(6)}`}
                        >
                          <div className="font-mono font-semibold text-emerald-300">
                            {formatAdminTokenCount(job.aiUsage.totalTokens)} tokens
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {job.aiUsage.models.map(formatAdminModelLabel).join(" · ") || "Model chưa ghi nhận"}
                          </div>
                          <div className="text-[9px] text-slate-500">
                            {job.aiUsage.debates} debates · {formatDateKey(job.aiUsage.asOfDate)}
                          </div>
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>

                    <td className="px-4 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {isManualAllowed ? (
                          <button
                            type="button"
                            onClick={() => setRunningJob(job)}
                            className="flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-xs font-bold text-emerald-300 transition-colors hover:bg-emerald-500/25"
                          >
                            <Play className="h-3 w-3" />
                            <span>Chạy</span>
                          </button>
                        ) : null}

                        <Link
                          href={`/admin/jobs/${job.key}`}
                          prefetch={false}
                          className="flex items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-xs text-slate-300 transition-colors hover:border-white/[0.15] hover:text-white"
                          title="Xem lịch sử chạy"
                        >
                          <ExternalLink className="h-3 w-3" />
                          <span>Chi tiết</span>
                        </Link>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {runningJob ? <AdminManualJobModal job={runningJob} onClose={() => setRunningJob(null)} /> : null}
    </div>
  )
}
