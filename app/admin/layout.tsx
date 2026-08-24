import type { ReactNode } from "react"
import Link from "next/link"
import { AlertOctagon, ArrowLeft } from "lucide-react"

import { AdminHeader } from "@/components/admin/admin-header"
import { AdminNav } from "@/components/admin/admin-nav"
import { getRootPageContext } from "@/lib/auth/root"

export const dynamic = "force-dynamic"

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const context = await getRootPageContext()

  if (!context?.user?.id) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#070a0e] p-4">
        <div className="w-full max-w-md rounded-2xl border border-rose-500/20 bg-[#0c1016] p-6 text-center shadow-2xl">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-400">
            <AlertOctagon className="h-6 w-6" />
          </div>

          <h2 className="mt-4 text-lg font-bold text-white">403 — Quyền truy cập bị từ chối</h2>
          <p className="mt-2 text-xs leading-relaxed text-slate-400">
            Trang này chỉ dành cho tài khoản thuộc danh sách <span className="font-mono text-rose-300">ROOT_ADMIN_USER_IDS</span>. Tài khoản hiện tại của bạn không có thẩm quyền truy cập Control Plane.
          </p>

          <div className="mt-6 flex justify-center">
            <Link
              href="/"
              prefetch={false}
              className="flex items-center gap-2 rounded-xl border border-white/[0.1] bg-white/[0.04] px-4 py-2 text-xs font-semibold text-slate-200 transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/10 hover:text-emerald-300"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Quay về Bảng điện</span>
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#070a0e] text-slate-100">
      <AdminHeader actorUserId={context.user.id} />
      <AdminNav />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {children}
      </main>
    </div>
  )
}
