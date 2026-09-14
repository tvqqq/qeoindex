"use client"

import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js"
import { getAuthenticatedSupabaseRealtimeClient } from "@/modules/shared/supabase/authenticated-realtime"

export type DnseOrderbookFrame = Record<string, unknown>
export type DnseOrderbookStreamStatus = "CONNECTING" | "LIVE" | "RECOVERING" | "STALE" | "ERROR" | "CLOSED"
export type DnseOrderbookStreamState = {
  status: DnseOrderbookStreamStatus
  error: string
  lastMessageAt: string
  sequence: number
}

type OrderbookEnvelope = {
  version: number
  shard: number
  sequence: number
  epoch: number
  continuityGap: boolean
  publishedAt: string
  frames: DnseOrderbookFrame[]
}

type OrderbookCheckpointRow = {
  sequence?: unknown
  frames?: unknown
  source_updated_at?: unknown
  updated_at?: unknown
}

const FANOUT_SHARDS = 10
const STALE_AFTER_MS = 45_000
const RECONNECT_BASE_MS = 750
const RECONNECT_MAX_MS = 10_000

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

function parseEnvelope(value: unknown): OrderbookEnvelope | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const version = Number(source.version)
  const shard = Number(source.shard)
  const sequence = Number(source.sequence)
  const epoch = Number(source.epoch ?? 0)
  if (version !== 1 || !Number.isInteger(shard) || shard < 0 || shard >= FANOUT_SHARDS) return null
  if (!Number.isSafeInteger(sequence) || sequence <= 0) return null
  if (!Number.isSafeInteger(epoch) || epoch < 0) return null
  const frames = Array.isArray(source.frames)
    ? source.frames.map(parseFrame).filter((frame): frame is DnseOrderbookFrame => Boolean(frame))
    : []
  return {
    version,
    shard,
    sequence,
    epoch,
    continuityGap: source.continuityGap === true,
    publishedAt: String(source.publishedAt ?? ""),
    frames,
  }
}

function frameSymbol(frame: DnseOrderbookFrame) {
  return String(frame.symbol ?? "").trim().toUpperCase()
}

function reconnectDelay(attempt: number) {
  const exponent = Math.min(Math.max(attempt - 1, 0), 4)
  return Math.min(RECONNECT_BASE_MS * 2 ** exponent, RECONNECT_MAX_MS) + Math.floor(Math.random() * 400)
}

export function subscribeDnseOrderbookFrames(
  symbol: string,
  onFrame: (frame: DnseOrderbookFrame) => void,
  onState?: (state: DnseOrderbookStreamState) => void,
): () => void {
  const upper = symbol.trim().toUpperCase()
  const shard = orderbookFanoutShard(upper)
  const shardId = String(shard).padStart(2, "0")
  const topic = `orderbook:v1:${shardId}`
  const checkpointStream = `orderbook-v1-${shardId}`

  let disposed = false
  let generation = 0
  let channel: RealtimeChannel | null = null
  let channelClient: SupabaseClient | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let attempts = 0
  let latestSequence = 0
  let latestEpoch = 0
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

  const clearReconnectTimer = () => {
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  const removeCurrentChannel = async () => {
    const current = channel
    const client = channelClient
    channel = null
    channelClient = null
    if (!current || !client) return
    try {
      await client.removeChannel(current)
    } catch {
      // Cleanup failure must not prevent a fresh authenticated join.
    }
  }

  const scheduleReconnect = (status: DnseOrderbookStreamStatus, message: string) => {
    if (disposed || reconnectTimer) return
    attempts += 1
    setState({ status, error: message })
    const delay = reconnectDelay(attempts)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      void connect()
    }, delay)
  }

  const restartForRecovery = (message: string) => {
    if (disposed) return
    generation += 1
    latestEpoch = 0
    clearReconnectTimer()
    setState({ status: "RECOVERING", error: message })
    void removeCurrentChannel().finally(() => scheduleReconnect("RECOVERING", message))
  }

  const applyCheckpoint = (row: OrderbookCheckpointRow | null | undefined) => {
    if (!row) return
    const sequence = Number(row.sequence ?? 0)
    if (!Number.isSafeInteger(sequence) || sequence <= 0) return
    latestSequence = sequence
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

  const applyEnvelope = (envelope: OrderbookEnvelope) => {
    if (envelope.shard !== shard) return

    // Continuity flags must be evaluated before duplicate-sequence suppression:
    // after a worker crash the first new broadcast can reuse the uncheckpointed
    // sequence and still needs to force authoritative session recovery.
    if (envelope.continuityGap) {
      restartForRecovery("Orderbook realtime continuity gap; refreshing session state.")
      return
    }
    if (latestEpoch > 0 && envelope.epoch !== latestEpoch) {
      restartForRecovery("Orderbook realtime worker epoch changed; refreshing session state.")
      return
    }
    if (latestSequence > 0 && envelope.sequence > latestSequence + 1) {
      restartForRecovery("Orderbook realtime sequence gap; refreshing session state.")
      return
    }
    if (envelope.sequence <= latestSequence) return

    latestSequence = envelope.sequence
    latestEpoch = envelope.epoch
    lastMessageAtMs = Date.now()
    emitFrames(envelope.frames)
    attempts = 0
    setState({
      status: "LIVE",
      error: "",
      lastMessageAt: envelope.publishedAt || new Date(lastMessageAtMs).toISOString(),
      sequence: latestSequence,
    })
  }

  const connect = async () => {
    clearReconnectTimer()
    if (disposed) return
    const thisGeneration = ++generation
    setState({ status: currentState.status === "RECOVERING" ? "RECOVERING" : "CONNECTING", error: "" })

    try {
      const supabase = await getAuthenticatedSupabaseRealtimeClient()
      if (disposed || thisGeneration !== generation) return

      const { data, error } = await supabase
        .from("market_realtime_bus")
        .select("sequence,frames,source_updated_at,updated_at")
        .eq("stream", checkpointStream)
        .maybeSingle()
      if (disposed || thisGeneration !== generation) return
      if (error) throw new Error(`Orderbook realtime bootstrap failed: ${error.message}`)
      applyCheckpoint(data as OrderbookCheckpointRow | null)

      const nextChannel = supabase
        .channel(topic, { config: { private: true } })
        .on("broadcast", { event: "orderbook" }, (message) => {
          if (disposed || thisGeneration !== generation || channel !== nextChannel) return
          const payload = message && typeof message === "object" && "payload" in message
            ? (message as { payload?: unknown }).payload
            : message
          const envelope = parseEnvelope(payload)
          if (envelope) applyEnvelope(envelope)
        })

      if (disposed || thisGeneration !== generation) {
        void supabase.removeChannel(nextChannel)
        return
      }
      channelClient = supabase
      channel = nextChannel
      nextChannel.subscribe((status) => {
        if (disposed || thisGeneration !== generation || channel !== nextChannel) return
        if (status === "SUBSCRIBED") {
          attempts = 0
          // A checkpoint is hydration, not proof that the producer is currently
          // live. Only a fresh Broadcast envelope transitions the popup to LIVE.
          setState({ status: "CONNECTING", error: "" })
          return
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          generation += 1
          void removeCurrentChannel().finally(() => {
            scheduleReconnect("ERROR", `Orderbook realtime channel ${status.toLowerCase()}.`)
          })
          return
        }
        if (status === "CLOSED") {
          generation += 1
          void removeCurrentChannel().finally(() => {
            scheduleReconnect("CLOSED", "Orderbook realtime channel closed; reconnecting.")
          })
        }
      })
    } catch (error) {
      if (disposed || thisGeneration !== generation) return
      generation += 1
      await removeCurrentChannel()
      scheduleReconnect("ERROR", error instanceof Error ? error.message : String(error))
    }
  }

  const recoverIfStale = () => {
    if (disposed || document.visibilityState !== "visible") return
    if (Date.now() - lastMessageAtMs <= STALE_AFTER_MS && channel) return
    setState({ status: "STALE", error: "Orderbook realtime stale; reconnecting." })
    restartForRecovery("Orderbook realtime stale; refreshing session state.")
  }
  const onVisibilityChange = () => recoverIfStale()
  const onOnline = () => recoverIfStale()

  document.addEventListener("visibilitychange", onVisibilityChange)
  window.addEventListener("online", onOnline)
  onState?.(currentState)
  void connect()

  return () => {
    disposed = true
    generation += 1
    clearReconnectTimer()
    document.removeEventListener("visibilitychange", onVisibilityChange)
    window.removeEventListener("online", onOnline)
    void removeCurrentChannel()
  }
}
