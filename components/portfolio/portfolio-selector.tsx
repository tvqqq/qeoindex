"use client"

import { useState, useCallback } from "react"
import { ChevronDown, Plus, Trash2, Check } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

interface PortfolioMeta {
  id: string
  name: string
  description: string | null
  is_default: boolean
  sort_order: number
}

interface PortfolioSelectorProps {
  portfolios: PortfolioMeta[]
  activeId: string
  onSelect: (id: string) => void
  onCreate: (name: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

export function PortfolioSelector({
  portfolios,
  activeId,
  onSelect,
  onCreate,
  onDelete,
}: PortfolioSelectorProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const [creating, setCreating] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const activePortfolio = portfolios.find((p) => p.id === activeId)

  const handleCreate = useCallback(async () => {
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    try {
      await onCreate(name)
      setNewName("")
      setCreateOpen(false)
    } finally {
      setCreating(false)
    }
  }, [newName, onCreate])

  const handleDelete = useCallback(async (id: string) => {
    setDeleting(true)
    try {
      await onDelete(id)
    } finally {
      setDeleting(false)
      setDeleteConfirm(null)
    }
  }, [onDelete])

  return (
    <div className="flex items-center gap-2">
      {/* Portfolio dropdown */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setDropdownOpen((o) => !o)}
          className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 text-sm font-medium text-[var(--color-foreground)] transition-colors hover:border-white/20"
        >
          <span className="font-ticker">{activePortfolio?.name ?? "Danh mục"}</span>
          <ChevronDown className={`h-3.5 w-3.5 text-[var(--color-muted-2)] transition-transform duration-150 ${dropdownOpen ? "rotate-180" : ""}`} />
        </button>

        {dropdownOpen && (
          <div
            className="absolute left-0 top-full z-50 mt-1.5 min-w-[200px] rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] py-1 shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
            onMouseLeave={() => setDropdownOpen(false)}
          >
            {portfolios.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => { onSelect(p.id); setDropdownOpen(false) }}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-white/[0.05]"
              >
                <span className={p.id === activeId ? "font-semibold text-[var(--color-up)]" : "text-[var(--color-foreground)]"}>
                  {p.name}
                </span>
                {p.id === activeId && <Check className="h-3.5 w-3.5 text-[var(--color-up)]" />}
              </button>
            ))}

            {portfolios.length < 5 && (
              <>
                <div className="my-1 border-t border-[var(--color-border)]" />
                <button
                  type="button"
                  onClick={() => { setCreateOpen(true); setDropdownOpen(false) }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--color-muted-2)] transition-colors hover:bg-white/[0.05] hover:text-white"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Tạo danh mục mới
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Delete current portfolio */}
      {portfolios.length > 1 && (
        <button
          type="button"
          onClick={() => setDeleteConfirm(activeId)}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-border)] text-[var(--color-muted-2)] transition-colors hover:border-[var(--color-down)]/30 hover:text-[var(--color-down)]"
          title="Xóa danh mục này"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm border-[var(--color-border)] bg-[var(--color-panel)]">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">Tạo danh mục đầu tư mới</DialogTitle>
          </DialogHeader>
          <div>
            <label className="mb-1.5 block text-xs text-[var(--color-muted-2)]">Tên danh mục</label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="VD: Danh mục dài hạn, Trading ngắn hạn..."
              maxLength={80}
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") handleCreate() }}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>Hủy</Button>
            <Button size="sm" onClick={handleCreate} disabled={creating || !newName.trim()}>
              {creating ? "Đang tạo..." : "Tạo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={deleteConfirm !== null} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm border-[var(--color-border)] bg-[var(--color-panel)]">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">Xóa danh mục?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[var(--color-muted-2)]">
            Tất cả giao dịch trong danh mục{" "}
            <span className="font-medium text-[var(--color-foreground)]">
              {portfolios.find((p) => p.id === deleteConfirm)?.name}
            </span>{" "}
            sẽ bị xóa vĩnh viễn.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setDeleteConfirm(null)}>Hủy</Button>
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
