"use client"

import type { SupabaseClient } from "@supabase/supabase-js"
import type { DnseMarketFrame } from "@/modules/market/realtime/index-candles"
import { synthesizeDnseOhlcFromTickMessage } from "@/modules/market/board/dnse-subscriptions"
import {
  restartMarketRelay,
  subscribeMarketRelay,
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
const frameListeners = new Set<DnseMarketFrameListener>()
const stateListeners = new Set<DnseMarketStreamStateListener>()

let relayUnsubscribe: (() => void) | null = null
let bootstrapStarted = false
let startupGeneration = 0
let checkpointSequence = 0
let relaySequence = 0
let relayEpoch = ""
let liveBaselineEstablished = false
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
    // Ignore malformed synthetic frames. The original frame still flows.
  }
}

function applyBusRow(row: MarketRealtimeBusRow | null | undefined) {
  if (!row) return
  const sequence = Number(row.sequence ?? 0)
  if (!Number.isFinite(sequence) || sequence <= checkpointSequence) return
  const frames = Array.isArray(row.frames) ? row.frames : []
  const accepted = frames.map(parseFrame).filter((frame): frame is DnseMarketFrame => Boolean(frame))
  if (!accepted.length) return

  checkpointSequence = sequence
  const updatedAt = String(row.source_updated_at ?? row.updated_at ?? new Date().toISOString())
  for (const frame of accepted) emitFrameWithSyntheticOhlc(frame)
  setStreamState({ lastMessageAt: updatedAt, sequence })
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

function applyRelayMessage(message: MarketRelayMarketMessage) {
  if (liveBaselineEstablished) {
    if (message.epoch !== relayEpoch || message.sequence !== relaySequence + 1) {
      void restartDnseMarketStream()
      return
    }
  }

  relayEpoch = message.epoch
  relaySequence = message.sequence
  liveBaselineEstablished = true
  for (const frame of message.frames) {
    const parsed = parseFrame(frame)
    if (parsed) emitFrameWithSyntheticOhlc(parsed)
  }
  const lastMessageAt = message.publishedAt || new Date().toISOString()
  setStreamState({ status: "LIVE", error: "", lastMessageAt, sequence: message.sequence })
}

async function startRelay() {
  if (relayUnsubscribe || bootstrapStarted) return
  bootstrapStarted = true
  const generation = ++startupGeneration
  setStreamState({ status: "CONNECTING", error: "" })

  try {
    const supabase = await getAuthenticatedSupabaseRealtimeClient()
    if (generation !== startupGeneration) return
    await bootstrapCurrentRow(supabase)
  } catch (error) {
    if (generation !== startupGeneration) return
    setStreamState({ status: "ERROR", error: error instanceof Error ? error.message : String(error) })
  }
  if (generation !== startupGeneration) return

  relayUnsubscribe = subscribeMarketRelay(
    "market",
    (message) => {
      if (generation !== startupGeneration || message.type !== "market") return
      applyRelayMessage(message)
    },
    (state) => {
      if (generation !== startupGeneration) return
      if (state.status === "ERROR") {
        setStreamState({ status: "ERROR", error: state.error })
      } else if (state.status === "CLOSED") {
        setStreamState({ status: "CLOSED" })
      } else if (state.status === "CONNECTING" || state.status === "AUTHENTICATING") {
        setStreamState({ status: "CONNECTING", error: "" })
      }
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
  relayUnsubscribe?.()
  relayUnsubscribe = null
  bootstrapStarted = false
  resetLiveBaseline()
  setStreamState({ status: "CONNECTING", error: "" })
  restartMarketRelay()
  ensureRelay()
}
