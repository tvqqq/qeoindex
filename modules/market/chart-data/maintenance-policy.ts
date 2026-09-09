import {
  isVietnamSecuritiesTradingDateKey,
  vietnamDateKey,
} from "@/modules/market/calendar"

export const QEO150_CONFIGURED_CLOSE_SECONDS = 14 * 3600 + 46 * 60
export const QEO150_CONFIGURED_OPEN_SECONDS = 9 * 3600

export type Qeo150EvidenceCategory =
  | "traded"
  | "no_trade"
  | "suspension"
  | "provider_gap"
  | "failure"
  | "unknown"

export type Qeo150AttemptOutcome =
  | "none"
  | "already_fresh"
  | "ingested"
  | "reused"
  | "no_trade"
  | "suspension"
  | "provider_gap"
  | "retryable_failure"
  | "failed"
  | "capacity_stop"
  | "unknown"

export interface Qeo150DailyEvidence {
  volume: number
  provider: string | null
  providerDetail: string | null
  sourceUrl: string | null
}

export interface Qeo150FreshnessInput {
  expectedSession: string
  actualSession: string | null
  dailyEvidence: Qeo150DailyEvidence | null
  lastAttemptOutcome: Qeo150AttemptOutcome
}

export interface Qeo150FreshnessClassification {
  current: boolean
  evidenceCategory: Qeo150EvidenceCategory
}

function boundedSessionSeconds(value: number, label: string) {
  if (!Number.isInteger(value) || value < 0 || value >= 24 * 3600) {
    throw new Error(`Invalid ${label} seconds`)
  }
  return value
}

function vietnamSecondsOfDay(value: Date) {
  if (!Number.isFinite(value.getTime())) throw new Error("Invalid QEO-150 reference timestamp")
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(value)
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value ?? NaN)
  const hour = part("hour")
  const minute = part("minute")
  const second = part("second")
  if (![hour, minute, second].every(Number.isFinite)) throw new Error("Unable to resolve Vietnam session time")
  return hour * 3600 + minute * 60 + second
}

function addCalendarDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00+07:00`)
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid Vietnam session date: ${dateKey}`)
  date.setUTCDate(date.getUTCDate() + days)
  return vietnamDateKey(date)
}

export function previousVietnamSecuritiesTradingDateKey(dateKey: string) {
  for (let offset = 1; offset <= 14; offset += 1) {
    const candidate = addCalendarDays(dateKey, -offset)
    if (isVietnamSecuritiesTradingDateKey(candidate)) return candidate
  }
  throw new Error(`Unable to resolve previous Vietnam securities trading date before ${dateKey}`)
}

export function expectedCompletedVietnamSession(
  referenceAt: Date = new Date(),
  options: { closeSeconds?: number } = {},
) {
  const closeSeconds = boundedSessionSeconds(options.closeSeconds ?? QEO150_CONFIGURED_CLOSE_SECONDS, "QEO-150 close")
  const today = vietnamDateKey(referenceAt)
  if (isVietnamSecuritiesTradingDateKey(today) && vietnamSecondsOfDay(referenceAt) >= closeSeconds) return today
  return previousVietnamSecuritiesTradingDateKey(today)
}

export function qeo150SessionRange(
  sessionDate: string,
  options: { openSeconds?: number; closeSeconds?: number } = {},
) {
  if (!isVietnamSecuritiesTradingDateKey(sessionDate)) {
    throw new Error(`QEO-150 session range requires a trading date: ${sessionDate}`)
  }
  const openSeconds = boundedSessionSeconds(options.openSeconds ?? QEO150_CONFIGURED_OPEN_SECONDS, "QEO-150 open")
  const closeSeconds = boundedSessionSeconds(options.closeSeconds ?? QEO150_CONFIGURED_CLOSE_SECONDS, "QEO-150 close")
  if (closeSeconds <= openSeconds) throw new Error("QEO-150 configured close must be after configured open")
  const dayStart = Math.floor(Date.parse(`${sessionDate}T00:00:00+07:00`) / 1000)
  return { from: dayStart + openSeconds, to: dayStart + closeSeconds }
}

function explicitSuspensionEvidence(evidence: Qeo150DailyEvidence | null) {
  const detail = evidence?.providerDetail ?? ""
  return /\b(?:suspend(?:ed|sion)?|trading suspension)\b|tạm ngừng|đình chỉ/i.test(detail)
}

export function isVerifiedQeo150NoTradeEvidence(evidence: Qeo150DailyEvidence | null) {
  if (!evidence || evidence.volume !== 0) return false
  const provider = (evidence.provider ?? "").trim().toUpperCase()
  if (provider === "VCI" || provider === "DNSE") return true
  return provider === "FALLBACK"
    && evidence.sourceUrl === "internal://stock_orderbook_snapshots"
    && (evidence.providerDetail ?? "").startsWith("Verified final market-close repair")
}

export function classifyQeo150Freshness(input: Qeo150FreshnessInput): Qeo150FreshnessClassification {
  if (input.actualSession === input.expectedSession) {
    return { current: true, evidenceCategory: "traded" }
  }
  if (explicitSuspensionEvidence(input.dailyEvidence)) {
    return { current: false, evidenceCategory: "suspension" }
  }
  if (isVerifiedQeo150NoTradeEvidence(input.dailyEvidence)) {
    return { current: false, evidenceCategory: "no_trade" }
  }
  if ((input.dailyEvidence?.volume ?? 0) > 0 || input.lastAttemptOutcome === "provider_gap") {
    return { current: false, evidenceCategory: "provider_gap" }
  }
  if (
    input.lastAttemptOutcome === "retryable_failure"
    || input.lastAttemptOutcome === "failed"
    || input.lastAttemptOutcome === "capacity_stop"
  ) {
    return { current: false, evidenceCategory: "failure" }
  }
  return { current: false, evidenceCategory: "unknown" }
}
