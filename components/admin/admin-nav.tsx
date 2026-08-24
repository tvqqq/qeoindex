"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Activity, FileText, LayoutGrid, Settings, ShieldAlert } from "lucide-react"

const NAV_ITEMS = [
  { href: "/admin", label: "Tổng quan", icon: LayoutGrid, exact: true },
  { href: "/admin/settings", label: "Cài đặt Runtime", icon: Settings, exact: false },
  { href: "/admin/jobs", label: "Tác vụ & Cron", icon: Activity, exact: false },
  { href: "/admin/environment", label: "Môi trường & Bí mật", icon: ShieldAlert, exact: false },
  { href: "/admin/audit", label: "Nhật ký Audit", icon: FileText, exact: false },
] as const

export function AdminNav() {
  const pathname = usePathname()

  return (
    <nav className="flex overflow-x-auto border-b border-white/[0.08] bg-[#070b10] px-4 sm:px-6">
      <div className="flex min-w-max gap-1 py-2">
        {NAV_ITEMS.map((item) => {
          const isActive = item.exact ? pathname === item.href : pathname.startsWith(item.href)
          const Icon = item.icon

          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              className={[
                "flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors",
                isActive
                  ? "border border-emerald-500/30 bg-emerald-500/15 font-bold text-emerald-300 shadow-sm"
                  : "border border-transparent text-slate-400 hover:bg-white/[0.04] hover:text-slate-200",
              ].join(" ")}
            >
              <Icon className={`h-4 w-4 ${isActive ? "text-emerald-400" : "text-slate-400"}`} />
              <span>{item.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
