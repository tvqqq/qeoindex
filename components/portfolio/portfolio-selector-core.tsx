"use client"

import React, { useState, useCallback, useRef, useEffect } from "react"
import { ChevronDown, Plus, Trash2, Check, Settings } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { cn } from "@/modules/shared/ui/cn"

export interface PortfolioMeta {
  id: string
  name: string
  description: string | null
  initial_capital?: number
  is_default: boolean
  sort_order: number
}

interface PortfolioSelectorProps {
  portfolios: PortfolioMeta[]
  activeId: string
  onSelect: (id: string) => void
  onCreate: (name: string, initialCapital?: number) => Promise<void>
  onUpdate?: (id: string, updates: { name?: string; initial_capital?: number }) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

export function PortfolioSelector({
  portfolios,
  activeId,
  onSelect,
  onCreate,
  onUpdate,
  onDelete,
}: PortfolioSelectorProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const [newInitialCapital, setNewInitialCapital] = useState("")
  const [creating, setCreating] = useState(false)

  // Edit settings modal
  const [editOpen, setEditOpen] = useState(false)
  const [editName, setEditName] = useState("")
  const [editCapital, setEditCapital] = useState("")
  const [updating, setUpdating] = useState(false)

  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const activePortfolio = portfolios.find((p) => p.id === activeId)

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false)
      }
    }
    if (dropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside)
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [dropdownOpen])

  const handleCreate = useCallback(async () => {
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    try {
      const cap = parseFloat(newInitialCapital)
      await onCreate(name, !isNaN(cap) ? cap : 0)
      setNewName("")
      setNewInitialCapital("")
      setCreateOpen(false)
    } finally {
      setCreating(false)
    }
  }, [newName, newInitialCapital, onCreate])

  const handleOpenEdit = (p: PortfolioMeta) => {
    setEditName(p.name)
    setEditCapital(p.initial_capital ? String(p.initial_capital) : "")
    setEditOpen(true)
    setDropdownOpen(false)
  }

  const handleSaveEdit = async () => {
    if (!activePortfolio || !onUpdate) return
    const name = editName.trim()
    if (!name) return
    setUpdating(true)
    try {
      const cap = parseFloat(editCapital)
      await onUpdate(activePortfolio.id, {
        name,
        initial_capital: !isNaN(cap) ? cap : 0,
      })
      setEditOpen(false)
    } finally {
      setUpdating(false)
    }
  }

  const handleDelete = useCallback(
    async (id: string) => {
      setDeleting(true)
      try {
        await onDelete(id)
      } finally {
        setDeleting(false)
        setDeleteConfirm(null)
      }
    },
    [onDelete],
  )

  return (
    <div className="flex items-center gap-2">
      {/* Sleek Pill Selector (Matching Screenshot 1) */}
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setDropdownOpen((o) => !o)}
          className="flex min-w-[200px] items-center justify-between gap-3 rounded-full border border-[#30364d] bg-[#0b0e14] px-5 py-2.5 text-sm font-medium text-white transition-colors duration-200 hover:border-purple-500/70 hover:bg-[#10141e] shadow-md cursor-pointer"
        >
          <span className="font-ticker font-semibold text-white tracking-wide truncate">
            {activePortfolio?.name ?? "Danh mục chính"}
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-[var(--color-muted-2)] transition-transform duration-200",
              dropdownOpen ? "rotate-180 text-purple-400" : "",
            )}
          />
        </button>

        {dropdownOpen && (
          <div
            className="absolute right-0 top-full z-[100] mt-2 min-w-[260px] rounded-2xl border border-[#30364d] bg-[#0e1218] p-2 shadow-[0_25px_60px_rgba(0,0,0,0.9)]"
          >
            <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-2)]">
              Danh sách danh mục ({portfolios.length}/5)
            </div>

            <div className="space-y-1">
              {portfolios.map((p) => (
                <div
                  key={p.id}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-xs transition-colors hover:bg-white/[0.08]",
                    p.id === activeId ? "bg-purple-500/15 border border-purple-500/30" : "border border-transparent",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(p.id)
                      setDropdownOpen(false)
                    }}
                    className="flex-1 flex flex-col min-w-0 text-left cursor-pointer"
                  >
                    <span
                      className={cn(
                        "truncate font-ticker text-xs",
                        p.id === activeId ? "font-bold text-purple-300" : "text-slate-200 font-medium",
                      )}
                    >
                      {p.name}
                    </span>
                    {p.initial_capital != null && p.initial_capital > 0 && (
                      <span className="font-ticker text-[10px] text-[var(--color-muted-2)]">
                        Vốn: {(p.initial_capital / 1_000_000).toLocaleString("vi-VN")} tr
                      </span>
                    )}
                  </button>

                  {p.id === activeId && <Check className="h-4 w-4 text-purple-400 shrink-0" />}
                </div>
              ))}
            </div>

            <div className="my-1.5 border-t border-[var(--color-border)]" />

            {/* Quick Settings & Create new */}
            {activePortfolio && onUpdate && (
              <button
                type="button"
                onClick={() => handleOpenEdit(activePortfolio)}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-[var(--color-muted-2)] transition-colors hover:bg-white/[0.06] hover:text-white cursor-pointer"
              >
                <Settings className="h-3.5 w-3.5" />
                Cài đặt vốn & Tên danh mục
              </button>
            )}

            {portfolios.length < 5 && (
              <button
                type="button"
                onClick={() => {
                  setCreateOpen(true)
                  setDropdownOpen(false)
                }}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold text-purple-300 transition-colors hover:bg-purple-500/10 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                Tạo danh mục mới
              </button>
            )}
          </div>
        )}
      </div>

      {/* Delete current portfolio button */}
      {portfolios.length > 1 && (
        <button
          type="button"
          onClick={() => setDeleteConfirm(activeId)}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-[#30364d] bg-[#0b0e14] text-[var(--color-muted-2)] transition-colors hover:border-[var(--color-down)]/40 hover:text-[var(--color-down)] cursor-pointer"
          title="Xóa danh mục này"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm border-[var(--color-border)] bg-[#0b0f13] text-foreground">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold text-white">Tạo danh mục đầu tư mới</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <div>
              <label className="mb-1 block text-xs text-[var(--color-muted-2)]">
                Tên danh mục <span className="text-[var(--color-down)]">*</span>
              </label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="VD: Danh mục Tăng trưởng, Sóng Q4..."
                maxLength={80}
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--color-muted-2)]">
                Vốn ban đầu (VNĐ)
              </label>
              <Input
                type="number"
                step="10000000"
                value={newInitialCapital}
                onChange={(e) => setNewInitialCapital(e.target.value)}
                placeholder="VD: 500000000 (500 triệu)"
                className="font-ticker text-xs"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>
              Hủy
            </Button>
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
              className="bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs"
            >
              {creating ? "Đang tạo..." : "Tạo danh mục"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Portfolio Settings Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-sm border-[var(--color-border)] bg-[#0b0f13] text-foreground">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold text-white">Cài đặt danh mục</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <div>
              <label className="mb-1 block text-xs text-[var(--color-muted-2)]">Tên danh mục</label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={80}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--color-muted-2)]">
                Vốn ban đầu (VNĐ) - Dùng cho phân bổ vốn
              </label>
              <Input
                type="number"
                step="10000000"
                value={editCapital}
                onChange={(e) => setEditCapital(e.target.value)}
                placeholder="VD: 500000000 (500 triệu)"
                className="font-ticker text-xs"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setEditOpen(false)}>
              Hủy
            </Button>
            <Button
              size="sm"
              onClick={handleSaveEdit}
              disabled={updating || !editName.trim()}
              className="bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs"
            >
              {updating ? "Đang lưu..." : "Lưu thay đổi"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={deleteConfirm !== null} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm border-[var(--color-border)] bg-[#0b0f13] text-foreground">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold text-white">Xóa danh mục?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[var(--color-muted-2)]">
            Tất cả giao dịch trong danh mục{" "}
            <span className="font-semibold text-white">
              {portfolios.find((p) => p.id === deleteConfirm)?.name}
            </span>{" "}
            sẽ bị xóa vĩnh viễn.
          </p>
          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setDeleteConfirm(null)}>
              Hủy
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={deleting}
              onClick={() => deleteConfirm && handleDelete(deleteConfirm)}
            >
              {deleting ? "Đang xóa..." : "Xóa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
