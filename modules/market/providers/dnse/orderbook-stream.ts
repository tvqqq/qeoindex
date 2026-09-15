"use client"

import {
  subscribeMarketRelay,
  type MarketRelayOrderbookMessage,
} from "@/modules/market/realtime/relay-client"
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

const FANOUT_SHARDS = 10
const STALE_AFTER_MS = 45_000

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
  let checkpointSequence = 0
  let liveSequence = 0
  let liveEpoch = ""
  let liveBaselineEstablished = false
  let lastMessageAtMs = Date.now()
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

  const resetLiveBaseline = () => {
    liveSequence = 0
    liveEpoch = ""
    liveBaselineEstablished = false
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
    emitFrames(message.frames)
    setState({
      status: "LIVE",
      error: "",
      lastMessageAt: message.publishedAt || new Date(lastMessageAtMs).toISOString(),
      sequence: message.sequence,
    })
  }

  const subscribeRelay = (expectedGeneration: number) => {
    relayUnsubscribe?.()
    relayUnsubscribe = subscribeMarketRelay(
      relayTopic,
      (message) => {
        if (disposed || expectedGeneration !== generation || message.type !== "orderbook") return
        applyRelayMessage(message)
      },
      (state) => {
        if (disposed || expectedGeneration !== generation) return
        if (state.status === "ERROR") {
          setState({ status: currentState.status === "RECOVERING" ? "RECOVERING" : "ERROR", error: state.error })
        } else if (state.status === "CLOSED") {
          setState({ status: "CLOSED", error: "" })
        } else if ((state.status === "CONNECTING" || state.status === "AUTHENTICATING") && currentState.status !== "RECOVERING") {
          setState({ status: "CONNECTING", error: "" })
        }
      },
    )
  }

  async function connect(status: DnseOrderbookStreamStatus = "CONNECTING") {
    if (disposed) return
    const expectedGeneration = ++generation
    resetLiveBaseline()
    setState({ status, error: "" })
    try {
      await bootstrapCheckpoint(expectedGeneration)
    } catch (error) {
      if (disposed || expectedGeneration !== generation) return
      setState({ status, error: error instanceof Error ? error.message : String(error) })
    }
    if (disposed || expectedGeneration !== generation) return
    subscribeRelay(expectedGeneration)
  }

  async function recover(message: string) {
    if (disposed) return
    if (recoveryPromise) return recoveryPromise
    setState({ status: "RECOVERING", error: message })
    relayUnsubscribe?.()
    relayUnsubscribe = null
    recoveryPromise = connect("RECOVERING").finally(() => {
      recoveryPromise = null
    })
    return recoveryPromise
  }

  const recoverIfStale = () => {
    if (disposed || document.visibilityState !== "visible") return
    if (Date.now() - lastMessageAtMs <= STALE_AFTER_MS && liveBaselineEstablished) return
    setState({ status: "STALE", error: "Orderbook realtime stale; reconnecting." })
    void recover("Orderbook realtime stale; refreshing session state.")
  }
  const onVisibilityChange = () => recoverIfStale()
  const onOnline = () => void recover("Network resumed; refreshing orderbook session state.")

  document.addEventListener("visibilitychange", onVisibilityChange)
  window.addEventListener("online", onOnline)
  onState?.(currentState)
  void connect()

  return () => {
    disposed = true
    generation += 1
    relayUnsubscribe?.()
    relayUnsubscribe = null
    document.removeEventListener("visibilitychange", onVisibilityChange)
    window.removeEventListener("online", onOnline)
  }
}
