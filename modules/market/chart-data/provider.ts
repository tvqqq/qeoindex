import "server-only"

import { fetchMinuteOhlcvRange } from "@/modules/market/providers/dnse/history"
import { fetchVciMinuteOhlcvRange } from "@/modules/market/providers/vci/history"
import { createSsiIboardProbeProvider } from "@/modules/market/provider-benchmark/providers/ssi-iboard"
import type { CanonicalChartOhlcvRequest, CanonicalOhlcvBar } from "./contract"
import { createProviderBudget } from "./provider-budget"

export interface ChartOhlcvProviderResult {
  provider: string
  bars: CanonicalOhlcvBar[]
}

export interface ChartOhlcvProvider {
  fetch(input: CanonicalChartOhlcvRequest): Promise<CanonicalOhlcvBar[] | ChartOhlcvProviderResult>
}

export interface PrimaryChartOhlcvProviderOptions {
  totalBudgetMs?: number
  nowMs?: () => number
}

type RuntimeProvider = "VCI" | "DNSE" | "SSI_IBOARD"
export type ChartProviderFailureCode = "AUTH" | "RATE_LIMIT" | "TIMEOUT" | "NETWORK" | "EMPTY_COVERAGE" | "INVALID_REQUEST" | "ERROR"

export interface ChartProviderFailure {
  provider: RuntimeProvider
  code: ChartProviderFailureCode
}

export class ChartOhlcvProviderWaterfallError extends Error {
  readonly failures: ChartProviderFailure[]
  readonly retryable: boolean
  readonly terminalCoverageGap: boolean

  constructor(failures: ChartProviderFailure[]) {
    super(`Chart OHLC provider waterfall exhausted (${failures.map((failure) => `${failure.provider}:${failure.code}`).join(",")})`)
    this.name = "ChartOhlcvProviderWaterfallError"
    this.failures = failures
    this.retryable = failures.some((failure) => isTransientFailure(failure.code))
    this.terminalCoverageGap = failures.length > 0 && failures.every((failure) => failure.code === "EMPTY_COVERAGE")
  }
}

const TRANSIENT_ATTEMPTS = 2
const RETRY_DELAY_MS = 250

function providerOrder(): RuntimeProvider[] {
  const configured = (process.env.CHART_OHLC_PROVIDER_ORDER ?? "VCI,DNSE,SSI_IBOARD")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter((value): value is RuntimeProvider => value === "VCI" || value === "SSI_IBOARD" || value === "DNSE")
  return configured.length ? [...new Set(configured)] : ["VCI", "DNSE", "SSI_IBOARD"]
}

function providerFailureCode(error: unknown): ChartProviderFailureCode {
  if (error && typeof error === "object" && "errorClass" in error) {
    return String((error as { errorClass?: unknown }).errorClass || "ERROR") as ChartProviderFailureCode
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

function isTransientFailure(code: ChartProviderFailureCode) {
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
  remainingMs: number | null,
) {
  const now = new Date()
  const timeoutMs = remainingMs == null ? undefined : Math.max(1, remainingMs)
  if (provider === "VCI") {
    return fetchVciMinuteOhlcvRange(input.ticker, input.from, input.to, now, {
      includeCurrent: input.includeCurrent === true,
      timeoutMs,
    })
  }
  if (provider === "SSI_IBOARD") {
    const activeSsi = timeoutMs == null ? ssi : createSsiIboardProbeProvider({ timeoutMs })
    const result = await activeSsi.fetch(input)
    return result.bars
  }
  return fetchMinuteOhlcvRange(input.ticker, input.from, input.to, now, {
    includeCurrent: input.includeCurrent === true,
    budgetMs: timeoutMs,
  })
}

export function normalizeChartProviderResult(
  result: CanonicalOhlcvBar[] | ChartOhlcvProviderResult,
  fallbackProvider = "UNKNOWN",
): ChartOhlcvProviderResult {
  return Array.isArray(result) ? { provider: fallbackProvider, bars: result } : result
}

export function createPrimaryChartOhlcvProvider(options: PrimaryChartOhlcvProviderOptions = {}): ChartOhlcvProvider {
  const ssi = createSsiIboardProbeProvider()
  const budget = createProviderBudget(options.totalBudgetMs, options.nowMs)
  return {
    async fetch(input) {
      if (input.resolution !== "1m") {
        throw new Error(`Primary chart provider does not fetch ${input.resolution}; canonical Daily is persisted separately`)
      }

      const failures: ChartProviderFailure[] = []
      for (const provider of providerOrder()) {
        let lastFailure: ChartProviderFailureCode | null = null
        for (let attempt = 1; attempt <= TRANSIENT_ATTEMPTS; attempt += 1) {
          const remainingMs = budget.remainingMs()
          if (remainingMs === 0) {
            lastFailure = "TIMEOUT"
            break
          }

          try {
            const bars = await fetchFromProvider(provider, input, ssi, remainingMs)
            if (bars.length) {
              logProviderEvent(input, provider, "success", { rowCount: bars.length, attempt })
              return { provider, bars }
            }
            lastFailure = "EMPTY_COVERAGE"
          } catch (error) {
            lastFailure = providerFailureCode(error)
          }

          const remainingAfterAttempt = budget.remainingMs()
          if (!lastFailure || !isTransientFailure(lastFailure) || attempt >= TRANSIENT_ATTEMPTS || remainingAfterAttempt === 0) break
          logProviderEvent(input, provider, "failure", { errorClass: lastFailure, attempt, retrying: true })
          const retryDelayMs = RETRY_DELAY_MS * attempt
          await sleep(remainingAfterAttempt == null ? retryDelayMs : Math.min(retryDelayMs, remainingAfterAttempt))
        }

        const code = lastFailure ?? "EMPTY_COVERAGE"
        failures.push({ provider, code })
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
      throw new ChartOhlcvProviderWaterfallError(failures)
    },
  }
}

export type ChartOhlcvFallbackProvider = ChartOhlcvProvider
