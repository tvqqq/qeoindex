import { AdminSettingsTable } from "@/components/admin/admin-settings-table"
import { loadAdminSettingsSnapshot } from "@/lib/admin/settings"

export const dynamic = "force-dynamic"

export default async function AdminSettingsPage() {
  const snapshot = await loadAdminSettingsSnapshot()

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-white">Quản lý Cài đặt Runtime</h2>
        <p className="text-xs text-slate-400">
          Chỉnh sửa an toàn các tham số vận hành được cho phép mà không cần redeploy. Các cài đặt chỉ đọc được bảo vệ.
        </p>
      </div>

      <AdminSettingsTable settings={snapshot.settings} />
    </div>
  )
}
