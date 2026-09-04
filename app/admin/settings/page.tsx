import { AdminSettingsTable } from "@/components/admin/admin-settings-table"
import { loadAdminSettingsSnapshot } from "@/modules/admin/settings"
import { requireRootPageContext } from "@/modules/auth/root"

export const dynamic = "force-dynamic"

export default async function AdminSettingsPage() {
  await requireRootPageContext()
  const snapshot = await loadAdminSettingsSnapshot()
  const overrideCount = snapshot.settings.filter((s) => s.hasOverride).length

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-white sm:text-lg">Quản lý Cài đặt Runtime</h2>
            <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-400">
              {snapshot.settings.length} PARAMS
            </span>
            {overrideCount > 0 ? (
              <span className="rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 font-mono text-[10px] font-bold text-cyan-300">
                {overrideCount} OVERRIDDEN
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-xs text-slate-400">
            Chỉnh sửa an toàn các tham số vận hành được cho phép mà không cần redeploy. Các cài đặt chỉ đọc được bảo vệ.
          </p>
        </div>
      </div>

      <AdminSettingsTable settings={snapshot.settings} />
    </div>
  )
}
