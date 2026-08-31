import { AdminEnvironmentTable } from "@/components/admin/admin-environment-table"
import { getAdminEnvironmentInventory } from "@/lib/admin/catalog"
import { requireRootPageContext } from "@/lib/auth/root"

export const dynamic = "force-dynamic"

export default async function AdminEnvironmentPage() {
  await requireRootPageContext()
  const environment = getAdminEnvironmentInventory()
  const configuredCount = environment.filter((e) => e.isConfigured).length
  const secretCount = environment.filter((e) => e.sensitivity === "secret").length

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-white sm:text-lg">Kiểm tra Biến Môi trường & Bí mật</h2>
            <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-400">
              {configuredCount}/{environment.length} CONFIGURED
            </span>
            <span className="rounded-md border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 font-mono text-[10px] font-bold text-purple-300">
              {secretCount} SECRETS PROTECTED
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-400">
            Theo dõi trạng thái cấu hình của tất cả các biến môi trường và bí mật hệ thống. Giá trị bí mật (secrets) được bảo vệ tuyệt đối và không bao giờ hiển thị.
          </p>
        </div>
      </div>

      <AdminEnvironmentTable environment={environment} />
    </div>
  )
}
