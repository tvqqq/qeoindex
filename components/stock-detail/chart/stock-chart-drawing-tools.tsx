"use client"

import React, { useState } from "react"
import {
  ArrowUpRight,
  Circle,
  Crosshair,
  Eraser,
  Eye,
  EyeOff,
  Flag,
  Lock,
  Minus,
  Palette,
  Square,
  Star,
  Target,
  ThumbsUp,
  Trash2,
  TrendingUp,
  Type,
  Unlock,
  AlertTriangle,
} from "lucide-react"
import { cn } from "@/modules/shared/ui/cn"
import type { DrawingIconType, DrawingTool } from "./stock-chart-types"

interface DrawingToolsProps {
  activeTool: DrawingTool
  onSelectTool: (tool: DrawingTool) => void
  activeColor: string
  onChangeColor: (color: string) => void
  lineWidth: number
  onChangeLineWidth: (width: number) => void
  selectedIconType: DrawingIconType
  onSelectIconType: (type: DrawingIconType) => void
  isLocked: boolean
  onToggleLock: () => void
  isHidden: boolean
  onToggleHide: () => void
  onClearAll: () => void
}

const PALETTE_COLORS = [
  { hex: "#00f0ff", label: "Cyan" },
  { hex: "#a855f7", label: "Purple" },
  { hex: "#10b981", label: "Emerald" },
  { hex: "#f59e0b", label: "Amber" },
  { hex: "#f43f5e", label: "Rose" },
  { hex: "#ffffff", label: "White" },
]

export function StockChartDrawingTools({
  activeTool,
  onSelectTool,
  activeColor,
  onChangeColor,
  lineWidth,
  onChangeLineWidth,
  selectedIconType,
  onSelectIconType,
  isLocked,
  onToggleLock,
  isHidden,
  onToggleHide,
  onClearAll,
}: DrawingToolsProps) {
  const [showPalette, setShowPalette] = useState(false)
  const [showIconPicker, setShowIconPicker] = useState(false)

  const toolButtons: { id: DrawingTool; label: string; icon: React.ReactNode }[] = [
    { id: "cursor", label: "Con trỏ (Crosshair)", icon: <Crosshair className="size-4" /> },
    { id: "trendline", label: "Đường xu hướng (Trendline)", icon: <TrendingUp className="size-4" /> },
    { id: "arrow", label: "Mũi tên (Arrow)", icon: <ArrowUpRight className="size-4" /> },
    { id: "horizontal", label: "Đường ngang (Hỗ trợ/Kháng cự)", icon: <Minus className="size-4" /> },
    { id: "rectangle", label: "Hình chữ nhật (Vùng giá / Wyckoff TR)", icon: <Square className="size-4" /> },
    { id: "circle", label: "Hình tròn / Ellipse", icon: <Circle className="size-4" /> },
    { id: "text", label: "Chèn văn bản (Text)", icon: <Type className="size-4" /> },
  ]

  return (
    <aside
      aria-label="Thanh công cụ vẽ TradingView"
      className="absolute left-2.5 top-12 z-30 flex flex-col items-center gap-1 rounded-xl border border-white/[0.08] bg-[#0a0f16]/95 p-1 shadow-[0_8px_32px_rgba(0,0,0,0.7)] backdrop-blur-md"
    >
      {/* Drawing Tool Buttons */}
      {toolButtons.map((item) => {
        const isActive = activeTool === item.id
        return (
          <button
            key={item.id}
            type="button"
            title={item.label}
            onClick={() => {
              onSelectTool(item.id)
              setShowPalette(false)
              setShowIconPicker(false)
            }}
            className={cn(
              "flex size-7 items-center justify-center rounded-lg transition-colors",
              isActive
                ? "border border-cyan-400/40 bg-cyan-400/20 text-cyan-300 shadow-[0_0_10px_rgba(0,240,255,0.3)]"
                : "text-slate-400 hover:bg-white/[0.06] hover:text-white",
            )}
          >
            {item.icon}
          </button>
        )
      })}

      {/* Icon Sticker Stamp Button */}
      <div className="relative">
        <button
          type="button"
          title="Chèn biểu tượng / Sticker"
          onClick={() => {
            onSelectTool("icon")
            setShowIconPicker((prev) => !prev)
            setShowPalette(false)
          }}
          className={cn(
            "flex size-7 items-center justify-center rounded-lg transition-colors",
            activeTool === "icon"
              ? "border border-cyan-400/40 bg-cyan-400/20 text-cyan-300 shadow-[0_0_10px_rgba(0,240,255,0.3)]"
              : "text-slate-400 hover:bg-white/[0.06] hover:text-white",
          )}
        >
          {selectedIconType === "flag" && <Flag className="size-4" />}
          {selectedIconType === "star" && <Star className="size-4" />}
          {selectedIconType === "alert" && <AlertTriangle className="size-4" />}
          {selectedIconType === "target" && <Target className="size-4" />}
          {selectedIconType === "thumbsUp" && <ThumbsUp className="size-4" />}
        </button>

        {showIconPicker && (
          <div className="absolute left-9 top-0 z-40 flex items-center gap-1 rounded-xl border border-white/[0.1] bg-[#0c131c] p-1.5 shadow-xl">
            {(["flag", "star", "alert", "target", "thumbsUp"] as const).map((ic) => (
              <button
                key={ic}
                type="button"
                onClick={() => {
                  onSelectIconType(ic)
                  onSelectTool("icon")
                  setShowIconPicker(false)
                }}
                className={cn(
                  "flex size-6 items-center justify-center rounded p-1 transition-colors",
                  selectedIconType === ic ? "bg-cyan-400/30 text-cyan-200" : "text-slate-400 hover:text-white",
                )}
              >
                {ic === "flag" && <Flag className="size-3.5" />}
                {ic === "star" && <Star className="size-3.5" />}
                {ic === "alert" && <AlertTriangle className="size-3.5" />}
                {ic === "target" && <Target className="size-3.5" />}
                {ic === "thumbsUp" && <ThumbsUp className="size-3.5" />}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="my-0.5 h-px w-5 bg-white/[0.08]" />

      {/* Color Palette & Stroke Width Popover */}
      <div className="relative">
        <button
          type="button"
          title="Màu sắc và nét vẽ"
          onClick={() => {
            setShowPalette((prev) => !prev)
            setShowIconPicker(false)
          }}
          className="flex size-7 items-center justify-center rounded-lg text-slate-400 hover:bg-white/[0.06] hover:text-white transition-colors"
        >
          <div className="size-3.5 rounded-full border border-white/50" style={{ backgroundColor: activeColor }} />
        </button>

        {showPalette && (
          <div className="absolute left-9 top-0 z-40 w-36 rounded-xl border border-white/[0.1] bg-[#0c131c] p-2.5 shadow-2xl space-y-2">
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5 font-mono">
                Màu sắc
              </span>
              <div className="grid grid-cols-3 gap-1.5">
                {PALETTE_COLORS.map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    title={c.label}
                    onClick={() => {
                      onChangeColor(c.hex)
                      setShowPalette(false)
                    }}
                    className={cn(
                      "size-6 rounded-md border flex items-center justify-center transition-transform hover:scale-110",
                      activeColor === c.hex ? "border-white scale-110" : "border-white/20",
                    )}
                    style={{ backgroundColor: c.hex }}
                  />
                ))}
              </div>
            </div>

            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5 font-mono">
                Độ dày nét
              </span>
              <div className="flex items-center gap-1.5">
                {[1, 2, 3].map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => {
                      onChangeLineWidth(w)
                      setShowPalette(false)
                    }}
                    className={cn(
                      "flex-1 rounded py-0.5 text-[11px] font-mono font-bold transition-colors",
                      lineWidth === w ? "bg-cyan-400/20 text-cyan-300 border border-cyan-400/30" : "text-slate-400 hover:bg-white/[0.05]",
                    )}
                  >
                    {w}px
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Eraser Tool */}
      <button
        type="button"
        title="Tẩy nét vẽ (Click vào đối tượng để xoá)"
        onClick={() => {
          onSelectTool("eraser")
          setShowPalette(false)
          setShowIconPicker(false)
        }}
        className={cn(
          "flex size-7 items-center justify-center rounded-lg transition-colors",
          activeTool === "eraser"
            ? "border border-rose-400/40 bg-rose-400/20 text-rose-300 shadow-[0_0_10px_rgba(244,63,94,0.3)]"
            : "text-slate-400 hover:bg-white/[0.06] hover:text-white",
        )}
      >
        <Eraser className="size-4" />
      </button>

      <div className="my-0.5 h-px w-5 bg-white/[0.08]" />

      {/* Lock Objects Toggle */}
      <button
        type="button"
        title={isLocked ? "Mở khóa bản vẽ" : "Khóa tất cả hình vẽ"}
        onClick={onToggleLock}
        className={cn(
          "flex size-7 items-center justify-center rounded-lg transition-colors",
          isLocked
            ? "border border-amber-400/40 bg-amber-400/20 text-amber-300"
            : "text-slate-400 hover:bg-white/[0.06] hover:text-white",
        )}
      >
        {isLocked ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />}
      </button>

      {/* Hide Objects Toggle */}
      <button
        type="button"
        title={isHidden ? "Hiện tất cả hình vẽ" : "Ẩn tất cả hình vẽ"}
        onClick={onToggleHide}
        className={cn(
          "flex size-7 items-center justify-center rounded-lg transition-colors",
          isHidden
            ? "border border-purple-400/40 bg-purple-400/20 text-purple-300"
            : "text-slate-400 hover:bg-white/[0.06] hover:text-white",
        )}
      >
        {isHidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </button>

      {/* Clear All Drawings */}
      <button
        type="button"
        title="Xóa tất cả hình vẽ"
        onClick={onClearAll}
        className="flex size-7 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-500/20 hover:text-rose-300 transition-colors"
      >
        <Trash2 className="size-3.5" />
      </button>
    </aside>
  )
}
