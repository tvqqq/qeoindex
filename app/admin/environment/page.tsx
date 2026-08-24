import { AdminEnvironmentTable } from "@/components/admin/admin-environment-table"
import { getAdminEnvironmentInventory } from "@/lib/admin/catalog"

export const dynamic = "force-dynamic"

export default function AdminEnvironmentPage() {
  const environment = getAdminEnvironmentInventory()

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-white">Kiểm tra Biến Môi trường & Bí mật</h2>
        <p className="text-xs text-slate-400">
          Theo dõi trạng thái cấu hình của tất cả các biến môi trường và bí mật hệ thống. Giá trị bí mật (secrets) được bảo vệ tuyệt đối và không bao giờ hiển thị.
        </p>
      </div>

      <AdminEnvironmentTable environment={environment} />
    </div>
  )
}
