import { createHmac } from "node:crypto"
import { NextResponse } from "next/server"

import { requireApiFeature } from "@/modules/auth/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_BODY_BYTES = 12 * 1024
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "Pragma": "no-cache",
  "X-Content-Type-Options": "nosniff",
}

const RELAY_STATES = new Set(["CLOSED", "CONNECTING", "AUTHENTICATING", "READY", "ERROR"])
const HEALTH_STREAMS = new Set(["market", "orderbook"])

type JsonRecord = Record<string, unknown>

function boundedText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return ""
  return value.trim().replace(/[\r\n\t]/g, " ").slice(0, maxLength)
}

function boundedNumber(value: unknown, max: number) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0) return null
  return Math.min(numeric, max)
}

function latencySummary(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const source = value as JsonRecord
  return {
    n: boundedNumber(source.n, 100_000) ?? 0,
    p50: boundedNumber(source.p50, 300_000),
    p95: boundedNumber(source.p95, 300_000),
    p99: boundedNumber(source.p99, 300_000),
  }
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin")
  return !origin || origin === new URL(request.url).origin
}

function contentLengthAllowed(request: Request) {
  const raw = request.headers.get("content-length")
  if (!raw) return true
  const length = Number(raw)
  return Number.isFinite(length) && length >= 0 && length <= MAX_BODY_BYTES
}

function userHash(userId: string, secret: string) {
  return createHmac("sha256", secret).update(userId).digest("hex").slice(0, 16)
}

function stateTelemetry(body: JsonRecord, user_hash: string) {
  const status = boundedText(body.status, 24).toUpperCase()
  if (!RELAY_STATES.has(status)) return null
  return {
    event: "browser_relay_state",
    user_hash,
    status,
    reconnect_attempt: boundedNumber(body.reconnectAttempt, 100) ?? 0,
    topic_count: boundedNumber(body.topicCount, 16) ?? 0,
    has_error: body.hasError === true,
  }
}

function healthTelemetry(body: JsonRecord, user_hash: string) {
  const stream = boundedText(body.stream, 16).toLowerCase()
  if (!HEALTH_STREAMS.has(stream)) return null
  const samples = boundedNumber(body.samples, 100_000)
  if (samples == null || samples <= 0) return null
  return {
    event: "browser_relay_health",
    user_hash,
    stream,
    symbol: boundedText(body.symbol, 16).toUpperCase(),
    batch_id: boundedText(body.batchId, 160),
    epoch: boundedText(body.epoch, 96),
    sequence: boundedNumber(body.sequence, Number.MAX_SAFE_INTEGER),
    samples,
    provider_to_worker: latencySummary(body.providerToWorker),
    worker_queue: latencySummary(body.workerQueue),
    delivery: latencySummary(body.delivery),
    end_to_end: latencySummary(body.endToEnd),
  }
}

export async function POST(request: Request) {
  const auth = await requireApiFeature("market_board")
  if (!auth.ok) return auth.response

  if (!sameOrigin(request) || !contentLengthAllowed(request)) {
    return NextResponse.json({ ok: false }, { status: 403, headers: NO_STORE_HEADERS })
  }

  const secret = process.env.QEO_MARKET_REALTIME_SIGNING_SECRET?.trim() ?? ""
  if (!secret) {
    return NextResponse.json({ ok: false }, { status: 503, headers: NO_STORE_HEADERS })
  }

  let body: JsonRecord
  try {
    const parsed = await request.json()
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid body")
    body = parsed as JsonRecord
  } catch {
    return NextResponse.json({ ok: false }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const user_hash = userHash(auth.context.user.id, secret)
  const event = boundedText(body.event, 48)
  const telemetry = event === "browser_relay_state"
    ? stateTelemetry(body, user_hash)
    : event === "browser_relay_health"
      ? healthTelemetry(body, user_hash)
      : null

  if (!telemetry) {
    return NextResponse.json({ ok: false }, { status: 400, headers: NO_STORE_HEADERS })
  }

  console.info(telemetry.event, telemetry)
  return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS })
}
