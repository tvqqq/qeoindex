import type { ChartTimeframe } from "../stock-chart-types.ts"
import type { DrawingVisibility } from "./drawing-types.ts"

export interface DrawingVisibilityMetadata {
  sourceTimeframe?: ChartTimeframe
  visibility?: DrawingVisibility
}

/**
 * Runtime visibility gate for persisted drawings.
 *
 * Global drawings are visible on every timeframe. Source-scoped drawings are
 * rendered only on the timeframe where they were created. Missing legacy
 * metadata stays visible so migration never hides user content silently.
 */
export function isDrawingVisibleOnTimeframe(
  drawing: DrawingVisibilityMetadata,
  timeframe: ChartTimeframe,
): boolean {
  if (drawing.visibility !== "source-timeframe") return true
  if (!drawing.sourceTimeframe) return true
  return drawing.sourceTimeframe === timeframe
}
