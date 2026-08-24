import type { ReactNode } from "react"
import { notFound } from "next/navigation"

import { AdminHeader } from "@/components/admin/admin-header"
import { AdminNav } from "@/components/admin/admin-nav"
import { getRootPageContext } from "@/lib/auth/root"

export const dynamic = "force-dynamic"

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const context = await getRootPageContext()

  if (!context?.user?.id) {
    notFound()
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
