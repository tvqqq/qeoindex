export interface OrderbookRect {
  x: number
  y: number
  width: number
  height: number
}

export const ORDERBOOK_SNAP_GAP = 12
// Keep the trade tape and the NĐTNN card side-by-side on laptop viewports.
export const ORDERBOOK_SNAP_MIN_SIDE_BY_SIDE_WIDTH = 750
// Includes header, depth, and the complete NĐTNN card at standard browser zoom.
export const ORDERBOOK_SNAP_MIN_FOREIGN_HEIGHT = 440

/**
 * Default to the bottom-right quarter. On compact screens, use the smallest
 * additional space needed for the foreign-flow card, without leaving viewport.
 */
export function getSnappedOrderbookRect(viewportWidth: number, viewportHeight: number): OrderbookRect {
  const availableWidth = Math.max(1, Math.floor(viewportWidth) - ORDERBOOK_SNAP_GAP * 2)
  const availableHeight = Math.max(1, Math.floor(viewportHeight) - ORDERBOOK_SNAP_GAP * 2)
  const width = Math.min(availableWidth, Math.max(Math.round(viewportWidth / 2), ORDERBOOK_SNAP_MIN_SIDE_BY_SIDE_WIDTH))
  const height = Math.min(availableHeight, Math.max(Math.round(viewportHeight / 2), ORDERBOOK_SNAP_MIN_FOREIGN_HEIGHT))

  return {
    x: Math.max(0, Math.floor(viewportWidth - width - ORDERBOOK_SNAP_GAP)),
    y: Math.max(0, Math.floor(viewportHeight - height - ORDERBOOK_SNAP_GAP)),
    width,
    height,
  }
}

export function clampOrderbookRectToViewport(
  rect: OrderbookRect,
  viewportWidth: number,
  viewportHeight: number,
): OrderbookRect {
  const width = Math.min(rect.width, Math.max(1, viewportWidth - ORDERBOOK_SNAP_GAP * 2))
  const height = Math.min(rect.height, Math.max(1, viewportHeight - ORDERBOOK_SNAP_GAP * 2))
  return {
    x: Math.max(0, Math.min(rect.x, viewportWidth - width - ORDERBOOK_SNAP_GAP)),
    y: Math.max(0, Math.min(rect.y, viewportHeight - height - ORDERBOOK_SNAP_GAP)),
    width,
    height,
  }
}
