"use client"

import type { DnseMarketFrame } from "@/modules/market/realtime/index-candles"
import {
  rewriteDnseBoardSubscriptionMessage,
  synthesizeDnseOhlcFromTickMessage,
} from "@/modules/market/board/dnse-subscriptions"

type DnseMarketFrameListener = (frame: DnseMarketFrame) => void
type WebSocketSendData = Parameters<WebSocket["send"]>[0]

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

/**
 * The DNSE normalUser tier caps subscriptions at 200 symbol/channel memberships.
 * The market board historically requested four stock feeds for the whole Top 200
 * plus index feeds, which DNSE rejects before any market frames can flow.
 *
 * Keep the canonical Top 200 on the core realtime trade feed. The existing board
 * still receives reference/foreign snapshots from its bootstrap paths; a transport
 * wrapper below also synthesizes OHLC frames from ticks so mini charts keep moving.
 */
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
