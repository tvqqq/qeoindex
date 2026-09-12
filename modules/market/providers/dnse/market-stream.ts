"use client"

import type { RealtimeChannel } from "@supabase/supabase-js"
import type { DnseMarketFrame } from "@/modules/market/realtime/index-candles"
import { synthesizeDnseOhlcFromTickMessage } from "@/modules/market/board/dnse-subscriptions"
import { getSupabaseBrowserClient } from "@/modules/shared/supabase/client"

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
const CHANNEL_NAME = "market-realtime-bus"
const frameListeners = new Set<DnseMarketFrameListener>()
const stateListeners = new Set<DnseMarketStreamStateListener>()

let realtimeChannel: RealtimeChannel | null = null
let bootstrapStarted = false
let latestSequence = 0
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

function applyBusRow(row: MarketRealtimeBusRow | null | undefined) {
  if (!row) return
  const sequence = Number(row.sequence ?? 0)
  if (!Number.isFinite(sequence) || sequence <= latestSequence) return
  const frames = Array.isArray(row.frames) ? row.frames : []
  const accepted = frames.map(parseFrame).filter((frame): frame is DnseMarketFrame => Boolean(frame))
  if (!accepted.length) return

  latestSequence = sequence
  const updatedAt = String(row.source_updated_at ?? row.updated_at ?? new Date().toISOString())
  for (const frame of accepted) emitFrameWithSyntheticOhlc(frame)
  setStreamState({ status: "LIVE", error: "", lastMessageAt: updatedAt, sequence })
}

async function bootstrapCurrentRow() {
  const supabase = getSupabaseBrowserClient()
  if (!supabase) return
  const { data, error } = await supabase
    .from("market_realtime_bus")
    .select("stream,sequence,frames,source_updated_at,updated_at")
    .eq("stream", STREAM_KEY)
    .maybeSingle()

  if (error) {
    setStreamState({ status: "ERROR", error: `Supabase realtime bootstrap failed: ${error.message}` })
    return
  }
  applyBusRow(data as MarketRealtimeBusRow | null)
}

function ensureSupabaseRealtime() {
  if (realtimeChannel || bootstrapStarted) return
  bootstrapStarted = true
  const supabase = getSupabaseBrowserClient()
  if (!supabase) {
    setStreamState({ status: "ERROR", error: "Supabase browser client is not configured." })
    return
  }

  setStreamState({ status: "CONNECTING", error: "" })
  void bootstrapCurrentRow()

  realtimeChannel = supabase
    .channel(CHANNEL_NAME)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "market_realtime_bus", filter: `stream=eq.${STREAM_KEY}` },
      (payload) => applyBusRow(payload.new as MarketRealtimeBusRow),
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        setStreamState({ status: latestSequence > 0 ? "LIVE" : "CONNECTING", error: "" })
        return
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        setStreamState({ status: "ERROR", error: `Supabase realtime channel ${status.toLowerCase()}.` })
        return
      }
      if (status === "CLOSED") setStreamState({ status: "CLOSED" })
    })
}

export function publishDnseMarketFrame(frame: DnseMarketFrame) {
  emitFrame(frame)
}

export function subscribeDnseMarketFrames(listener: DnseMarketFrameListener) {
  frameListeners.add(listener)
  ensureSupabaseRealtime()
  return () => frameListeners.delete(listener)
}

export function subscribeDnseMarketStreamState(listener: DnseMarketStreamStateListener) {
  stateListeners.add(listener)
  listener(streamState)
  ensureSupabaseRealtime()
  return () => stateListeners.delete(listener)
}
