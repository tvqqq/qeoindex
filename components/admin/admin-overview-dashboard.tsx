import Link from "next/link"
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  GitBranch,
  KeyRound,
  Server,
  Settings,
  ShieldAlert,
  XCircle,
} from "lucide-react"

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
  const secretCount = environment.filter((e) => e.sensitivity === "secret").length

  return (
    <div className="space-y-6">
      {/* System Infrastructure Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/[0.08] bg-[#0c1017] p-4 text-xs text-slate-300">
        <div className="flex flex-wrap items-center gap-3 sm:gap-5">
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 items-center justify-center">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping opacity-75" />
              <span className="absolute h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </span>
            <span className="font-semibold text-white">System Runtime:</span>
            <span className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] font-bold uppercase text-emerald-300">
              {build.nodeEnv}
            </span>
          </div>

          {build.vercelEnv ? (
            <div className="flex items-center gap-2">
              <span className="text-slate-400">Vercel:</span>
              <span className="rounded-lg border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 font-mono text-[11px] font-medium text-purple-300">
                {build.vercelEnv}
              </span>
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            <GitBranch className="h-3.5 w-3.5 text-slate-400" />
            <span className="text-slate-400">Commit:</span>
            <span className="rounded bg-white/[0.04] px-1.5 py-0.5 font-mono text-[11px] text-slate-200">
              {build.commitSha.slice(0, 7)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          <Clock className="h-3.5 w-3.5 text-emerald-400" />
          <span>Làm mới lúc (ICT):</span>
          <span className="font-mono font-medium text-slate-200">{formatAdminTime(overview.refreshedAt)}</span>
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
          subValue={`${settings.length} tham số trong danh mục`}
          icon={<Settings className="h-4 w-4" />}
          tone={overrideCount > 0 ? "cyan" : "default"}
        />
        <AdminStatCard
          label="Biến môi trường"
          value={`${envConfiguredCount}/${environment.length}`}
          subValue={`${secretCount} khóa bí mật được bảo vệ`}
          icon={<KeyRound className="h-4 w-4" />}
          tone="purple"
        />
        <AdminStatCard
          label="Nhật ký Audit"
          value={`${audit.length} sự kiện`}
          subValue="Ghi nhận mọi thay đổi tham số & run"
          icon={<FileText className="h-4 w-4" />}
          tone="default"
        />
      </div>

      {/* Sources Health and Quick Actions Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Source Health Check */}
        <div className="rounded-2xl border border-white/[0.08] bg-[#0c1017] p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between border-b border-white/[0.06] pb-3.5">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                <Server className="h-3.5 w-3.5" />
              </div>
              <h2 className="text-sm font-bold text-white">
                Hạ tầng & Nguồn Dữ liệu Kết nối
              </h2>
            </div>
            <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-0.5 text-[10px] font-medium text-slate-400">
              {sources.length} Dịch vụ tích hợp
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {sources.map((source) => {
              const isHealthy = source.status === "healthy"
              return (
                <div
                  key={source.name}
                  className="flex items-start gap-3 rounded-xl border border-white/[0.06] bg-[#080c11] p-3.5 transition-colors hover:border-white/[0.1]"
                >
                  <div className="mt-0.5">
                    {isHealthy ? (
                      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </div>
                    ) : (
                      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/10 text-amber-400">
                        <XCircle className="h-3.5 w-3.5" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-semibold text-slate-100">{source.name}</span>
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                          isHealthy
                            ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                            : "border border-amber-500/30 bg-amber-500/10 text-amber-400"
                        }`}
                      >
                        {source.status}
                      </span>
                    </div>
                    {source.message ? (
                      <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{source.message}</p>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Quick Operations Links */}
        <div className="rounded-2xl border border-white/[0.08] bg-[#0c1017] p-5">
          <div className="mb-4 border-b border-white/[0.06] pb-3.5">
            <h2 className="text-sm font-bold text-white">
              Điều hướng Chức năng
            </h2>
            <p className="mt-0.5 text-[11px] text-slate-400">Truy cập nhanh các phân hệ quản trị</p>
          </div>

          <div className="space-y-2.5">
            <Link
              href="/admin/settings"
              prefetch={false}
              className="group flex items-center justify-between rounded-xl border border-white/[0.06] bg-[#080c11] p-3 text-xs text-slate-200 transition-colors hover:border-emerald-500/30 hover:bg-emerald-500/5 hover:text-emerald-300"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-slate-400 transition-colors group-hover:border-emerald-500/30 group-hover:bg-emerald-500/10 group-hover:text-emerald-400">
                  <Settings className="h-3.5 w-3.5" />
                </div>
                <div>
                  <div className="font-semibold">Cài đặt Runtime</div>
                  <div className="text-[10px] text-slate-400">Tham số LLM, batch size, threshold</div>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-slate-500 transition-transform group-hover:translate-x-0.5 group-hover:text-emerald-400" />
            </Link>

            <Link
              href="/admin/jobs"
              prefetch={false}
              className="group flex items-center justify-between rounded-xl border border-white/[0.06] bg-[#080c11] p-3 text-xs text-slate-200 transition-colors hover:border-emerald-500/30 hover:bg-emerald-500/5 hover:text-emerald-300"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-slate-400 transition-colors group-hover:border-emerald-500/30 group-hover:bg-emerald-500/10 group-hover:text-emerald-400">
                  <Activity className="h-3.5 w-3.5" />
                </div>
                <div>
                  <div className="font-semibold">Tác vụ & Cron Timeline</div>
                  <div className="text-[10px] text-slate-400">Lịch 24H ICT, EOD pipeline, chạy thủ công</div>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-slate-500 transition-transform group-hover:translate-x-0.5 group-hover:text-emerald-400" />
            </Link>

            <Link
              href="/admin/environment"
              prefetch={false}
              className="group flex items-center justify-between rounded-xl border border-white/[0.06] bg-[#080c11] p-3 text-xs text-slate-200 transition-colors hover:border-emerald-500/30 hover:bg-emerald-500/5 hover:text-emerald-300"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-slate-400 transition-colors group-hover:border-emerald-500/30 group-hover:bg-emerald-500/10 group-hover:text-emerald-400">
                  <ShieldAlert className="h-3.5 w-3.5" />
                </div>
                <div>
                  <div className="font-semibold">Biến Môi trường & Bí mật</div>
                  <div className="text-[10px] text-slate-400">Kiểm tra cấu hình API keys & Secrets</div>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-slate-500 transition-transform group-hover:translate-x-0.5 group-hover:text-emerald-400" />
            </Link>

            <Link
              href="/admin/audit"
              prefetch={false}
              className="group flex items-center justify-between rounded-xl border border-white/[0.06] bg-[#080c11] p-3 text-xs text-slate-200 transition-colors hover:border-emerald-500/30 hover:bg-emerald-500/5 hover:text-emerald-300"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-slate-400 transition-colors group-hover:border-emerald-500/30 group-hover:bg-emerald-500/10 group-hover:text-emerald-400">
                  <FileText className="h-3.5 w-3.5" />
                </div>
                <div>
                  <div className="font-semibold">Nhật ký Audit</div>
                  <div className="text-[10px] text-slate-400">Lịch sử thay đổi và kiểm toán vận hành</div>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-slate-500 transition-transform group-hover:translate-x-0.5 group-hover:text-emerald-400" />
            </Link>
          </div>
        </div>
      </div>

      {/* Recent Audit Log Trail */}
      <div className="rounded-2xl border border-white/[0.08] bg-[#0c1017] p-5">
        <div className="mb-4 flex items-center justify-between border-b border-white/[0.06] pb-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
              <FileText className="h-3.5 w-3.5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">
                Nhật ký Hoạt động Gần đây
              </h2>
              <p className="text-[11px] text-slate-400">Audit trail các thay đổi tham số và thực thi thủ công</p>
            </div>
          </div>
          <Link
            href="/admin/audit"
            prefetch={false}
            className="flex items-center gap-1 text-xs font-semibold text-emerald-400 transition-colors hover:text-emerald-300"
          >
            <span>Xem tất cả</span>
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {audit.length === 0 ? (
          <p className="py-8 text-center text-xs text-slate-400">Chưa có hoạt động audit nào được ghi nhận.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-white/[0.06] text-[11px] font-medium text-slate-400">
                  <th className="pb-3 pl-2 font-medium">Hành động</th>
                  <th className="pb-3 font-medium">Đối tượng</th>
                  <th className="pb-3 font-medium">Lý do thay đổi</th>
                  <th className="pb-3 font-medium">Thời gian (ICT)</th>
                  <th className="pb-3 pr-2 text-right font-medium">Kết quả</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {audit.slice(0, 8).map((log) => (
                  <tr key={log.id} className="text-slate-300 transition-colors hover:bg-white/[0.02]">
                    <td className="py-3 pl-2">
                      <span className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-400">
                        {log.action}
                      </span>
                    </td>
                    <td className="py-3 font-mono font-medium text-white">{log.targetKey}</td>
                    <td className="max-w-[280px] truncate py-3 text-slate-400" title={log.reason}>
                      {log.reason}
                    </td>
                    <td className="py-3 font-mono text-[11px] text-slate-400">
                      {formatAdminDateTime(log.createdAt)}
                    </td>
                    <td className="py-3 pr-2 text-right">
                      <span
                        className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                          log.success
                            ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                            : "border border-rose-500/30 bg-rose-500/10 text-rose-400"
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
