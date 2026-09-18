export interface DrawingBounds {
  width: number
  height: number
}

export interface DrawingCoordinate {
  x: number
  y: number
}

export function clampDrawingCoordinate(value: number, maximum: number): number {
  const safeMaximum = Number.isFinite(maximum) ? Math.max(0, maximum) : 0
  const safeValue = Number.isFinite(value) ? value : 0
  return Math.min(safeMaximum, Math.max(0, safeValue))
}

export function clampDrawingPoint(point: DrawingCoordinate, bounds: DrawingBounds): DrawingCoordinate {
  return {
    x: clampDrawingCoordinate(point.x, bounds.width),
    y: clampDrawingCoordinate(point.y, bounds.height),
  }
}

export function isInsideDrawingBounds(point: DrawingCoordinate, bounds: DrawingBounds): boolean {
  return Number.isFinite(point.x)
    && Number.isFinite(point.y)
    && point.x >= 0
    && point.y >= 0
    && point.x <= bounds.width
    && point.y <= bounds.height
}

export function hasCanonicalDrawingAnchor(point: { time?: number; price?: number }): boolean {
  return typeof point.time === "number"
    && Number.isFinite(point.time)
    && typeof point.price === "number"
    && Number.isFinite(point.price)
}
