import "server-only"

import { fetchMinuteOhlcvRange } from "@/modules/market/providers/dnse/history"
import { createSsiIboardProbeProvider } from "@/modules/market/provider-benchmark/providers/ssi-iboard"
import type { CanonicalChartOhlcvRequest, CanonicalOhlcvBar } from "./contract"

export interface ChartOhlcvProviderResult {
  provider: string
  bars: CanonicalOhlcvBar[]
}

export interface ChartOhlcvProvider {
  fetch(input: CanonicalChartOhlcvRequest): Promise<CanonicalOhlcvBar[] | ChartOhlcvProviderResult>
}

function providerOrder() {
  const configured = (process.env.CHART_OHLC_PROVIDER_ORDER ?? "SSI_IBOARD,DNSE")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter((value) => value === "SSI_IBOARD" || value === "DNSE")
  return configured.length ? [...new Set(configured)] : ["SSI_IBOARD", "DNSE"]
}

export function normalizeChartProviderResult(
  result: CanonicalOhlcvBar[] | ChartOhlcvProviderResult,
  fallbackProvider = "UNKNOWN",
): ChartOhlcvProviderResult {
  return Array.isArray(result) ? { provider: fallbackProvider, bars: result } : result
}

export function createPrimaryChartOhlcvProvider(): ChartOhlcvProvider {
  const ssi = createSsiIboardProbeProvider()
  return {
    async fetch(input) {
      if (input.resolution !== "1m") {
        throw new Error(`Primary chart provider does not fetch ${input.resolution}; canonical Daily is persisted separately`)
      }

      const failures: string[] = []
      for (const provider of providerOrder()) {
        try {
          if (provider === "SSI_IBOARD") {
            const result = await ssi.fetch(input)
            if (result.bars.length) return { provider, bars: result.bars }
            failures.push(`${provider}:EMPTY_COVERAGE`)
            continue
          }
          const bars = await fetchMinuteOhlcvRange(input.ticker, input.from, input.to)
          if (bars.length) return { provider: "DNSE", bars }
          failures.push("DNSE:EMPTY_COVERAGE")
        } catch (error) {
          const code = error && typeof error === "object" && "errorClass" in error
            ? String((error as { errorClass?: unknown }).errorClass || "ERROR")
            : "ERROR"
          failures.push(`${provider}:${code}`)
        }
      }
      throw new Error(`Chart OHLC provider waterfall exhausted (${failures.join(",")})`)
    },
  }
}

export type ChartOhlcvFallbackProvider = ChartOhlcvProvider
