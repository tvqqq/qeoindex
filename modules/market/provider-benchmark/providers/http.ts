import type { CanonicalOhlcvBar } from "@/modules/market/chart-data/contract"
import type { ProviderErrorClass } from "../contract"

export function classifyProviderError(error: unknown): ProviderErrorClass {
  const text = error instanceof Error ? error.message.toLowerCase() : String(error ?? "").toLowerCase()
  if (/401|403|unauthorized|forbidden|signature/.test(text)) return "AUTH"
  if (/429|rate.?limit|too many/.test(text)) return "RATE_LIMIT"
  if (/abort|timeout|deadline|timed out/.test(text)) return "TIMEOUT"
  if (/unsupported.*resolution|resolution.*unsupported/.test(text)) return "UNSUPPORTED_RESOLUTION"
  if (/400|422|invalid request|bad request/.test(text)) return "INVALID_REQUEST"
  if (/malformed|schema|json|parse/.test(text)) return "MALFORMED_RESPONSE"
  if (/normaliz/.test(text)) return "NORMALIZATION"
  return "NETWORK"
}

export function summarizeReturnedRange(bars: CanonicalOhlcvBar[]) {
  if (!bars.length) return { returnedFrom: null, returnedTo: null }
  const sorted = [...bars].sort((a, b) => a.time - b.time)
  return { returnedFrom: sorted[0].time, returnedTo: sorted.at(-1)!.time }
}

export function coverageForBars(bars: CanonicalOhlcvBar[], from: number, to: number) {
  if (!bars.length) return "EMPTY" as const
  const { returnedFrom, returnedTo } = summarizeReturnedRange(bars)
  if (returnedFrom == null || returnedTo == null) return "EMPTY" as const
  return returnedFrom <= from && returnedTo >= to ? "FULL" as const : "PARTIAL" as const
}

export function sanitizedProviderMessage(provider: string, errorClass: ProviderErrorClass) {
  return `${provider} provider request failed (${errorClass})`
}
