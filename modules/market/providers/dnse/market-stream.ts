"use client"

import type { SupabaseClient } from "@supabase/supabase-js"
import type { DnseMarketFrame } from "@/modules/market/realtime/index-candles"
import { synthesizeDnseOhlcFromTickMessage } from "@/modules/market/board/dnse-subscriptions"
import { reportRealtimeHealth } from "@/modules/market/realtime/health-reporter"
import {
  restartMarketRelay,
  subscribeMarketRelay,
  type MarketRelayConnectionState,
  type MarketRelayMarketMessage,
} from "@/modules/market/realtime/relay-client"
import { getAuthenticatedSupabaseRealtimeClient } from "@/modules/shared/supabase/authenticated-realtime"

export type DnseMarketStreamStatus = "CONNECTING" | "LIVE" | "ERROR" | "CLOSED"
export type DnseMarketStreamState = {
  status: DnseMarketStreamStatus
  error: string
  lastMessageAt: string
  sequence: number
}

type DnseMarketFrameListener = (frame: DnseMarketFrame) => void
type DnseMarketStreamStateListener = (state: DnseMarketStreamState) => void

type MarketRealtimeBusRow = {
  stream?: unknown
  sequence?: unknown
  frames?: unknown
  source_updated_at?: unknown
  updated_at?: unknown
}

const STREAM_KEY = "dnse-market"
const BOOTSTRAP_RETRY_MS = 1_500
const MAX_RECOVERY_QUEUE = 256
const MARKET_DELIVERY_SAMPLE_LIMIT = 512
const MARKET_DELIVERY_REPORT_EVERY = 100
const MAX_REASONABLE_LATENCY_MS = 5 * 60_000
const frameListeners = new Set<DnseMarketFrameListener>()
const stateListeners = new Set<DnseMarketStreamStateListener>()

let relayUnsubscribe: (() => void) | null = null
let bootstrapStarted = false
let bootstrapRetryTimer: ReturnType<typeof setTimeout> | null = null
let startupGeneration = 0
let checkpointSequence = 0
let relaySequence = 0
let relayEpoch = ""
let liveBaselineEstablished = false
let relayWasReady = false
let recoveryRequired = false
let recoveryPromise: Promise<void> | null = null
let recoveryQueue: MarketRelayMarketMessage[] = []
let marketDeliveryMessageCount = 0
let nextMarketDeliveryReportAt = MARKET_DELIVERY_REPORT_EVERY
const marketDeliverySamples: number[] = []
let streamState: DnseMarketStreamState = {
  status: "CLOSED",
  error: "",
  lastMessageAt: "",
  sequence: 0,
}

function setStreamState(patch: Partial<DnseMarketStreamState>) {
  streamState = { ...streamState, ...patch }
  for (const listener of stateListeners) listener(streamState)
}

function parseFrame(value: unknown): DnseMarketFrame | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as DnseMarketFrame
}

function emitFrame(frame: DnseMarketFrame) {
  for (const listener of frameListeners) listener(frame)
}

function emitFrameWithSyntheticOhlc(frame: DnseMarketFrame) {
  emitFrame(frame)
  const synthetic = synthesizeDnseOhlcFromTickMessage(JSON.stringify(frame))
  if (!synthetic) return
  try {
    const parsed = parseFrame(JSON.parse(synthetic))
    if (parsed) emitFrame(parsed)
  } catch {
    // Ignore malformed synthetic frames. The original provider frame still flows.
  }
}

function percentile(values: number[], percent: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percent / 100) * sorted.length) - 1))
  return Math.round(sorted[index] * 10) / 10
}

function summarizeDelivery(values: number[]) {
  return {
    n: values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
  }
}

function resetMarketDeliveryTelemetry() {
  marketDeliveryMessageCount = 0
  nextMarketDeliveryReportAt = MARKET_DELIVERY_REPORT_EVERY
  marketDeliverySamples.length = 0
}

function recordMarketDelivery(message: MarketRelayMarketMessage) {
  const publishedAt = Date.parse(message.publishedAt)
  if (!Number.isFinite(publishedAt)) return

  const delivery = Date.now() - publishedAt
  if (!Number.isFinite(delivery) || delivery < 0 || delivery > MAX_REASONABLE_LATENCY_MS) return

  marketDeliverySamples.push(Math.round(delivery * 10) / 10)
  marketDeliveryMessageCount += 1
  if (marketDeliverySamples.length > MARKET_DELIVERY_SAMPLE_LIMIT) {
    marketDeliverySamples.splice(0, marketDeliverySamples.length - MARKET_DELIVERY_SAMPLE_LIMIT)
  }
  if (marketDeliveryMessageCount < nextMarketDeliveryReportAt) return

  reportRealtimeHealth({
    stream: "market",
    batchId: message.batchId,
    epoch: message.epoch,
    sequence: message.sequence,
    samples: marketDeliverySamples.length,
    delivery: summarizeDelivery(marketDeliverySamples),
  })
  nextMarketDeliveryReportAt =
    Math.floor(marketDeliveryMessageCount / MARKET_DELIVERY_REPORT_EVERY + 1) * MARKET_DELIVERY_REPORT_EVERY
}

function applyBusRow(row: MarketRealtimeBusRow | null | undefined) {
  if (!row) return
  const sequence = Number(row.sequence ?? 0)
  if (!Number.isSafeInteger(sequence) || sequence <= checkpointSequence) return
  const frames = Array.isArray(row.frames) ? row.frames : []
  const accepted = frames.map(parseFrame).filter((frame): frame is DnseMarketFrame => Boolean(frame))
  if (!accepted.length) return

  checkpointSequence = sequence
  const updatedAt = String(row.source_updated_at ?? row.updated_at ?? new Date().toISOString())
  for (const frame of accepted) emitFrameWithSyntheticOhlc(frame)
  setStreamState({ lastMessageAt: updatedAt })
}

async function bootstrapCurrentRow(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("market_realtime_bus")
    .select("stream,sequence,frames,source_updated_at,updated_at")
    .eq("stream", STREAM_KEY)
    .maybeSingle()

  if (error) throw new Error(`Market realtime bootstrap failed: ${error.message}`)
  applyBusRow(data as MarketRealtimeBusRow | null)
}

function resetLiveBaseline() {
  relaySequence = 0
  relayEpoch = ""
  liveBaselineEstablished = false
}

function clearBootstrapRetry() {
  if (bootstrapRetryTimer) clearTimeout(bootstrapRetryTimer)
  bootstrapRetryTimer = null
}

function scheduleBootstrapRetry() {
  if (bootstrapRetryTimer || frameListeners.size + stateListeners.size === 0) return
  bootstrapRetryTimer = setTimeout(() => {
    bootstrapRetryTimer = null
    ensureRelay()
  }, BOOTSTRAP_RETRY_MS)
}

function queueRecoveryMessage(message: MarketRelayMarketMessage) {
  recoveryQueue.push(message)
  if (recoveryQueue.length > MAX_RECOVERY_QUEUE) {
    recoveryQueue.splice(0, recoveryQueue.length - MAX_RECOVERY_QUEUE)
  }
}

function applyRelayMessage(message: MarketRelayMarketMessage) {
  if (message.continuityGap) {
    void recoverFromCheckpoint("Market realtime continuity gap; refreshing checkpoint.")
    return
  }
  if (liveBaselineEstablished) {
    if (message.epoch !== relayEpoch || message.sequence !== relaySequence + 1) {
      void recoverFromCheckpoint("Market realtime sequence changed; refreshing checkpoint.")
      return
    }
  }

  relayEpoch = message.epoch
  relaySequence = message.sequence
  liveBaselineEstablished = true
  recordMarketDelivery(message)
  for (const frame of message.frames) {
    const parsed = parseFrame(frame)
    if (parsed) emitFrameWithSyntheticOhlc(parsed)
  }
  const lastMessageAt = message.publishedAt || new Date().toISOString()
  setStreamState({ status: "LIVE", error: "", lastMessageAt, sequence: message.sequence })
}

function drainRecoveryQueue() {
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

async function recoverFromCheckpoint(message: string) {
  if (!relayUnsubscribe) return
  recoveryRequired = true
  resetLiveBaseline()
  setStreamState({ status: "CONNECTING", error: message })
  if (recoveryPromise) return recoveryPromise

  const generation = startupGeneration
  recoveryPromise = (async () => {
    try {
      const supabase = await getAuthenticatedSupabaseRealtimeClient()
      if (generation !== startupGeneration) return
      await bootstrapCurrentRow(supabase)
      if (generation !== startupGeneration) return
      recoveryRequired = false
      recoveryPromise = null
      drainRecoveryQueue()
    } catch (error) {
      if (generation !== startupGeneration) return
      recoveryPromise = null
      bootstrapStarted = false
      setStreamState({ status: "ERROR", error: error instanceof Error ? error.message : String(error) })
      scheduleBootstrapRetry()
    }
  })()
  return recoveryPromise
}

function handleRelayState(state: MarketRelayConnectionState) {
  if (state.status === "READY") {
    if (relayWasReady && recoveryRequired) {
      void recoverFromCheckpoint("Market realtime reconnected; refreshing checkpoint.")
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
    setStreamState({ status: "ERROR", error: state.error })
  } else if (state.status === "CLOSED") {
    setStreamState({ status: "CLOSED", error: "" })
  } else {
    setStreamState({ status: "CONNECTING", error: "" })
  }
}

async function startRelay() {
  if (relayUnsubscribe || bootstrapStarted) return
  bootstrapStarted = true
  clearBootstrapRetry()
  const generation = ++startupGeneration
  checkpointSequence = 0
  relayWasReady = false
  recoveryRequired = false
  recoveryQueue = []
  resetLiveBaseline()
  resetMarketDeliveryTelemetry()
  setStreamState({ status: "CONNECTING", error: "" })

  try {
    const supabase = await getAuthenticatedSupabaseRealtimeClient()
    if (generation !== startupGeneration) return
    await bootstrapCurrentRow(supabase)
  } catch (error) {
    if (generation !== startupGeneration) return
    bootstrapStarted = false
    setStreamState({ status: "ERROR", error: error instanceof Error ? error.message : String(error) })
    scheduleBootstrapRetry()
    return
  }
  if (generation !== startupGeneration) return

  relayUnsubscribe = subscribeMarketRelay(
    "market",
    (message) => {
      if (generation !== startupGeneration || message.type !== "market") return
      if (recoveryRequired || recoveryPromise) {
        queueRecoveryMessage(message)
        return
      }
      applyRelayMessage(message)
    },
    (state) => {
      if (generation !== startupGeneration) return
      handleRelayState(state)
    },
  )
}

function ensureRelay() {
  void startRelay()
}

export function publishDnseMarketFrame(frame: DnseMarketFrame) {
  emitFrame(frame)
}

export function subscribeDnseMarketFrames(listener: DnseMarketFrameListener) {
  frameListeners.add(listener)
  ensureRelay()
  return () => frameListeners.delete(listener)
}

export function subscribeDnseMarketStreamState(listener: DnseMarketStreamStateListener) {
  stateListeners.add(listener)
  listener(streamState)
  ensureRelay()
  return () => stateListeners.delete(listener)
}

export async function restartDnseMarketStream() {
  startupGeneration += 1
  clearBootstrapRetry()
  relayUnsubscribe?.()
  relayUnsubscribe = null
  bootstrapStarted = false
  recoveryPromise = null
  recoveryRequired = false
  recoveryQueue = []
  checkpointSequence = 0
  relayWasReady = false
  resetLiveBaseline()
  resetMarketDeliveryTelemetry()
  setStreamState({ status: "CONNECTING", error: "" })
  restartMarketRelay()
  ensureRelay()
}
