"use client"

import React, { useState } from "react"
import { Check, Type, X } from "lucide-react"
import { cn } from "@/modules/shared/ui/cn"

interface TextEditorProps {
  initialText: string
  initialColor?: string
  initialFontSize?: number
  position: { x: number; y: number }
  containerWidth: number
  containerHeight: number
  onSave: (text: string, color: string, fontSize: number) => void
  onCancel: () => void
  title?: string
}

const PALETTE_COLORS = ["#00f0ff", "#a855f7", "#10b981", "#f59e0b", "#f43f5e", "#ffffff"]
const FONT_SIZES = [11, 13, 16, 20]

export function StockChartTextEditor({
  initialText,
  initialColor = "#00f0ff",
  initialFontSize = 13,
  position,
  containerWidth,
  containerHeight,
  onSave,
  onCancel,
  title = "Soạn thảo văn bản biểu đồ",
}: TextEditorProps) {
  const [text, setText] = useState(initialText)
  const [color, setColor] = useState(initialColor)
  const [fontSize, setFontSize] = useState(initialFontSize)

  // Clamp positioning inside chart container
  const popoverWidth = 260
  const popoverHeight = 160
  const left = Math.min(Math.max(10, position.x), Math.max(10, containerWidth - popoverWidth - 10))
  const top = Math.min(Math.max(10, position.y), Math.max(10, containerHeight - popoverHeight - 10))

  const handleSave = () => {
    const trimmed = text.trim()
    if (!trimmed) return
    onSave(trimmed, color, fontSize)
  }

  return (
    <div
      className="absolute z-50 rounded-xl border border-cyan-400/40 bg-[#0a0f16]/95 p-3 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150"
      style={{ left: `${left}px`, top: `${top}px`, width: `${popoverWidth}px` }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between border-b border-white/[0.08] pb-2 mb-2">
        <span className="flex items-center gap-1.5 text-[11px] font-bold text-cyan-300 font-mono">
          <Type className="size-3.5" />
          {title}
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="text-slate-400 hover:text-white transition-colors"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* Input */}
      <textarea
        autoFocus
        rows={2}
        placeholder="Nhập nội dung ghi chú..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            handleSave()
          }
          if (e.key === "Escape") onCancel()
        }}
        className="w-full rounded-lg bg-black/60 px-2.5 py-1.5 text-xs text-white placeholder-slate-500 outline-none border border-white/15 focus:border-cyan-400 resize-none font-sans"
        style={{ color }}
      />

      {/* Font Size & Color Bar */}
      <div className="mt-2 flex items-center justify-between gap-2">
        {/* Color swatches */}
        <div className="flex items-center gap-1">
          {PALETTE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className={cn(
                "size-4 rounded-full border transition-transform",
                color === c ? "scale-125 border-white shadow-[0_0_6px_rgba(255,255,255,0.6)]" : "border-transparent opacity-70 hover:opacity-100",
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>

        {/* Font size pills */}
        <div className="flex items-center gap-1">
          {FONT_SIZES.map((sz) => (
            <button
              key={sz}
              type="button"
              onClick={() => setFontSize(sz)}
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-mono font-bold transition-colors",
                fontSize === sz
                  ? "bg-cyan-400/20 text-cyan-300 border border-cyan-400/40"
                  : "text-slate-400 hover:text-white",
              )}
            >
              {sz}
            </button>
          ))}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="mt-2.5 flex items-center justify-end gap-1.5 pt-1.5 border-t border-white/[0.06]">
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-2 py-1 text-[11px] text-slate-400 hover:text-white"
        >
          Hủy
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!text.trim()}
          className="flex items-center gap-1 rounded bg-cyan-500/20 border border-cyan-400/50 px-2.5 py-1 text-[11px] font-bold text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-40"
        >
          <Check className="size-3" />
          <span>Lưu</span>
        </button>
      </div>
    </div>
  )
}
