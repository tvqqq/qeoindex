import Link from "next/link"
import { Activity, CheckCircle, FileText, KeyRound, Server, Settings, ShieldAlert, XCircle } from "lucide-react"

import { formatAdminDateTime, formatAdminTime } from "@/lib/admin/time"
import type { AdminSystemOverview } from "@/lib/admin/types"
import { AdminStatCard } from "./admin-stat-card"

export interface AdminOverviewDashboardProps {
  overview: AdminSystemOverview
}

export function AdminOverviewDashboard({ overview }: AdminOverviewDashboardProps) {
  const { jobCounts, sources, settings, environment, audit, build } = overview

  const overrideCount = settings.filter((s) => s.hasOverride).length
  const envConfiguredCount = environment.filter((e) => e.isConfigured).length

  return (
    <div className="space-y-6">
      {/* Build and runtime banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-[#0c1016] px-4 py-3 text-xs text-slate-300">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">Environment:</span>
            <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 font-mono font-medium text-emerald-400">
              {build.nodeEnv}
            </span>
          </div>
          {build.vercelEnv ? (
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">Vercel:</span>
              <span className="rounded border border-purple-500/30 bg-purple-500/10 px-1.5 py-0.5 font-mono text-purple-300">
                {build.vercelEnv}
              </span>
            </div>
          ) : null}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">Commit:</span>
            <span className="font-mono text-slate-200">{build.commitSha.slice(0, 7)}</span>
          </div>
        </div>
        <div className="text-[11px] text-slate-400">
          Làm mới lúc (ICT): <span className="font-mono text-slate-300">{formatAdminTime(overview.refreshedAt)}</span>
        </div>
      </div>

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <AdminStatCard
          label="Tình trạng Tác vụ"
          value={`${jobCounts.healthy}/${jobCounts.total}`}
          subValue={`${jobCounts.healthy} tốt • ${jobCounts.failing} lỗi • ${jobCounts.stale} trễ`}
          icon={<Activity className="h-4 w-4" />}
          tone={jobCounts.failing > 0 ? "rose" : jobCounts.stale > 0 ? "amber" : "emerald"}
        />
        <AdminStatCard
          label="Cài đặt Runtime"
          value={`${overrideCount} ghi đè`}
          subValue={`${settings.length} cài đặt trong danh mục`}
          icon={<Settings className="h-4 w-4" />}
          tone={overrideCount > 0 ? "cyan" : "default"}
        />
        <AdminStatCard
          label="Biến môi trường"
          value={`${envConfiguredCount}/${environment.length}`}
          subValue={`${environment.filter((e) => e.sensitivity === "secret").length} secrets`}
          icon={<KeyRound className="h-4 w-4" />}
          tone="purple"
        />
        <AdminStatCard
          label="Nhật ký Audit"
          value={`${audit.length} gần đây`}
          subValue="Ghi nhận mọi thay đổi và thực thi"
          icon={<FileText className="h-4 w-4" />}
          tone="default"
        />
      </div>

      {/* Sources Health and Quick Actions Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Source Health Check */}
        <div className="rounded-xl border border-white/[0.08] bg-[#0c1016] p-4 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between border-b border-white/[0.06] pb-3">
            <h2 className="flex items-center gap-2 text-sm font-bold text-white">
              <Server className="h-4 w-4 text-emerald-400" />
              Tình trạng Nguồn dữ liệu & Hạ tầng
            </h2>
            <span className="text-xs text-slate-400">{sources.length} dịch vụ kết nối</span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {sources.map((source) => {
              const isHealthy = source.status === "healthy"
              return (
                <div
                  key={source.name}
                  className="flex items-start gap-3 rounded-lg border border-white/[0.06] bg-[#080c10] p-3"
                >
                  <div className="mt-0.5">
                    {isHealthy ? (
                      <CheckCircle className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <XCircle className="h-4 w-4 text-amber-400" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-white">{source.name}</span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                          isHealthy
                            ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                            : "border border-amber-500/30 bg-amber-500/10 text-amber-400"
                        }`}
                      >
                        {source.status}
                      </span>
                    </div>
                    {source.message ? (
                      <p className="mt-1 text-[11px] text-slate-400">{source.message}</p>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Quick Links */}
        <div className="rounded-xl border border-white/[0.08] bg-[#0c1016] p-4">
          <h2 className="mb-4 border-b border-white/[0.06] pb-3 text-sm font-bold text-white">
            Điều hướng nhanh
          </h2>
          <div className="space-y-2">
            <Link
              href="/admin/settings"
              prefetch={false}
              className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-[#080c10] p-3 text-xs text-slate-200 transition-colors hover:border-emerald-500/30 hover:bg-emerald-500/5 hover:text-emerald-300"
            >
              <div className="flex items-center gap-2.5">
                <Settings className="h-4 w-4 text-slate-400" />
                <span className="font-medium">Quản lý Cài đặt Runtime</span>
              </div>
              <span className="text-slate-400">→</span>
            </Link>

            <Link
              href="/admin/jobs"
              prefetch={false}
              className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-[#080c10] p-3 text-xs text-slate-200 transition-colors hover:border-emerald-500/30 hover:bg-emerald-500/5 hover:text-emerald-300"
            >
              <div className="flex items-center gap-2.5">
                <Activity className="h-4 w-4 text-slate-400" />
                <span className="font-medium">Quản lý Tác vụ & Lịch Cron</span>
              </div>
              <span className="text-slate-400">→</span>
            </Link>

            <Link
              href="/admin/environment"
              prefetch={false}
              className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-[#080c10] p-3 text-xs text-slate-200 transition-colors hover:border-emerald-500/30 hover:bg-emerald-500/5 hover:text-emerald-300"
            >
              <div className="flex items-center gap-2.5">
                <ShieldAlert className="h-4 w-4 text-slate-400" />
                <span className="font-medium">Kiểm tra Biến môi trường</span>
              </div>
              <span className="text-slate-400">→</span>
            </Link>

            <Link
              href="/admin/audit"
              prefetch={false}
              className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-[#080c10] p-3 text-xs text-slate-200 transition-colors hover:border-emerald-500/30 hover:bg-emerald-500/5 hover:text-emerald-300"
            >
              <div className="flex items-center gap-2.5">
                <FileText className="h-4 w-4 text-slate-400" />
                <span className="font-medium">Xem Toàn bộ Audit Log</span>
              </div>
              <span className="text-slate-400">→</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Recent Audit Log Trail */}
      <div className="rounded-xl border border-white/[0.08] bg-[#0c1016] p-4">
        <div className="mb-4 flex items-center justify-between border-b border-white/[0.06] pb-3">
          <h2 className="flex items-center gap-2 text-sm font-bold text-white">
            <FileText className="h-4 w-4 text-emerald-400" />
            Nhật ký Hoạt động Gần đây
          </h2>
          <Link
            href="/admin/audit"
            prefetch={false}
            className="text-xs text-emerald-400 transition-colors hover:text-emerald-300"
          >
            Xem tất cả →
          </Link>
        </div>

        {audit.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-400">Chưa có hoạt động audit nào được ghi nhận.</p>
        ) : (
          <div className="divide-y divide-white/[0.04] overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-[11px] font-medium text-slate-400">
                  <th className="pb-2 font-medium">Hành động</th>
                  <th className="pb-2 font-medium">Đối tượng</th>
                  <th className="pb-2 font-medium">Lý do</th>
                  <th className="pb-2 font-medium">Thời gian (ICT)</th>
                  <th className="pb-2 text-right font-medium">Kết quả</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {audit.slice(0, 8).map((log) => (
                  <tr key={log.id} className="text-slate-300">
                    <td className="py-2.5">
                      <span className="font-mono text-emerald-400">{log.action}</span>
                    </td>
                    <td className="py-2.5 font-medium text-white">{log.targetKey}</td>
                    <td className="max-w-[280px] truncate py-2.5 text-slate-400" title={log.reason}>
                      {log.reason}
                    </td>
                    <td className="py-2.5 font-mono text-[11px] text-slate-400">
                      {formatAdminDateTime(log.createdAt)}
                    </td>
                    <td className="py-2.5 text-right">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                          log.success
                            ? "bg-emerald-500/10 text-emerald-400"
                            : "bg-rose-500/10 text-rose-400"
                        }`}
                      >
                        {log.success ? "THÀNH CÔNG" : "THẤT BẠI"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
