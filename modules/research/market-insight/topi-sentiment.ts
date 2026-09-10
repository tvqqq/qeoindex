import "server-only"

const TOPI_API_BASE = "https://apiclient.topi.vn/api-web"
const TOPI_TARGET_VNINDEX = 0
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_TRANSIENT_ATTEMPTS = 3

export interface TopiMarketSentimentData {
  score: number
  label: string | null
  asOf: string | null
  history: Array<{ tradingDate: string; value: number }>
}

export interface FetchTopiMarketSentimentOptions {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  transientAttempts?: number
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replaceAll(",", ""))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function unwrapTopiData(payload: unknown): unknown {
  let current = payload
  for (let depth = 0; depth < 5; depth += 1) {
    const record = asRecord(current)
    if (!record) return current
    if (Object.prototype.hasOwnProperty.call(record, "Data")) return record.Data
    if (Object.prototype.hasOwnProperty.call(record, "data")) {
      current = record.data
      continue
    }
    return current
  }
  return current
}

export function parseTopiMarketDate(value: unknown): string | null {
  const text = readString(value)
  if (!text) return null
  const viDate = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(text)
  if (viDate) return `${viDate[3]}-${viDate[2]}-${viDate[1]}`
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
  return isoDate ? `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}` : null
}

export function parseTopiMarketSentiment(currentPayload: unknown, historyPayload: unknown): TopiMarketSentimentData | null {
  const current = asRecord(unwrapTopiData(currentPayload))
  const score = current ? readFiniteNumber(current.Score ?? current.score) : null
  if (score == null || score < 0 || score > 100) return null

  const rows = unwrapTopiData(historyPayload)
  const historyByDate = new Map<string, number>()
  if (Array.isArray(rows)) {
    for (const value of rows) {
      const row = asRecord(value)
      if (!row) continue
      const tradingDate = parseTopiMarketDate(row.Date ?? row.date)
      const point = readFiniteNumber(row.Score ?? row.score)
      if (!tradingDate || point == null || point < 0 || point > 100) continue
      historyByDate.set(tradingDate, point)
    }
  }

  return {
    score,
    label: readString(current?.SentimentLevel ?? current?.sentimentLevel),
    asOf: parseTopiMarketDate(current?.Date ?? current?.date),
    history: [...historyByDate.entries()]
      .map(([tradingDate, value]) => ({ tradingDate, value }))
      .sort((left, right) => left.tradingDate.localeCompare(right.tradingDate)),
  }
}

function isRetryable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /\b(408|429|5\d\d)\b|timeout|timed out|AbortError|fetch failed|network|ECONNRESET|ENETUNREACH|EAI_AGAIN/i.test(message)
}

async function postTopi(
  path: "GetFGIndex" | "GetFGChart",
  body: Record<string, number>,
  fetchImpl: typeof fetch,
  timeoutMs: number,
) {
  const response = await fetchImpl(`${TOPI_API_BASE}/${path}`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`TOPI ${path} failed (${response.status})`)
  return response.json() as Promise<unknown>
}

export async function fetchTopiMarketSentiment({
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  transientAttempts = DEFAULT_TRANSIENT_ATTEMPTS,
}: FetchTopiMarketSentimentOptions = {}): Promise<TopiMarketSentimentData | null> {
  if (!Number.isInteger(transientAttempts) || transientAttempts < 1 || transientAttempts > 5) {
    throw new Error("TOPI transientAttempts must be between 1 and 5")
  }

  let lastError: unknown = null
  for (let attempt = 1; attempt <= transientAttempts; attempt += 1) {
    try {
      const [current, history] = await Promise.all([
        postTopi("GetFGIndex", { Target: TOPI_TARGET_VNINDEX }, fetchImpl, timeoutMs),
        postTopi("GetFGChart", { Target: TOPI_TARGET_VNINDEX, Days: 0 }, fetchImpl, timeoutMs),
      ])
      return parseTopiMarketSentiment(current, history)
    } catch (error) {
      lastError = error
      if (!isRetryable(error) || attempt >= transientAttempts) break
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(2_000, 300 * 2 ** (attempt - 1))))
    }
  }

  throw lastError instanceof Error ? lastError : new Error("TOPI sentiment request failed")
}
