import "server-only"

import { fetchMinuteOhlcvRange } from "@/modules/market/providers/dnse/history"
import { fetchVciMinuteOhlcvRange } from "@/modules/market/providers/vci/history"
import { createSsiIboardProbeProvider } from "@/modules/market/provider-benchmark/providers/ssi-iboard"
import type { CanonicalChartOhlcvRequest, CanonicalOhlcvBar } from "./contract"

export interface ChartOhlcvProviderResult {
  provider: string
  bars: CanonicalOhlcvBar[]
}

export interface ChartOhlcvProvider {
  fetch(input: CanonicalChartOhlcvRequest): Promise<CanonicalOhlcvBar[] | ChartOhlcvProviderResult>
}

type RuntimeProvider = "VCI" | "DNSE" | "SSI_IBOARD"

function providerOrder(): RuntimeProvider[] {
  const configured = (process.env.CHART_OHLC_PROVIDER_ORDER ?? "VCI,DNSE,SSI_IBOARD")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter((value): value is RuntimeProvider => value === "VCI" || value === "SSI_IBOARD" || value === "DNSE")
  return configured.length ? [...new Set(configured)] : ["VCI", "DNSE", "SSI_IBOARD"]
}

function providerFailureCode(error: unknown) {
  if (error && typeof error === "object" && "errorClass" in error) {
    return String((error as { errorClass?: unknown }).errorClass || "ERROR")
  }
  const message = error instanceof Error ? error.message.toLowerCase() : String(error ?? "").toLowerCase()
  if (/401|403|unauthorized|forbidden|signature/.test(message)) return "AUTH"
  if (/429|rate.?limit|too many/.test(message)) return "RATE_LIMIT"
  if (/abort|timeout|deadline|timed out/.test(message)) return "TIMEOUT"
  if (/no completed|no usable|empty/.test(message)) return "EMPTY_COVERAGE"
  if (/400|422|invalid request|bad request/.test(message)) return "INVALID_REQUEST"
  return "ERROR"
}

function logProviderEvent(input: CanonicalChartOhlcvRequest, provider: RuntimeProvider, event: "success" | "failure", detail: Record<string, unknown>) {
  const payload = {
    scope: "chart_ohlcv_provider",
    event,
    provider,
    ticker: input.ticker,
    resolution: input.resolution,
    requestedFrom: input.from,
    requestedTo: input.to,
    ...detail,
  }
  if (event === "success") console.info("[chart-ohlcv-provider]", payload)
  else console.warn("[chart-ohlcv-provider]", payload)
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
          let bars: CanonicalOhlcvBar[]
          if (provider === "VCI") {
            bars = await fetchVciMinuteOhlcvRange(input.ticker, input.from, input.to)
          } else if (provider === "SSI_IBOARD") {
            const result = await ssi.fetch(input)
            bars = result.bars
          } else {
            bars = await fetchMinuteOhlcvRange(input.ticker, input.from, input.to)
          }

          if (bars.length) {
            logProviderEvent(input, provider, "success", { rowCount: bars.length })
            return { provider, bars }
          }
          failures.push(`${provider}:EMPTY_COVERAGE`)
          logProviderEvent(input, provider, "failure", { errorClass: "EMPTY_COVERAGE" })
        } catch (error) {
          const code = providerFailureCode(error)
          failures.push(`${provider}:${code}`)
          logProviderEvent(input, provider, "failure", { errorClass: code })
        }
      }
      console.warn("[chart-ohlcv-provider]", {
        scope: "chart_ohlcv_provider",
        event: "waterfall_exhausted",
        ticker: input.ticker,
        resolution: input.resolution,
        requestedFrom: input.from,
        requestedTo: input.to,
        failures,
      })
      throw new Error(`Chart OHLC provider waterfall exhausted (${failures.join(",")})`)
    },
  }
}

export type ChartOhlcvFallbackProvider = ChartOhlcvProvider
