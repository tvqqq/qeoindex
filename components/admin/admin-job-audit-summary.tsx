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
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-400" />
          <h3 className="text-sm font-bold text-white">Bảng Tổng hợp Kiểm toán Tác vụ & Bằng chứng (Audit Summary)</h3>
        </div>
        <span className="text-[11px] font-mono text-slate-400">
          Nguồn sự thật: Execution Evidence
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* 1. Confirmed Healthy */}
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.05] p-3.5 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              <span>ĐÃ XÁC NHẬN CHẠY TỐT</span>
            </div>
            <span className="font-mono text-base font-black text-emerald-300">{healthyJobs.length}</span>
          </div>
          <p className="text-[11px] text-slate-300">
            Có bằng chứng thực thi thành công từ bảng dữ liệu domain và trong ngưỡng độ tươi.
          </p>
          <div className="flex flex-wrap gap-1 pt-1">
            {healthyJobs.map((j) => (
              <Link
                key={j.key}
                href={`/admin/jobs/${j.key}`}
                prefetch={false}
                className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300 hover:underline"
              >
                {j.label}
              </Link>
            ))}
          </div>
        </div>

        {/* 2. Confirmed Failing */}
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/[0.05] p-3.5 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-bold text-rose-400">
              <AlertCircle className="h-4 w-4" />
              <span>LỖI THỰC THI (FAILING)</span>
            </div>
            <span className="font-mono text-base font-black text-rose-300">{failingJobs.length}</span>
          </div>
          <p className="text-[11px] text-slate-300">
            Bằng chứng thực thi từ cơ sở dữ liệu xác nhận tác vụ gặp lỗi hoặc thất bại.
          </p>
          <div className="space-y-1.5 pt-1">
            {failingJobs.length > 0 ? (
              failingJobs.map((j) => (
                <div key={j.key} className="rounded bg-rose-500/10 p-2 text-[11px] text-rose-200">
                  <div className="font-bold flex items-center justify-between">
                    <Link href={`/admin/jobs/${j.key}`} prefetch={false} className="hover:underline text-white">
                      {j.label}
                    </Link>
                    {j.lastErrorCode ? (
                      <span className="rounded bg-rose-500/20 px-1 py-0.2 text-[9px] font-mono text-rose-300">
                        {j.lastErrorCode}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-[10px] text-slate-300 mt-1">{j.healthReason || j.lastErrorMessage || "Thực thi thất bại"}</div>
                </div>
              ))
            ) : (
              <span className="text-[11px] text-slate-400">Không có tác vụ nào lỗi</span>
            )}
          </div>
        </div>

        {/* 3. Pending / Unverified Telemetry */}
        <div className="rounded-xl border border-white/[0.1] bg-white/[0.03] p-3.5 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-300">
              <Clock className="h-4 w-4 text-sky-400" />
              <span>CHỜ CHẠY / TELEMETRY</span>
            </div>
            <span className="font-mono text-base font-black text-white">{unknownJobs.length}</span>
          </div>
          <p className="text-[11px] text-slate-400">
            Tác vụ chưa đến lượt chạy lịch trình đầu tiên hoặc đang chờ telemetry workflow.
          </p>
          <div className="space-y-1.5 pt-1">
            {unknownJobs.length > 0 ? (
              unknownJobs.map((j) => (
                <div key={j.key} className="rounded bg-white/[0.04] p-2 text-[11px]">
                  <div className="font-bold text-slate-200">
                    <Link href={`/admin/jobs/${j.key}`} prefetch={false} className="hover:underline">
                      {j.label}
                    </Link>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{j.healthReason}</div>
                </div>
              ))
            ) : (
              <span className="text-[11px] text-slate-400">Tất cả tác vụ đều đã có telemetry</span>
            )}
          </div>
        </div>

        {/* 4. Schedule Warnings / Overlaps */}
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.05] p-3.5 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-bold text-amber-400">
              <AlertTriangle className="h-4 w-4" />
              <span>TRÙNG LỊCH CHẠY (OVERLAP)</span>
            </div>
            <span className="font-mono text-base font-black text-amber-300">{conflictJobs.length}</span>
          </div>
          <p className="text-[11px] text-slate-300">
            Phát hiện tác vụ có lịch chạy trùng lặp hoặc xung đột thời gian.
          </p>
          <div className="space-y-1.5 pt-1">
            {conflictJobs.length > 0 ? (
              conflictJobs.map((j) => (
                <div key={j.key} className="rounded bg-amber-500/10 p-2 text-[11px] text-amber-200">
                  <div className="font-bold text-[10px] uppercase">{j.label}</div>
                  <div className="text-[10px] text-slate-300 mt-0.5">{j.conflictWarning}</div>
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
