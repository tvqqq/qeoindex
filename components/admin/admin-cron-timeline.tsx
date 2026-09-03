"use client"

import { useState } from "react"
import Link from "next/link"
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  Layers,
  ListOrdered,
  XCircle,
  Zap,
} from "lucide-react"

import type { AdminJobView } from "@/lib/admin/types"
import {
  buildCronTimelineModel,
  type TimelineJobNode,
  type TimelineLaneId,
} from "@/lib/admin/cron-timeline"

export interface AdminCronTimelineProps {
  jobs: AdminJobView[]
}

const STATUS_BADGE_CONFIG: Record<
  string,
  { bg: string; border: string; text: string; label: string; icon: typeof CheckCircle2 }
> = {
  healthy: {
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    text: "text-emerald-400",
    label: "HEALTHY",
    icon: CheckCircle2,
  },
  failing: {
    bg: "bg-rose-500/10",
    border: "border-rose-500/30",
    text: "text-rose-400",
    label: "FAILING",
    icon: XCircle,
  },
  degraded: {
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    text: "text-amber-400",
    label: "DEGRADED",
    icon: AlertTriangle,
  },
  stale: {
    bg: "bg-orange-500/10",
    border: "border-orange-500/30",
    text: "text-orange-400",
    label: "STALE",
    icon: Clock,
  },
  in_progress: {
    bg: "bg-cyan-500/10",
    border: "border-cyan-500/30",
    text: "text-cyan-300",
    label: "ĐANG CHẠY",
    icon: Clock,
  },
  unknown: {
    bg: "bg-white/[0.04]",
    border: "border-white/[0.08]",
    text: "text-slate-400",
    label: "CHỜ CHẠY",
    icon: Clock,
  },
}

export function AdminCronTimeline({ jobs }: AdminCronTimelineProps) {
  const [filterMode, setFilterMode] = useState<"all" | "scheduled" | "issues" | "weekdays" | "daily">("all")
  const [viewMode, setViewMode] = useState<"visual" | "table">("visual")
  const [expandedEod, setExpandedEod] = useState(true)

  const timeline = buildCronTimelineModel(jobs)

  const matchesFilter = (node: TimelineJobNode, laneId: TimelineLaneId) => {
    if (filterMode === "scheduled") return laneId === "vercel" || laneId === "pg_cron"
    if (filterMode === "issues") return node.executionStatus === "failing" || node.executionStatus === "degraded" || Boolean(node.conflictWarning)
    if (filterMode === "weekdays") return laneId !== "manual" && laneId !== "disabled" && node.daysLabel === "T2-T6"
    if (filterMode === "daily") return laneId !== "manual" && laneId !== "disabled" && node.daysLabel === "Hàng ngày"
    return true
  }

  const filteredNodes = timeline.allNodes.filter((node) => matchesFilter(node, node.lane))

  return (
    <section
      aria-label="Sơ đồ Lịch chạy Cron & Mindmap ICT"
      className="space-y-4.5 rounded-2xl border border-white/[0.08] bg-[#0c1017] p-5 sm:p-6"
    >
      <div className="flex flex-col gap-3.5 border-b border-white/[0.06] pb-4.5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
              <Clock className="h-4 w-4" />
            </div>
            <h3 className="text-sm font-bold text-white">Sơ đồ Lịch chạy Cron & Chu kỳ ICT (UTC+7)</h3>
            <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-400">
              24H SPINE
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Biểu diễn trục thời gian thực thi, tách biệt scheduler, manual recovery và bằng chứng kết quả.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl border border-white/[0.08] bg-[#080c11] p-1 text-xs">
            <button
              type="button"
              onClick={() => setViewMode("visual")}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                viewMode === "visual" ? "bg-emerald-500/20 text-emerald-300 shadow-sm" : "text-slate-400 hover:text-white"
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              <span>Sơ đồ</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("table")}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                viewMode === "table" ? "bg-emerald-500/20 text-emerald-300 shadow-sm" : "text-slate-400 hover:text-white"
              }`}
            >
              <ListOrdered className="h-3.5 w-3.5" />
              <span>Bảng tuần tự</span>
            </button>
          </div>

          <div className="flex overflow-x-auto gap-1 text-xs">
            {(
              [
                { id: "all", label: "Tất cả" },
                { id: "scheduled", label: "Cron Lịch" },
                { id: "weekdays", label: "T2-T6" },
                { id: "daily", label: "Hàng ngày" },
                { id: "issues", label: `Cảnh báo (${timeline.failingCount + timeline.conflictCount})` },
              ] as const
            ).map((filter) => (
              <button
                key={filter.id}
                type="button"
                onClick={() => setFilterMode(filter.id)}
                className={`rounded-xl px-3 py-1 text-xs font-medium transition-colors ${
                  filterMode === filter.id
                    ? "border border-emerald-500/40 bg-emerald-500/15 font-semibold text-emerald-300"
                    : "border border-transparent text-slate-400 hover:border-white/[0.06] hover:bg-white/[0.03] hover:text-white"
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-[#080c11] p-3.5 text-[11px]">
        <div className="flex items-center justify-between font-mono text-slate-400">
          <span>00:00 ICT</span>
          <span className="font-bold text-emerald-400/90">07:00 (Signals & KFSP)</span>
          <span>09:00 (Mở phiên)</span>
          <span>11:30 (Nghỉ trưa)</span>
          <span>13:00 (Chiều)</span>
          <span className="font-bold text-emerald-400">14:45 (ATC & EOD Sync)</span>
          <span className="font-bold text-sky-400">15:15 (EOD Chain)</span>
          <span>24:00</span>
        </div>
        <div className="relative mt-2.5 h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className="absolute top-0 bottom-0 bg-emerald-500/20"
            style={{ left: "37.5%", width: "23.96%" }}
            title="Khung giờ giao dịch thị trường HOSE (09:00 - 14:45 ICT)"
          />
          <div
            className="absolute top-0 bottom-0 w-1.5 bg-emerald-400"
            style={{ left: "61.46%" }}
            title="14:45 ICT: Market EOD Closing Orderbook Sync (ATC Close)"
          />
          <div
            className="absolute top-0 bottom-0 w-1.5 bg-sky-400"
            style={{ left: "63.5%" }}
            title="15:15 ICT: QeoIndex Unified EOD Pipeline"
          />
        </div>
      </div>

      {viewMode === "visual" ? (
        <div className="space-y-4">
          {timeline.lanes.map((lane) => {
            const laneNodes = lane.jobs.filter((node) => matchesFilter(node, lane.id))
            if (laneNodes.length === 0) return null

            return (
              <div key={lane.id} className="space-y-3.5 rounded-xl border border-white/[0.06] bg-[#080c11]/80 p-4">
                <div className="flex flex-col gap-1 border-b border-white/[0.04] pb-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-400" />
                    <h4 className="text-xs font-bold uppercase tracking-wider text-white">{lane.title}</h4>
                    <span className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-0.2 font-mono text-[10px] text-slate-300">
                      {laneNodes.length} tác vụ
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400">{lane.description}</p>
                </div>

                <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-3">
                  {laneNodes.map((node) => (
                    <TimelineCard
                      key={`${lane.id}:${node.key}`}
                      node={node}
                      expandedEod={expandedEod}
                      onToggleEod={() => setExpandedEod(!expandedEod)}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      ) : null}

      <div className={viewMode === "table" ? "block" : "sr-only"} aria-label="Danh sách tác vụ tuần tự chi tiết">
        <div className="overflow-x-auto rounded-xl border border-white/[0.06] bg-[#080c11]">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-white/[0.06] bg-[#05080c] text-[11px] font-medium text-slate-400">
              <tr>
                <th className="px-3.5 py-3">Thời gian (ICT)</th>
                <th className="px-3.5 py-3">Tác vụ</th>
                <th className="px-3.5 py-3">Luồng / Scheduler</th>
                <th className="px-3.5 py-3">Scheduler State</th>
                <th className="px-3.5 py-3">Execution Evidence</th>
                <th className="px-3.5 py-3">Chi tiết / Cảnh báo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04] text-slate-300">
              {filteredNodes.map((node) => (
                <tr key={node.key} className="transition-colors hover:bg-white/[0.02]">
                  <td className="whitespace-nowrap px-3.5 py-2.5 font-mono text-white">
                    <span className="font-bold">{node.timeIctLabel}</span>
                    <span className="ml-1 text-[10px] text-slate-400">({node.daysLabel})</span>
                  </td>
                  <td className="px-3.5 py-2.5 font-mono font-medium text-white">
                    <Link href={`/admin/jobs/${node.key}`} prefetch={false} className="hover:text-emerald-400 transition-colors">
                      {node.label}
                    </Link>
                    <div className="font-mono text-[10px] font-normal text-slate-400">{node.key}</div>
                  </td>
                  <td className="px-3.5 py-2.5 text-slate-300">
                    <div className="font-mono text-[11px]">{node.provider}</div>
                    {node.schedulerName ? <div className="font-mono text-[10px] text-slate-400">cron: {node.schedulerName}</div> : null}
                  </td>
                  <td className="px-3.5 py-2.5 font-mono text-[11px]">
                    <span
                      className={`inline-block rounded-md px-2 py-0.5 text-[10px] uppercase font-bold ${
                        node.schedulerStatus === "active"
                          ? "bg-emerald-500/15 text-emerald-300"
                          : node.schedulerStatus === "unscheduled"
                            ? "bg-white/[0.05] text-slate-400"
                            : "bg-rose-500/15 text-rose-300"
                      }`}
                    >
                      {node.schedulerStatus}
                    </span>
                  </td>
                  <td className="px-3.5 py-2.5">
                    <span
                      className={`inline-block rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase ${
                        STATUS_BADGE_CONFIG[node.executionStatus]?.bg
                      } ${STATUS_BADGE_CONFIG[node.executionStatus]?.border} ${STATUS_BADGE_CONFIG[node.executionStatus]?.text}`}
                    >
                      {STATUS_BADGE_CONFIG[node.executionStatus]?.label || node.executionStatus}
                    </span>
                  </td>
                  <td className="px-3.5 py-2.5 text-[11px] text-slate-300">
                    <div>{node.healthReason}</div>
                    {node.conflictWarning ? (
                      <div className="mt-0.5 flex items-center gap-1 font-medium text-amber-400 text-[10px]">
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        <span>{node.conflictWarning}</span>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

function TimelineCard({
  node,
  expandedEod,
  onToggleEod,
}: {
  node: TimelineJobNode
  expandedEod: boolean
  onToggleEod: () => void
}) {
  const config = STATUS_BADGE_CONFIG[node.executionStatus] || STATUS_BADGE_CONFIG.unknown
  const StatusIcon = config.icon

  return (
    <div
      className={`flex flex-col justify-between space-y-3 rounded-2xl border bg-[#0c1017] p-4 transition-colors hover:border-white/[0.14] ${
        node.executionStatus === "failing"
          ? "border-rose-500/40"
          : node.conflictWarning
            ? "border-amber-500/40"
            : "border-white/[0.08]"
      }`}
    >
      <div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-300">
              {node.timeIctLabel}
            </span>
            <span className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 font-mono text-[10px] text-slate-400">
              {node.daysLabel}
            </span>
          </div>
          <span className={`flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${config.bg} ${config.border} ${config.text}`}>
            <StatusIcon className="h-3 w-3" />
            <span>{config.label}</span>
          </span>
        </div>

        <div className="mt-2.5">
          <div className="flex items-center justify-between">
            <Link
              href={`/admin/jobs/${node.key}`}
              prefetch={false}
              className="flex items-center gap-1 font-mono text-xs font-bold text-white transition-colors hover:text-emerald-400"
            >
              <span>{node.label}</span>
              <ExternalLink className="h-2.5 w-2.5 text-slate-400" />
            </Link>
          </div>
          <p className="mt-0.5 font-mono text-[10px] text-slate-400">{node.key}</p>
          <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-slate-300">{node.description}</p>
        </div>

        {node.conflictWarning ? (
          <div className="mt-2.5 flex items-start gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
            <div>
              <div className="text-[10px] font-bold uppercase">Xung đột lịch chạy</div>
              <div className="text-[11px] leading-relaxed">{node.conflictWarning}</div>
            </div>
          </div>
        ) : null}

        <div className="mt-2.5 rounded-xl border border-white/[0.06] bg-[#080c11] p-2.5 text-[11px]">
          <div className="mb-1 flex items-center justify-between font-mono text-[10px] text-slate-400">
            <span>Bằng chứng thực thi:</span>
            <span className="text-slate-300">{node.evidenceSource}</span>
          </div>
          <div className="font-medium text-slate-200">{node.healthReason}</div>
        </div>

        {node.phases ? (
          <div className="mt-2.5 rounded-xl border border-sky-500/20 bg-sky-500/5 p-2.5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 text-[11px] font-bold text-sky-300">
                <Zap className="h-3 w-3" />
                <span>{node.phases.length} phân đoạn EOD tuần tự:</span>
              </span>
              <button type="button" onClick={onToggleEod} className="flex items-center gap-0.5 font-mono text-[10px] text-sky-400 hover:underline">
                <span>{expandedEod ? "Thu gọn" : "Chi tiết"}</span>
                {expandedEod ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
            </div>
            {expandedEod ? (
              <div className="mt-2 grid grid-cols-2 gap-1.5 font-mono text-[10px]">
                {node.phases.map((phase) => (
                  <div key={phase.key} className="rounded-lg border border-white/[0.04] bg-white/[0.03] px-2 py-1 text-slate-300">
                    {phase.label}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between border-t border-white/[0.06] pt-2.5 font-mono text-[10px] text-slate-400">
        <div>
          {node.lane === "manual" ? (
            <>
              <span className="font-bold text-emerald-400">
                {node.manualPurpose === "maintenance" ? "Manual maintenance" : "Manual recovery"}
              </span>
              {node.automatedParentKeys?.length ? (
                <span> · Automated by: {node.automatedParentKeys.join(", ")}</span>
              ) : node.schedulerName ? (
                <span> · Automated by: {node.key} ({node.timeIctLabel})</span>
              ) : (
                <span> · one-shot operator action</span>
              )}
            </>
          ) : node.lane === "disabled" ? (
            <>
              <span className="font-bold text-slate-400">Manual disabled</span>
              <span> · policy chặn dispatch</span>
            </>
          ) : (
            <>
              <span>Scheduler: </span>
              <span
                className={`font-bold ${
                  node.schedulerStatus === "active"
                    ? "text-emerald-400"
                    : node.schedulerStatus === "unscheduled"
                      ? "text-slate-400"
                      : "text-rose-400"
                }`}
              >
                {node.schedulerEvidence?.availability === "unavailable"
                  ? "EVIDENCE UNAVAILABLE"
                  : node.schedulerEvidence?.status === "config_only"
                    ? "CONFIGURED IN DEPLOYED REVISION"
                    : node.schedulerEvidence?.status === "live_verified"
                      ? "LIVE VERIFIED"
                      : node.schedulerStatus.toUpperCase()}
              </span>
              {node.schedulerName ? ` (${node.schedulerName})` : ""}
            </>
          )}
        </div>

        <Link href={`/admin/jobs/${node.key}`} prefetch={false} className="text-slate-400 transition-colors hover:text-emerald-400">
          Lịch sử →
        </Link>
      </div>
    </div>
  )
}
