import type { OhlcvBar } from "@/modules/shared/technical/indicators"
import {
  aggregateChartTimeframe,
  canonicalSourceResolution,
} from "../../../modules/market/chart-data/timeframes.ts"
import type { ChartTimeframe } from "./stock-chart-types"

/**
 * Compatibility adapter for the existing SVG chart surface.
 *
 * QEO-93 production callers pass server-resolved timeframe bars through the
 * second argument. When those bars are present this function is deliberately a
 * no-op: no client-side provider/storage branching and no second aggregation.
 *
 * The Daily-only fallback remains deterministic for SSR/legacy tests. Intraday
 * resolutions fail closed unless server-resolved bars are supplied.
 */
export function aggregateBarsByTimeframe(
  dailyBars: OhlcvBar[],
  resolvedTimeframeBars: OhlcvBar[] | undefined,
  timeframe: ChartTimeframe,
): OhlcvBar[] {
  if (resolvedTimeframeBars?.length) return resolvedTimeframeBars
  if (canonicalSourceResolution(timeframe) === "1m") return []
  return aggregateChartTimeframe(dailyBars || [], timeframe)
}
