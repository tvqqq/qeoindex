"use client"

import React from "react"
import {
  AlertTriangle,
  ArrowUpRight,
  Circle,
  Eye,
  EyeOff,
  Flag,
  Layers,
  Lock,
  Minus,
  Pencil,
  Square,
  Star,
  Target,
  ThumbsUp,
  Trash2,
  TrendingUp,
  Type,
  Unlock,
  X,
} from "lucide-react"
import { cn } from "@/modules/shared/ui/cn"
import type { DrawingObject } from "./stock-chart-types"

interface ObjectManagerProps {
  drawings: DrawingObject[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onToggleHide: (id: string) => void
  onToggleLock: (id: string) => void
  onDelete: (id: string) => void
  onEditText: (id: string) => void
  onClearAll: () => void
  onClose: () => void
}

function getToolMeta(draw: DrawingObject): { label: string; icon: React.ReactNode } {
  switch (draw.tool) {
    case "trendline":
      return { label: "Đường xu hướng (Trendline)", icon: <TrendingUp className="size-3.5 text-cyan-400" /> }
    case "arrow":
      return { label: "Mũi tên (Arrow)", icon: <ArrowUpRight className="size-3.5 text-cyan-400" /> }
    case "horizontal":
      return {
        label: `Đường ngang: ${draw.points[0]?.price ? draw.points[0].price.toFixed(1) : "Hỗ trợ/Kháng cự"}`,
        icon: <Minus className="size-3.5 text-amber-400" />,
      }
    case "rectangle":
      return { label: "Vùng chữ nhật (Wyckoff TR)", icon: <Square className="size-3.5 text-purple-400" /> }
    case "circle":
      return { label: "Vùng Elip / Vòng tròn", icon: <Circle className="size-3.5 text-emerald-400" /> }
    case "text":
      return {
        label: draw.text ? `Ghi chú: "${draw.text.slice(0, 18)}${draw.text.length > 18 ? "..." : ""}"` : "Ghi chú văn bản",
        icon: <Type className="size-3.5 text-cyan-300" />,
      }
    case "icon": {
      let ic = <Flag className="size-3.5 text-cyan-400" />
      if (draw.iconType === "star") ic = <Star className="size-3.5 text-amber-400" />
      if (draw.iconType === "alert") ic = <AlertTriangle className="size-3.5 text-rose-500" />
      if (draw.iconType === "target") ic = <Target className="size-3.5 text-cyan-400" />
      if (draw.iconType === "thumbsUp") ic = <ThumbsUp className="size-3.5 text-emerald-400" />
      return { label: `Biểu tượng (${draw.iconType || "flag"})`, icon: ic }
    }
    default:
      return { label: "Đối tượng vẽ", icon: <Layers className="size-3.5 text-slate-400" /> }
  }
}

export function StockChartObjectManager({
  drawings,
  selectedId,
  onSelect,
  onToggleHide,
  onToggleLock,
  onDelete,
  onEditText,
  onClearAll,
  onClose,
}: ObjectManagerProps) {
  return (
    <div className="absolute right-3 top-12 z-40 w-72 sm:w-80 rounded-2xl border border-white/[0.1] bg-[#09111c]/95 shadow-[0_12px_40px_rgba(0,0,0,0.8)] backdrop-blur-xl flex flex-col overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.08] bg-[#0c1624] px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <Layers className="size-4 text-slate-400" />
          <span className="text-xs font-bold uppercase tracking-wider text-slate-200 font-mono">
            Quản lý đối tượng ({drawings.length})
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* List of Drawings */}
      <div className="max-h-72 overflow-y-auto p-1.5 divide-y divide-white/[0.03]">
        {drawings.length === 0 ? (
          <div className="py-8 px-4 text-center text-xs text-slate-500">
            Chưa có đối tượng vẽ nào trên biểu đồ. Chọn công cụ bên trái để vẽ.
          </div>
        ) : (
          drawings.map((draw) => {
            const isSelected = selectedId === draw.id
            const meta = getToolMeta(draw)

            return (
              <div
                key={draw.id}
                onClick={() => onSelect(draw.id)}
                className={cn(
                  "group flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors cursor-pointer",
                  isSelected
                    ? "bg-white/15 border border-white/25 text-slate-100"
                    : "hover:bg-white/[0.04] text-slate-300",
                  draw.hidden ? "opacity-40" : "opacity-100",
                )}
              >
                {/* Left info */}
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="size-2 rounded-full shrink-0" style={{ backgroundColor: draw.color }} />
                  <span className="shrink-0">{meta.icon}</span>
                  <span className="truncate font-medium text-[11px]">{meta.label}</span>
                </div>

                {/* Right Action buttons */}
                <div className="flex items-center gap-1 shrink-0">
                  {/* Edit text button if tool is text */}
                  {draw.tool === "text" && (
                    <button
                      type="button"
                      title="Sửa nội dung văn bản"
                      onClick={(e) => {
                        e.stopPropagation()
                        onEditText(draw.id)
                      }}
                      className="rounded p-1 text-slate-400 hover:text-cyan-300 hover:bg-white/[0.06]"
                    >
                      <Pencil className="size-3" />
                    </button>
                  )}

                  {/* Lock toggle */}
                  <button
                    type="button"
                    title={draw.locked ? "Mở khóa" : "Khóa đối tượng"}
                    onClick={(e) => {
                      e.stopPropagation()
                      onToggleLock(draw.id)
                    }}
                    className={cn(
                      "rounded p-1 transition-colors",
                      draw.locked ? "text-amber-400" : "text-slate-500 hover:text-slate-300",
                    )}
                  >
                    {draw.locked ? <Lock className="size-3" /> : <Unlock className="size-3" />}
                  </button>

                  {/* Hide/Show toggle */}
                  <button
                    type="button"
                    title={draw.hidden ? "Hiện đối tượng" : "Ẩn đối tượng"}
                    onClick={(e) => {
                      e.stopPropagation()
                      onToggleHide(draw.id)
                    }}
                    className={cn(
                      "rounded p-1 transition-colors",
                      draw.hidden ? "text-slate-500" : "text-slate-400 hover:text-white",
                    )}
                  >
                    {draw.hidden ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                  </button>

                  {/* Delete button */}
                  <button
                    type="button"
                    title="Xóa đối tượng này"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete(draw.id)
                    }}
                    className="rounded p-1 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Footer: Clear All */}
      {drawings.length > 0 && (
        <div className="flex items-center justify-between border-t border-white/[0.06] bg-[#070e17] px-3 py-2">
          <span className="text-[10px] text-slate-500 font-mono">Bấm vào đối tượng để chỉnh sửa</span>
          <button
            type="button"
            onClick={onClearAll}
            className="flex items-center gap-1 text-[11px] font-bold text-rose-400/80 hover:text-rose-300 transition-colors"
          >
            <Trash2 className="size-3" />
            <span>Xóa tất cả</span>
          </button>
        </div>
      )}
    </div>
  )
}
