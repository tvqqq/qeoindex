import type { CanonicalOhlcvBar } from "@/modules/market/chart-data/contract"
import {
  ProviderProbeError,
  normalizeProbeRequest,
  type MarketDataProbeProvider,
  type MarketDataProbeResolution,
  type ProviderFetchRequest,
} from "../contract.ts"
import {
  classifyProviderError,
  coverageForBars,
  sanitizedProviderMessage,
  summarizeReturnedRange,
} from "./http.ts"

const SSI_IBOARD_HISTORY_URL = "https://iboard-api.ssi.com.vn/statistics/charts/history"
const DEFAULT_TIMEOUT_MS = 15_000

type FetchLike = typeof fetch

type SsiEnvelope = {
  code?: unknown
  status?: unknown
  data?: unknown
}

function finite(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function validBar(bar: CanonicalOhlcvBar) {
  return bar.time > 0
    && bar.open > 0
    && bar.high > 0
    && bar.low > 0
    && bar.close > 0
    && bar.volume >= 0
    && bar.high >= Math.max(bar.open, bar.close, bar.low)
    && bar.low <= Math.min(bar.open, bar.close, bar.high)
}

export function ssiIboardResolutionToken(resolution: MarketDataProbeResolution) {
  return resolution === "1m" ? "1" : "1D"
}

export function parseSsiIboardPayload(payload: unknown, request: ProviderFetchRequest): CanonicalOhlcvBar[] {
  const envelope = payload as SsiEnvelope
  if (!envelope || typeof envelope !== "object" || envelope.code !== "SUCCESS" || envelope.status !== "ok") {
    throw new ProviderProbeError("SSI_IBOARD", "MALFORMED_RESPONSE", "SSI iBoard returned an invalid response envelope")
  }
  const data = envelope.data as Record<string, unknown> | null
  if (!data || typeof data !== "object") {
    throw new ProviderProbeError("SSI_IBOARD", "MALFORMED_RESPONSE", "SSI iBoard response data is missing")
  }
  if (data.s === "no_data") return []
  if (data.s !== "ok") {
    throw new ProviderProbeError("SSI_IBOARD", "MALFORMED_RESPONSE", "SSI iBoard returned an unexpected UDF status")
  }

  const keys = ["t", "o", "h", "l", "c"] as const
  const arrays = Object.fromEntries(keys.map((key) => [key, data[key]])) as Record<(typeof keys)[number], unknown>
  if (keys.some((key) => !Array.isArray(arrays[key]))) {
    throw new ProviderProbeError("SSI_IBOARD", "MALFORMED_RESPONSE", "SSI iBoard OHLC arrays are missing")
  }
  const times = arrays.t as unknown[]
  const opens = arrays.o as unknown[]
  const highs = arrays.h as unknown[]
  const lows = arrays.l as unknown[]
  const closes = arrays.c as unknown[]
  const volumes = data.v == null ? new Array(times.length).fill(0) : data.v
  if (!Array.isArray(volumes) || [opens, highs, lows, closes, volumes].some((array) => array.length !== times.length)) {
    throw new ProviderProbeError("SSI_IBOARD", "MALFORMED_RESPONSE", "SSI iBoard OHLCV arrays are misaligned")
  }

  const bars: CanonicalOhlcvBar[] = []
  const seen = new Set<number>()
  for (let index = 0; index < times.length; index += 1) {
    const time = finite(times[index])
    const open = finite(opens[index])
    const high = finite(highs[index])
    const low = finite(lows[index])
    const close = finite(closes[index])
    const volume = finite(volumes[index])
    if (time == null || open == null || high == null || low == null || close == null || volume == null) continue
    const bar = { time: Math.trunc(time), open, high, low, close, volume }
    if (bar.time < request.from || bar.time > request.to || seen.has(bar.time) || !validBar(bar)) continue
    seen.add(bar.time)
    bars.push(bar)
  }
  return bars.sort((a, b) => a.time - b.time)
}

export function createSsiIboardProbeProvider(deps: {
  fetchImpl?: FetchLike
  timeoutMs?: number
  nowMs?: () => number
} = {}): MarketDataProbeProvider {
  const fetchImpl = deps.fetchImpl ?? fetch
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const nowMs = deps.nowMs ?? Date.now

  return {
    name: "SSI_IBOARD",
    async fetch(rawInput) {
      const input = normalizeProbeRequest(rawInput)
      const started = nowMs()
      try {
        const url = new URL(SSI_IBOARD_HISTORY_URL)
        url.searchParams.set("resolution", ssiIboardResolutionToken(input.resolution))
        url.searchParams.set("symbol", input.ticker)
        url.searchParams.set("from", String(input.from))
        url.searchParams.set("to", String(input.to))

        const response = await fetchImpl(url, {
          cache: "no-store",
          headers: {
            Accept: "application/json",
            "User-Agent": "Mozilla/5.0 QeoIndex/1.0",
          },
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (!response.ok) {
          const errorClass = response.status === 429
            ? "RATE_LIMIT"
            : response.status === 401 || response.status === 403
              ? "AUTH"
              : response.status >= 400 && response.status < 500
                ? "INVALID_REQUEST"
                : "NETWORK"
          throw new ProviderProbeError("SSI_IBOARD", errorClass, sanitizedProviderMessage("SSI_IBOARD", errorClass))
        }

        const payload = await response.json()
        const parsed = parseSsiIboardPayload(payload, input)
        const completedCutoff = Math.floor(nowMs() / 1000) - 60
        const bars = input.resolution === "1m"
          ? parsed.filter((bar) => bar.time <= completedCutoff)
          : parsed
        const latencyMs = Math.max(0, nowMs() - started)
        const range = summarizeReturnedRange(bars)
        return {
          ...input,
          provider: "SSI_IBOARD",
          bars,
          requestedFrom: input.from,
          requestedTo: input.to,
          ...range,
          rowCount: bars.length,
          latencyMs,
          fetchedAt: new Date().toISOString(),
          coverage: coverageForBars(bars, input.from, input.to),
          ...(bars.length ? {} : { errorClass: "EMPTY_COVERAGE" as const }),
        }
      } catch (error) {
        if (error instanceof ProviderProbeError) throw error
        const errorClass = classifyProviderError(error)
        throw new ProviderProbeError("SSI_IBOARD", errorClass, sanitizedProviderMessage("SSI_IBOARD", errorClass))
      }
    },
  }
}
