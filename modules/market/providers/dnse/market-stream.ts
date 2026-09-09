"use client"

import type { DnseMarketFrame } from "@/modules/market/realtime/index-candles"
import { buildDnseBoardSubscriptionPlan } from "@/modules/market/board/dnse-subscriptions"

type DnseMarketFrameListener = (frame: DnseMarketFrame) => void
type DnseChannelRow = { name: string; symbols?: unknown[] }
type DnseSubscribePayload = { action?: unknown; channels?: unknown }
type WebSocketSendData = Parameters<WebSocket["send"]>[0]

const BOARD_STOCK_CHANNELS = ["tick.G1.json", "top_price.G1.json", "ohlc.1.json", "foreign.G1.json"] as const
const listeners = new Set<DnseMarketFrameListener>()
const guardedSockets = new WeakSet<WebSocket>()

function isDnseStreamSocket(socket: WebSocket) {
  try {
    const hostname = new URL(socket.url).hostname.toLowerCase()
    return hostname === "ws-openapi.dnse.com.vn" || hostname.endsWith(".dnse.com.vn")
  } catch {
    return false
  }
}

function channelRows(value: unknown): DnseChannelRow[] {
  if (!Array.isArray(value)) return []
  return value.filter((row): row is DnseChannelRow => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return false
    return typeof (row as Record<string, unknown>).name === "string"
  })
}

/**
 * The DNSE normalUser tier caps subscriptions at 200 symbol/channel memberships.
 * The market board historically requested four stock feeds for the whole Top 200
 * plus index feeds, which DNSE rejects before any market frames can flow.
 *
 * Keep the canonical Top 200 on the core realtime trade feed. The existing board
 * still receives reference/foreign snapshots from its bootstrap paths; a transport
 * wrapper below also synthesizes OHLC frames from ticks so mini charts keep moving.
 */
export function rewriteDnseBoardSubscriptionMessage(data: unknown): unknown {
  if (typeof data !== "string") return data

  try {
    const payload = JSON.parse(data) as DnseSubscribePayload
    if (payload.action !== "subscribe") return data

    const rows = channelRows(payload.channels)
    const names = new Set(rows.map((row) => row.name))
    if (!BOARD_STOCK_CHANNELS.every((name) => names.has(name))) return data

    const tick = rows.find((row) => row.name === "tick.G1.json")
    if (!tick || !Array.isArray(tick.symbols)) return data

    const symbols = tick.symbols.map((symbol) => String(symbol ?? ""))
    const plan = buildDnseBoardSubscriptionPlan(symbols)
    return JSON.stringify({ ...payload, channels: plan.channels })
  } catch {
    return data
  }
}

export function synthesizeDnseOhlcFromTickMessage(data: unknown): string | null {
  if (typeof data !== "string") return null

  try {
    const frame = JSON.parse(data) as Record<string, unknown>
    if (String(frame.T ?? "") !== "t" || !frame.symbol) return null
    const rawPrice = frame.matchPrice ?? frame.price ?? frame.lastPrice
    const price = typeof rawPrice === "number" ? rawPrice : Number(rawPrice)
    if (!Number.isFinite(price) || price <= 0) return null
    return JSON.stringify({ ...frame, T: "b", close: price })
  } catch {
    return null
  }
}

function preserveBoardMiniCharts(socket: WebSocket) {
  if (guardedSockets.has(socket) || !socket.onmessage) return
  const originalOnMessage = socket.onmessage

  socket.onmessage = function onBudgetedMarketMessage(event) {
    originalOnMessage.call(socket, event)
    const synthetic = synthesizeDnseOhlcFromTickMessage(event.data)
    if (!synthetic) return
    originalOnMessage.call(socket, new MessageEvent("message", { data: synthetic }))
  }
  guardedSockets.add(socket)
}

function installDnseBoardSubscriptionBudgetGuard() {
  if (typeof WebSocket === "undefined") return
  const runtime = globalThis as typeof globalThis & { __qeoDnseBoardBudgetGuardInstalled?: boolean }
  if (runtime.__qeoDnseBoardBudgetGuardInstalled) return

  const originalSend = WebSocket.prototype.send
  WebSocket.prototype.send = function sendWithDnseBoardBudget(data: WebSocketSendData) {
    if (!isDnseStreamSocket(this)) return originalSend.call(this, data)
    const rewritten = rewriteDnseBoardSubscriptionMessage(data)
    if (rewritten !== data) preserveBoardMiniCharts(this)
    return originalSend.call(this, rewritten as WebSocketSendData)
  }
  runtime.__qeoDnseBoardBudgetGuardInstalled = true
}

installDnseBoardSubscriptionBudgetGuard()

export function publishDnseMarketFrame(frame: DnseMarketFrame) {
  if (!listeners.size) return
  for (const listener of listeners) listener(frame)
}

export function subscribeDnseMarketFrames(listener: DnseMarketFrameListener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
