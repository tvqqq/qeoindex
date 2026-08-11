"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { SidebarCell } from "@/components/sidebar-cell"

interface Folder {
  id: string
  label: string
  badge?: string
  stocks: string[] // group:symbol keys
}

const FOLDERS: Folder[] = [
  { id: "main", label: "Danh mục chính", stocks: ["vn30:HPG", "vn30:MSN", "vn30:VPB"] },
  { id: "bank", label: "Bank", stocks: ["vn30:VCB"] },
  { id: "chung", label: "Chứng", stocks: [] },
  { id: "bds", label: "BĐS", stocks: [] },
  { id: "thep", label: "Thép", stocks: [] },
  { id: "dien", label: "Điện", stocks: [] },
  { id: "p9", label: "Port 9", stocks: [] },
  { id: "p10", label: "Port 10", stocks: [] },
  { id: "p7", label: "Port 7", stocks: [] },
  { id: "p8", label: "Port 8", stocks: [] },
  { id: "p5", label: "Port 5", stocks: [] },
  { id: "watch", label: "Watchlist", badge: "FPT", stocks: ["vn30:VIC", "vn30:VHM", "vn30:MWG"] },
]

function FolderSection({ folder }: { folder: Folder }) {
  const [open, setOpen] = useState(true)

  return (
    <div className="border-b border-border/60">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-3 py-2.5 text-left"
      >
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform ${open ? "" : "-rotate-90"}`}
        />
        <span className="text-sm font-medium text-foreground">{folder.label}</span>
        {folder.badge && (
          <span className="ml-auto rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] text-muted-2">
            {folder.badge}
          </span>
        )}
      </button>
      {open && (
        <div className="px-1.5 pb-2">
          {folder.stocks.length === 0 ? (
            <p className="px-2 py-1 text-xs italic text-muted">Chưa có cổ phiếu</p>
          ) : (
            <div className="flex flex-col gap-1">
              {folder.stocks.map((k) => (
                <SidebarCell key={k} stockKey={k} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function Sidebar() {
  return (
    <aside className="flex h-full w-[240px] shrink-0 flex-col border-r border-border bg-panel">
      <div className="flex items-center px-3 py-3">
        <h2 className="text-base font-semibold text-foreground">Danh mục</h2>
      </div>
      <div className="flex-1 overflow-y-auto">
        {FOLDERS.map((f) => (
          <FolderSection key={f.id} folder={f} />
        ))}
      </div>
    </aside>
  )
}
