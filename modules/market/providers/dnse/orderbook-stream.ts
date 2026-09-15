"use client"

import {
  restartMarketRelay,
  subscribeMarketRelay,
  type MarketRelayConnectionState,
  type MarketRelayOrderbookMessage,
} from "@/modules/market/realtime/relay-client"
import { reportRealtimeHealth } from "@/modules/market/realtime/health-reporter"
import { getAuthenticatedSupabaseRealtimeClient } from "@/modules/shared/supabase/authenticated-realtime"

export type DnseOrderbookFrame = Record<string, unknown>
export type DnseOrderbookStreamStatus = "CONNECTING" | "LIVE" | "RECOVERING" | "STALE" | "ERROR" | "CLOSED"
export type DnseOrderbookStreamState = {
  status: DnseOrderbookStreamStatus
  error: string
  lastMessageAt: string
  sequence: number
}

type OrderbookCheckpointRow = {
  sequence?: unknown
  frames?: unknown
  source_updated_at?: unknown
  updated_at?: unknown
}

type OrderbookLatencySample = {
  providerToWorker: number | null
  workerQueue: number | null
  delivery: number | null
  endToEnd: number | null
}

type OrderbookLatencyMetric = keyof OrderbookLatencySample

const FANOUT_SHARDS = 10
const STALE_AFTER_MS = 45_000
const RECOVERY_RETRY_MS = 1_500
const MAX_RECOVERY_QUEUE = 256
const WORKER_RECEIVED_AT_FIELD = "_qeoWorkerReceivedAt"
const LATENCY_SAMPLE_LIMIT = 512
const LATENCY_REPORT_EVERY = 100
const MAX_REASONABLE_LATENCY_MS = 5 * 60_000

export function orderbookFanoutShard(symbol: string): number {
  let hash = 0x811c9dc5
  const bytes = new TextEncoder().encode(symbol.trim().toUpperCase())
  for (const byte of bytes) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash % FANOUT_SHARDS
}

function parseFrame(value: unknown): DnseOrderbookFrame | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as DnseOrderbookFrame
}

function frameSymbol(frame: DnseOrderbookFrame) {
  return String(frame.symbol ?? "").trim().toUpperCase()
}

function timestampValueMs(value: unknown): number | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const source = value as Record<string, unknown>
    const seconds = Number(source.Seconds ?? source.seconds)
    const nanos = Number(source.Nanos ?? source.nanos ?? 0)
    if (Number.isFinite(seconds) && seconds > 0 && Number.isFinite(nanos)) {
      return seconds * 1000 + nanos / 1_000_000
    }
  }

  const numeric = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN
  if (Number.isFinite(numeric) && numeric > 0) {
    if (numeric >= 1e17) return numeric / 1_000_000
    if (numeric >= 1e12) return numeric
    if (numeric >= 1e9) return numeric * 1000
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function providerTimestampMs(frame: DnseOrderbookFrame): number | null {
  return timestampValueMs(frame.time ?? frame.t ?? frame.timestamp ?? frame.ts ?? frame.transactTime)
}

function latencyBetween(start: number | null, end: number | null): number | null {
  if (start == null || end == null) return null
  const delta = end - start
  if (!Number.isFinite(delta) || delta < 0 || delta > MAX_REASONABLE_LATENCY_MS) return null
  return Math.round(delta * 10) / 10
}

function percentile(values: number[], percent: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percent / 100) * sorted.length) - 1))
  return Math.round(sorted[index] * 10) / 10
}

function summarizeLatency(samples: OrderbookLatencySample[], metric: OrderbookLatencyMetric) {
  const values = samples
    .map((sample) => sample[metric])
    .filter((value): value is number => value != null && Number.isFinite(value))
  return {
    n: values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
  }
}

export function subscribeDnseOrderbookFrames(
  symbol: string,
  onFrame: (frame: DnseOrderbookFrame) => void,
  onState?: (state: DnseOrderbookStreamState) => void,
): () => void {
  const upper = symbol.trim().toUpperCase()
  const shard = orderbookFanoutShard(upper)
  const shardId = String(shard).padStart(2, "0")
  const checkpointStream = `orderbook-v1-${shardId}`
  const relayTopic = `orderbook:${upper}` as const

  let disposed = false
  let generation = 0
  let relayUnsubscribe: (() => void) | null = null
  let recoveryPromise: Promise<void> | null = null
  let recoveryRetryTimer: ReturnType<typeof setTimeout> | null = null
  let recoveryRequired = false
  let recoveryQueue: MarketRelayOrderbookMessage[] = []
  let relayWasReady = false
  let checkpointSequence = 0
  let liveSequence = 0
  let liveEpoch = ""
  let liveBaselineEstablished = false
  let lastMessageAtMs = Date.now()
  let latencyFrameCount = 0
  let nextLatencyReportAt = LATENCY_REPORT_EVERY
  const latencySamples: OrderbookLatencySample[] = []
  let currentState: DnseOrderbookStreamState = {
    status: "CONNECTING",
    error: "",
    lastMessageAt: "",
    sequence: 0,
  }

  const setState = (patch: Partial<DnseOrderbookStreamState>) => {
    currentState = { ...currentState, ...patch }
    onState?.(currentState)
  }

  const emitFrames = (frames: DnseOrderbookFrame[]) => {
    for (const frame of frames) {
      if (frameSymbol(frame) === upper) onFrame(frame)
    }
  }

  const recordLatency = (message: MarketRelayOrderbookMessage) => {
    const browserReceivedAt = Date.now()
    const publishedAt = timestampValueMs(message.publishedAt)
    let added = 0
    for (const frame of message.frames) {
      if (frameSymbol(frame) !== upper) continue
      const workerReceivedAt = timestampValueMs(frame[WORKER_RECEIVED_AT_FIELD])
      const providerAt = providerTimestampMs(frame)
      latencySamples.push({
        providerToWorker: latencyBetween(providerAt, workerReceivedAt),
        workerQueue: latencyBetween(workerReceivedAt, publishedAt),
        delivery: latencyBetween(publishedAt, browserReceivedAt),
        endToEnd: latencyBetween(providerAt, browserReceivedAt),
      })
      added += 1
    }
    if (!added) return

    latencyFrameCount += added
    if (latencySamples.length > LATENCY_SAMPLE_LIMIT) {
      latencySamples.splice(0, latencySamples.length - LATENCY_SAMPLE_LIMIT)
    }
    if (latencyFrameCount < nextLatencyReportAt) return

    const providerToWorker = summarizeLatency(latencySamples, "providerToWorker")
    const workerQueue = summarizeLatency(latencySamples, "workerQueue")
    const delivery = summarizeLatency(latencySamples, "delivery")
    const endToEnd = summarizeLatency(latencySamples, "endToEnd")
    console.info("[orderbook-latency]", {
      symbol: upper,
      batchId: message.batchId,
      samples: latencySamples.length,
      providerToWorker,
      workerQueue,
      delivery,
      endToEnd,
    })
    reportRealtimeHealth({
      stream: "orderbook",
      symbol: upper,
      batchId: message.batchId,
      epoch: message.epoch,
      sequence: message.sequence,
      samples: latencySamples.length,
      providerToWorker,
      workerQueue,
      delivery,
      endToEnd,
    })
    nextLatencyReportAt = Math.floor(latencyFrameCount / LATENCY_REPORT_EVERY + 1) * LATENCY_REPORT_EVERY
  }

  const resetLiveBaseline = () => {
    liveSequence = 0
    liveEpoch = ""
    liveBaselineEstablished = false
  }

  const clearRecoveryRetry = () => {
    if (recoveryRetryTimer) clearTimeout(recoveryRetryTimer)
    recoveryRetryTimer = null
  }

  const queueRecoveryMessage = (message: MarketRelayOrderbookMessage) => {
    recoveryQueue.push(message)
    if (recoveryQueue.length > MAX_RECOVERY_QUEUE) {
      recoveryQueue.splice(0, recoveryQueue.length - MAX_RECOVERY_QUEUE)
    }
  }

  const applyCheckpoint = (row: OrderbookCheckpointRow | null | undefined) => {
    if (!row) return
    const sequence = Number(row.sequence ?? 0)
    if (!Number.isSafeInteger(sequence) || sequence <= checkpointSequence) return
    checkpointSequence = sequence
    const frames = Array.isArray(row.frames)
      ? row.frames.map(parseFrame).filter((frame): frame is DnseOrderbookFrame => Boolean(frame))
      : []
    emitFrames(frames)
    const updatedAt = String(row.source_updated_at ?? row.updated_at ?? "")
    if (updatedAt) {
      const parsed = Date.parse(updatedAt)
      if (Number.isFinite(parsed)) lastMessageAtMs = parsed
    }
    setState({ sequence, lastMessageAt: updatedAt || currentState.lastMessageAt })
  }

  const bootstrapCheckpoint = async (expectedGeneration: number) => {
    const supabase = await getAuthenticatedSupabaseRealtimeClient()
    if (disposed || expectedGeneration !== generation) return
    const { data, error } = await supabase
      .from("market_realtime_bus")
      .select("sequence,frames,source_updated_at,updated_at")
      .eq("stream", checkpointStream)
      .maybeSingle()
    if (disposed || expectedGeneration !== generation) return
    if (error) throw new Error(`Orderbook realtime bootstrap failed: ${error.message}`)
    applyCheckpoint(data as OrderbookCheckpointRow | null)
  }

  const applyRelayMessage = (message: MarketRelayOrderbookMessage) => {
    if (message.symbol !== upper) return
    if (message.continuityGap) {
      void recover("Orderbook realtime continuity gap; refreshing session state.")
      return
    }
    if (liveBaselineEstablished) {
      if (message.epoch !== liveEpoch) {
        void recover("Orderbook realtime worker epoch changed; refreshing session state.")
        return
      }
      if (message.sequence !== liveSequence + 1) {
        void recover("Orderbook realtime sequence gap; refreshing session state.")
        return
      }
    }

    liveEpoch = message.epoch
    liveSequence = message.sequence
    liveBaselineEstablished = true
    lastMessageAtMs = Date.now()
    recordLatency(message)
    emitFrames(message.frames)
    setState({
      status: "LIVE",
      error: "",
      lastMessageAt: message.publishedAt || new Date(lastMessageAtMs).toISOString(),
      sequence: message.sequence,
    })
  }

  const drainRecoveryQueue = () => {
    const pending = recoveryQueue
    recoveryQueue = []
    for (let index = 0; index < pending.length; index += 1) {
      if (recoveryRequired || recoveryPromise) {
        for (const remaining of pending.slice(index)) queueRecoveryMessage(remaining)
        return
      }
      applyRelayMessage(pending[index])
    }
  }

  const scheduleRecoveryRetry = (message: string) => {
    if (disposed || recoveryRetryTimer) return
    recoveryRetryTimer = setTimeout(() => {
      recoveryRetryTimer = null
      void recover(message)
    }, RECOVERY_RETRY_MS)
  }

  async function recover(message: string) {
    if (disposed) return
    recoveryRequired = true
    resetLiveBaseline()
    setState({ status: "RECOVERING", error: message })
    if (recoveryPromise) return recoveryPromise

    clearRecoveryRetry()
    const expectedGeneration = generation
    recoveryPromise = (async () => {
      try {
        await bootstrapCheckpoint(expectedGeneration)
        if (disposed || expectedGeneration !== generation) return
        recoveryRequired = false
        recoveryPromise = null
        drainRecoveryQueue()
      } catch (error) {
        if (disposed || expectedGeneration !== generation) return
        recoveryPromise = null
        const reason = error instanceof Error ? error.message : String(error)
        setState({ status: "RECOVERING", error: reason })
        scheduleRecoveryRetry(reason)
      }
    })()
    return recoveryPromise
  }

  const handleRelayState = (state: MarketRelayConnectionState) => {
    if (state.status === "READY") {
      if (relayWasReady && recoveryRequired) {
        void recover("Orderbook realtime reconnected; refreshing session state.")
      }
      relayWasReady = true
      return
    }

    if (relayWasReady) {
      recoveryRequired = true
      resetLiveBaseline()
      recoveryQueue = []
    }
    if (state.status === "ERROR") {
      setState({ status: recoveryRequired ? "RECOVERING" : "ERROR", error: state.error })
    } else if (state.status === "CLOSED") {
      setState({ status: recoveryRequired ? "RECOVERING" : "CLOSED", error: "" })
    } else if (currentState.status !== "RECOVERING") {
      setState({ status: "CONNECTING", error: "" })
    }
  }

  const subscribeRelay = (expectedGeneration: number) => {
    relayUnsubscribe?.()
    relayUnsubscribe = subscribeMarketRelay(
      relayTopic,
      (message) => {
        if (disposed || expectedGeneration !== generation || message.type !== "orderbook") return
        if (recoveryRequired || recoveryPromise) {
          queueRecoveryMessage(message)
          return
        }
        applyRelayMessage(message)
      },
      (state) => {
        if (disposed || expectedGeneration !== generation) return
        handleRelayState(state)
      },
    )
  }

  const connect = async () => {
    if (disposed) return
    clearRecoveryRetry()
    const expectedGeneration = ++generation
    checkpointSequence = 0
    relayWasReady = false
    recoveryRequired = false
    recoveryQueue = []
    resetLiveBaseline()
    setState({ status: "CONNECTING", error: "" })
    try {
      await bootstrapCheckpoint(expectedGeneration)
    } catch (error) {
      if (disposed || expectedGeneration !== generation) return
      const message = error instanceof Error ? error.message : String(error)
      setState({ status: "ERROR", error: message })
      scheduleRecoveryRetry(message)
      return
    }
    if (disposed || expectedGeneration !== generation) return
    subscribeRelay(expectedGeneration)
  }

  const recoverIfStale = () => {
    if (disposed || document.visibilityState !== "visible") return
    if (Date.now() - lastMessageAtMs <= STALE_AFTER_MS && liveBaselineEstablished) return
    recoveryRequired = true
    resetLiveBaseline()
    setState({ status: "STALE", error: "Orderbook realtime stale; reconnecting." })
    restartMarketRelay()
  }
  const onVisibilityChange = () => recoverIfStale()
  const onOnline = () => {
    recoveryRequired = true
    resetLiveBaseline()
    setState({ status: "RECOVERING", error: "Network resumed; refreshing orderbook session state." })
  }

  document.addEventListener("visibilitychange", onVisibilityChange)
  window.addEventListener("online", onOnline)
  onState?.(currentState)
  void connect()

  return () => {
    disposed = true
    generation += 1
    clearRecoveryRetry()
    relayUnsubscribe?.()
    relayUnsubscribe = null
    recoveryPromise = null
    recoveryQueue = []
    document.removeEventListener("visibilitychange", onVisibilityChange)
    window.removeEventListener("online", onOnline)
  }
}
