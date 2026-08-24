"use client"

import { useActionState, useState } from "react"
import { AlertCircle, Edit2, RotateCcw, Search, X } from "lucide-react"

import { resetSettingAction, saveSettingAction, type AdminActionResult } from "@/app/admin/actions"
import type { ResolvedAdminSetting } from "@/lib/admin/types"

export interface AdminSettingsTableProps {
  settings: ResolvedAdminSetting[]
}

export function AdminSettingsTable({ settings }: AdminSettingsTableProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedGroup, setSelectedGroup] = useState<string>("all")
  const [editingSetting, setEditingSetting] = useState<ResolvedAdminSetting | null>(null)
  const [resettingSetting, setResettingSetting] = useState<ResolvedAdminSetting | null>(null)

  const [saveState, formSaveAction, isSaving] = useActionState<AdminActionResult | null, FormData>(
    async (prev, formData) => {
      const res = await saveSettingAction(prev, formData)
      if (res.ok) setEditingSetting(null)
      return res
    },
    null,
  )

  const [resetState, formResetAction, isResetting] = useActionState<AdminActionResult | null, FormData>(
    async (prev, formData) => {
      const res = await resetSettingAction(prev, formData)
      if (res.ok) setResettingSetting(null)
      return res
    },
    null,
  )

  const groups = ["all", ...Array.from(new Set(settings.map((s) => s.group)))]

  const filteredSettings = settings.filter((s) => {
    const matchesGroup = selectedGroup === "all" || s.group === selectedGroup
    const matchesSearch =
      s.key.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.description.toLowerCase().includes(searchTerm.toLowerCase())
    return matchesGroup && matchesSearch
  })

  function formatValue(value: unknown): string {
    if (value === null || value === undefined) return "—"
    if (typeof value === "boolean") return value ? "true" : "false"
    if (Array.isArray(value)) return value.join(", ")
    return String(value)
  }

  return (
    <div className="space-y-4">
      {/* Search and Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Tìm kiếm cài đặt theo key, nhãn..."
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

      {/* Global feedback message */}
      {saveState?.error ? (
        <div className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
          <span>{saveState.error}</span>
        </div>
      ) : null}
      {resetState?.error ? (
        <div className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
          <span>{resetState.error}</span>
        </div>
      ) : null}

      {/* Table */}
      <div className="rounded-xl border border-white/[0.08] bg-[#0c1016] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-white/[0.06] bg-[#080c10]">
              <tr className="text-[11px] font-medium text-slate-400">
                <th className="px-4 py-3 font-medium">Khóa (Key) & Mô tả</th>
                <th className="px-4 py-3 font-medium">Nhóm</th>
                <th className="px-4 py-3 font-medium">Giá trị Hiện tại</th>
                <th className="px-4 py-3 font-medium">Nguồn giải quyết</th>
                <th className="px-4 py-3 font-medium">Phiên bản</th>
                <th className="px-4 py-3 text-right font-medium">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {filteredSettings.map((item) => {
                const isRuntime = item.resolvedFrom === "runtime"
                const isEnv = item.resolvedFrom === "environment"

                return (
                  <tr key={item.key} className="text-slate-300 hover:bg-white/[0.02]">
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-white">{item.key}</span>
                        {item.editable ? (
                          <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1 py-0.2 text-[9px] font-bold uppercase text-emerald-400">
                            RUNTIME
                          </span>
                        ) : (
                          <span className="rounded border border-white/[0.1] bg-white/[0.04] px-1 py-0.2 text-[9px] font-bold uppercase text-slate-400">
                            CHỈ ĐỌC
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[11px] text-slate-400">{item.description}</p>
                    </td>

                    <td className="px-4 py-3.5">
                      <span className="rounded border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-[10px] font-medium uppercase text-slate-300">
                        {item.group}
                      </span>
                    </td>

                    <td className="px-4 py-3.5 font-mono text-white">
                      <span
                        className={`rounded px-1.5 py-0.5 ${
                          isRuntime
                            ? "border border-cyan-500/30 bg-cyan-500/10 text-cyan-300"
                            : "bg-white/[0.04] text-slate-200"
                        }`}
                      >
                        {formatValue(item.value)}
                      </span>
                    </td>

                    <td className="px-4 py-3.5">
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                          isRuntime
                            ? "border border-cyan-500/30 bg-cyan-500/10 text-cyan-400"
                            : isEnv
                              ? "border border-purple-500/30 bg-purple-500/10 text-purple-300"
                              : "border border-white/[0.08] bg-white/[0.04] text-slate-400"
                        }`}
                      >
                        {item.resolvedFrom}
                      </span>
                    </td>

                    <td className="px-4 py-3.5 font-mono text-slate-400">
                      {item.version ? `v${item.version}` : "—"}
                    </td>

                    <td className="px-4 py-3.5 text-right">
                      {item.editable ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setEditingSetting(item)}
                            className="flex items-center gap-1 rounded-lg border border-white/[0.1] bg-white/[0.03] px-2.5 py-1 text-xs text-slate-200 transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/10 hover:text-emerald-300"
                          >
                            <Edit2 className="h-3 w-3" />
                            <span>Sửa</span>
                          </button>

                          {item.hasOverride ? (
                            <button
                              type="button"
                              onClick={() => setResettingSetting(item)}
                              className="flex items-center gap-1 rounded-lg border border-white/[0.1] bg-white/[0.03] px-2.5 py-1 text-xs text-slate-300 transition-colors hover:border-amber-500/40 hover:bg-amber-500/10 hover:text-amber-300"
                              title="Khôi phục về mặc định"
                            >
                              <RotateCcw className="h-3 w-3" />
                              <span>Reset</span>
                            </button>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-400">Cố định</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Modal */}
      {editingSetting ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-md rounded-xl border border-white/[0.12] bg-[#0d1218] p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <div>
                <h3 className="text-sm font-bold text-white">Chỉnh sửa Cài đặt Runtime</h3>
                <p className="font-mono text-xs text-emerald-400">{editingSetting.key}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingSetting(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-white/[0.06] hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form action={formSaveAction} className="mt-4 space-y-4">
              <input type="hidden" name="key" value={editingSetting.key} />
              <input type="hidden" name="type" value={editingSetting.type} />
              <input type="hidden" name="expectedVersion" value={editingSetting.version || 1} />

              <div>
                <label className="block text-xs font-medium text-slate-300">
                  Giá trị mới ({editingSetting.type})
                </label>
                {editingSetting.type === "boolean" ? (
                  <select
                    name="value"
                    defaultValue={String(editingSetting.value)}
                    className="mt-1 w-full rounded-lg border border-white/[0.1] bg-[#070b10] px-3 py-2 text-xs text-white focus:border-emerald-500/50 focus:outline-none"
                  >
                    <option value="true">true (Bật)</option>
                    <option value="false">false (Tắt)</option>
                  </select>
                ) : (
                  <input
                    type={editingSetting.type === "integer" || editingSetting.type === "number" ? "number" : "text"}
                    name="value"
                    defaultValue={
                      Array.isArray(editingSetting.value)
                        ? editingSetting.value.join(",")
                        : String(editingSetting.value ?? "")
                    }
                    required
                    className="mt-1 w-full rounded-lg border border-white/[0.1] bg-[#070b10] px-3 py-2 font-mono text-xs text-white focus:border-emerald-500/50 focus:outline-none"
                  />
                )}
                <p className="mt-1 text-[11px] text-slate-400">{editingSetting.description}</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300">
                  Lý do thay đổi <span className="text-emerald-400">*</span> (8–240 ký tự)
                </label>
                <textarea
                  name="reason"
                  required
                  minLength={8}
                  maxLength={240}
                  rows={3}
                  placeholder="Ví dụ: Tăng số lượng ticker debate trong phiên biến động..."
                  className="mt-1 w-full rounded-lg border border-white/[0.1] bg-[#070b10] p-2.5 text-xs text-white placeholder-slate-400 focus:border-emerald-500/50 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingSetting(null)}
                  className="rounded-lg border border-white/[0.1] px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/[0.04]"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/20 px-4 py-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50"
                >
                  {isSaving ? "Đang lưu..." : "Lưu Thay Đổi"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Reset Modal */}
      {resettingSetting ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-md rounded-xl border border-white/[0.12] bg-[#0d1218] p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <div>
                <h3 className="text-sm font-bold text-white">Khôi phục Cài đặt về Mặc định</h3>
                <p className="font-mono text-xs text-amber-400">{resettingSetting.key}</p>
              </div>
              <button
                type="button"
                onClick={() => setResettingSetting(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-white/[0.06] hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form action={formResetAction} className="mt-4 space-y-4">
              <input type="hidden" name="key" value={resettingSetting.key} />
              <input type="hidden" name="expectedVersion" value={resettingSetting.version || 1} />

              <p className="text-xs text-slate-300">
                Bạn có chắc chắn muốn xóa bản ghi đè runtime này và khôi phục về giá trị cấu hình mặc định từ mã nguồn hoặc biến môi trường?
              </p>

              <div>
                <label className="block text-xs font-medium text-slate-300">
                  Lý do khôi phục <span className="text-amber-400">*</span> (8–240 ký tự)
                </label>
                <textarea
                  name="reason"
                  required
                  minLength={8}
                  maxLength={240}
                  rows={3}
                  placeholder="Ví dụ: Hoàn tất đợt kiểm thử, trả về cấu hình chuẩn..."
                  className="mt-1 w-full rounded-lg border border-white/[0.1] bg-[#070b10] p-2.5 text-xs text-white placeholder-slate-400 focus:border-amber-500/50 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setResettingSetting(null)}
                  className="rounded-lg border border-white/[0.1] px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/[0.04]"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isResetting}
                  className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/20 px-4 py-1.5 text-xs font-bold text-amber-300 hover:bg-amber-500/30 disabled:opacity-50"
                >
                  {isResetting ? "Đang khôi phục..." : "Xác nhận Reset"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}
