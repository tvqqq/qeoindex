import type { ChartTimeframe } from "../stock-chart-types.ts"

export type DrawingSchemaVersion = 2

export interface MarketAnchor {
  time: number
  price: number
}

export type DrawingVisibility = "global" | "source-timeframe"

export type DrawingToolType =
  | "trendline"
  | "arrow"
  | "horizontal"
  | "ray"
  | "rectangle"
  | "circle"
  | "text"
  | "icon"

export type DrawingIconType = "flag" | "star" | "alert" | "target" | "thumbsUp"

export interface DrawingStyle {
  color: string
  lineWidth: number
  fontSize?: number
}

export interface PersistedDrawingV2 {
  schemaVersion: 2
  id: string
  tool: DrawingToolType
  anchors: MarketAnchor[]
  sourceTimeframe: ChartTimeframe
  visibility: DrawingVisibility
  style: DrawingStyle
  text?: string
  iconType?: DrawingIconType
  locked?: boolean
  hidden?: boolean
  createdAt?: string
  updatedAt?: string
}

export interface ScreenPoint {
  x: number
  y: number
}

export interface CoordinateAdapter {
  priceToY?: (price: number) => number | null | undefined
  yToPrice?: (y: number) => number | null | undefined
  timeToX?: (time: number) => number | null | undefined
  xToTime?: (x: number) => number | null | undefined
}

export interface ProjectedDrawing {
  drawing: PersistedDrawingV2
  projectedAnchors: (ScreenPoint | null)[]
}

/**
 * Project a canonical market anchor (time + price) to screen coordinates (x + y).
 * Returns null if adapter is missing required transform functions or if output is non-finite.
 */
export function projectAnchor(
  anchor: MarketAnchor,
  adapter: CoordinateAdapter,
): ScreenPoint | null {
  if (!adapter.timeToX || !adapter.priceToY) return null
  if (!Number.isFinite(anchor.time) || !Number.isFinite(anchor.price)) return null

  const x = adapter.timeToX(anchor.time)
  const y = adapter.priceToY(anchor.price)

  if (x === null || x === undefined || !Number.isFinite(x)) return null
  if (y === null || y === undefined || !Number.isFinite(y)) return null

  return {
    x: Math.round(x * 10) / 10,
    y: Math.round(y * 10) / 10,
  }
}

/**
 * Convert ephemeral screen coordinates (x + y) to a canonical market anchor (time + price).
 * Returns null if adapter is missing required transform functions or if output is non-finite.
 */
export function screenPointToAnchor(
  point: ScreenPoint,
  adapter: CoordinateAdapter,
): MarketAnchor | null {
  if (!adapter.xToTime || !adapter.yToPrice) return null
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null

  const time = adapter.xToTime(point.x)
  const price = adapter.yToPrice(point.y)

  if (time === null || time === undefined || !Number.isFinite(time)) return null
  if (price === null || price === undefined || !Number.isFinite(price)) return null

  return { time, price }
}
