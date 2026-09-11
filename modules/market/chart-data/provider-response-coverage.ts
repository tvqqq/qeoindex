import type { CanonicalOhlcvBar } from "./contract"
import { detectTradingSessionGaps } from "./normalize"

/**
 * Closed provider reads must not be treated as terminal success when they
 * contain a missing minute inside a continuous Vietnam trading segment.
 * Session boundaries (lunch, ATC, weekends/holidays) remain governed by the
 * canonical gap detector rather than by naive timestamp arithmetic.
 */
export function closedProviderBarsAreComplete(bars: CanonicalOhlcvBar[]) {
  return bars.length > 0 && detectTradingSessionGaps(bars).length === 0
}
