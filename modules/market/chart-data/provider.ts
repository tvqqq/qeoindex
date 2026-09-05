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
type ProviderFailureCode = "AUTH" | "RATE_LIMIT" | "TIMEOUT" | "NETWORK" | "EMPTY_COVERAGE" | "INVALID_REQUEST" | "ERROR"

const TRANSIENT_ATTEMPTS = 2
const RETRY_DELAY_MS = 250

function providerOrder(): RuntimeProvider[] {
  const configured = (process.env.CHART_OHLC_PROVIDER_ORDER ?? "VCI,DNSE,SSI_IBOARD")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter((value): value is RuntimeProvider => value === "VCI" || value === "SSI_IBOARD" || value === "DNSE")
  return configured.length ? [...new Set(configured)] : ["VCI", "DNSE", "SSI_IBOARD"]
}

function providerFailureCode(error: unknown): ProviderFailureCode {
  if (error && typeof error === "object" && "errorClass" in error) {
    return String((error as { errorClass?: unknown }).errorClass || "ERROR") as ProviderFailureCode
  }
  const message = error instanceof Error ? error.message.toLowerCase() : String(error ?? "").toLowerCase()
  if (/401|403|unauthorized|forbidden|signature/.test(message)) return "AUTH"
  if (/429|rate.?limit|too many/.test(message)) return "RATE_LIMIT"
  if (/abort|timeout|deadline|timed out/.test(message)) return "TIMEOUT"
  if (/network|socket|fetch failed|econn|enotfound|tls/.test(message)) return "NETWORK"
  if (/no completed|no usable|empty/.test(message)) return "EMPTY_COVERAGE"
  if (/400|422|invalid request|bad request/.test(message)) return "INVALID_REQUEST"
  return "ERROR"
}

function isTransientFailure(code: ProviderFailureCode) {
  return code === "RATE_LIMIT" || code === "TIMEOUT" || code === "NETWORK"
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
    includeCurrent: input.includeCurrent === true,
    ...detail,
  }
  if (event === "success") console.info("[chart-ohlcv-provider]", payload)
  else console.warn("[chart-ohlcv-provider]", payload)
}

async function fetchFromProvider(
  provider: RuntimeProvider,
  input: CanonicalChartOhlcvRequest,
  ssi: ReturnType<typeof createSsiIboardProbeProvider>,
) {
  const now = new Date()
  if (provider === "VCI") {
    return fetchVciMinuteOhlcvRange(input.ticker, input.from, input.to, now, { includeCurrent: input.includeCurrent === true })
  }
  if (provider === "SSI_IBOARD") {
    const result = await ssi.fetch(input)
    return result.bars
  }
  return fetchMinuteOhlcvRange(input.ticker, input.from, input.to, now, { includeCurrent: input.includeCurrent === true })
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
        let lastFailure: ProviderFailureCode | null = null
        for (let attempt = 1; attempt <= TRANSIENT_ATTEMPTS; attempt += 1) {
          try {
            const bars = await fetchFromProvider(provider, input, ssi)
            if (bars.length) {
              logProviderEvent(input, provider, "success", { rowCount: bars.length, attempt })
              return { provider, bars }
            }
            lastFailure = "EMPTY_COVERAGE"
          } catch (error) {
            lastFailure = providerFailureCode(error)
          }

          if (!lastFailure || !isTransientFailure(lastFailure) || attempt >= TRANSIENT_ATTEMPTS) break
          logProviderEvent(input, provider, "failure", { errorClass: lastFailure, attempt, retrying: true })
          await sleep(RETRY_DELAY_MS * attempt)
        }

        const code = lastFailure ?? "EMPTY_COVERAGE"
        failures.push(`${provider}:${code}`)
        logProviderEvent(input, provider, "failure", { errorClass: code, retrying: false })
      }
      console.warn("[chart-ohlcv-provider]", {
        scope: "chart_ohlcv_provider",
        event: "waterfall_exhausted",
        ticker: input.ticker,
        resolution: input.resolution,
        requestedFrom: input.from,
        requestedTo: input.to,
        includeCurrent: input.includeCurrent === true,
        failures,
      })
      throw new Error(`Chart OHLC provider waterfall exhausted (${failures.join(",")})`)
    },
  }
}

export type ChartOhlcvFallbackProvider = ChartOhlcvProvider
