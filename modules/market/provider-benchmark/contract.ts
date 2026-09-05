import type { CanonicalOhlcvBar } from "@/modules/market/chart-data/contract"

export const MARKET_DATA_PROBE_PROVIDERS = ["SSI_IBOARD", "DNSE", "VCI", "KBS"] as const
export type MarketDataProbeProviderName = (typeof MARKET_DATA_PROBE_PROVIDERS)[number]
export type MarketDataProbeResolution = "1m" | "1D"

export type ProviderErrorClass =
  | "AUTH"
  | "INVALID_REQUEST"
  | "UNSUPPORTED_RESOLUTION"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "NETWORK"
  | "EMPTY_COVERAGE"
  | "MALFORMED_RESPONSE"
  | "NORMALIZATION"

export type ProviderFetchRequest = {
  ticker: string
  resolution: MarketDataProbeResolution
  from: number
  to: number
}

export type ProviderFetchResult = ProviderFetchRequest & {
  provider: MarketDataProbeProviderName
  bars: CanonicalOhlcvBar[]
  requestedFrom: number
  requestedTo: number
  returnedFrom: number | null
  returnedTo: number | null
  rowCount: number
  latencyMs: number
  fetchedAt: string
  coverage: "FULL" | "PARTIAL" | "EMPTY"
  errorClass?: ProviderErrorClass
  providerDetail?: string
}

export interface MarketDataProbeProvider {
  readonly name: MarketDataProbeProviderName
  fetch(input: ProviderFetchRequest): Promise<ProviderFetchResult>
}

export type ProviderResolver = (name: MarketDataProbeProviderName) => MarketDataProbeProvider

export class ProviderProbeError extends Error {
  readonly provider: MarketDataProbeProviderName
  readonly errorClass: ProviderErrorClass

  constructor(provider: MarketDataProbeProviderName, errorClass: ProviderErrorClass, message: string) {
    super(message)
    this.name = "ProviderProbeError"
    this.provider = provider
    this.errorClass = errorClass
  }
}

export function normalizeProbeRequest(input: ProviderFetchRequest): ProviderFetchRequest {
  const ticker = String(input.ticker || "").trim().toUpperCase()
  if (!/^[A-Z0-9]{2,12}$/.test(ticker)) throw new Error("Invalid probe ticker")
  if (input.resolution !== "1m" && input.resolution !== "1D") throw new Error("Unsupported probe resolution")
  if (!Number.isInteger(input.from) || !Number.isInteger(input.to) || input.from <= 0 || input.to <= input.from) {
    throw new Error("Invalid probe range")
  }
  const maxSpan = input.resolution === "1m" ? 31 * 86400 : 50 * 366 * 86400
  if (input.to - input.from > maxSpan) throw new Error("Probe range is too large")
  return { ticker, resolution: input.resolution, from: input.from, to: input.to }
}
