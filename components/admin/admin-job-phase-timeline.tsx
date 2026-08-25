import {
  CheckCircle2,
  Circle,
  Clock3,
  MinusCircle,
  XCircle,
} from "lucide-react"

import {
  buildAdminJobPhaseTimeline,
  type AdminJobPhaseStatus,
  type SystemJobPhaseRow,
} from "@/lib/admin/job-phases"

export interface AdminJobPhaseTimelineProps {
  rows: SystemJobPhaseRow[]
}

const STATUS_LABEL: Record<AdminJobPhaseStatus, string> = {
  pending: "Pending",
  queued: "Queued",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  skipped: "Skipped",
}

const STATUS_CLASS: Record<AdminJobPhaseStatus, string> = {
  pending: "border-white/[0.08] bg-white/[0.03] text-slate-400",
  queued: "border-sky-500/25 bg-sky-500/10 text-sky-300",
  running: "border-cyan-500/30 bg-cyan-500/10 text-cyan-300",
  succeeded: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  failed: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  skipped: "border-amber-500/30 bg-amber-500/10 text-amber-300",
}

function StatusIcon({ status }: { status: AdminJobPhaseStatus }) {
  if (status === "succeeded") return <CheckCircle2 className="h-4 w-4 text-emerald-400" />
  if (status === "failed") return <XCircle className="h-4 w-4 text-rose-400" />
  if (status === "running" || status === "queued") return <Clock3 className="h-4 w-4 text-cyan-300" />
  if (status === "skipped") return <MinusCircle className="h-4 w-4 text-amber-300" />
  return <Circle className="h-4 w-4 text-slate-500" />
}

function formatDuration(durationMs: number | null) {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs < 0) return "—"
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`
  const seconds = Math.round(durationMs / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`
}

function formatSummaryValue(value: unknown) {
  if (value === null || value === undefined) return "—"
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function AdminJobPhaseTimeline({ rows }: AdminJobPhaseTimelineProps) {
  const phases = buildAdminJobPhaseTimeline(rows)

  return (
    <section className="space-y-3" aria-label="QeoIndex EOD pipeline phases">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-sm font-bold text-white">Pipeline phases</h3>
          <p className="text-[11px] text-slate-400">
            Dependency-driven: phase sau chỉ chạy khi phase trước hoàn tất hợp lệ.
          </p>
        </div>
        <div className="font-mono text-[10px] text-slate-500">
          {rows.length ? `${rows.length} phase event(s) recorded` : "Chưa có phase telemetry cho run này"}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#0c1016]">
        <ol className="divide-y divide-white/[0.05]">
          {phases.map((phase) => {
            const summaryEntries = Object.entries(phase.summary ?? {}).slice(0, 8)
            return (
              <li key={phase.key} className="grid gap-3 px-4 py-3.5 lg:grid-cols-[36px_minmax(220px,1fr)_minmax(260px,1.5fr)]">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5">
                    <StatusIcon status={phase.status} />
                  </span>
                  <span className="font-mono text-[10px] text-slate-500">{String(phase.order).padStart(2, "0")}</span>
                </div>

                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold text-white">{phase.key}</span>
                    <span className={`rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase ${STATUS_CLASS[phase.status]}`}>
                      {STATUS_LABEL[phase.status]}
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-medium text-slate-200">{phase.label}</p>
                  <p className="mt-0.5 text-[11px] leading-5 text-slate-400">{phase.description}</p>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-slate-500">
                    <span>Duration: {formatDuration(phase.durationMs)}</span>
                    {phase.startedAt ? <span>Start: {new Date(phase.startedAt).toLocaleString("vi-VN")}</span> : null}
                  </div>
                </div>

                <div className="min-w-0">
                  {phase.errorMessage ? (
                    <div className="rounded-lg border border-rose-500/20 bg-rose-500/[0.06] p-2.5 text-[11px] text-rose-300">
                      {phase.errorCode ? <span className="font-mono font-bold">[{phase.errorCode}] </span> : null}
                      {phase.errorMessage}
                    </div>
                  ) : summaryEntries.length ? (
                    <dl className="grid gap-x-3 gap-y-1.5 sm:grid-cols-2">
                      {summaryEntries.map(([key, value]) => (
                        <div key={key} className="min-w-0 rounded-lg border border-white/[0.06] bg-black/20 px-2.5 py-1.5">
                          <dt className="truncate font-mono text-[9px] uppercase tracking-wide text-slate-500">{key}</dt>
                          <dd className="mt-0.5 break-words font-mono text-[10px] text-slate-300">{formatSummaryValue(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <div className="text-[11px] text-slate-500">
                      {phase.status === "pending" ? "Chờ dependency trước hoàn tất." : "Phase chưa ghi summary."}
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      </div>
    </section>
  )
}
