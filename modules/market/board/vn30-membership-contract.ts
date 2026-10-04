export const DNSE_VN30_MEMBERSHIP_SOURCE = "DNSE basket-influence" as const
export const VN30_MEMBER_COUNT = 30

export type Vn30Membership = {
  symbols: string[]
  source: typeof DNSE_VN30_MEMBERSHIP_SOURCE
  asOf: string
  fetchedAt: string
}

const SYMBOL_PATTERN = /^[A-Z0-9]{2,12}$/
const EARLIEST_PROVIDER_TIME_MS = Date.UTC(2020, 0, 1)

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function providerTimeMs(value: unknown): number | null {
  if (!isRecord(value) || !isRecord(value.time)) return null
  const { seconds, nanos } = value.time
  if (
    typeof seconds !== "number" ||
    !Number.isSafeInteger(seconds) ||
    seconds <= 0 ||
    typeof nanos !== "number" ||
    !Number.isInteger(nanos) ||
    nanos < 0 ||
    nanos >= 1_000_000_000
  ) return null

  const milliseconds = seconds * 1000 + nanos / 1_000_000
  return Number.isFinite(milliseconds) && milliseconds >= EARLIEST_PROVIDER_TIME_MS ? milliseconds : null
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value
}

function validSymbols(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length !== VN30_MEMBER_COUNT) return false
  const seen = new Set<string>()
  for (const symbol of value) {
    if (typeof symbol !== "string" || !SYMBOL_PATTERN.test(symbol) || seen.has(symbol)) return false
    seen.add(symbol)
  }
  return true
}

export function parseDnseVn30Membership(payload: unknown, fetchedAt = new Date()): Vn30Membership | null {
  if (!Array.isArray(payload) || payload.length !== VN30_MEMBER_COUNT || !Number.isFinite(fetchedAt.getTime())) return null

  const symbols: string[] = []
  const seen = new Set<string>()
  let latestProviderTimeMs = Number.NEGATIVE_INFINITY
  for (const row of payload) {
    if (!isRecord(row) || typeof row.symbol !== "string" || !SYMBOL_PATTERN.test(row.symbol) || seen.has(row.symbol)) return null
    const rowTime = providerTimeMs(row)
    if (rowTime === null || rowTime > fetchedAt.getTime() + 60_000) return null
    seen.add(row.symbol)
    symbols.push(row.symbol)
    latestProviderTimeMs = Math.max(latestProviderTimeMs, rowTime)
  }

  if (symbols.length !== VN30_MEMBER_COUNT || !Number.isFinite(latestProviderTimeMs)) return null
  return {
    symbols,
    source: DNSE_VN30_MEMBERSHIP_SOURCE,
    asOf: new Date(latestProviderTimeMs).toISOString(),
    fetchedAt: fetchedAt.toISOString(),
  }
}

export function isValidVn30Membership(value: unknown): value is Vn30Membership {
  if (!isRecord(value)) return false
  if (value.source !== DNSE_VN30_MEMBERSHIP_SOURCE || !validSymbols(value.symbols)) return false
  if (!isIsoDate(value.asOf) || !isIsoDate(value.fetchedAt)) return false
  const asOfMs = Date.parse(value.asOf)
  const fetchedAtMs = Date.parse(value.fetchedAt)
  return asOfMs >= EARLIEST_PROVIDER_TIME_MS && asOfMs <= fetchedAtMs + 60_000
}
