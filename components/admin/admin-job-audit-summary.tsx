import Link from "next/link"
import { AlertCircle, AlertTriangle, CheckCircle2, Clock, ShieldCheck } from "lucide-react"

import type { AdminJobView } from "@/lib/admin/types"

export interface AdminJobAuditSummaryProps {
  jobs: AdminJobView[]
}

export function AdminJobAuditSummary({ jobs }: AdminJobAuditSummaryProps) {
  const healthyJobs = jobs.filter((j) => j.status === "healthy")
  const failingJobs = jobs.filter((j) => j.status === "failing")
  const unknownJobs = jobs.filter((j) => j.status === "unknown")
  const conflictJobs = jobs.filter((j) => Boolean(j.conflictWarning))

  return (
    <div className="space-y-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">Kiểm toán Trạng thái Tác vụ & Bằng chứng Thực thi</h3>
            <p className="text-[11px] text-slate-400">Nguồn sự thật: Telemetry & Execution Evidence</p>
          </div>
        </div>
        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-400">
          AUDIT READY
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {/* 1. Confirmed Healthy */}
        <div className="flex flex-col justify-between rounded-2xl border border-emerald-500/25 bg-[#0c1017] p-4 transition-colors hover:border-emerald-500/40">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400">
                <CheckCircle2 className="h-4 w-4" />
                <span>CHẠY TỐT (HEALTHY)</span>
              </div>
              <span className="font-mono text-xl font-bold text-emerald-400">{healthyJobs.length}</span>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-300">
              Có bằng chứng thực thi thành công từ bảng dữ liệu domain và trong ngưỡng độ tươi.
            </p>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-white/[0.06] pt-3">
            {healthyJobs.map((j) => (
              <Link
                key={j.key}
                href={`/admin/jobs/${j.key}`}
                prefetch={false}
                className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-300 transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/20"
              >
                {j.label}
              </Link>
            ))}
          </div>
        </div>

        {/* 2. Confirmed Failing */}
        <div className="flex flex-col justify-between rounded-2xl border border-rose-500/25 bg-[#0c1017] p-4 transition-colors hover:border-rose-500/40">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-bold text-rose-400">
                <AlertCircle className="h-4 w-4" />
                <span>LỖI THỰC THI (FAILING)</span>
              </div>
              <span className="font-mono text-xl font-bold text-rose-400">{failingJobs.length}</span>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-300">
              Bằng chứng thực thi từ cơ sở dữ liệu xác nhận tác vụ gặp lỗi hoặc thất bại.
            </p>
          </div>

          <div className="mt-3 space-y-1.5 border-t border-white/[0.06] pt-3">
            {failingJobs.length > 0 ? (
              failingJobs.map((j) => (
                <div key={j.key} className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-2.5 text-[11px] text-rose-200">
                  <div className="flex items-center justify-between font-bold">
                    <Link href={`/admin/jobs/${j.key}`} prefetch={false} className="text-white hover:text-rose-300">
                      {j.label}
                    </Link>
                    {j.lastErrorCode ? (
                      <span className="rounded bg-rose-500/20 px-1.5 py-0.2 font-mono text-[9px] text-rose-300">
                        {j.lastErrorCode}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 text-[10px] text-slate-300">{j.healthReason || j.lastErrorMessage || "Thực thi thất bại"}</div>
                </div>
              ))
            ) : (
              <span className="text-[11px] text-slate-400">Không có tác vụ nào lỗi</span>
            )}
          </div>
        </div>

        {/* 3. Pending / Unverified Telemetry */}
        <div className="flex flex-col justify-between rounded-2xl border border-white/[0.08] bg-[#0c1017] p-4 transition-colors hover:border-white/[0.14]">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-300">
                <Clock className="h-4 w-4 text-cyan-400" />
                <span>CHỜ CHẠY / TELEMETRY</span>
              </div>
              <span className="font-mono text-xl font-bold text-white">{unknownJobs.length}</span>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
              Tác vụ chưa đến lượt chạy lịch trình đầu tiên hoặc đang chờ telemetry workflow.
            </p>
          </div>

          <div className="mt-3 space-y-1.5 border-t border-white/[0.06] pt-3">
            {unknownJobs.length > 0 ? (
              unknownJobs.map((j) => (
                <div key={j.key} className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-2.5 text-[11px]">
                  <div className="font-bold text-slate-200">
                    <Link href={`/admin/jobs/${j.key}`} prefetch={false} className="hover:text-emerald-400">
                      {j.label}
                    </Link>
                  </div>
                  <div className="mt-0.5 text-[10px] text-slate-400">{j.healthReason}</div>
                </div>
              ))
            ) : (
              <span className="text-[11px] text-slate-400">Tất cả tác vụ đều đã ghi nhận telemetry</span>
            )}
          </div>
        </div>

        {/* 4. Schedule Warnings / Overlaps */}
        <div className="flex flex-col justify-between rounded-2xl border border-amber-500/25 bg-[#0c1017] p-4 transition-colors hover:border-amber-500/40">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-bold text-amber-400">
                <AlertTriangle className="h-4 w-4" />
                <span>TRÙNG LỊCH (OVERLAP)</span>
              </div>
              <span className="font-mono text-xl font-bold text-amber-400">{conflictJobs.length}</span>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-300">
              Phát hiện tác vụ có lịch chạy trùng lặp hoặc xung đột thời gian.
            </p>
          </div>

          <div className="mt-3 space-y-1.5 border-t border-white/[0.06] pt-3">
            {conflictJobs.length > 0 ? (
              conflictJobs.map((j) => (
                <div key={j.key} className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-2.5 text-[11px] text-amber-200">
                  <div className="font-bold text-[10px] uppercase text-amber-300">{j.label}</div>
                  <div className="mt-0.5 text-[10px] text-slate-300">{j.conflictWarning}</div>
                </div>
              ))
            ) : (
              <span className="text-[11px] text-slate-400">Không có xung đột lịch chạy nào</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
