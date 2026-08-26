"use client"

import { useState } from "react"
import Link from "next/link"
import {
  AlertTriangle,
  CheckCircle2,
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
  unknown: {
    bg: "bg-white/[0.04]",
    border: "border-white/[0.1]",
    text: "text-slate-400",
    label: "CHỜ CHẠY / UNKNOWN",
    icon: Clock,
  },
}

export function AdminCronTimeline({ jobs }: AdminCronTimelineProps) {
  const [filterMode, setFilterMode] = useState<"all" | "scheduled" | "issues" | "weekdays" | "daily">("all")
  const [viewMode, setViewMode] = useState<"visual" | "table">("visual")
  const [expandedEod, setExpandedEod] = useState(true)

  const timeline = buildCronTimelineModel(jobs)

  const filteredNodes = timeline.allNodes.filter((node) => {
    if (filterMode === "scheduled") return node.lane !== "manual"
    if (filterMode === "issues") return node.executionStatus === "failing" || node.executionStatus === "degraded" || Boolean(node.conflictWarning)
    if (filterMode === "weekdays") return node.daysLabel === "T2-T6"
    if (filterMode === "daily") return node.daysLabel === "Hàng ngày"
    return true
  })

  return (
    <section
      aria-label="Sơ đồ Lịch chạy Cron & Mindmap ICT"
      className="space-y-4 rounded-xl border border-white/[0.08] bg-[#0c1016] p-4 sm:p-5"
    >
      {/* Header & Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-white/[0.06] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-emerald-400" />
            <h3 className="text-sm font-bold text-white">Sơ đồ Lịch chạy Cron & Chu kỳ ICT (UTC+7)</h3>
            <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-400">
              24H SPINE
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Biểu diễn trục thời gian thực thi, tách biệt trạng thái lập lịch (Scheduler) và bằng chứng kết quả (Execution Evidence).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* View mode toggle */}
          <div className="flex rounded-lg border border-white/[0.08] bg-[#080c10] p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setViewMode("visual")}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 transition-colors ${
                viewMode === "visual"
                  ? "bg-emerald-500/20 text-emerald-300 font-medium"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Layers className="h-3 w-3" />
              <span>Sơ đồ</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("table")}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 transition-colors ${
                viewMode === "table"
                  ? "bg-emerald-500/20 text-emerald-300 font-medium"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <ListOrdered className="h-3 w-3" />
              <span>Bảng tuần tự</span>
            </button>
          </div>

          {/* Filter pills */}
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
                className={`rounded-lg px-2.5 py-1 font-medium transition-colors ${
                  filterMode === filter.id
                    ? "border border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                    : "text-slate-400 hover:bg-white/[0.04] hover:text-white"
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 24-Hour ICT Time Spine Axis */}
      <div className="rounded-lg border border-white/[0.06] bg-[#080c10] p-3 text-[11px]">
        <div className="flex items-center justify-between text-slate-400 font-mono">
          <span>00:00 ICT</span>
          <span className="text-emerald-400/80 font-bold">07:00 (Signals & KFSP)</span>
          <span>09:00 (Mở phiên)</span>
          <span>11:30 (Nghỉ trưa)</span>
          <span>13:00 (Chiều)</span>
          <span className="text-amber-400/90 font-bold">14:50 (EOD Sync)</span>
          <span className="text-sky-400/90 font-bold">15:15 (EOD Chain)</span>
          <span>24:00</span>
        </div>
        <div className="relative mt-2 h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden">
          {/* Market hours band: 09:00 to 15:00 = 37.5% to 62.5% */}
          <div
            className="absolute top-0 bottom-0 bg-emerald-500/20"
            style={{ left: "37.5%", width: "25%" }}
            title="Khung giờ giao dịch thị trường HOSE (09:00 - 15:00 ICT)"
          />
          {/* Overlap point at 14:50: ~61.8% */}
          <div
            className="absolute top-0 bottom-0 w-1 bg-amber-400"
            style={{ left: "61.8%" }}
            title="14:50 ICT: Trùng lặp sync-universe-5m và sync-universe-eod-1450"
          />
          {/* EOD Pipeline point at 15:15: ~63.5% */}
          <div
            className="absolute top-0 bottom-0 w-1 bg-sky-400"
            style={{ left: "63.5%" }}
            title="15:15 ICT: QeoIndex Unified EOD Pipeline"
          />
        </div>
      </div>

      {/* Visual Lane & Node Display */}
      {viewMode === "visual" ? (
        <div className="space-y-4">
          {timeline.lanes.map((lane) => {
            const laneNodes = lane.jobs.filter((j) => filteredNodes.some((f) => f.key === j.key))
            if (laneNodes.length === 0) return null

            return (
              <div
                key={lane.id}
                className="rounded-lg border border-white/[0.06] bg-[#080c10]/60 p-3.5 space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 border-b border-white/[0.04] pb-2">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-400" />
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider">{lane.title}</h4>
                    <span className="rounded bg-white/[0.04] px-1.5 py-0.2 text-[10px] font-mono text-slate-400">
                      {laneNodes.length} tác vụ
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400">{lane.description}</p>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {laneNodes.map((node) => (
                    <TimelineCard
                      key={node.key}
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

      {/* Accessible Ordered List & Table Fallback */}
      <div
        className={viewMode === "table" ? "block" : "sr-only"}
        aria-label="Danh sách tác vụ tuần tự chi tiết"
      >
        <div className="overflow-x-auto rounded-lg border border-white/[0.06] bg-[#080c10]">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-white/[0.06] bg-[#05080c] text-[11px] font-medium text-slate-400">
              <tr>
                <th className="px-3 py-2.5">Thời gian (ICT)</th>
                <th className="px-3 py-2.5">Tác vụ</th>
                <th className="px-3 py-2.5">Luồng / Scheduler</th>
                <th className="px-3 py-2.5">Scheduler State</th>
                <th className="px-3 py-2.5">Execution Evidence</th>
                <th className="px-3 py-2.5">Chi tiết / Cảnh báo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04] text-slate-300">
              {filteredNodes.map((node) => (
                <tr key={node.key} className="hover:bg-white/[0.02]">
                  <td className="px-3 py-2 font-mono text-white whitespace-nowrap">
                    <span className="font-bold">{node.timeIctLabel}</span>
                    <span className="ml-1 text-[10px] text-slate-400">({node.daysLabel})</span>
                  </td>
                  <td className="px-3 py-2 font-mono font-medium text-white">
                    <Link
                      href={`/admin/jobs/${node.key}`}
                      prefetch={false}
                      className="hover:text-emerald-400"
                    >
                      {node.label}
                    </Link>
                    <div className="text-[10px] text-slate-400 font-normal">{node.key}</div>
                  </td>
                  <td className="px-3 py-2 text-slate-300">
                    <div className="font-mono text-[11px]">{node.provider}</div>
                    {node.schedulerName ? (
                      <div className="text-[10px] text-slate-400 font-mono">cron: {node.schedulerName}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px]">
                    <span
                      className={`inline-block rounded px-1.5 py-0.5 text-[10px] uppercase ${
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
                  <td className="px-3 py-2">
                    <span
                      className={`inline-block rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${
                        STATUS_BADGE_CONFIG[node.executionStatus]?.bg
                      } ${STATUS_BADGE_CONFIG[node.executionStatus]?.border} ${
                        STATUS_BADGE_CONFIG[node.executionStatus]?.text
                      }`}
                    >
                      {STATUS_BADGE_CONFIG[node.executionStatus]?.label || node.executionStatus}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[11px] text-slate-300">
                    <div>{node.healthReason}</div>
                    {node.conflictWarning ? (
                      <div className="mt-0.5 flex items-center gap-1 text-[10px] text-amber-400 font-medium">
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
      className={`rounded-lg border bg-[#0c1016] p-3.5 flex flex-col justify-between space-y-2.5 transition-colors ${
        node.executionStatus === "failing"
          ? "border-rose-500/40"
          : node.conflictWarning
            ? "border-amber-500/40"
            : "border-white/[0.08]"
      }`}
    >
      <div>
        {/* Top bar: Time, Frequency & Status Badge */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-300">
              {node.timeIctLabel}
            </span>
            <span className="rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
              {node.daysLabel}
            </span>
          </div>

          <span
            className={`flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${config.bg} ${config.border} ${config.text}`}
          >
            <StatusIcon className="h-3 w-3" />
            <span>{config.label}</span>
          </span>
        </div>

        {/* Job Identity */}
        <div className="mt-2">
          <div className="flex items-center justify-between">
            <Link
              href={`/admin/jobs/${node.key}`}
              prefetch={false}
              className="font-mono text-xs font-bold text-white hover:text-emerald-400 transition-colors flex items-center gap-1"
            >
              <span>{node.label}</span>
              <ExternalLink className="h-2.5 w-2.5 text-slate-400" />
            </Link>
          </div>
          <p className="mt-0.5 font-mono text-[10px] text-slate-400">{node.key}</p>
          <p className="mt-1 text-[11px] text-slate-300 line-clamp-2">{node.description}</p>
        </div>

        {/* Conflict warning banner */}
        {node.conflictWarning ? (
          <div className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-400" />
            <div>
              <div className="font-bold text-[10px] uppercase">Xung đột lịch chạy</div>
              <div>{node.conflictWarning}</div>
            </div>
          </div>
        ) : null}

        {/* Execution evidence summary */}
        <div className="mt-2.5 rounded-md border border-white/[0.04] bg-[#080c10] p-2 text-[11px]">
          <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono mb-1">
            <span>Bằng chứng thực thi:</span>
            <span className="text-slate-300">{node.evidenceSource}</span>
          </div>
          <div className="text-slate-200 font-medium">{node.healthReason}</div>
        </div>

        {/* Special: QeoIndex EOD Pipeline 10 Dependency Phases */}
        {node.phases ? (
          <div className="mt-2.5 rounded-md border border-sky-500/20 bg-sky-500/5 p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-sky-300 flex items-center gap-1">
                <Zap className="h-3 w-3" />
                <span>10 Phân đoạn EOD tuần tự:</span>
              </span>
              <button
                type="button"
                onClick={onToggleEod}
                className="text-[10px] font-mono text-sky-400 hover:underline"
              >
                {expandedEod ? "Thu gọn" : "Chi tiết"}
              </button>
            </div>

            {expandedEod ? (
              <div className="mt-2 grid grid-cols-2 gap-1 text-[10px] font-mono">
                {node.phases.map((phase) => (
                  <div
                    key={phase.key}
                    className="rounded bg-white/[0.03] px-1.5 py-0.5 text-slate-300 border border-white/[0.04]"
                  >
                    {phase.label}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Footer: Scheduler vs Execution Separation */}
      <div className="border-t border-white/[0.04] pt-2 flex items-center justify-between text-[10px] text-slate-400 font-mono">
        <div>
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
            {node.schedulerStatus.toUpperCase()}
          </span>
          {node.schedulerName ? ` (${node.schedulerName})` : ""}
        </div>

        <Link
          href={`/admin/jobs/${node.key}`}
          prefetch={false}
          className="text-slate-400 hover:text-white transition-colors"
        >
          Lịch sử →
        </Link>
      </div>
    </div>
  )
}
