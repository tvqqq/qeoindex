"use client"

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Activity,
  BarChart3,
  ExternalLink,
  GripVertical,
  Layers,
  ListFilter,
  Maximize2,
  Minimize2,
  Minus,
  PieChart,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react"
import { MarketChangePill } from "@/components/market-change-pill"
import { marketToneFromPrice, marketToneHex, marketToneText } from "@/lib/market-tone"
import type { StockInitialMeta } from "@/components/orderbook/orderbook-context"

type DepthLevel = { price: number; volume: number }
type TradeSide = "BUY" | "SELL" | "UNKNOWN"
type StreamTrade = { id: string; time: string; price: number; volume: number; side: TradeSide }
type StockQuote = {
  symbol: string
  price: number
  reference?: number
  ceiling?: number
  floor?: number
  change?: number
  changePercent: number
  high?: number
  low?: number
  avgPrice?: number
  totalVolume?: number
  volume?: number
  totalValue?: number
  updatedAt: string
}
type StreamState = "CONNECTING" | "LIVE" | "ERROR" | "CLOSED"
type ActivityTab = "trades" | "foreign" | "profile"
type HistoryState = "LOADING" | "READY" | "PARTIAL" | "ERROR"

type ForeignSnapshot = {
  symbol: string
  totalBuyVolume: number
  totalSellVolume: number
  totalBuyValue: number
  totalSellValue: number
  availableRoom: number | null
  orderLimitQuantity: number | null
  listedShare: number | null
  investorTypeCode?: string
  updatedAt: string
}

type ForeignFlowEvent = { id: string; time: string; side: "BUY" | "SELL"; volume: number; value: number | null }

type CompanyInfo = {
  nameVi: string
  nameEn?: string
  exchange?: string
  sector?: string
}

type SessionHistoryResponse = {
  ok: boolean
  message?: string
  sessionStart?: number
  prices?: Array<{ time: number; open?: number; close: number }>
  trades?: Array<{ id: string; time: number; price: number; volume: number; side: string }>
  tradesTruncated?: boolean
  latestQuote?: {
    time: number | null
    bid: unknown[]
    offer: unknown[]
    matchPrice: number | null
    openPrice: number | null
    reference?: number | null
    ceiling?: number | null
    floor?: number | null
    highPrice?: number | null
    lowPrice?: number | null
    avgPrice?: number | null
    totalVolume?: number | null
  } | null
  foreign?: {
    totalBuyVolume?: number
    totalSellVolume?: number
    totalBuyValue?: number
    totalSellValue?: number
    availableRoom?: number | null
    orderLimitQuantity?: number | null
    listedShare?: number | null
    updatedAt?: string
  } | null
  company?: {
    nameVi?: string
    nameEn?: string
    exchange?: string
    sector?: string
  } | null
}

const ORDERBOOK_VOLUME_MULTIPLIER = 10
const LARGE_TRADE_MIN_VOLUME = 10_000
const WHALE_TRADE_MIN_VOLUME = 50_000
const OPEN_PRICE_KEYS = ["openPrice", "openingPrice", "open", "openValue", "firstPrice"]
const STREAM_STALE_MS = 45_000
const MAX_SESSION_TRADES = 6_000

const DEFAULT_WIDTH = 760
const MIN_WIDTH = 460
const MIN_HEIGHT = 420
const DEFAULT_HEIGHT = 680

function number(value: unknown) {
  const result = typeof value === "number" ? value : Number(value)
  return Number.isFinite(result) ? result : 0
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const result = typeof value === "number" ? value : Number(value)
  return Number.isFinite(result) ? result : null
}

function firstPositive(data: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = number(data[key])
    if (value > 0) return value
  }
  return 0
}

function formatPrice(value?: number | null, allowNegative = false) {
  if (typeof value !== "number" || !Number.isFinite(value) || (!allowNegative && value <= 0)) return "—"
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(value)
}

function formatVolume(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—"
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(value)
}

function formatMarketValue(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—"
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(abs >= 10_000_000_000 ? 1 : 2)} tỷ`
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} tr`
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(value)
}

function formatCompactVolume(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "—"
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 1 : 2)} tr`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} k`
  return value.toLocaleString("vi-VN")
}

function normalizeDepth(rows: unknown): DepthLevel[] {
  if (!Array.isArray(rows)) return []
  return rows
    .map((row: any) => ({
      price: number(row?.price),
      volume: number(row?.qtty ?? row?.quantity ?? row?.volume) * ORDERBOOK_VOLUME_MULTIPLIER,
    }))
    .filter((row) => row.price > 0 && row.volume >= 0)
}

function normalizeTime(value: unknown) {
  if (typeof value === "number") {
    const millis = value > 10_000_000_000 ? value : value * 1000
    return new Date(millis).toISOString()
  }
  if (value && typeof value === "object") {
    const seconds = number((value as any).Seconds ?? (value as any).seconds)
    const nanos = number((value as any).Nanos ?? (value as any).nanos)
    if (seconds > 0) return new Date((seconds + nanos / 1e9) * 1000).toISOString()
  }
  const text = String(value ?? "")
  const parsed = Date.parse(text)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString()
}

function timeLabel(value: string) {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return value || "—"
  return new Date(parsed).toLocaleTimeString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

function explicitSide(rawSide: unknown): TradeSide {
  const side = String(rawSide ?? "").toUpperCase()
  if (["BUY", "B", "MUA", "BU", "NB"].includes(side)) return "BUY"
  if (["SELL", "S", "BÁN", "BAN", "SD", "NS"].includes(side)) return "SELL"
  return "UNKNOWN"
}

function inferSide(rawSide: unknown, price: number, bids: DepthLevel[], asks: DepthLevel[]): TradeSide {
  const direct = explicitSide(rawSide)
  if (direct !== "UNKNOWN") return direct
  const bestBid = bids[0]?.price
  const bestAsk = asks[0]?.price
  if (bestAsk && price >= bestAsk) return "BUY"
  if (bestBid && price <= bestBid) return "SELL"
  return "UNKNOWN"
}

function sideMeta(side: TradeSide) {
  if (side === "BUY") return { label: "Mua*", className: "text-up bg-up/10 border-up/30" }
  if (side === "SELL") return { label: "Bán*", className: "text-down bg-down/10 border-down/30" }
  return { label: "Khớp", className: "text-muted-2 bg-panel-2 border-border" }
}

function nextQuote(symbol: string, data: Record<string, unknown>, current: StockQuote | null): StockQuote | null {
  const price = firstPositive(data, ["matchPrice", "price", "lastPrice"]) || current?.price || 0
  if (price <= 0) return current
  const explicitOpen = firstPositive(data, OPEN_PRICE_KEYS)
  const reference = explicitOpen || firstPositive(data, ["referencePrice", "refPrice", "reference"]) || current?.reference || price
  const ceiling = firstPositive(data, ["ceilingPrice", "ceiling"]) || current?.ceiling
  const floor = firstPositive(data, ["floorPrice", "floor"]) || current?.floor
  const high = firstPositive(data, ["highPrice", "high"]) || (current?.high ? Math.max(current.high, price) : price)
  const low = firstPositive(data, ["lowPrice", "low"]) || (current?.low ? Math.min(current.low, price) : price)
  const avgPrice = firstPositive(data, ["avgPrice", "averagePrice", "avePrice"]) || current?.avgPrice
  const totalVolume = firstPositive(data, ["totalVolumeTraded", "totalVolume", "volume", "lot"]) || current?.totalVolume
  const change = reference > 0 ? price - reference : current?.change
  const changePercent = reference > 0 ? ((price - reference) / reference) * 100 : current?.changePercent ?? 0

  return {
    symbol,
    price,
    reference: reference || undefined,
    ceiling: ceiling || undefined,
    floor: floor || undefined,
    high: high || undefined,
    low: low || undefined,
    avgPrice: avgPrice || undefined,
    totalVolume: totalVolume || undefined,
    change,
    changePercent,
    updatedAt: new Date().toISOString(),
  }
}

function mergeTrades(incoming: StreamTrade[], current: StreamTrade[]) {
  const deduped = new Map<string, StreamTrade>()
  for (const trade of [...incoming, ...current]) deduped.set(trade.id, trade)
  return [...deduped.values()]
    .sort((a, b) => Date.parse(b.time) - Date.parse(a.time))
    .slice(0, MAX_SESSION_TRADES)
}

function useDnseOrderBookStream(symbol: string, reconnectKey: number, initialMeta?: StockInitialMeta) {
  const [state, setState] = useState<StreamState>("CONNECTING")
  const [bids, setBids] = useState<DepthLevel[]>([])
  const [asks, setAsks] = useState<DepthLevel[]>([])
  const [trades, setTrades] = useState<StreamTrade[]>([])
  const [foreign, setForeign] = useState<ForeignSnapshot | null>(null)
  const [foreignEvents, setForeignEvents] = useState<ForeignFlowEvent[]>([])
  const [company, setCompany] = useState<CompanyInfo | null>(() => (initialMeta?.companyName ? { nameVi: initialMeta.companyName, sector: initialMeta.sector } : null))
  const [quote, setQuote] = useState<StockQuote | null>(() => {
    if (!initialMeta?.price) return null
    return {
      symbol,
      price: initialMeta.price,
      reference: initialMeta.reference,
      ceiling: initialMeta.ceiling,
      floor: initialMeta.floor,
      changePercent: initialMeta.changePercent ?? 0,
      totalVolume: initialMeta.volume,
      volume: initialMeta.volume,
      updatedAt: new Date().toISOString(),
    }
  })
  const [priceHistory, setPriceHistory] = useState<number[]>(() => initialMeta?.history ?? [])
  const [historyState, setHistoryState] = useState<HistoryState>("LOADING")
  const [historyMessage, setHistoryMessage] = useState("")
  const [updatedAt, setUpdatedAt] = useState("")
  const [error, setError] = useState("")
  const depthRef = useRef<{ bids: DepthLevel[]; asks: DepthLevel[] }>({ bids: [], asks: [] })
  const lastFrameAt = useRef(0)
  const lastForeignEventKey = useRef<string>("")

  // Hydrate from initial metadata if symbol changes
  useEffect(() => {
    if (initialMeta) {
      if (initialMeta.price) {
        setQuote({
          symbol,
          price: initialMeta.price,
          reference: initialMeta.reference,
          ceiling: initialMeta.ceiling,
          floor: initialMeta.floor,
          changePercent: initialMeta.changePercent ?? 0,
          totalVolume: initialMeta.volume,
          volume: initialMeta.volume,
          updatedAt: new Date().toISOString(),
        })
      }
      if (initialMeta.history?.length) {
        setPriceHistory(initialMeta.history)
      }
      if (initialMeta.companyName) {
        setCompany({ nameVi: initialMeta.companyName, sector: initialMeta.sector })
      }
    }
    setForeignEvents([])
  }, [symbol, initialMeta])

  // Fetch REST session history + initial hydration
  useEffect(() => {
    const controller = new AbortController()
    let disposed = false
    setHistoryState("LOADING")
    setHistoryMessage("")

    void (async () => {
      try {
        const response = await fetch(`/api/market/session?symbol=${encodeURIComponent(symbol)}`, {
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        })
        const payload = (await response.json()) as SessionHistoryResponse
        if (!response.ok || !payload.ok) throw new Error(payload.message ?? `Session history ${response.status}`)
        if (disposed) return

        const prices = (payload.prices ?? []).map((point) => number(point.close)).filter((value) => value > 0)
        if (prices.length > 0) {
          setPriceHistory(prices)
        }

        if (payload.company) {
          setCompany({
            nameVi: payload.company.nameVi || "",
            nameEn: payload.company.nameEn,
            exchange: payload.company.exchange,
            sector: payload.company.sector,
          })
        }

        if (payload.foreign) {
          const buyVol = number(payload.foreign.totalBuyVolume)
          const sellVol = number(payload.foreign.totalSellVolume)
          const buyVal = number(payload.foreign.totalBuyValue)
          const sellVal = number(payload.foreign.totalSellValue)
          setForeign((current) => ({
            symbol,
            totalBuyVolume: buyVol || current?.totalBuyVolume || 0,
            totalSellVolume: sellVol || current?.totalSellVolume || 0,
            totalBuyValue: buyVal || current?.totalBuyValue || 0,
            totalSellValue: sellVal || current?.totalSellValue || 0,
            availableRoom: nullableNumber(payload.foreign?.availableRoom) ?? current?.availableRoom ?? null,
            orderLimitQuantity: nullableNumber(payload.foreign?.orderLimitQuantity) ?? current?.orderLimitQuantity ?? null,
            listedShare: nullableNumber(payload.foreign?.listedShare) ?? current?.listedShare ?? null,
            updatedAt: payload.foreign?.updatedAt || new Date().toISOString(),
          }))
        }

        const latest = payload.latestQuote
        if (latest) {
          const nextBids = normalizeDepth(latest.bid).sort((a, b) => b.price - a.price)
          const nextAsks = normalizeDepth(latest.offer).sort((a, b) => a.price - b.price)
          if (nextBids.length || nextAsks.length) {
            depthRef.current = { bids: nextBids, asks: nextAsks }
            setBids(nextBids)
            setAsks(nextAsks)
          }
          const restQuote: Record<string, unknown> = {
            matchPrice: latest.matchPrice,
            openPrice: latest.openPrice,
            reference: latest.reference,
            ceiling: latest.ceiling,
            floor: latest.floor,
            highPrice: latest.highPrice,
            lowPrice: latest.lowPrice,
            avgPrice: latest.avgPrice,
            totalVolume: latest.totalVolume,
          }
          setQuote((current) => nextQuote(symbol, restQuote, current))
        }

        const historicalTrades: StreamTrade[] = (payload.trades ?? [])
          .map((trade) => ({
            id: `history-${trade.id}`,
            time: normalizeTime(trade.time),
            price: number(trade.price),
            volume: number(trade.volume) * ORDERBOOK_VOLUME_MULTIPLIER,
            side: explicitSide(trade.side),
          }))
          .filter((trade) => trade.price > 0 && trade.volume > 0)

        if (historicalTrades.length > 0) {
          setTrades((current) => mergeTrades(historicalTrades, current))
        }

        if (payload.tradesTruncated) {
          setHistoryState("PARTIAL")
          setHistoryMessage(`Đã tải ${historicalTrades.length.toLocaleString("vi-VN")} giao dịch (giới hạn thanh khoản).`)
        } else {
          setHistoryState("READY")
          setHistoryMessage(`Đầu phiên 09:00 · ${prices.length} nến · ${historicalTrades.length.toLocaleString("vi-VN")} lệnh.`)
        }
      } catch (nextError) {
        if (disposed || (nextError instanceof DOMException && nextError.name === "AbortError")) return
        setHistoryState("READY")
        setHistoryMessage("Sử dụng dữ liệu trực tiếp từ bảng điện.")
      }
    })()

    return () => {
      disposed = true
      controller.abort()
    }
  }, [symbol])

  // WebSocket Live Stream
  useEffect(() => {
    let disposed = false
    let socket: WebSocket | null = null
    let reconnectTimer: number | null = null
    let pingTimer: number | null = null
    let watchdogTimer: number | null = null
    let attempts = 0

    setState("CONNECTING")
    setError("")

    const clearConnectionTimers = () => {
      if (pingTimer) window.clearInterval(pingTimer)
      if (watchdogTimer) window.clearInterval(watchdogTimer)
      pingTimer = null
      watchdogTimer = null
    }

    const clearReconnectTimer = () => {
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      reconnectTimer = null
    }

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer) return
      attempts += 1
      const base = Math.min(650 * 2 ** Math.min(attempts - 1, 4), 8_000)
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null
        void connect()
      }, base + Math.floor(Math.random() * 400))
    }

    const forceReconnect = (reason: string) => {
      if (disposed) return
      clearConnectionTimers()
      if (socket && socket.readyState < WebSocket.CLOSING) {
        try {
          socket.close(4000, reason.slice(0, 120))
        } catch {
          scheduleReconnect()
        }
      } else {
        scheduleReconnect()
      }
    }

    const connect = async () => {
      clearReconnectTimer()
      clearConnectionTimers()
      if (disposed) return
      setState("CONNECTING")
      lastFrameAt.current = Date.now()
      try {
        const authResponse = await fetch("/api/market/stream-auth", { cache: "no-store", headers: { Accept: "application/json" } })
        const authJson = await authResponse.json()
        if (!authResponse.ok || !authJson.ok || !authJson.url || !authJson.auth) throw new Error(authJson.message ?? `Stream auth ${authResponse.status}`)
        if (disposed) return

        socket = new WebSocket(authJson.url)
        socket.onopen = () => {
          lastFrameAt.current = Date.now()
          setState("CONNECTING")
        }
        socket.onmessage = (event) => {
          if (disposed || typeof event.data !== "string") return
          lastFrameAt.current = Date.now()
          let data: any
          try {
            data = JSON.parse(event.data)
          } catch {
            return
          }

          const action = data?.action ?? data?.a
          if (action === "ping") {
            if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ action: "pong", timestamp: data?.timestamp }))
            return
          }
          if (data?.session_id || data?.sid || action === "welcome") {
            socket?.send(JSON.stringify(authJson.auth))
            return
          }
          if (action === "auth_success") {
            setState("LIVE")
            setError("")
            attempts = 0
            socket?.send(
              JSON.stringify({
                action: "subscribe",
                channels: [
                  { name: "tick.G1.json", symbols: [symbol] },
                  { name: "top_price.G1.json", symbols: [symbol] },
                  { name: "tick_extra.G1.json", symbols: [symbol] },
                  { name: "ohlc.1.json", symbols: [symbol] },
                  { name: "foreign.G1.json", symbols: [symbol] },
                ],
              }),
            )
            pingTimer = window.setInterval(() => {
              if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ action: "ping", timestamp: Date.now() }))
            }, 15_000)
            watchdogTimer = window.setInterval(() => {
              if (socket?.readyState === WebSocket.OPEN && Date.now() - lastFrameAt.current > STREAM_STALE_MS) {
                setError("DNSE WS im lặng; đang tự động reconnect.")
                forceReconnect("stale orderbook stream")
              }
            }, 7_500)
            return
          }
          if (action === "auth_error" || action === "error") {
            setState("ERROR")
            setError(data?.message ?? data?.msg ?? "DNSE stream authentication failed")
            forceReconnect("orderbook auth/subscription error")
            return
          }

          const ticker = String(data?.symbol ?? "").toUpperCase()
          if (ticker !== symbol) return

          // OHLC 1 minute update
          if (data?.T === "b") {
            const close = firstPositive(data, ["close", "c", "closePrice"])
            if (close > 0) {
              setPriceHistory((current) => {
                if (current.at(-1) === close) return current
                return [...current, close].slice(-360)
              })
            }
            return
          }

          // Top price depth update
          if (data?.T === "q") {
            const nextBids = normalizeDepth(data?.bid).sort((a, b) => b.price - a.price)
            const nextAsks = normalizeDepth(data?.offer).sort((a, b) => a.price - b.price)
            depthRef.current = { bids: nextBids, asks: nextAsks }
            setBids(nextBids)
            setAsks(nextAsks)
            setQuote((current) => nextQuote(symbol, data, current))
            setUpdatedAt(new Date().toISOString())
            setError("")
            return
          }

          // Tick quote update
          if (data?.T === "t") {
            setQuote((current) => nextQuote(symbol, data, current))
            setUpdatedAt(new Date().toISOString())
            setError("")
            return
          }

          // Tick extra trade execution
          if (data?.T === "te") {
            const price = number(data?.matchPrice)
            const volume = number(data?.matchQtty) * ORDERBOOK_VOLUME_MULTIPLIER
            setQuote((current) => nextQuote(symbol, data, current))
            setUpdatedAt(new Date().toISOString())
            setError("")
            if (price <= 0 || volume <= 0) return
            const time = normalizeTime(data?.time)
            const trade: StreamTrade = {
              id: `live-${time}-${price}-${volume}-${String(data?.side ?? "")}-${Math.random().toString(36).slice(2, 7)}`,
              time,
              price,
              volume,
              side: inferSide(data?.side, price, depthRef.current.bids, depthRef.current.asks),
            }
            setTrades((current) => mergeTrades([trade], current))
            return
          }

          // Foreign flow update
          if (data?.T === "f") {
            const time = normalizeTime(data?.transactTime ?? data?.time)
            const buyVolume = number(data?.buyVolume)
            const sellVolume = number(data?.sellVolume)
            const buyValue = number(data?.buyTradedAmount)
            const sellValue = number(data?.sellTradedAmount)

            const totalBuyVol = number(data?.totalBuyVolume ?? data?.totalBuyQtty ?? data?.foreignBuyVolume)
            const totalSellVol = number(data?.totalSellVolume ?? data?.totalSellQtty ?? data?.foreignSellVolume)
            const totalBuyVal = number(data?.totalBuyTradedAmount ?? data?.totalBuyValue ?? data?.foreignBuyValue)
            const totalSellVal = number(data?.totalSellTradedAmount ?? data?.totalSellValue ?? data?.foreignSellValue)
            const room = nullableNumber(data?.foreignerBuyPossibleQuantity ?? data?.foreignBuyPossibleQuantity ?? data?.room ?? data?.availableRoom)
            const limit = nullableNumber(data?.foreignerOrderLimitQuantity ?? data?.orderLimitQuantity ?? data?.totalRoom)

            setForeign((current) => ({
              symbol,
              totalBuyVolume: totalBuyVol || (buyVolume > 0 && current ? current.totalBuyVolume + buyVolume : current?.totalBuyVolume || 0),
              totalSellVolume: totalSellVol || (sellVolume > 0 && current ? current.totalSellVolume + sellVolume : current?.totalSellVolume || 0),
              totalBuyValue: totalBuyVal || (buyValue > 0 && current ? current.totalBuyValue + buyValue : current?.totalBuyValue || 0),
              totalSellValue: totalSellVal || (sellValue > 0 && current ? current.totalSellValue + sellValue : current?.totalSellValue || 0),
              availableRoom: room ?? current?.availableRoom ?? null,
              orderLimitQuantity: limit ?? current?.orderLimitQuantity ?? null,
              listedShare: current?.listedShare ?? null,
              investorTypeCode: String(data?.foreignInvestorTypeCode ?? current?.investorTypeCode ?? ""),
              updatedAt: time,
            }))

            // Deduplicate event transactions
            const eventKey = `${time}-${buyVolume}-${sellVolume}`
            if (eventKey !== lastForeignEventKey.current) {
              lastForeignEventKey.current = eventKey
              const events: ForeignFlowEvent[] = []
              if (buyVolume > 0) {
                events.push({
                  id: `${time}-BUY-${buyVolume}-${Math.random().toString(36).slice(2, 6)}`,
                  time,
                  side: "BUY",
                  volume: buyVolume,
                  value: buyValue > 0 ? buyValue : null,
                })
              }
              if (sellVolume > 0) {
                events.push({
                  id: `${time}-SELL-${sellVolume}-${Math.random().toString(36).slice(2, 6)}`,
                  time,
                  side: "SELL",
                  volume: sellVolume,
                  value: sellValue > 0 ? sellValue : null,
                })
              }
              if (events.length) {
                setForeignEvents((current) => [...events, ...current].slice(0, 100))
              }
            }
            setUpdatedAt(new Date().toISOString())
            setError("")
          }
        }

        socket.onerror = () => {
          if (!disposed) {
            setState("ERROR")
            setError("DNSE WebSocket kết nối lỗi; đang tự kết nối lại.")
            forceReconnect("orderbook websocket error")
          }
        }
        socket.onclose = () => {
          clearConnectionTimers()
          if (disposed) return
          setState("CLOSED")
          scheduleReconnect()
        }
      } catch (nextError) {
        if (disposed) return
        setState("ERROR")
        setError(nextError instanceof Error ? nextError.message : String(nextError))
        scheduleReconnect()
      }
    }

    const recoverIfNeeded = () => {
      if (document.visibilityState !== "visible") return
      if (!socket || socket.readyState !== WebSocket.OPEN || Date.now() - lastFrameAt.current > STREAM_STALE_MS) {
        forceReconnect("popup resumed")
      }
    }
    const onVisibilityChange = () => recoverIfNeeded()
    const onOnline = () => recoverIfNeeded()
    document.addEventListener("visibilitychange", onVisibilityChange)
    window.addEventListener("online", onOnline)

    void connect()
    return () => {
      disposed = true
      clearReconnectTimer()
      clearConnectionTimers()
      document.removeEventListener("visibilitychange", onVisibilityChange)
      window.removeEventListener("online", onOnline)
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "popup closed")
    }
  }, [symbol, reconnectKey])

  return { state, bids, asks, trades, foreign, foreignEvents, company, quote, priceHistory, historyState, historyMessage, updatedAt, error }
}

/**
 * Interactive Intraday Area Sparkline Chart with Crosshair & Reference Line (Memoized for high FPS)
 */
const IntradayAreaChart = memo(function IntradayAreaChart({
  data,
  reference,
  toneColor,
  height = 96,
}: {
  data: number[]
  reference?: number
  toneColor: string
  height?: number
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const points = useMemo(() => data.filter((v) => Number.isFinite(v) && v > 0), [data])
  const ref = reference && reference > 0 ? reference : points[0] || 0

  const { min, max, pathD, areaD, coordinates, refY } = useMemo(() => {
    if (points.length < 2) return { min: ref, max: ref, pathD: "", areaD: "", coordinates: [], refY: height / 2 }
    const minVal = Math.min(...points, ref > 0 ? ref * 0.995 : Number.POSITIVE_INFINITY)
    const maxVal = Math.max(...points, ref > 0 ? ref * 1.005 : Number.NEGATIVE_INFINITY)
    const range = maxVal - minVal || 1
    const padding = 10
    const usableHeight = height - padding * 2
    const width = 640

    const coords = points.map((val, idx) => {
      const x = (idx / (points.length - 1)) * width
      const y = height - padding - ((val - minVal) / range) * usableHeight
      return { x, y, val }
    })

    const d = coords.reduce((acc, pt, idx) => (idx === 0 ? `M ${pt.x},${pt.y}` : `${acc} L ${pt.x},${pt.y}`), "")
    const area = coords.length ? `${d} L ${coords.at(-1)?.x},${height} L ${coords[0].x},${height} Z` : ""
    const refYPos = ref > 0 ? height - padding - ((ref - minVal) / range) * usableHeight : height / 2

    return { min: minVal, max: maxVal, pathD: d, areaD: area, coordinates: coords, refY: refYPos }
  }, [points, ref, height])

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!containerRef.current || coordinates.length < 2) return
    const rect = containerRef.current.getBoundingClientRect()
    const xPct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const index = Math.round(xPct * (coordinates.length - 1))
    setHoverIndex(index)
  }

  const handlePointerLeave = () => setHoverIndex(null)

  const hovered = hoverIndex !== null && coordinates[hoverIndex] ? coordinates[hoverIndex] : null
  const hoveredPct = hovered && ref > 0 ? ((hovered.val - ref) / ref) * 100 : null

  if (points.length < 2) {
    return (
      <div className="flex h-[96px] w-full items-center justify-center rounded-lg border border-border bg-panel-2/30 text-xs text-muted-2">
        Đang tải biểu đồ nến trong phiên...
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      className="group relative h-[96px] w-full cursor-crosshair select-none overflow-hidden rounded-lg border border-border/80 bg-[#121313] p-1.5"
    >
      <svg viewBox="0 0 640 96" preserveAspectRatio="none" className="h-full w-full overflow-visible">
        <defs>
          <linearGradient id={`gradient-${toneColor}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={toneColor} stopOpacity="0.28" />
            <stop offset="100%" stopColor={toneColor} stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Reference horizontal guideline */}
        {ref > 0 && <line x1="0" y1={refY} x2="640" y2={refY} stroke="var(--color-ref)" strokeDasharray="3 3" strokeOpacity="0.4" strokeWidth="1" />}

        {/* Area fill */}
        <path d={areaD} fill={`url(#gradient-${toneColor})`} />

        {/* Line stroke */}
        <path d={pathD} fill="none" stroke={toneColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

        {/* Current / Hover point */}
        {hovered ? (
          <>
            <line x1={hovered.x} y1="0" x2={hovered.x} y2="96" stroke="#ffffff" strokeOpacity="0.3" strokeDasharray="2 2" strokeWidth="1" />
            <circle cx={hovered.x} cy={hovered.y} r="4" fill={toneColor} stroke="#ffffff" strokeWidth="1.5" />
          </>
        ) : (
          coordinates.at(-1) && <circle cx={coordinates.at(-1)?.x} cy={coordinates.at(-1)?.y} r="3.5" fill={toneColor} />
        )}
      </svg>

      {/* Floating Info Overlay */}
      <div className="pointer-events-none absolute left-3 top-2 flex items-center gap-2 font-mono text-[11px]">
        {hovered ? (
          <div className="flex items-center gap-2 rounded bg-black/80 px-2 py-0.5 backdrop-blur-sm border border-border/60">
            <span className="text-foreground font-bold">{formatPrice(hovered.val)}</span>
            {hoveredPct !== null && (
              <span className={hoveredPct > 0 ? "text-up font-semibold" : hoveredPct < 0 ? "text-down font-semibold" : "text-ref"}>
                {hoveredPct > 0 ? "+" : ""}
                {hoveredPct.toFixed(2)}%
              </span>
            )}
          </div>
        ) : (
          <div className="text-[10px] text-muted-2">
            Đầu phiên <span className="text-foreground font-medium">{formatPrice(points[0])}</span> · Hiện tại{" "}
            <span className="text-foreground font-bold">{formatPrice(points.at(-1))}</span>
          </div>
        )}
      </div>

      {/* Min / Max bounds */}
      <div className="pointer-events-none absolute bottom-1 right-2 flex items-center gap-2 font-mono text-[9px] text-muted-2">
        <span>Thấp: {formatPrice(min)}</span>
        <span>·</span>
        <span>Cao: {formatPrice(max)}</span>
      </div>
    </div>
  )
})

/**
 * Main LiveOrderBookPanel Component
 */
export function LiveOrderBookPanel({
  stockKey,
  symbol,
  initialMeta,
  index,
  z,
  onClose,
  onFocus,
}: {
  stockKey: string
  symbol: string
  initialMeta?: StockInitialMeta
  index: number
  z: number
  onClose: () => void
  onFocus: () => void
}) {
  const [minimized, setMinimized] = useState(false)
  const [isMaximized, setIsMaximized] = useState(false)
  const [activityTab, setActivityTab] = useState<ActivityTab>("trades")
  const [tradeFilter, setTradeFilter] = useState<"all" | "large" | "whale">("all")
  const [reconnectKey, setReconnectKey] = useState(0)

  // Window sizing & positioning
  const [size, setSize] = useState<{ width: number; height: number }>({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT })
  const [pos, setPos] = useState(() => ({
    x: Math.max(16, 32 + (index % 4) * 44),
    y: Math.max(50, 72 + (index % 5) * 36),
  }))

  const panelRef = useRef<HTMLElement>(null)
  const isInteractingRef = useRef(false)
  const [isInteracting, setIsInteracting] = useState(false)
  const closeRequested = useRef(false)

  const stream = useDnseOrderBookStream(symbol, reconnectKey, initialMeta)
  const quote = stream.quote

  // High-performance Drag-to-Move with window listener + requestAnimationFrame (0ms latency, zero re-renders while moving)
  const onHeaderPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const target = event.target instanceof HTMLElement ? event.target : null
      if (target?.closest("button, a, [data-orderbook-action], [data-no-drag]")) return
      if (isMaximized) return
      onFocus()

      const startX = event.clientX
      const startY = event.clientY
      const startPosX = pos.x
      const startPosY = pos.y
      let curX = startPosX
      let curY = startPosY
      let rafId: number | null = null

      isInteractingRef.current = true
      setIsInteracting(true)

      const handlePointerMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX
        const dy = ev.clientY - startY
        curX = Math.max(0, Math.min(window.innerWidth - 200, startPosX + dx))
        curY = Math.max(0, Math.min(window.innerHeight - 50, startPosY + dy))

        if (rafId) cancelAnimationFrame(rafId)
        rafId = requestAnimationFrame(() => {
          if (panelRef.current) {
            panelRef.current.style.left = `${curX}px`
            panelRef.current.style.top = `${curY}px`
          }
        })
      }

      const handlePointerUp = () => {
        if (rafId) cancelAnimationFrame(rafId)
        window.removeEventListener("pointermove", handlePointerMove)
        window.removeEventListener("pointerup", handlePointerUp)
        window.removeEventListener("pointercancel", handlePointerUp)
        isInteractingRef.current = false
        setIsInteracting(false)
        setPos({ x: curX, y: curY })
      }

      window.addEventListener("pointermove", handlePointerMove, { passive: true })
      window.addEventListener("pointerup", handlePointerUp)
      window.addEventListener("pointercancel", handlePointerUp)
    },
    [onFocus, pos.x, pos.y, isMaximized],
  )

  // High-performance Drag-to-Resize with window listener + requestAnimationFrame (0ms latency, zero re-renders while resizing)
  const startResize = useCallback(
    (e: React.PointerEvent, handle: "se" | "e" | "s") => {
      e.preventDefault()
      e.stopPropagation()
      onFocus()

      const startX = e.clientX
      const startY = e.clientY
      const startW = size.width
      const startH = size.height
      let curW = startW
      let curH = startH
      let rafId: number | null = null

      isInteractingRef.current = true
      setIsInteracting(true)

      const handlePointerMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX
        const dy = ev.clientY - startY

        if (handle === "se" || handle === "e") {
          curW = Math.max(MIN_WIDTH, Math.min(window.innerWidth - pos.x - 12, startW + dx))
        }
        if (handle === "se" || handle === "s") {
          curH = Math.max(MIN_HEIGHT, Math.min(window.innerHeight - pos.y - 12, startH + dy))
        }

        if (rafId) cancelAnimationFrame(rafId)
        rafId = requestAnimationFrame(() => {
          if (panelRef.current) {
            if (handle === "se" || handle === "e") {
              panelRef.current.style.width = `${curW}px`
            }
            if (handle === "se" || handle === "s") {
              panelRef.current.style.height = `${curH}px`
            }
          }
        })
      }

      const handlePointerUp = () => {
        if (rafId) cancelAnimationFrame(rafId)
        window.removeEventListener("pointermove", handlePointerMove)
        window.removeEventListener("pointerup", handlePointerUp)
        window.removeEventListener("pointercancel", handlePointerUp)
        isInteractingRef.current = false
        setIsInteracting(false)
        setSize({ width: curW, height: curH })
      }

      window.addEventListener("pointermove", handlePointerMove, { passive: true })
      window.addEventListener("pointerup", handlePointerUp)
      window.addEventListener("pointercancel", handlePointerUp)
    },
    [onFocus, size.width, size.height, pos.x, pos.y],
  )

  const onPanelPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const target = event.target instanceof HTMLElement ? event.target : null
      if (target?.closest("[data-orderbook-action]")) return
      onFocus()
    },
    [onFocus],
  )

  const closeOnPointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      if (closeRequested.current) return
      closeRequested.current = true
      onClose()
    },
    [onClose],
  )

  const closeOnClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      if (closeRequested.current) return
      closeRequested.current = true
      onClose()
    },
    [onClose],
  )

  // Top 3 orderbook ladder rows
  const topBids = stream.bids.slice(0, 3)
  const topAsks = stream.asks.slice(0, 3)
  const bidTotal = stream.bids.reduce((sum, row) => sum + row.volume, 0)
  const askTotal = stream.asks.reduce((sum, row) => sum + row.volume, 0)
  const depthTotal = bidTotal + askTotal
  const buyPct = depthTotal > 0 ? (bidTotal / depthTotal) * 100 : 50
  const sellPct = 100 - buyPct
  const maxDepthVolume = Math.max(1, ...topBids.map((b) => b.volume), ...topAsks.map((a) => a.volume))

  const rows = useMemo(
    () => Array.from({ length: 3 }, (_, i) => ({ bid: stream.bids[i], ask: stream.asks[i] })),
    [stream.bids, stream.asks],
  )

  // Tape filtering
  const visibleTrades = useMemo(() => {
    if (tradeFilter === "large") return stream.trades.filter((t) => t.volume >= LARGE_TRADE_MIN_VOLUME)
    if (tradeFilter === "whale") return stream.trades.filter((t) => t.volume >= WHALE_TRADE_MIN_VOLUME)
    return stream.trades
  }, [tradeFilter, stream.trades])

  const largeTradeCount = useMemo(() => stream.trades.filter((t) => t.volume >= LARGE_TRADE_MIN_VOLUME).length, [stream.trades])
  const whaleTradeCount = useMemo(() => stream.trades.filter((t) => t.volume >= WHALE_TRADE_MIN_VOLUME).length, [stream.trades])

  // Active Buy vs Sell volume breakdown from trades
  const tradeStats = useMemo(() => {
    let buyVol = 0
    let sellVol = 0
    let unkVol = 0
    for (const t of stream.trades) {
      if (t.side === "BUY") buyVol += t.volume
      else if (t.side === "SELL") sellVol += t.volume
      else unkVol += t.volume
    }
    const totalTraded = buyVol + sellVol + unkVol
    const buyTradedPct = totalTraded > 0 ? (buyVol / totalTraded) * 100 : 50
    const sellTradedPct = totalTraded > 0 ? (sellVol / totalTraded) * 100 : 50
    return { buyVol, sellVol, unkVol, totalTraded, buyTradedPct, sellTradedPct }
  }, [stream.trades])

  // Volume Profile (Volume distribution by price level)
  const volumeProfile = useMemo(() => {
    const profileMap = new Map<number, { price: number; buyVol: number; sellVol: number; totalVol: number }>()
    for (const t of stream.trades) {
      const cur = profileMap.get(t.price) || { price: t.price, buyVol: 0, sellVol: 0, totalVol: 0 }
      if (t.side === "BUY") cur.buyVol += t.volume
      else if (t.side === "SELL") cur.sellVol += t.volume
      cur.totalVol += t.volume
      profileMap.set(t.price, cur)
    }
    const profileRows = [...profileMap.values()].sort((a, b) => b.price - a.price)
    const maxVol = Math.max(1, ...profileRows.map((r) => r.totalVol))
    return { rows: profileRows, maxVol }
  }, [stream.trades])

  const tone = marketToneFromPrice({
    price: quote?.price,
    reference: quote?.reference,
    ceiling: quote?.ceiling,
    floor: quote?.floor,
  })
  const color = quote ? marketToneText(tone) : "text-muted-2"
  const chartColor = marketToneHex(tone)

  const chartData = useMemo(() => {
    const values = stream.priceHistory.filter((value) => Number.isFinite(value) && value > 0)
    if (!quote?.price || values.at(-1) === quote.price) return values
    return [...values, quote.price]
  }, [quote, stream.priceHistory])

  // Foreign statistics calculations
  const foreignNetVolume = stream.foreign ? stream.foreign.totalBuyVolume - stream.foreign.totalSellVolume : null
  const foreignNetValue =
    stream.foreign?.totalBuyValue || stream.foreign?.totalSellValue
      ? stream.foreign.totalBuyValue - stream.foreign.totalSellValue
      : foreignNetVolume && quote?.price
        ? foreignNetVolume * quote.price
        : null

  const foreignRoom = stream.foreign?.availableRoom
  const listedShare = stream.foreign?.listedShare
  const roomPercentage = foreignRoom && listedShare && listedShare > 0 ? (foreignRoom / listedShare) * 100 : null

  // Spread calculation
  const bestBidPrice = topBids[0]?.price
  const bestAskPrice = topAsks[0]?.price
  const spread = bestBidPrice && bestAskPrice ? bestAskPrice - bestBidPrice : null

  // Clean CSS styles with zero transition lag while interacting
  const panelStyle = isMaximized
    ? { top: "12px", left: "12px", right: "12px", bottom: "12px", width: "calc(100vw - 24px)", height: "calc(100vh - 24px)", zIndex: z + 10 }
    : {
        left: `${pos.x}px`,
        top: `${pos.y}px`,
        width: `${Math.min(size.width, window.innerWidth - 16)}px`,
        height: minimized ? "auto" : `${Math.min(size.height, window.innerHeight - 32)}px`,
        zIndex: z,
      }

  return (
    <section
      ref={panelRef}
      className={`pointer-events-auto absolute flex flex-col overflow-hidden rounded-xl border border-border-strong bg-[#141515] shadow-2xl shadow-black/80 will-change-[width,height,left,top] ${
        isMaximized ? "fixed" : ""
      } ${!isInteracting ? "transition-[width,height,left,top] duration-150 ease-out" : "select-none"}`}
      style={panelStyle}
      onPointerDown={onPanelPointerDown}
      data-orderbook={stockKey}
    >
      {/* HEADER / DRAG HANDLE */}
      <header
        className="flex cursor-grab select-none items-center gap-2 border-b border-border bg-[#1b1d1c] px-3.5 py-2.5 active:cursor-grabbing touch-none"
        onPointerDown={onHeaderPointerDown}
      >
        <GripVertical className="h-4 w-4 text-muted shrink-0" />
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-mono text-lg font-black tracking-tight text-foreground">{symbol}</span>
          {stream.company?.exchange ? (
            <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] font-semibold text-muted-2 uppercase tracking-wide">
              {stream.company.exchange}
            </span>
          ) : null}
          {stream.company?.nameVi ? (
            <span className="hidden sm:inline truncate text-xs text-muted max-w-[200px]" title={stream.company.nameVi}>
              {stream.company.nameVi}
            </span>
          ) : null}
        </div>

        {/* Live Price & Change Pill */}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <span className={`font-mono text-base font-bold sm:text-lg ${color}`}>{formatPrice(quote?.price)}</span>
          {quote ? <MarketChangePill value={quote.changePercent} tone={tone} compact /> : null}
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1 shrink-0 ml-1">
          <button
            data-orderbook-action
            type="button"
            aria-label="Kết nối lại sổ lệnh"
            title="Kết nối lại DNSE Stream"
            onClick={(event) => {
              event.stopPropagation()
              setReconnectKey((key) => key + 1)
            }}
            className="rounded p-1.5 text-muted-2 hover:bg-panel-2 hover:text-foreground transition-colors"
          >
            <RefreshCw className={`h-4 w-4 ${stream.state === "CONNECTING" ? "animate-spin text-ref" : ""}`} />
          </button>

          <a
            data-orderbook-action
            href={`/research/${symbol.toLowerCase()}`}
            aria-label={`Mở phân tích chuyên sâu ${symbol}`}
            title="Mở phân tích chuyên sâu"
            onClick={(event) => event.stopPropagation()}
            className="rounded p-1.5 text-muted-2 hover:bg-panel-2 hover:text-foreground transition-colors"
          >
            <ExternalLink className="h-4 w-4" />
          </a>

          <button
            data-orderbook-action
            type="button"
            aria-label={isMaximized ? "Khôi phục cửa sổ" : "Phóng to toàn màn hình"}
            title={isMaximized ? "Khôi phục kích thước" : "Phóng to"}
            onClick={(event) => {
              event.stopPropagation()
              setIsMaximized((v) => !v)
            }}
            className="rounded p-1.5 text-muted-2 hover:bg-panel-2 hover:text-foreground transition-colors"
          >
            {isMaximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>

          <button
            data-orderbook-action
            type="button"
            aria-label={minimized ? "Mở rộng sổ lệnh" : "Thu gọn sổ lệnh"}
            title={minimized ? "Mở rộng" : "Thu gọn"}
            onClick={(event) => {
              event.stopPropagation()
              setMinimized((value) => !value)
            }}
            className="rounded p-1.5 text-muted-2 hover:bg-panel-2 hover:text-foreground transition-colors"
          >
            <Minus className="h-4 w-4" />
          </button>

          <button
            data-orderbook-action
            type="button"
            aria-label="Đóng sổ lệnh"
            title="Đóng"
            onPointerDown={closeOnPointerDown}
            onClick={closeOnClick}
            className="rounded p-1.5 text-muted-2 hover:bg-panel-2 hover:text-down transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      {!minimized ? (
        <div className="min-h-0 flex-1 overflow-y-auto flex flex-col">
          {/* TOP PRICE METRICS STRIP */}
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 border-b border-border bg-[#181919] px-3.5 py-2 font-mono text-[11px]">
            <div>
              <div className="text-[10px] text-muted-2">Sàn</div>
              <div className="text-[#22b8cf] font-bold">{formatPrice(quote?.floor)}</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-2">TC</div>
              <div className="text-ref font-bold">{formatPrice(quote?.reference)}</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-2">Trần</div>
              <div className="text-ceiling font-bold">{formatPrice(quote?.ceiling)}</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-2">Thấp</div>
              <div className="text-foreground">{formatPrice(quote?.low)}</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-2">Cao</div>
              <div className="text-foreground">{formatPrice(quote?.high)}</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-2">TB</div>
              <div className="text-foreground">{formatPrice(quote?.avgPrice)}</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-2">Tổng KL</div>
              <div className="text-foreground font-semibold">{formatCompactVolume(quote?.totalVolume)}</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-2">Tổng GT</div>
              <div className="text-foreground font-semibold">
                {quote?.totalValue ? formatMarketValue(quote.totalValue) : quote?.totalVolume && quote?.price ? formatMarketValue(quote.totalVolume * quote.price) : "—"}
              </div>
            </div>
          </div>

          {/* SECTION 1: ORDERBOOK DEPTH LADDER (3 Levels) */}
          <div className="border-b border-border px-4 py-3 bg-panel/30">
            <div className="mb-2 flex items-center justify-between text-[11px]">
              <div className="flex items-center gap-1.5 text-muted-2">
                <span className={`h-2 w-2 rounded-full ${stream.state === "LIVE" ? "bg-up animate-pulse" : stream.state === "CONNECTING" ? "bg-ref" : "bg-down"}`} />
                <span className="font-medium text-foreground">Sổ lệnh 3 cấp độ</span>
                <span className="text-[10px] text-muted">· {stream.state === "LIVE" ? "Realtime WS" : "Đang đồng bộ"}</span>
              </div>
              {spread !== null && spread > 0 ? (
                <div className="text-[10px] text-muted-2 font-mono">
                  Spread: <span className="text-foreground font-medium">{formatPrice(spread)}</span>
                </div>
              ) : null}
            </div>

            {/* Depth Ladder Table */}
            <div className="rounded-lg border border-border/80 bg-[#121313] p-2">
              <div className="grid grid-cols-[1fr_80px_80px_1fr] gap-x-3 text-[11px] font-semibold text-muted-2 border-b border-border/50 pb-1.5">
                <span>KL Mua</span>
                <span className="text-right">Giá Mua</span>
                <span>Giá Bán</span>
                <span className="text-right">KL Bán</span>
              </div>

              <div className="mt-1.5 space-y-1 font-mono text-xs">
                {rows.map(({ bid, ask }, rowIndex) => {
                  const bidWidthPct = bid?.volume ? (bid.volume / maxDepthVolume) * 100 : 0
                  const askWidthPct = ask?.volume ? (ask.volume / maxDepthVolume) * 100 : 0

                  return (
                    <div key={rowIndex} className="relative grid grid-cols-[1fr_80px_80px_1fr] gap-x-3 items-center py-1 rounded">
                      {/* Left Bid Volume bar */}
                      {bid?.volume ? (
                        <div
                          className="absolute inset-y-0 left-0 bg-up/12 rounded-l"
                          style={{ width: `${(bidWidthPct / 2).toFixed(1)}%` }}
                          aria-hidden="true"
                        />
                      ) : null}

                      {/* Right Ask Volume bar */}
                      {ask?.volume ? (
                        <div
                          className="absolute inset-y-0 right-0 bg-down/12 rounded-r"
                          style={{ width: `${(askWidthPct / 2).toFixed(1)}%` }}
                          aria-hidden="true"
                        />
                      ) : null}

                      <span className="relative font-bold text-foreground pl-1">{formatVolume(bid?.volume)}</span>
                      <span className="relative text-right font-bold text-up">{formatPrice(bid?.price)}</span>
                      <span className="relative font-bold text-down">{formatPrice(ask?.price)}</span>
                      <span className="relative text-right font-bold text-foreground pr-1">{formatVolume(ask?.volume)}</span>
                    </div>
                  )
                })}
              </div>

              {/* Total Ratio Bar */}
              <div className="mt-2.5 pt-2 border-t border-border/40">
                <div className="flex items-center justify-between text-[11px] font-semibold">
                  <span className="text-up flex items-center gap-1">
                    <TrendingUp className="h-3 w-3" /> Mua {depthTotal > 0 ? `${buyPct.toFixed(0)}%` : "50%"} ({formatCompactVolume(bidTotal)})
                  </span>
                  <span className="text-down flex items-center gap-1">
                    Bán {depthTotal > 0 ? `${sellPct.toFixed(0)}%` : "50%"} ({formatCompactVolume(askTotal)}) <TrendingDown className="h-3 w-3" />
                  </span>
                </div>
                <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-panel-2">
                  <div className="bg-up transition-all duration-300" style={{ width: `${depthTotal > 0 ? buyPct : 50}%` }} />
                  <div className="bg-down transition-all duration-300" style={{ width: `${depthTotal > 0 ? sellPct : 50}%` }} />
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 2: INTRADAY AREA CHART */}
          <div className="border-b border-border px-4 py-3 bg-panel/10">
            <div className="mb-1.5 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <Activity className="h-3.5 w-3.5 text-brand" />
                <span>Biểu đồ giá trong phiên</span>
              </div>
              <span className="text-[10px] text-muted-2">{stream.historyMessage || "DNSE 1m · 09:00 → live"}</span>
            </div>
            <IntradayAreaChart data={chartData} reference={quote?.reference} toneColor={chartColor} height={96} />
          </div>

          {/* SECTION 3: TABBED ACTIVITY VIEWS */}
          <div className="px-4 py-3 flex-1 flex flex-col">
            {/* Tabs Header */}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2">
              <div className="flex items-center gap-1 bg-[#181919] p-1 rounded-lg border border-border">
                <button
                  type="button"
                  onClick={() => setActivityTab("trades")}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                    activityTab === "trades" ? "bg-brand/15 text-brand shadow-sm" : "text-muted-2 hover:bg-panel-2 hover:text-foreground"
                  }`}
                >
                  <BarChart3 className="h-3.5 w-3.5" />
                  <span>Khớp lệnh</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActivityTab("foreign")}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                    activityTab === "foreign" ? "bg-blue-500/15 text-blue-400 shadow-sm" : "text-muted-2 hover:bg-panel-2 hover:text-foreground"
                  }`}
                >
                  <PieChart className="h-3.5 w-3.5" />
                  <span>Khối ngoại</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActivityTab("profile")}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                    activityTab === "profile" ? "bg-purple-500/15 text-purple-400 shadow-sm" : "text-muted-2 hover:bg-panel-2 hover:text-foreground"
                  }`}
                >
                  <Layers className="h-3.5 w-3.5" />
                  <span>Bước giá</span>
                </button>
              </div>

              {/* Tape Sub-filters */}
              {activityTab === "trades" && (
                <div className="flex items-center gap-1 text-[10px]">
                  <button
                    type="button"
                    onClick={() => setTradeFilter("all")}
                    className={`rounded px-2 py-1 font-medium transition-colors ${
                      tradeFilter === "all" ? "bg-panel-2 text-foreground font-bold" : "text-muted hover:text-muted-2"
                    }`}
                  >
                    Tất cả ({stream.trades.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setTradeFilter("large")}
                    className={`flex items-center gap-1 rounded border px-2 py-0.5 font-medium transition-colors ${
                      tradeFilter === "large" ? "border-ref/50 bg-ref/15 text-ref font-bold" : "border-border text-muted-2 hover:text-foreground"
                    }`}
                  >
                    <ListFilter className="h-3 w-3" />
                    <span>≥10K</span>
                    {largeTradeCount > 0 && <span className="rounded bg-ref/20 px-1 text-[9px]">{largeTradeCount}</span>}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTradeFilter("whale")}
                    className={`flex items-center gap-1 rounded border px-2 py-0.5 font-medium transition-colors ${
                      tradeFilter === "whale" ? "border-up/50 bg-up/15 text-up font-bold" : "border-border text-muted-2 hover:text-foreground"
                    }`}
                  >
                    <span>Cá mập ≥50K</span>
                    {whaleTradeCount > 0 && <span className="rounded bg-up/20 px-1 text-[9px]">{whaleTradeCount}</span>}
                  </button>
                </div>
              )}
            </div>

            {/* TAB CONTENT: KHỚP LỆNH (TAPE) */}
            {activityTab === "trades" && (
              <div className="flex flex-col flex-1">
                {/* Trade Initiative Bar */}
                <div className="mb-2.5 rounded-lg border border-border/80 bg-[#121313] p-2 font-mono text-[11px]">
                  <div className="flex items-center justify-between text-[10px] text-muted-2 mb-1">
                    <span>
                      Chủ động Mua: <b className="text-up">{formatCompactVolume(tradeStats.buyVol)}</b> (
                      {tradeStats.buyTradedPct.toFixed(0)}%)
                    </span>
                    <span>
                      Chủ động Bán: <b className="text-down">{formatCompactVolume(tradeStats.sellVol)}</b> (
                      {tradeStats.sellTradedPct.toFixed(0)}%)
                    </span>
                  </div>
                  <div className="flex h-1.5 overflow-hidden rounded-full bg-panel-2">
                    <div className="bg-up" style={{ width: `${tradeStats.buyTradedPct}%` }} />
                    <div className="bg-down" style={{ width: `${tradeStats.sellTradedPct}%` }} />
                  </div>
                </div>

                {visibleTrades.length ? (
                  <div className="flex-1 rounded-lg border border-border/80 bg-[#121313] overflow-hidden flex flex-col">
                    <div className="grid grid-cols-[100px_1fr_120px_80px] border-b border-border/60 bg-[#181919] px-3 py-1.5 text-[11px] font-semibold text-muted-2">
                      <span>Thời gian</span>
                      <span className="text-right">Khối lượng</span>
                      <span className="text-right">Giá</span>
                      <span className="text-right">Loại</span>
                    </div>
                    <div className="flex-1 overflow-y-auto max-h-[340px] px-3">
                      {visibleTrades.map((trade) => {
                        const meta = sideMeta(trade.side)
                        const isLarge = trade.volume >= LARGE_TRADE_MIN_VOLUME
                        const isWhale = trade.volume >= WHALE_TRADE_MIN_VOLUME

                        return (
                          <div
                            key={trade.id}
                            className={`grid grid-cols-[100px_1fr_120px_80px] items-center border-b py-1.5 font-mono text-xs last:border-0 ${
                              isWhale
                                ? "border-up/30 bg-up/10 text-up font-bold -mx-3 px-3"
                                : isLarge
                                  ? "border-ref/30 bg-ref/10 text-ref font-bold -mx-3 px-3"
                                  : "border-border/30 text-foreground"
                            }`}
                          >
                            <span className="text-muted-2">{timeLabel(trade.time)}</span>
                            <span className="text-right font-bold flex items-center justify-end gap-1.5">
                              {formatVolume(trade.volume)}
                              {isWhale ? (
                                <span className="rounded bg-up/25 px-1 py-0.2 text-[9px] text-up">50K+</span>
                              ) : isLarge ? (
                                <span className="rounded bg-ref/25 px-1 py-0.2 text-[9px] text-ref">10K+</span>
                              ) : null}
                            </span>
                            <span
                              className={`text-right font-bold ${
                                trade.side === "BUY" ? "text-up" : trade.side === "SELL" ? "text-down" : "text-foreground"
                              }`}
                            >
                              {formatPrice(trade.price)}
                            </span>
                            <div className="flex justify-end">
                              <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold border ${meta.className}`}>
                                {meta.label}
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-border bg-panel-2/30 px-4 py-8 text-center text-xs text-muted-2">
                    {stream.historyState === "LOADING"
                      ? "Đang tải dữ liệu khớp lệnh từ đầu phiên..."
                      : tradeFilter !== "all"
                        ? "Không có lệnh nào thỏa mãn bộ lọc."
                        : "Chờ dữ liệu khớp lệnh mới..."}
                  </div>
                )}
              </div>
            )}

            {/* TAB CONTENT: NƯỚC NGOÀI (FOREIGN) */}
            {activityTab === "foreign" && (
              <div className="flex flex-col flex-1 space-y-3">
                {/* 4 Summary Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="rounded-lg border border-border/80 bg-[#121313] p-2.5">
                    <div className="text-[10px] text-muted-2 font-medium">NN Mua lũy kế</div>
                    <div className="mt-1 font-mono text-sm font-bold text-up">
                      {formatVolume(stream.foreign?.totalBuyVolume)}
                    </div>
                    <div className="mt-0.5 text-[10px] text-muted font-mono">
                      {stream.foreign?.totalBuyValue
                        ? formatMarketValue(stream.foreign.totalBuyValue)
                        : stream.foreign?.totalBuyVolume && quote?.price
                          ? formatMarketValue(stream.foreign.totalBuyVolume * quote.price)
                          : "—"}
                    </div>
                  </div>

                  <div className="rounded-lg border border-border/80 bg-[#121313] p-2.5">
                    <div className="text-[10px] text-muted-2 font-medium">NN Bán lũy kế</div>
                    <div className="mt-1 font-mono text-sm font-bold text-down">
                      {formatVolume(stream.foreign?.totalSellVolume)}
                    </div>
                    <div className="mt-0.5 text-[10px] text-muted font-mono">
                      {stream.foreign?.totalSellValue
                        ? formatMarketValue(stream.foreign.totalSellValue)
                        : stream.foreign?.totalSellVolume && quote?.price
                          ? formatMarketValue(stream.foreign.totalSellVolume * quote.price)
                          : "—"}
                    </div>
                  </div>

                  <div className="rounded-lg border border-border/80 bg-[#121313] p-2.5">
                    <div className="text-[10px] text-muted-2 font-medium">Mua / Bán Ròng</div>
                    <div
                      className={`mt-1 font-mono text-sm font-bold ${
                        foreignNetVolume === null
                          ? "text-muted-2"
                          : foreignNetVolume > 0
                            ? "text-up"
                            : foreignNetVolume < 0
                              ? "text-down"
                              : "text-ref"
                      }`}
                    >
                      {foreignNetVolume === null
                        ? "—"
                        : `${foreignNetVolume > 0 ? "+" : ""}${formatVolume(foreignNetVolume)}`}
                    </div>
                    <div className="mt-0.5 text-[10px] text-muted font-mono">
                      {foreignNetValue !== null ? `${foreignNetValue > 0 ? "+" : ""}${formatMarketValue(foreignNetValue)}` : "—"}
                    </div>
                  </div>

                  <div className="rounded-lg border border-border/80 bg-[#121313] p-2.5">
                    <div className="text-[10px] text-muted-2 font-medium">Room Ngoại còn lại</div>
                    <div className="mt-1 font-mono text-sm font-bold text-foreground">
                      {foreignRoom ? formatCompactVolume(foreignRoom) : "—"}
                    </div>
                    <div className="mt-0.5 text-[10px] text-muted font-mono">
                      {roomPercentage !== null ? `Còn ${roomPercentage.toFixed(1)}% room` : "Theo quy định VSD"}
                    </div>
                  </div>
                </div>

                {/* Foreign Transaction Event Log */}
                <div className="flex-1 rounded-lg border border-border/80 bg-[#121313] overflow-hidden flex flex-col">
                  <div className="flex items-center justify-between border-b border-border/60 bg-[#181919] px-3 py-1.5 text-[11px] font-semibold text-muted-2">
                    <span>Nhật ký giao dịch NĐTNN trong phiên</span>
                    {stream.foreign?.updatedAt && <span className="text-[10px]">{timeLabel(stream.foreign.updatedAt)}</span>}
                  </div>

                  {stream.foreignEvents.length ? (
                    <div className="flex-1 overflow-y-auto max-h-[260px] px-3">
                      <div className="grid grid-cols-[100px_80px_1fr_120px] border-b border-border/40 py-1.5 text-[10px] text-muted-2">
                        <span>Thời gian</span>
                        <span>Chiều</span>
                        <span className="text-right">Khối lượng</span>
                        <span className="text-right">Giá trị</span>
                      </div>
                      {stream.foreignEvents.map((event) => (
                        <div
                          key={event.id}
                          className="grid grid-cols-[100px_80px_1fr_120px] items-center border-b border-border/30 py-1.5 font-mono text-xs last:border-0"
                        >
                          <span className="text-muted-2">{timeLabel(event.time)}</span>
                          <span>
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                event.side === "BUY" ? "bg-up/15 text-up" : "bg-down/15 text-down"
                              }`}
                            >
                              {event.side === "BUY" ? "NN MUA" : "NN BÁN"}
                            </span>
                          </span>
                          <span className="text-right font-bold text-foreground">{formatVolume(event.volume)}</span>
                          <span className="text-right text-muted-2">{formatMarketValue(event.value)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="px-4 py-8 text-center text-xs text-muted-2">
                      {stream.foreign
                        ? "Đã nạp đầy đủ số liệu lũy kế. Khối ngoại chưa phát sinh lệnh mới trong tích tắc vừa qua."
                        : "Đang kết nối luồng NĐT nước ngoài..."}
                    </div>
                  )}
                </div>

                <div className="text-[10px] text-muted leading-relaxed">
                  * Dữ liệu NĐTNN được tổng hợp trực tiếp từ sở giao dịch & feed DNSE T=f. Khối lượng và giá trị không bị suy diễn từ bảng khớp lệnh thông thường.
                </div>
              </div>
            )}

            {/* TAB CONTENT: PHÂN TÍCH BƯỚC GIÁ (VOLUME PROFILE) */}
            {activityTab === "profile" && (
              <div className="flex flex-col flex-1">
                <div className="mb-2 text-xs text-muted-2">Phân bổ khối lượng khớp lệnh theo từng bước giá trong phiên:</div>

                {volumeProfile.rows.length ? (
                  <div className="rounded-lg border border-border/80 bg-[#121313] p-2.5 max-h-[340px] overflow-y-auto space-y-1.5">
                    {volumeProfile.rows.map((row) => {
                      const totalPct = (row.totalVol / volumeProfile.maxVol) * 100
                      const buyVolPct = row.totalVol > 0 ? (row.buyVol / row.totalVol) * 100 : 50
                      const isRef = quote?.reference && row.price === quote.reference
                      const isCurrent = quote?.price && row.price === quote.price

                      return (
                        <div key={row.price} className="relative flex items-center gap-3 font-mono text-xs py-1 px-2 rounded hover:bg-panel-2/50">
                          {/* Profile histogram bar */}
                          <div
                            className="absolute inset-y-0 left-0 bg-brand/10 rounded"
                            style={{ width: `${totalPct.toFixed(1)}%` }}
                            aria-hidden="true"
                          />

                          {/* Price */}
                          <div className="relative w-16 font-bold flex items-center gap-1">
                            <span
                              className={
                                quote?.reference && row.price > quote.reference
                                  ? "text-up"
                                  : quote?.reference && row.price < quote.reference
                                    ? "text-down"
                                    : "text-ref"
                              }
                            >
                              {formatPrice(row.price)}
                            </span>
                            {isCurrent && <span className="h-1.5 w-1.5 rounded-full bg-brand animate-pulse" title="Giá khớp hiện tại" />}
                            {isRef && <span className="text-[9px] text-ref" title="Giá tham chiếu">(TC)</span>}
                          </div>

                          {/* Volume */}
                          <div className="relative w-24 text-right font-semibold text-foreground">
                            {formatVolume(row.totalVol)}
                          </div>

                          {/* Dual Buy/Sell Mini Bar */}
                          <div className="relative flex-1 flex items-center gap-2">
                            <div className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-panel-2">
                              <div className="bg-up" style={{ width: `${buyVolPct}%` }} />
                              <div className="bg-down" style={{ width: `${100 - buyVolPct}%` }} />
                            </div>
                            <span className="text-[10px] text-muted-2 w-12 text-right">
                              {((row.totalVol / tradeStats.totalTraded) * 100).toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="rounded-lg border border-border bg-panel-2/30 px-4 py-8 text-center text-xs text-muted-2">
                    Chưa có đủ dữ liệu khớp lệnh để vẽ phân bổ bước giá.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* RESIZE HANDLES (Interactive everywhere via window listeners with 0ms drag latency) */}
      {!minimized && !isMaximized && (
        <>
          {/* Bottom-right corner resize handle */}
          <div
            onPointerDown={(e) => startResize(e, "se")}
            className="absolute bottom-0 right-0 h-5 w-5 cursor-se-resize flex items-end justify-end p-1 z-30 group touch-none select-none"
            title="Kéo để phóng to / thu nhỏ"
          >
            <div className="h-2.5 w-2.5 border-r-2 border-b-2 border-muted-2/80 group-hover:border-brand group-active:border-brand transition-colors" />
          </div>

          {/* Right edge resize strip */}
          <div
            onPointerDown={(e) => startResize(e, "e")}
            className="absolute top-0 right-0 bottom-5 w-2 cursor-e-resize z-20 hover:bg-brand/25 active:bg-brand/40 transition-colors touch-none select-none"
            title="Kéo ngang"
          />

          {/* Bottom edge resize strip */}
          <div
            onPointerDown={(e) => startResize(e, "s")}
            className="absolute bottom-0 left-0 right-5 h-2 cursor-s-resize z-20 hover:bg-brand/25 active:bg-brand/40 transition-colors touch-none select-none"
            title="Kéo dọc"
          />
        </>
      )}
    </section>
  )
}
