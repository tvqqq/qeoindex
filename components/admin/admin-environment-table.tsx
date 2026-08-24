"use client"

import { useState } from "react"
import { CheckCircle2, Lock, Search, XCircle } from "lucide-react"

import type { AdminEnvironmentItem } from "@/lib/admin/types"

export interface AdminEnvironmentTableProps {
  environment: AdminEnvironmentItem[]
}

const SENSITIVITY_BADGES = {
  public: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  internal: "border-purple-500/30 bg-purple-500/10 text-purple-300",
  secret: "border-amber-500/30 bg-amber-500/10 text-amber-400",
}

export function AdminEnvironmentTable({ environment }: AdminEnvironmentTableProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedGroup, setSelectedGroup] = useState<string>("all")

  const groups = ["all", ...Array.from(new Set(environment.map((e) => e.group)))]

  const filteredItems = environment.filter((item) => {
    const matchesGroup = selectedGroup === "all" || item.group === selectedGroup
    const matchesSearch =
      item.key.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.description.toLowerCase().includes(searchTerm.toLowerCase())
    return matchesGroup && matchesSearch
  })

  return (
    <div className="space-y-4">
      {/* Search and Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Tìm kiếm biến môi trường..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-white/[0.08] bg-[#0c1016] py-2 pl-9 pr-3 text-xs text-white placeholder-slate-400 focus:border-emerald-500/50 focus:outline-none"
          />
        </div>

        <div className="flex overflow-x-auto gap-1">
          {groups.map((group) => (
            <button
              key={group}
              type="button"
              onClick={() => setSelectedGroup(group)}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium uppercase transition-colors ${
                selectedGroup === group
                  ? "border border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                  : "text-slate-400 hover:bg-white/[0.04] hover:text-white"
              }`}
            >
              {group}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-white/[0.08] bg-[#0c1016] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-white/[0.06] bg-[#080c10]">
              <tr className="text-[11px] font-medium text-slate-400">
                <th className="px-4 py-3 font-medium">Tên biến (Key) & Mô tả</th>
                <th className="px-4 py-3 font-medium">Nhóm</th>
                <th className="px-4 py-3 font-medium">Độ nhạy</th>
                <th className="px-4 py-3 font-medium">Trạng thái cấu hình</th>
                <th className="px-4 py-3 font-medium">Giá trị (Chỉ public / internal)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {filteredItems.map((item) => {
                const sensitivityStyle = SENSITIVITY_BADGES[item.sensitivity] || SENSITIVITY_BADGES.public
                const isSecret = item.sensitivity === "secret"

                return (
                  <tr key={item.key} className="text-slate-300 hover:bg-white/[0.02]">
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-white">{item.key}</span>
                        {isSecret ? (
                          <Lock className="h-3 w-3 text-amber-400" />
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-[11px] text-slate-400">{item.description}</p>
                    </td>

                    <td className="px-4 py-3.5">
                      <span className="rounded border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-[10px] font-medium uppercase text-slate-300">
                        {item.group}
                      </span>
                    </td>

                    <td className="px-4 py-3.5">
                      <span className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${sensitivityStyle}`}>
                        {item.sensitivity}
                      </span>
                    </td>

                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1.5">
                        {item.isConfigured ? (
                          <>
                            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                            <span className="text-xs font-semibold text-emerald-400">ĐÃ CẤU HÌNH</span>
                          </>
                        ) : (
                          <>
                            <XCircle className="h-4 w-4 text-slate-400" />
                            <span className="text-xs text-slate-400">CHƯA CẤU HÌNH</span>
                          </>
                        )}
                      </div>
                    </td>

                    <td className="px-4 py-3.5 font-mono">
                      {isSecret ? (
                        <span className="text-slate-400" title="Bí mật được bảo vệ an toàn">
                          ••••••••••••••••
                        </span>
                      ) : item.value ? (
                        <span className="rounded bg-white/[0.04] px-1.5 py-0.5 text-slate-200">
                          {item.value}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
