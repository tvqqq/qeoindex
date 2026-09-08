"use client"

import React, { useEffect, useRef, useState } from "react"
import {
  AlertTriangle,
  Flag,
  Lock,
  Pencil,
  Star,
  Target,
  ThumbsUp,
  Trash2,
  Unlock,
} from "lucide-react"
import { cn } from "@/modules/shared/ui/cn"
import type { DrawingIconType, DrawingObject, DrawingPoint, DrawingTool } from "./stock-chart-types"

export type DrawingGestureState = "idle" | "creating" | "selected" | "body-drag" | "anchor-drag"

interface DrawingCanvasProps {
  width: number
  height: number
  drawings: DrawingObject[]
  selectedId: string | null
  onSelectDrawing: (id: string | null) => void
  onAddDrawing: (drawing: DrawingObject) => void
  onUpdateDrawing: (id: string, patch: Partial<DrawingObject>) => void
  onDeleteDrawing: (id: string) => void
  onEditText: (id: string) => void
  activeTool: DrawingTool
  activeColor: string
  lineWidth: number
  selectedIconType: DrawingIconType
  isLocked: boolean
  isHidden: boolean
  priceToY?: (price: number) => number | null | undefined
  yToPrice?: (y: number) => number | null | undefined
  timeToX?: (time: number) => number | null | undefined
  xToTime?: (x: number) => number | null | undefined
  drawingReady?: boolean
}

const PALETTE_COLORS = ["#00f0ff", "#a855f7", "#10b981", "#f59e0b", "#f43f5e", "#ffffff"]

function createDrawingId(): string {
  return `draw-${globalThis.crypto.randomUUID()}`
}

function roundCoordinate(value: number): number {
  return Math.round(value * 10) / 10
}

export function StockChartDrawingCanvas({
  width,
  height,
  drawings,
  selectedId,
  onSelectDrawing,
  onAddDrawing,
  onUpdateDrawing,
  onDeleteDrawing,
  onEditText,
  activeTool,
  activeColor,
  lineWidth,
  selectedIconType,
  isLocked,
  isHidden,
  priceToY,
  yToPrice,
  timeToX,
  xToTime,
  drawingReady = true,
}: DrawingCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null)

  // Active drawing state for new shapes
  const [currentStart, setCurrentStart] = useState<DrawingPoint | null>(null)
  const [currentEnd, setCurrentEnd] = useState<DrawingPoint | null>(null)
  const [gestureState, setGestureState] = useState<DrawingGestureState>("idle")

  // Dragging state for existing shapes / handles
  const [dragState, setDragState] = useState<{
    drawingId: string
    handleIndex: number | null // null = whole body drag; 0/1 = point index
    startX: number
    startY: number
    originalPoints: DrawingPoint[]
  } | null>(null)

  // Keyboard shortcut for deleting selected drawing
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229 || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      const target = e.target instanceof Element ? e.target : null
      if (target?.closest('input, textarea, select, [contenteditable], [role="textbox"], dialog, [role="dialog"], [aria-modal="true"]')) return
      if (e.key === "Escape") {
        setCurrentStart(null)
        setCurrentEnd(null)
        setDragState(null)
        setGestureState("idle")
        onSelectDrawing(null)
        return
      }
      if (!drawingReady || !selectedId || isLocked) return
      if (e.key === "Delete" || e.key === "Backspace") {
        if (drawings.find((drawing) => drawing.id === selectedId)?.locked) return
        e.preventDefault()
        onDeleteDrawing(selectedId)
        onSelectDrawing(null)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [drawingReady, drawings, selectedId, isLocked, onDeleteDrawing, onSelectDrawing])

  if (isHidden) return null

  const createRuntimePoint = (
    x: number,
    y: number,
    fallback?: DrawingPoint,
  ): DrawingPoint => {
    const px = roundCoordinate(x)
    const py = roundCoordinate(y)
    const next: DrawingPoint = { x: px, y: py }

    const convertedTime = xToTime?.(px)
    if (typeof convertedTime === "number" && Number.isFinite(convertedTime)) {
      next.time = convertedTime
    } else if (fallback?.time !== undefined && Number.isFinite(fallback.time)) {
      next.time = fallback.time
    }

    const convertedPrice = yToPrice?.(py)
    if (typeof convertedPrice === "number" && Number.isFinite(convertedPrice)) {
      next.price = convertedPrice
    } else if (fallback?.price !== undefined && Number.isFinite(fallback.price)) {
      next.price = fallback.price
    }

    return next
  }

  // Coordinate transforms
  const getSvgCoordinates = (e: { clientX: number; clientY: number }): DrawingPoint => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const rect = svg.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 }
    const x = ((e.clientX - rect.left) / rect.width) * width
    const y = ((e.clientY - rect.top) / rect.height) * height
    return createRuntimePoint(x, y)
  }

  // Convert point time/price to current screen coordinates if available.
  // Canonical market coordinates always win over stale runtime x/y values.
  const resolvePoint = (pt: DrawingPoint): { x: number; y: number } => {
    let x = pt.x
    let y = pt.y
    if (pt.time !== undefined && timeToX) {
      const computedX = timeToX(pt.time)
      if (typeof computedX === "number" && Number.isFinite(computedX)) x = computedX
    }
    if (pt.price !== undefined && priceToY) {
      const computedY = priceToY(pt.price)
      if (typeof computedY === "number" && Number.isFinite(computedY)) y = computedY
    }
    return { x, y }
  }

  const resolveRayEnd = (
    start: { x: number; y: number },
    directionPoint: { x: number; y: number },
  ): { x: number; y: number } => {
    const dx = directionPoint.x - start.x
    const dy = directionPoint.y - start.y
    if (Math.abs(dx) < 0.0001 && Math.abs(dy) < 0.0001) return directionPoint

    const candidates: number[] = []
    if (dx > 0) candidates.push((width - start.x) / dx)
    if (dx < 0) candidates.push((0 - start.x) / dx)
    if (dy > 0) candidates.push((height - start.y) / dy)
    if (dy < 0) candidates.push((0 - start.y) / dy)

    const t = Math.min(...candidates.filter((value) => Number.isFinite(value) && value >= 1))
    if (!Number.isFinite(t)) return directionPoint

    return {
      x: start.x + dx * t,
      y: start.y + dy * t,
    }
  }

  const twoPointTool = activeTool === "trendline"
    || activeTool === "arrow"
    || activeTool === "ray"
    || activeTool === "rectangle"
    || activeTool === "circle"

  const commitTwoPointDrawing = (first: DrawingPoint, second: DrawingPoint) => {
    const dist = Math.hypot(second.x - first.x, second.y - first.y)
    if (dist <= 3) return
    const newId = createDrawingId()
    onAddDrawing({
      id: newId,
      tool: activeTool,
      points: [first, second],
      color: activeColor,
      lineWidth,
    })
    onSelectDrawing(newId)
    setGestureState("selected")
  }

  // Two-point tools use click-click creation. This keeps the first canonical
  // time/price anchor stable while the pointer renders a live preview.
  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drawingReady || isLocked) return
    if (activeTool === "eraser") return

    if (activeTool === "cursor") {
      if (e.target === e.currentTarget) onSelectDrawing(null)
      return
    }

    const point = getSvgCoordinates(e)

    if (twoPointTool) {
      if (currentStart) {
        commitTwoPointDrawing(currentStart, point)
        setCurrentStart(null)
        setCurrentEnd(null)
      } else {
        setCurrentStart(point)
        setCurrentEnd(point)
        setGestureState("creating")
        e.currentTarget.setPointerCapture(e.pointerId)
      }
      return
    }

    if (activeTool === "horizontal") {
      onAddDrawing({
        id: createDrawingId(),
        tool: "horizontal",
        // A horizontal line only needs one canonical market anchor.
        points: [point],
        color: activeColor,
        lineWidth,
      })
      setGestureState("selected")
      return
    }

    if (activeTool === "icon") {
      onAddDrawing({
        id: createDrawingId(),
        tool: "icon",
        points: [point],
        color: activeColor,
        lineWidth,
        iconType: selectedIconType,
      })
      setGestureState("selected")
      return
    }

    if (activeTool === "text") {
      const newId = createDrawingId()
      onAddDrawing({
        id: newId,
        tool: "text",
        points: [point],
        color: activeColor,
        lineWidth,
        text: "Ghi chú mới",
        fontSize: 13,
      })
      onSelectDrawing(newId)
      onEditText(newId)
      setGestureState("selected")
      return
    }

    setCurrentStart(point)
    setCurrentEnd(point)
    setGestureState("creating")
  }

  // Mouse Move handler
  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drawingReady) return
    const coords = getSvgCoordinates(e)

    // Handle dragging existing shape or handle
    if (dragState) {
      const targetDraw = drawings.find((d) => d.id === dragState.drawingId)
      if (!targetDraw || targetDraw.locked) return

      const dx = coords.x - dragState.startX
      const dy = coords.y - dragState.startY

      if (dragState.handleIndex !== null) {
        // Dragging one endpoint
        const newPoints = dragState.originalPoints.map((p, idx) => {
          if (idx === dragState.handleIndex) {
            return createRuntimePoint(coords.x, coords.y, p)
          }
          return p
        })
        onUpdateDrawing(dragState.drawingId, { points: newPoints })
      } else {
        // Dragging entire shape. Horizontal lines retain their timestamp because
        // only the price dimension is meaningful for viewport-wide rendering.
        const newPoints = dragState.originalPoints.map((p) => {
          const resolved = resolvePoint(p)
          const newX = targetDraw.tool === "horizontal" ? resolved.x : resolved.x + dx
          const newY = resolved.y + dy
          return createRuntimePoint(newX, newY, p)
        })
        onUpdateDrawing(dragState.drawingId, { points: newPoints })
      }
      setGestureState(dragState.handleIndex === null ? "body-drag" : "anchor-drag")
      return
    }

    // Creating new shape
    if (currentStart && !isLocked && twoPointTool) {
      setCurrentEnd(coords)
    }
  }

  // Mouse Up handler
  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drawingReady) {
      setCurrentStart(null)
      setCurrentEnd(null)
      setDragState(null)
      setGestureState("idle")
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
      return
    }
    if (dragState) {
      setDragState(null)
      setGestureState(selectedId ? "selected" : "idle")
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
      return
    }

    // Two-point objects commit on the second click, so mouse-up only closes a
    // native drag path and leaves the preview visible between clicks.
    if (twoPointTool) {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
      return
    }

    if (!currentStart || !currentEnd || isLocked) {
      setCurrentStart(null)
      setCurrentEnd(null)
      setGestureState("idle")
      return
    }

    const dist = Math.hypot(currentEnd.x - currentStart.x, currentEnd.y - currentStart.y)
    if (dist > 5) {
      const newId = createDrawingId()
      onAddDrawing({
        id: newId,
        tool: activeTool,
        points: [currentStart, currentEnd],
        color: activeColor,
        lineWidth,
      })
      onSelectDrawing(newId)
      setGestureState("selected")
    }

    setCurrentStart(null)
    setCurrentEnd(null)
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

  const selectedDrawing = drawings.find((d) => d.id === selectedId)

  return (
    <>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="absolute inset-0 z-20 size-full select-none"
        style={{
          // Leave the chart's native pan/zoom/crosshair handlers in charge when
          // the cursor tool is selected. Drawing gestures opt into the overlay.
          pointerEvents: !drawingReady || activeTool === "cursor" ? "none" : "auto",
          cursor:
            dragState
              ? "grabbing"
              : activeTool === "eraser"
              ? "crosshair"
              : activeTool === "text"
              ? "text"
              : activeTool === "icon"
              ? "cell"
              : activeTool !== "cursor"
              ? "crosshair"
              : "default",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        data-drawing-gesture={gestureState}
      >
        <defs>
          <marker
            id="arrow-marker"
            viewBox="0 0 10 10"
            refX="5"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill={activeColor} />
          </marker>
        </defs>

        {/* Existing Drawings */}
        {drawings.map((draw) => {
          if (draw.hidden) return null

          const rawP1 = draw.points[0]
          const rawP2 = draw.points[1] || rawP1
          if (!rawP1) return null

          const p1 = resolvePoint(rawP1)
          const p2 = resolvePoint(rawP2)
          const lineEnd =
            draw.tool === "horizontal"
              ? { x: width, y: p1.y }
              : draw.tool === "ray"
              ? resolveRayEnd(p1, p2)
              : p2
          const lineStart = draw.tool === "horizontal" ? { x: 0, y: p1.y } : p1
          const isSelected = selectedId === draw.id

          const handleClickDrawing = (e: React.MouseEvent) => {
            e.stopPropagation()
            if (!drawingReady) return
            if (activeTool === "eraser" && !isLocked && !draw.locked) {
              onDeleteDrawing(draw.id)
              if (selectedId === draw.id) onSelectDrawing(null)
              return
            }
            if (activeTool === "cursor") {
              onSelectDrawing(draw.id)
            }
          }

          const handleDoubleClickDrawing = (e: React.MouseEvent) => {
            e.stopPropagation()
            if (!drawingReady) return
            if (draw.tool === "text") {
              onEditText(draw.id)
            }
          }

          const handleStartBodyDrag = (e: React.PointerEvent) => {
            if (!drawingReady || activeTool !== "cursor" || draw.locked || isLocked) return
            e.stopPropagation()
            svgRef.current?.setPointerCapture(e.pointerId)
            onSelectDrawing(draw.id)
            const coords = getSvgCoordinates(e)
            setDragState({
              drawingId: draw.id,
              handleIndex: null,
              startX: coords.x,
              startY: coords.y,
              originalPoints: draw.points,
            })
          }

          return (
            <g
              key={draw.id}
              onClick={handleClickDrawing}
              onDoubleClick={handleDoubleClickDrawing}
              onPointerDown={handleStartBodyDrag}
              className={cn(
                activeTool === "eraser" && !draw.locked
                  ? "cursor-pointer hover:opacity-50"
                  : activeTool === "cursor" && !draw.locked
                  ? "cursor-grab"
                  : "",
              )}
              // In cursor mode the SVG root is transparent to native LWC, but
              // each drawing remains an interactive hit target for selection and
              // body dragging. Drawing tools make the whole layer interactive.
              style={{ pointerEvents: drawingReady ? "auto" : "none" }}
            >
              {/* Trendline / Horizontal / Ray */}
              {(draw.tool === "trendline" || draw.tool === "horizontal" || draw.tool === "ray") && (
                <>
                  {/* Invisible fat hit area for easy clicking */}
                  <line
                    x1={lineStart.x}
                    y1={lineStart.y}
                    x2={lineEnd.x}
                    y2={lineEnd.y}
                    stroke="transparent"
                    strokeWidth={Math.max(12, draw.lineWidth + 8)}
                  />
                  {/* Selection glow if selected */}
                  {isSelected && (
                    <line
                      x1={lineStart.x}
                      y1={lineStart.y}
                      x2={lineEnd.x}
                      y2={lineEnd.y}
                      stroke="#00f0ff"
                      strokeWidth={draw.lineWidth + 4}
                      strokeOpacity="0.4"
                      strokeLinecap="round"
                    />
                  )}
                  <line
                    x1={lineStart.x}
                    y1={lineStart.y}
                    x2={lineEnd.x}
                    y2={lineEnd.y}
                    stroke={draw.color}
                    strokeWidth={draw.lineWidth}
                    strokeLinecap="round"
                  />
                </>
              )}

              {/* Arrow */}
              {draw.tool === "arrow" && (
                <>
                  <line
                    x1={p1.x}
                    y1={p1.y}
                    x2={p2.x}
                    y2={p2.y}
                    stroke="transparent"
                    strokeWidth={Math.max(12, draw.lineWidth + 8)}
                  />
                  {isSelected && (
                    <line
                      x1={p1.x}
                      y1={p1.y}
                      x2={p2.x}
                      y2={p2.y}
                      stroke="#00f0ff"
                      strokeWidth={draw.lineWidth + 4}
                      strokeOpacity="0.4"
                      strokeLinecap="round"
                    />
                  )}
                  <line
                    x1={p1.x}
                    y1={p1.y}
                    x2={p2.x}
                    y2={p2.y}
                    stroke={draw.color}
                    strokeWidth={draw.lineWidth}
                    markerEnd="url(#arrow-marker)"
                    strokeLinecap="round"
                  />
                </>
              )}

              {/* Rectangle */}
              {draw.tool === "rectangle" && (
                <>
                  <rect
                    x={Math.min(p1.x, p2.x)}
                    y={Math.min(p1.y, p2.y)}
                    width={Math.abs(p2.x - p1.x)}
                    height={Math.abs(p2.y - p1.y)}
                    fill={draw.color}
                    fillOpacity={isSelected ? "0.22" : "0.12"}
                    stroke={isSelected ? "#00f0ff" : draw.color}
                    strokeWidth={isSelected ? draw.lineWidth + 1 : draw.lineWidth}
                    strokeDasharray={isSelected ? "3 3" : "none"}
                  />
                </>
              )}

              {/* Circle / Ellipse */}
              {draw.tool === "circle" && (
                <>
                  <ellipse
                    cx={(p1.x + p2.x) / 2}
                    cy={(p1.y + p2.y) / 2}
                    rx={Math.abs(p2.x - p1.x) / 2}
                    ry={Math.abs(p2.y - p1.y) / 2}
                    fill={draw.color}
                    fillOpacity={isSelected ? "0.2" : "0.1"}
                    stroke={isSelected ? "#00f0ff" : draw.color}
                    strokeWidth={isSelected ? draw.lineWidth + 1 : draw.lineWidth}
                    strokeDasharray={isSelected ? "3 3" : "none"}
                  />
                </>
              )}

              {/* Text */}
              {draw.tool === "text" && (
                <g>
                  {isSelected && (
                    <rect
                      x={p1.x - 4}
                      y={p1.y - (draw.fontSize || 13) - 2}
                      width={Math.max(60, (draw.text?.length || 5) * 8 + 8)}
                      height={(draw.fontSize || 13) + 8}
                      fill="rgba(0,240,255,0.15)"
                      stroke="#00f0ff"
                      strokeWidth="1"
                      strokeDasharray="2 2"
                      rx="3"
                    />
                  )}
                  <text
                    x={p1.x}
                    y={p1.y}
                    fill={draw.color}
                    fontSize={draw.fontSize || 13}
                    fontFamily="sans-serif"
                    fontWeight="bold"
                  >
                    {draw.text}
                  </text>
                </g>
              )}

              {/* Icon Sticker */}
              {draw.tool === "icon" && (
                <g
                  transform={`translate(${p1.x - 8}, ${p1.y - 8})`}
                  className={isSelected ? "" : ""}
                >
                  {renderIcon(draw.iconType)}
                </g>
              )}

              {/* Anchor Handles when SELECTED */}
              {isSelected && !draw.locked && !isLocked && (
                <>
                  {/* Point 0 Handle */}
                  <circle
                    cx={p1.x}
                    cy={p1.y}
                    r="4.5"
                    fill="#ffffff"
                    stroke="#00f0ff"
                    strokeWidth="2"
                    className="cursor-nwse-resize"
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      svgRef.current?.setPointerCapture(e.pointerId)
                      const coords = getSvgCoordinates(e)
                      setDragState({
                        drawingId: draw.id,
                        handleIndex: 0,
                        startX: coords.x,
                        startY: coords.y,
                        originalPoints: draw.points,
                      })
                    }}
                  />
                  {/* Point 1 Handle (if 2-point object) */}
                  {draw.tool !== "icon" && draw.tool !== "text" && draw.tool !== "horizontal" && (
                    <circle
                      cx={p2.x}
                      cy={p2.y}
                      r="4.5"
                      fill="#ffffff"
                      stroke="#00f0ff"
                      strokeWidth="2"
                      className="cursor-nwse-resize"
                      onPointerDown={(e) => {
                        e.stopPropagation()
                        svgRef.current?.setPointerCapture(e.pointerId)
                        const coords = getSvgCoordinates(e)
                        setDragState({
                          drawingId: draw.id,
                          handleIndex: 1,
                          startX: coords.x,
                          startY: coords.y,
                          originalPoints: draw.points,
                        })
                      }}
                    />
                  )}
                </>
              )}
            </g>
          )
        })}

        {/* Temporary Shape currently being drawn */}
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
            {activeTool === "ray" && (() => {
              const rayEnd = resolveRayEnd(currentStart, currentEnd)
              return (
                <line
                  x1={currentStart.x}
                  y1={currentStart.y}
                  x2={rayEnd.x}
                  y2={rayEnd.y}
                  stroke={activeColor}
                  strokeWidth={lineWidth}
                  strokeDasharray="4 4"
                />
              )
            })()}
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
                fillOpacity="0.12"
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
                fillOpacity="0.12"
                stroke={activeColor}
                strokeWidth={lineWidth}
                strokeDasharray="4 4"
              />
            )}
          </>
        )}
      </svg>

      {/* Floating Action Bar for Selected Drawing Object */}
      {selectedDrawing && activeTool === "cursor" && (
        (() => {
          const pt = resolvePoint(selectedDrawing.points[0] || { x: width / 2, y: 50 })
          const barLeft = Math.min(Math.max(20, pt.x - 60), width - 220)
          const barTop = Math.max(10, pt.y - 42)

          return (
            <div
              className="absolute z-40 flex items-center gap-1 rounded-xl border border-cyan-400/40 bg-[#0a0f16]/95 p-1 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-100"
              style={{ left: `${barLeft}px`, top: `${barTop}px` }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Color swatches */}
              <div className="flex items-center gap-0.5 px-1">
                {PALETTE_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    title="Đổi màu đối tượng"
                    onClick={() => onUpdateDrawing(selectedDrawing.id, { color: c })}
                    className={cn(
                      "size-3.5 rounded-full border transition-transform hover:scale-125",
                      selectedDrawing.color === c ? "border-white scale-110" : "border-white/20",
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>

              <div className="h-3.5 w-px bg-white/10 mx-0.5" />

              {/* Line width toggle (1, 2, 3) */}
              {selectedDrawing.tool !== "icon" && selectedDrawing.tool !== "text" && (
                <div className="flex items-center gap-0.5">
                  {[1, 2, 3].map((w) => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => onUpdateDrawing(selectedDrawing.id, { lineWidth: w })}
                      className={cn(
                        "rounded px-1 text-[10px] font-mono font-bold transition-colors",
                        selectedDrawing.lineWidth === w
                          ? "bg-cyan-400/20 text-cyan-300 font-black"
                          : "text-slate-400 hover:text-white",
                      )}
                    >
                      {w}px
                    </button>
                  ))}
                </div>
              )}

              {/* Edit text button */}
              {selectedDrawing.tool === "text" && (
                <button
                  type="button"
                  title="Sửa nội dung văn bản"
                  onClick={() => onEditText(selectedDrawing.id)}
                  className="rounded p-1 text-cyan-300 hover:bg-white/[0.06] transition-colors"
                >
                  <Pencil className="size-3" />
                </button>
              )}

              {/* Lock toggle */}
              <button
                type="button"
                title={selectedDrawing.locked ? "Mở khóa" : "Khóa vị trí"}
                onClick={() => onUpdateDrawing(selectedDrawing.id, { locked: !selectedDrawing.locked })}
                className={cn(
                  "rounded p-1 transition-colors",
                  selectedDrawing.locked ? "text-amber-400" : "text-slate-400 hover:text-white",
                )}
              >
                {selectedDrawing.locked ? <Lock className="size-3" /> : <Unlock className="size-3" />}
              </button>

              {/* Delete button */}
              <button
                type="button"
                title="Xóa đối tượng (Delete)"
                onClick={() => {
                  onDeleteDrawing(selectedDrawing.id)
                  onSelectDrawing(null)
                }}
                className="rounded p-1 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          )
        })()
      )}
    </>
  )
}
