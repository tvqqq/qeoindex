"use client"

import React, { useState } from "react"
import { AlertTriangle, Flag, Star, Target, ThumbsUp } from "lucide-react"
import type { DrawingIconType, DrawingObject, DrawingPoint, DrawingTool } from "./stock-chart-types"

interface DrawingCanvasProps {
  width: number
  height: number
  drawings: DrawingObject[]
  onAddDrawing: (drawing: DrawingObject) => void
  onDeleteDrawing: (id: string) => void
  activeTool: DrawingTool
  activeColor: string
  lineWidth: number
  selectedIconType: DrawingIconType
  isLocked: boolean
  isHidden: boolean
}

export function StockChartDrawingCanvas({
  width,
  height,
  drawings,
  onAddDrawing,
  onDeleteDrawing,
  activeTool,
  activeColor,
  lineWidth,
  selectedIconType,
  isLocked,
  isHidden,
}: DrawingCanvasProps) {
  const [currentStart, setCurrentStart] = useState<DrawingPoint | null>(null)
  const [currentEnd, setCurrentEnd] = useState<DrawingPoint | null>(null)
  const [textPrompt, setTextPrompt] = useState<{ x: number; y: number; value: string } | null>(null)

  if (isHidden) return null

  const getSvgCoordinates = (e: React.MouseEvent<SVGSVGElement>): DrawingPoint => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * width
    const y = ((e.clientY - rect.top) / rect.height) * height
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }
  }

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (isLocked || activeTool === "cursor" || activeTool === "eraser") return

    const point = getSvgCoordinates(e)

    if (activeTool === "horizontal") {
      onAddDrawing({
        id: `draw-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        tool: "horizontal",
        points: [
          { x: 0, y: point.y },
          { x: width, y: point.y },
        ],
        color: activeColor,
        lineWidth,
      })
      return
    }

    if (activeTool === "icon") {
      onAddDrawing({
        id: `draw-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        tool: "icon",
        points: [point],
        color: activeColor,
        lineWidth,
        iconType: selectedIconType,
      })
      return
    }

    if (activeTool === "text") {
      setTextPrompt({ x: point.x, y: point.y, value: "" })
      return
    }

    setCurrentStart(point)
    setCurrentEnd(point)
  }

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!currentStart || isLocked) return
    setCurrentEnd(getSvgCoordinates(e))
  }

  const handleMouseUp = () => {
    if (!currentStart || !currentEnd || isLocked) {
      setCurrentStart(null)
      setCurrentEnd(null)
      return
    }

    // Don't add tiny accidental clicks
    const dist = Math.hypot(currentEnd.x - currentStart.x, currentEnd.y - currentStart.y)
    if (dist > 4) {
      onAddDrawing({
        id: `draw-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        tool: activeTool,
        points: [currentStart, currentEnd],
        color: activeColor,
        lineWidth,
      })
    }

    setCurrentStart(null)
    setCurrentEnd(null)
  }

  const submitTextPrompt = () => {
    if (textPrompt && textPrompt.value.trim()) {
      onAddDrawing({
        id: `draw-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        tool: "text",
        points: [{ x: textPrompt.x, y: textPrompt.y }],
        color: activeColor,
        lineWidth,
        text: textPrompt.value.trim(),
      })
    }
    setTextPrompt(null)
  }

  const renderIcon = (type?: DrawingIconType) => {
    switch (type) {
      case "star":
        return <Star className="size-4 fill-amber-400 text-amber-400" />
      case "alert":
        return <AlertTriangle className="size-4 fill-rose-500 text-rose-500" />
      case "target":
        return <Target className="size-4 text-cyan-400" />
      case "thumbsUp":
        return <ThumbsUp className="size-4 fill-emerald-400 text-emerald-400" />
      default:
        return <Flag className="size-4 fill-cyan-400 text-cyan-400" />
    }
  }

  return (
    <>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="absolute inset-0 size-full select-none"
        style={{
          pointerEvents: activeTool === "cursor" ? "none" : "auto",
          cursor:
            activeTool === "eraser"
              ? "crosshair"
              : activeTool === "text"
              ? "text"
              : activeTool === "icon"
              ? "cell"
              : activeTool !== "cursor"
              ? "crosshair"
              : "default",
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        <defs>
          <marker id="arrow-marker" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill={activeColor} />
          </marker>
        </defs>

        {/* Existing Drawings */}
        {drawings.map((draw) => {
          const p1 = draw.points[0]
          const p2 = draw.points[1] || p1
          if (!p1) return null

          const handleClickDrawing = (e: React.MouseEvent) => {
            if (activeTool === "eraser" && !isLocked) {
              e.stopPropagation()
              onDeleteDrawing(draw.id)
            }
          }

          if (draw.tool === "trendline" || draw.tool === "horizontal") {
            return (
              <line
                key={draw.id}
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                stroke={draw.color}
                strokeWidth={draw.lineWidth}
                strokeLinecap="round"
                className={activeTool === "eraser" ? "cursor-pointer hover:stroke-rose-500" : ""}
                onClick={handleClickDrawing}
              />
            )
          }

          if (draw.tool === "arrow") {
            return (
              <line
                key={draw.id}
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                stroke={draw.color}
                strokeWidth={draw.lineWidth}
                markerEnd="url(#arrow-marker)"
                strokeLinecap="round"
                className={activeTool === "eraser" ? "cursor-pointer hover:stroke-rose-500" : ""}
                onClick={handleClickDrawing}
              />
            )
          }

          if (draw.tool === "rectangle") {
            const x = Math.min(p1.x, p2.x)
            const y = Math.min(p1.y, p2.y)
            const w = Math.abs(p2.x - p1.x)
            const h = Math.abs(p2.y - p1.y)
            return (
              <rect
                key={draw.id}
                x={x}
                y={y}
                width={w}
                height={h}
                fill={draw.color}
                fillOpacity="0.12"
                stroke={draw.color}
                strokeWidth={draw.lineWidth}
                className={activeTool === "eraser" ? "cursor-pointer hover:stroke-rose-500" : ""}
                onClick={handleClickDrawing}
              />
            )
          }

          if (draw.tool === "circle") {
            const rx = Math.abs(p2.x - p1.x) / 2
            const ry = Math.abs(p2.y - p1.y) / 2
            const cx = (p1.x + p2.x) / 2
            const cy = (p1.y + p2.y) / 2
            return (
              <ellipse
                key={draw.id}
                cx={cx}
                cy={cy}
                rx={rx}
                ry={ry}
                fill={draw.color}
                fillOpacity="0.1"
                stroke={draw.color}
                strokeWidth={draw.lineWidth}
                className={activeTool === "eraser" ? "cursor-pointer hover:stroke-rose-500" : ""}
                onClick={handleClickDrawing}
              />
            )
          }

          if (draw.tool === "text") {
            return (
              <text
                key={draw.id}
                x={p1.x}
                y={p1.y}
                fill={draw.color}
                fontSize="12"
                fontFamily="sans-serif"
                fontWeight="bold"
                className={activeTool === "eraser" ? "cursor-pointer hover:fill-rose-500" : ""}
                onClick={handleClickDrawing}
              >
                {draw.text}
              </text>
            )
          }

          if (draw.tool === "icon") {
            return (
              <g
                key={draw.id}
                transform={`translate(${p1.x - 8}, ${p1.y - 8})`}
                className={activeTool === "eraser" ? "cursor-pointer hover:opacity-50" : ""}
                onClick={handleClickDrawing}
              >
                {renderIcon(draw.iconType)}
              </g>
            )
          }

          return null
        })}

        {/* Temporary drawing shape currently being dragged */}
        {currentStart && currentEnd && (
          <>
            {activeTool === "trendline" && (
              <line
                x1={currentStart.x}
                y1={currentStart.y}
                x2={currentEnd.x}
                y2={currentEnd.y}
                stroke={activeColor}
                strokeWidth={lineWidth}
                strokeDasharray="4 4"
              />
            )}
            {activeTool === "arrow" && (
              <line
                x1={currentStart.x}
                y1={currentStart.y}
                x2={currentEnd.x}
                y2={currentEnd.y}
                stroke={activeColor}
                strokeWidth={lineWidth}
                markerEnd="url(#arrow-marker)"
              />
            )}
            {activeTool === "rectangle" && (
              <rect
                x={Math.min(currentStart.x, currentEnd.x)}
                y={Math.min(currentStart.y, currentEnd.y)}
                width={Math.abs(currentEnd.x - currentStart.x)}
                height={Math.abs(currentEnd.y - currentStart.y)}
                fill={activeColor}
                fillOpacity="0.1"
                stroke={activeColor}
                strokeWidth={lineWidth}
                strokeDasharray="4 4"
              />
            )}
            {activeTool === "circle" && (
              <ellipse
                cx={(currentStart.x + currentEnd.x) / 2}
                cy={(currentStart.y + currentEnd.y) / 2}
                rx={Math.abs(currentEnd.x - currentStart.x) / 2}
                ry={Math.abs(currentEnd.y - currentStart.y) / 2}
                fill={activeColor}
                fillOpacity="0.1"
                stroke={activeColor}
                strokeWidth={lineWidth}
                strokeDasharray="4 4"
              />
            )}
          </>
        )}
      </svg>

      {/* Text Tool Modal / Prompt */}
      {textPrompt && (
        <div
          className="absolute z-50 rounded-lg border border-cyan-400/40 bg-[#0a0f16]/95 p-2 shadow-2xl backdrop-blur-md"
          style={{
            left: `${Math.min(width - 200, Math.max(10, textPrompt.x))}px`,
            top: `${Math.min(height - 80, Math.max(10, textPrompt.y))}px`,
          }}
        >
          <input
            autoFocus
            type="text"
            placeholder="Nhập ghi chú biểu đồ..."
            value={textPrompt.value}
            onChange={(e) => setTextPrompt({ ...textPrompt, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitTextPrompt()
              if (e.key === "Escape") setTextPrompt(null)
            }}
            className="w-44 rounded bg-black/50 px-2 py-1 text-xs text-white outline-none border border-white/15 focus:border-cyan-400"
          />
          <div className="mt-1.5 flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setTextPrompt(null)}
              className="rounded px-2 py-0.5 text-[10px] text-slate-400 hover:text-white"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={submitTextPrompt}
              className="rounded bg-cyan-500/20 border border-cyan-400/40 px-2 py-0.5 text-[10px] font-bold text-cyan-200"
            >
              Thêm
            </button>
          </div>
        </div>
      )}
    </>
  )
}
