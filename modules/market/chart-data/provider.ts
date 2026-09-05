import "server-only"

import { fetchMinuteOhlcvRange } from "@/modules/market/providers/dnse/history"
import type { CanonicalOhlcvBar, ChartOhlcvRequest } from "./contract"

export interface ChartOhlcvProvider {
  fetch(input: ChartOhlcvRequest): Promise<CanonicalOhlcvBar[]>
}

export function createPrimaryChartOhlcvProvider(): ChartOhlcvProvider {
  return {
    async fetch(input) {
      if (input.resolution !== "1m") {
        throw new Error(`Primary chart provider does not fetch ${input.resolution}; canonical Daily is persisted separately`)
      }
      return fetchMinuteOhlcvRange(input.ticker, input.from, input.to)
    },
  }
}

/**
 * Future SSI FastConnect fallback implementations plug into this same interface.
 * QEO-92 intentionally does not fabricate a fallback when verified SSI runtime
 * credentials/coverage are unavailable.
 */
export type ChartOhlcvFallbackProvider = ChartOhlcvProvider
