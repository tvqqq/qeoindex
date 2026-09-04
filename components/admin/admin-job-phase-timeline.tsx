"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock3,
  MinusCircle,
  RefreshCw,
  Workflow,
  XCircle,
} from "lucide-react"

import { formatAdminModelLabel, type AdminAiUsage } from "@/modules/admin/job-ai-usage"
import {
  buildAdminEodRunView,
  type AdminEodBusinessPhaseStatus,
  type AdminEodRunSnapshot,
  type SystemJobPhaseRow,
} from "@/modules/admin/job-phases"
import { formatAdminDateTime, formatAdminDuration, formatAdminTokenCount } from "@/modules/admin/time"

export interface AdminJobPhaseTimelineProps {
  rows: SystemJobPhaseRow[]
  run: AdminEodRunSnapshot | null
  aiUsage?: AdminAiUsage | null
}

const STATUS_LABEL: Record<AdminEodBusinessPhaseStatus, string> = {
  pending: "Pending",
  queued: "Queued",
  running: "Running",
  retrying: "Retrying",
  degraded: "Degraded",
  partial: "Partial",
  succeeded: "Succeeded",
  failed: "Failed",
  skipped: "Skipped",
}

const STATUS_CLASS: Record<AdminEodBusinessPhaseStatus, string> = {
  pending: "border-white/[0.08] bg-white/[0.03] text-slate-400",
  queued: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  running: "border-cyan-500/30 bg-cyan-500/10 text-cyan-300",
  retrying: "border-sky-400/35 bg-sky-400/10 text-sky-200",
  degraded: "border-amber-500/35 bg-amber-500/10 text-amber-200",
  partial: "border-orange-500/40 bg-orange-500/10 text-orange-200",
  succeeded: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  failed: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  skipped: "border-amber-500/30 bg-amber-500/10 text-amber-300",
}

function StatusIcon({ status }: { status: AdminEodBusinessPhaseStatus }) {
  if (status === "succeeded") return <CheckCircle2 className="h-4 w-4 text-emerald-400" />
  if (status === "failed") return <XCircle className="h-4 w-4 text-rose-400" />
  if (status === "partial" || status === "degraded") return <AlertTriangle className="h-4 w-4 text-amber-300" />
  if (status === "retrying") return <RefreshCw className="h-4 w-4 text-sky-300" />
  if (status === "running" || status === "queued") return <Clock3 className="h-4 w-4 text-cyan-300" />
  if (status === "skipped") return <MinusCircle className="h-4 w-4 text-amber-300" />
  return <Circle className="h-4 w-4 text-slate-500" />
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

function shortId(value: string | null) {
  if (!value) return "—"
  return value.length > 20 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value
}

function AdminEodRetryAction({ runId, retryTickers }: { runId: string; retryTickers: string[] }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function retry() {
    if (pending || retryTickers.length === 0) return
    const confirmed = window.confirm(
      `Retry ${retryTickers.length} ticker lỗi (${retryTickers.join(", ")}) cho EOD run này?`,
    )
    if (!confirmed) return

    setPending(true)
    setMessage(null)
    setError(null)
    try {
      const response = await fetch("/api/admin/qeoindex/eod/retry", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, tickers: retryTickers }),
      })
      const payload = await response.json().catch(() => null) as {
        ok?: boolean
        workflowRunId?: string
        error?: string
      } | null
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || `Retry request failed (${response.status})`)
      }
      setMessage(`Targeted retry đã được dispatch${payload.workflowRunId ? ` · ${payload.workflowRunId}` : ""}.`)
      router.refresh()
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "Không thể dispatch targeted retry")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={retry}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-lg border border-orange-500/35 bg-orange-500/10 px-3 py-2 text-[11px] font-bold text-orange-200 transition-colors hover:bg-orange-500/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        {pending ? "Đang dispatch retry…" : `Targeted Retry (${retryTickers.length})`}
      </button>
      {message ? <p className="text-[10px] text-emerald-300">{message}</p> : null}
      {error ? <p className="text-[10px] text-rose-300">{error}</p> : null}
    </div>
  )
}

export function AdminJobPhaseTimeline({ rows, run, aiUsage = null }: AdminJobPhaseTimelineProps) {
  const runView = buildAdminEodRunView(rows, run)
  const failedTickers = runView.failedTickers
  const coverage = runView.universeCount !== null && runView.healthyCount !== null
    ? `${runView.healthyCount}/${runView.universeCount}`
    : "—"

  return (
    <section className="space-y-4 rounded-2xl border border-white/[0.08] bg-[#0c1017] p-5 sm:p-6" aria-label="QeoIndex EOD v4 business phases">
      <div className="flex flex-col gap-3 border-b border-white/[0.06] pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
            <Workflow className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">EOD v4 Business Phases</h3>
            <p className="text-[11px] text-slate-400">
              7 operator phases; durable step/ticker telemetry nằm trong từng phase để debug khi cần.
            </p>
          </div>
        </div>
        <span className={`w-fit rounded-md border px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider ${STATUS_CLASS[runView.terminalStatus]}`}>
          Terminal: {STATUS_LABEL[runView.terminalStatus]}
        </span>
      </div>

      <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-xl border border-white/[0.06] bg-[#080c11] p-3">
          <dt className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Trading date</dt>
          <dd className="mt-1 font-mono text-xs font-semibold text-white">{runView.tradingDate ?? "—"}</dd>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-[#080c11] p-3">
          <dt className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Universe version</dt>
          <dd className="mt-1 font-mono text-xs font-semibold text-white" title={runView.universeRunId ?? undefined}>{shortId(runView.universeRunId)}</dd>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-[#080c11] p-3">
          <dt className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Healthy coverage</dt>
          <dd className="mt-1 font-mono text-xs font-semibold text-white">{coverage}</dd>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-[#080c11] p-3">
          <dt className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Failed tickers</dt>
          <dd className={`mt-1 font-mono text-xs font-semibold ${Number(runView.failedCount || 0) > 0 ? "text-orange-200" : "text-white"}`}>
            {runView.failedCount ?? failedTickers.length}
          </dd>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-[#080c11] p-3">
          <dt className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Run ID</dt>
          <dd className="mt-1 font-mono text-xs font-semibold text-white" title={runView.runId ?? undefined}>{shortId(runView.runId)}</dd>
        </div>
      </dl>

      {failedTickers.length > 0 ? (
        <div className="grid gap-3 rounded-xl border border-orange-500/25 bg-orange-500/[0.06] p-3.5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-orange-300">PARTIAL coverage diagnostics</p>
            <p className="mt-1 break-words font-mono text-[11px] text-slate-200">
              Failed: {failedTickers.join(", ")}
            </p>
            <p className="mt-1 break-words font-mono text-[10px] text-slate-400">
              Retry eligible: {runView.retryEligibleTickers.length ? runView.retryEligibleTickers.join(", ") : "none"}
            </p>
          </div>
          {runView.retryAvailable && runView.runId ? (
            <AdminEodRetryAction runId={runView.runId} retryTickers={runView.retryEligibleTickers} />
          ) : null}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-[#080c11]">
        <ol className="divide-y divide-white/[0.05]">
          {runView.phases.map((phase) => {
            const autoOpen = ["running", "retrying", "degraded", "partial", "failed"].includes(phase.status)
            return (
              <li key={phase.key} className="p-4 transition-colors hover:bg-white/[0.01]">
                <details open={autoOpen}>
                  <summary className="group cursor-pointer list-none">
                    <div className="grid gap-3 lg:grid-cols-[48px_minmax(220px,1fr)_minmax(260px,1fr)_20px] lg:items-center">
                      <div className="flex items-center gap-2">
                        <StatusIcon status={phase.status} />
                        <span className="font-mono text-[11px] font-bold text-slate-500">{String(phase.order).padStart(2, "0")}</span>
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-bold text-white">{phase.key}</span>
                          <span className={`rounded-md border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${STATUS_CLASS[phase.status]}`}>
                            {STATUS_LABEL[phase.status]}
                          </span>
                        </div>
                        <p className="mt-1 text-xs font-semibold text-slate-200">{phase.label}</p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{phase.description}</p>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-slate-400">
                        <span>Steps: <strong className="text-slate-200">{phase.summary.succeeded}/{phase.summary.total}</strong></span>
                        {phase.summary.failed > 0 ? <span>Failed: <strong className="text-rose-300">{phase.summary.failed}</strong></span> : null}
                        {phase.summary.pending > 0 ? <span>Pending: <strong className="text-slate-300">{phase.summary.pending}</strong></span> : null}
                        <span>Duration: <strong className="text-slate-200">{formatAdminDuration(phase.durationMs)}</strong></span>
                        {phase.startedAt ? <span>Start: <strong className="text-slate-200">{formatAdminDateTime(phase.startedAt)}</strong></span> : null}
                      </div>
                      <ChevronDown className="h-4 w-4 text-slate-500 transition-transform group-open:rotate-180" />
                    </div>
                  </summary>

                  <div className="mt-3 space-y-2 border-t border-white/[0.05] pt-3">
                    {phase.children.map((child) => {
                      const summaryEntries = Object.entries(child.summary ?? {}).slice(0, 12)
                      return (
                        <div key={child.key} className="grid gap-3 rounded-xl border border-white/[0.06] bg-[#0c1017] p-3 lg:grid-cols-[minmax(200px,0.8fr)_minmax(260px,1.2fr)]">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <StatusIcon status={child.status} />
                              <span className="font-mono text-[11px] font-bold text-slate-100">{child.key}</span>
                              <span className={`rounded-md border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider ${STATUS_CLASS[child.status]}`}>
                                {STATUS_LABEL[child.status]}
                              </span>
                            </div>
                            <p className="mt-1 text-[11px] font-semibold text-slate-300">{child.label}</p>
                            <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">{child.description}</p>
                            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[9px] text-slate-500">
                              <span>#{String(child.order).padStart(2, "0")}</span>
                              <span>{formatAdminDuration(child.durationMs)}</span>
                              {child.startedAt ? <span>{formatAdminDateTime(child.startedAt)}</span> : null}
                            </div>
                          </div>

                          <div className="min-w-0">
                            {child.errorMessage ? (
                              <div className="rounded-lg border border-rose-500/25 bg-rose-500/10 p-2.5 text-[10px] text-rose-300">
                                {child.errorCode ? <span className="font-mono font-bold">[{child.errorCode}] </span> : null}
                                {child.errorMessage}
                              </div>
                            ) : summaryEntries.length ? (
                              <dl className="grid gap-1.5 sm:grid-cols-2">
                                {summaryEntries.map(([key, value]) => (
                                  <div key={key} className="min-w-0 rounded-lg border border-white/[0.05] bg-[#080c11] p-2">
                                    <dt className="truncate font-mono text-[8px] uppercase tracking-wider text-slate-500">{key}</dt>
                                    <dd className="mt-0.5 break-words font-mono text-[9px] font-semibold text-slate-300">{formatSummaryValue(value)}</dd>
                                  </div>
                                ))}
                              </dl>
                            ) : (
                              <p className="text-[10px] text-slate-500">{child.status === "pending" ? "Chờ dependency." : "Chưa có durable summary."}</p>
                            )}
                          </div>
                        </div>
                      )
                    })}

                    {phase.key === "AI_COUNCIL" && aiUsage ? (
                      <div className="grid gap-2 rounded-xl border border-purple-500/20 bg-purple-500/[0.05] p-3 sm:grid-cols-2 xl:grid-cols-4">
                        <div>
                          <p className="text-[8px] font-bold uppercase tracking-wider text-purple-300">Models</p>
                          <p className="mt-1 break-words font-mono text-[10px] text-slate-200">
                            {aiUsage.models.length ? aiUsage.models.map(formatAdminModelLabel).join(" · ") : "—"}
                          </p>
                        </div>
                        <div>
                          <p className="text-[8px] font-bold uppercase tracking-wider text-purple-300">Total tokens</p>
                          <p className="mt-1 font-mono text-[11px] font-bold text-white">{formatAdminTokenCount(aiUsage.totalTokens)}</p>
                        </div>
                        <div>
                          <p className="text-[8px] font-bold uppercase tracking-wider text-purple-300">Input / Output</p>
                          <p className="mt-1 font-mono text-[10px] text-slate-200">{formatAdminTokenCount(aiUsage.inputTokens)} / {formatAdminTokenCount(aiUsage.outputTokens)}</p>
                        </div>
                        <div>
                          <p className="text-[8px] font-bold uppercase tracking-wider text-purple-300">Reasoning / debates</p>
                          <p className="mt-1 font-mono text-[10px] text-slate-200">{formatAdminTokenCount(aiUsage.reasoningTokens)} / {aiUsage.debates}</p>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </details>
              </li>
            )
          })}
        </ol>
      </div>

      {runView.tickerAttempts.length > 0 ? (
        <details className="rounded-xl border border-white/[0.06] bg-[#080c11] p-3.5">
          <summary className="cursor-pointer text-[11px] font-bold text-slate-200">
            Ticker attempt diagnostics ({runView.tickerAttempts.length})
          </summary>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[10px]">
              <thead className="font-mono uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="pb-2 pr-3">Ticker</th>
                  <th className="pb-2 pr-3">Stage</th>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2 pr-3">Attempt</th>
                  <th className="pb-2 pr-3">Error class</th>
                  <th className="pb-2 pr-3">Retry</th>
                  <th className="pb-2">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05] font-mono text-slate-300">
                {runView.tickerAttempts.map((attempt, index) => (
                  <tr key={`${attempt.ticker}-${attempt.stage}-${attempt.attempt ?? "na"}-${index}`}>
                    <td className="py-2 pr-3 font-bold text-white">{attempt.ticker}</td>
                    <td className="py-2 pr-3">{attempt.stage}</td>
                    <td className="py-2 pr-3">{attempt.status}</td>
                    <td className="py-2 pr-3">{attempt.attempt ?? "—"}</td>
                    <td className="py-2 pr-3">{attempt.errorClass ?? "—"}</td>
                    <td className={`py-2 pr-3 ${attempt.retryEligible ? "text-orange-200" : "text-slate-500"}`}>{attempt.retryEligible ? "eligible" : "no"}</td>
                    <td className="max-w-[360px] break-words py-2 text-slate-400">{attempt.error ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </section>
  )
}
