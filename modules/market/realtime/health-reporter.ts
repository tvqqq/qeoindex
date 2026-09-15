"use client"

type RelayStateStatus = "CLOSED" | "CONNECTING" | "AUTHENTICATING" | "READY" | "ERROR"

type LatencySummary = {
  n: number
  p50: number | null
  p95: number | null
  p99: number | null
}

export type RealtimeHealthReport = {
  stream: "orderbook" | "market"
  symbol?: string
  batchId?: string
  epoch?: string
  sequence?: number
  samples: number
  providerToWorker?: LatencySummary
  workerQueue?: LatencySummary
  delivery?: LatencySummary
  endToEnd?: LatencySummary
}

export type RealtimeConnectionReport = {
  status: RelayStateStatus
  reconnectAttempt: number
  topicCount: number
  hasError: boolean
}

const REPORT_URL = "/api/market/realtime-health"
const MAX_TEXT_LENGTH = 96
const MAX_SEQUENCE = Number.MAX_SAFE_INTEGER
const HEALTH_REPORT_MIN_INTERVAL_MS = 15_000

let lastStateFingerprint = ""
const lastHealthReportAt = new Map<string, number>()

function boundedText(value: unknown, maxLength = MAX_TEXT_LENGTH) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : ""
}

function finiteNonNegative(value: unknown, max = Number.MAX_SAFE_INTEGER) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0) return null
  return Math.min(numeric, max)
}

function normalizeLatencySummary(value: LatencySummary | undefined) {
  if (!value) return undefined
  return {
    n: finiteNonNegative(value.n, 100_000) ?? 0,
    p50: finiteNonNegative(value.p50, 300_000),
    p95: finiteNonNegative(value.p95, 300_000),
    p99: finiteNonNegative(value.p99, 300_000),
  }
}

function postTelemetry(payload: Record<string, unknown>) {
  if (typeof window === "undefined") return
  void fetch(REPORT_URL, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    keepalive: true,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  }).catch(() => undefined)
}

export function reportRealtimeConnectionState(report: RealtimeConnectionReport) {
  const normalized = {
    event: "browser_relay_state",
    status: report.status,
    reconnectAttempt: finiteNonNegative(report.reconnectAttempt, 100) ?? 0,
    topicCount: finiteNonNegative(report.topicCount, 16) ?? 0,
    hasError: report.hasError === true,
  }
  const fingerprint = JSON.stringify(normalized)
  if (fingerprint === lastStateFingerprint) return
  lastStateFingerprint = fingerprint
  postTelemetry(normalized)
}

export function reportRealtimeHealth(report: RealtimeHealthReport) {
  const sequence = finiteNonNegative(report.sequence, MAX_SEQUENCE)
  const samples = finiteNonNegative(report.samples, 100_000)
  if (samples == null || samples <= 0) return

  const symbol = boundedText(report.symbol, 16).toUpperCase()
  const throttleKey = `${report.stream}:${symbol}`
  const now = Date.now()
  const previous = lastHealthReportAt.get(throttleKey) ?? 0
  if (now - previous < HEALTH_REPORT_MIN_INTERVAL_MS) return
  lastHealthReportAt.set(throttleKey, now)

  postTelemetry({
    event: "browser_relay_health",
    stream: report.stream,
    symbol,
    batchId: boundedText(report.batchId, 160),
    epoch: boundedText(report.epoch, 96),
    sequence,
    samples,
    providerToWorker: normalizeLatencySummary(report.providerToWorker),
    workerQueue: normalizeLatencySummary(report.workerQueue),
    delivery: normalizeLatencySummary(report.delivery),
    endToEnd: normalizeLatencySummary(report.endToEnd),
  })
}
