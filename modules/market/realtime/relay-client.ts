"use client"

import { reportRealtimeConnectionState } from "@/modules/market/realtime/health-reporter"

export type MarketRelayTopic = "market" | `orderbook:${string}`
export type MarketRelayFrame = Record<string, unknown>

export type MarketRelayMarketMessage = {
  type: "market"
  batchId: string
  epoch: string
  sequence: number
  publishedAt: string
  browserReceivedAtMonotonicMs: number
  continuityGap: boolean
  frames: MarketRelayFrame[]
}

export type MarketRelayOrderbookMessage = {
  type: "orderbook"
  batchId: string
  symbol: string
  epoch: string
  sequence: number
  publishedAt: string
  browserReceivedAtMonotonicMs: number
  continuityGap: boolean
  frames: MarketRelayFrame[]
}

export type MarketRelayDataMessage = MarketRelayMarketMessage | MarketRelayOrderbookMessage
export type MarketRelayConnectionStatus = "CLOSED" | "CONNECTING" | "AUTHENTICATING" | "READY" | "ERROR"
export type MarketRelayConnectionState = {
  status: MarketRelayConnectionStatus
  error: string
  lastMessageAt: string
}

type MessageListener = (message: MarketRelayDataMessage) => void
type StateListener = (state: MarketRelayConnectionState) => void

type TokenResponse = {
  ok?: unknown
  token?: unknown
  expiresAt?: unknown
}

const RECONNECT_BASE_MS = 500
const RECONNECT_MAX_MS = 10_000
const topicListeners = new Map<MarketRelayTopic, Set<MessageListener>>()
const stateListeners = new Set<StateListener>()

let socket: WebSocket | null = null
let socketGeneration = 0
let reconnectAttempt = 0
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let lifecycleListenersAttached = false
let connectionState: MarketRelayConnectionState = {
  status: "CLOSED",
  error: "",
  lastMessageAt: "",
}

function activeTopics() {
  return [...topicListeners.entries()]
    .filter(([, listeners]) => listeners.size > 0)
    .map(([topic]) => topic)
}

function reportConnectionState() {
  reportRealtimeConnectionState({
    status: connectionState.status,
    reconnectAttempt,
    topicCount: activeTopics().length,
    hasError: Boolean(connectionState.error),
  })
}

function setState(patch: Partial<MarketRelayConnectionState>) {
  connectionState = { ...connectionState, ...patch }
  reportConnectionState()
  for (const listener of stateListeners) listener(connectionState)
}

function relayUrl() {
  return (process.env.NEXT_PUBLIC_QEO_MARKET_REALTIME_URL ?? "").trim()
}

function normalizeTopic(topic: MarketRelayTopic): MarketRelayTopic {
  if (topic === "market") return topic
  const symbol = topic.slice("orderbook:".length).trim().toUpperCase()
  return `orderbook:${symbol}` as MarketRelayTopic
}

function reconnectDelay(attempt: number) {
  const exponent = Math.min(Math.max(attempt - 1, 0), 5)
  return Math.min(RECONNECT_BASE_MS * 2 ** exponent, RECONNECT_MAX_MS) + Math.floor(Math.random() * 300)
}

function send(message: unknown) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false
  socket.send(JSON.stringify(message))
  return true
}

async function fetchRelayToken() {
  const response = await fetch("/api/market/realtime-token", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  })
  const body = await response.json().catch(() => null) as TokenResponse | null
  const token = typeof body?.token === "string" ? body.token.trim() : ""
  if (!response.ok || body?.ok !== true || !token) {
    throw new Error("Realtime authentication unavailable.")
  }
  return token
}

function parseFrames(value: unknown): MarketRelayFrame[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (frame): frame is MarketRelayFrame => Boolean(frame) && typeof frame === "object" && !Array.isArray(frame),
  )
}

function parseDataMessage(value: unknown, browserReceivedAtMonotonicMs: number): MarketRelayDataMessage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const batchId = typeof source.batchId === "string" ? source.batchId.trim().slice(0, 160) : ""
  const epoch = typeof source.epoch === "string" ? source.epoch : ""
  const sequence = Number(source.sequence)
  const publishedAt = typeof source.publishedAt === "string" ? source.publishedAt : ""
  if (!epoch || !Number.isSafeInteger(sequence) || sequence <= 0) return null

  if (source.type === "market") {
    return {
      type: "market",
      batchId,
      epoch,
      sequence,
      publishedAt,
      browserReceivedAtMonotonicMs,
      continuityGap: source.continuityGap === true,
      frames: parseFrames(source.frames),
    }
  }

  if (source.type === "orderbook") {
    const symbol = typeof source.symbol === "string" ? source.symbol.trim().toUpperCase() : ""
    if (!symbol) return null
    return {
      type: "orderbook",
      batchId,
      symbol,
      epoch,
      sequence,
      publishedAt,
      browserReceivedAtMonotonicMs,
      continuityGap: source.continuityGap === true,
      frames: parseFrames(source.frames),
    }
  }
  return null
}

function dispatch(message: MarketRelayDataMessage) {
  const topic: MarketRelayTopic = message.type === "market" ? "market" : `orderbook:${message.symbol}`
  for (const listener of topicListeners.get(topic) ?? []) listener(message)
}

function clearReconnectTimer() {
  if (reconnectTimer) clearTimeout(reconnectTimer)
  reconnectTimer = null
}

function detachSocket(close = true) {
  const current = socket
  socket = null
  socketGeneration += 1
  if (close && current && current.readyState < WebSocket.CLOSING) {
    current.close(1000, "relay reset")
  }
}

function scheduleReconnect(message: string) {
  if (activeTopics().length === 0 || reconnectTimer) return
  reconnectAttempt += 1
  setState({ status: "ERROR", error: message })
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    void connect()
  }, reconnectDelay(reconnectAttempt))
}

async function connect() {
  clearReconnectTimer()
  if (activeTopics().length === 0 || socket) return

  const url = relayUrl()
  if (!url || !/^wss?:\/\//i.test(url)) {
    scheduleReconnect("Realtime endpoint unavailable.")
    return
  }

  const generation = ++socketGeneration
  setState({ status: "CONNECTING", error: "" })
  try {
    const token = await fetchRelayToken()
    if (generation !== socketGeneration || activeTopics().length === 0) return

    const nextSocket = new WebSocket(url)
    socket = nextSocket
    nextSocket.onopen = () => {
      if (socket !== nextSocket || generation !== socketGeneration) return
      setState({ status: "AUTHENTICATING", error: "" })
      nextSocket.send(JSON.stringify({ type: "auth", token }))
    }
    nextSocket.onmessage = (event) => {
      if (socket !== nextSocket || generation !== socketGeneration) return
      const browserReceivedAtMonotonicMs = performance.now()
      let payload: unknown
      try {
        payload = JSON.parse(String(event.data))
      } catch {
        return
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return
      const source = payload as Record<string, unknown>
      if (source.type === "ready") {
        reconnectAttempt = 0
        setState({ status: "READY", error: "" })
        const topics = activeTopics()
        if (topics.length) send({ type: "subscribe", topics })
        return
      }
      if (source.type === "error") {
        const code = typeof source.code === "string" ? source.code : "RELAY_ERROR"
        setState({ status: "ERROR", error: `Realtime relay error (${code}).` })
        return
      }

      const message = parseDataMessage(payload, browserReceivedAtMonotonicMs)
      if (!message) return
      setState({ status: "READY", error: "", lastMessageAt: new Date().toISOString() })
      dispatch(message)
    }
    nextSocket.onerror = () => {
      if (socket === nextSocket && generation === socketGeneration) {
        setState({ status: "ERROR", error: "Realtime connection error." })
      }
    }
    nextSocket.onclose = () => {
      if (socket !== nextSocket || generation !== socketGeneration) return
      socket = null
      scheduleReconnect("Realtime connection closed; reconnecting.")
    }
  } catch (error) {
    if (generation !== socketGeneration) return
    socket = null
    scheduleReconnect(error instanceof Error ? error.message : "Realtime connection unavailable.")
  }
}

function onOnline() {
  if (activeTopics().length > 0) restartMarketRelay()
}

function onVisibilityChange() {
  if (document.visibilityState !== "visible" || activeTopics().length === 0) return
  if (!socket || connectionState.status !== "READY") restartMarketRelay()
}

function attachLifecycleListeners() {
  if (lifecycleListenersAttached) return
  lifecycleListenersAttached = true
  window.addEventListener("online", onOnline)
  document.addEventListener("visibilitychange", onVisibilityChange)
}

function detachLifecycleListeners() {
  if (!lifecycleListenersAttached) return
  lifecycleListenersAttached = false
  window.removeEventListener("online", onOnline)
  document.removeEventListener("visibilitychange", onVisibilityChange)
}

export function subscribeMarketRelay(
  topic: MarketRelayTopic,
  onMessage: MessageListener,
  onState?: StateListener,
) {
  const normalized = normalizeTopic(topic)
  let listeners = topicListeners.get(normalized)
  if (!listeners) {
    listeners = new Set()
    topicListeners.set(normalized, listeners)
  }
  const firstForTopic = listeners.size === 0
  listeners.add(onMessage)

  if (onState) {
    stateListeners.add(onState)
    onState(connectionState)
  }
  attachLifecycleListeners()
  reportConnectionState()
  if (firstForTopic && connectionState.status === "READY") {
    send({ type: "subscribe", topics: [normalized] })
  }
  void connect()

  return () => {
    const current = topicListeners.get(normalized)
    current?.delete(onMessage)
    if (onState) stateListeners.delete(onState)
    if (current && current.size === 0) {
      topicListeners.delete(normalized)
      if (connectionState.status === "READY") {
        send({ type: "unsubscribe", topics: [normalized] })
      }
    }
    reportConnectionState()
    if (activeTopics().length === 0) {
      clearReconnectTimer()
      detachSocket()
      detachLifecycleListeners()
      reconnectAttempt = 0
      setState({ status: "CLOSED", error: "" })
    }
  }
}

export function restartMarketRelay() {
  if (activeTopics().length === 0) return
  clearReconnectTimer()
  detachSocket()
  setState({ status: "CONNECTING", error: "" })
  void connect()
}
