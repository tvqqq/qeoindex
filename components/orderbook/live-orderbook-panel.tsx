"use client"

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Activity,
  AlertCircle,
  BarChart3,
  Clock,
  ExternalLink,
  GripVertical,
  Handshake,
  Layers,
  ListFilter,
  Maximize2,
  Minimize2,
  Minus,
  PieChart,
  RefreshCw,
  RotateCcw,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react"
import { MarketChangePill } from "@/components/market-change-pill"
import { marketToneFromPrice, marketToneHex, marketToneText } from "@/lib/market-tone"
import { normalizeMarketPrice } from "@/lib/intraday-5m"
import { useFlashAnimation, usePriceFlashAnimation } from "@/lib/use-flash-animation"
import { useWhaleConfetti, ConfettiOverlay } from "@/components/orderbook/confetti"
import { calculateSessionCountdown } from "@/lib/session-countdown"
import type { StockInitialMeta } from "@/components/orderbook/orderbook-context"

export type DepthLevel = { price: number; volume: number }
export type TradeSide = "BUY" | "SELL" | "UNKNOWN"
export type StreamTrade = { id: string; time: string; price: number; volume: number; side: TradeSide }
export type StockQuote = {
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
type ActivityTab = "trades" | "foreign" | "profile" | "putthrough"
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
type ForeignTimelinePoint = { time: string; timestamp: number; buyValue: number; sellValue: number; netValue: number }
type PutThroughDeal = { id: string; time: string; price: number; volume: number; value: number; type?: string; sym?: string }

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
  putThrough?: PutThroughDeal[]
}

const ORDERBOOK_VOLUME_MULTIPLIER = 10
const LARGE_TRADE_MIN_VOLUME = 10_000
const OPEN_PRICE_KEYS = ["openPrice", "openingPrice", "open", "openValue", "firstPrice"]
const STREAM_STALE_MS = 45_000
const MAX_SESSION_TRADES = 30_000

/** 
 * Quy tắc phân loại lệnh cá mập:
 * - Nếu spread giá là 0.05 (hoặc giá < 50k) → Filter & Tag Cá mập ≥50K ("50K+")
 * - Nếu spread giá là 0.1 (hoặc giá ≥ 50k) → Filter & Tag Cá mập ≥30K ("30K+")
 */
function getWhaleThreshold(price?: number | null, spread?: number | null): number {
  if (spread !== null && spread !== undefined && spread > 0) {
    if (spread <= 0.06) return 50_000
    if (spread >= 0.09) return 30_000
  }

  if (!price || price <= 0) return 50_000
  const normalizedPrice = price > 1000 ? price / 1000 : price
  if (normalizedPrice >= 50) return 30_000   // spread = 0.1 → ≥30K
  return 50_000                              // spread = 0.05 → ≥50K
}

function getWhaleLabel(price?: number | null, spread?: number | null): string {
  const threshold = getWhaleThreshold(price, spread)
  return threshold >= 50_000 ? "≥50K" : "≥30K"
}

const DEFAULT_WIDTH = 740
const MIN_WIDTH = 660
const MIN_HEIGHT = 600
const DEFAULT_HEIGHT = 740

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
  const normalized = value >= 1000 ? value / 1000 : value
  return new Intl.NumberFormat("vi-VN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(normalized)
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
  if (!value) return "—"
  if (/^\d{2}:\d{2}:\d{2}$/.test(value)) return value
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return value || "—"
  return new Date(parsed).toLocaleTimeString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

export function useSessionCountdown() {
  const [countdown, setCountdown] = useState<{ type: "ATO" | "ATC"; label: string; remainingSec: number } | null>(() => {
    return calculateSessionCountdown()
  })

  useEffect(() => {
    const update = () => {
      setCountdown(calculateSessionCountdown())
    }
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [])

  return countdown
}

function getPriceColorClass(
  price?: number,
  reference?: number,
  ceiling?: number,
  floor?: number
): string {
  if (!price || !Number.isFinite(price)) return "text-foreground font-bold"

  const normPrice = price >= 1000 ? price / 1000 : price
  const ref = reference ? (reference >= 1000 ? reference / 1000 : reference) : undefined
  const ceil = ceiling ? (ceiling >= 1000 ? ceiling / 1000 : ceiling) : undefined
  const flr = floor ? (floor >= 1000 ? floor / 1000 : floor) : undefined

  if (ceil && normPrice >= ceil - 0.01) return "text-ceiling font-bold"
  if (flr && normPrice <= flr + 0.01) return "text-floor font-bold"
  if (ref) {
    if (Math.abs(normPrice - ref) < 0.01) return "text-ref font-bold"
    if (normPrice > ref) return "text-up font-bold"
    if (normPrice < ref) return "text-down font-bold"
  }
  return "text-foreground font-bold"
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
  if (side === "BUY") return { label: "Mua", className: "text-up bg-up/10 border-up/30" }
  if (side === "SELL") return { label: "Bán", className: "text-down bg-down/10 border-down/30" }
  return { label: "Khớp", className: "text-muted-2 bg-panel-2 border-border" }
}

function sidePillMeta(side: TradeSide) {
  if (side === "BUY") return { label: "M", className: "text-up bg-up/15 border-up/40" }
  if (side === "SELL") return { label: "B", className: "text-down bg-down/15 border-down/40" }
  return { label: "—", className: "text-muted-2 bg-panel-2 border-border/80" }
}

function nextQuote(symbol: string, data: Record<string, unknown>, current: StockQuote | null): StockQuote | null {
  const rawPrice = firstPositive(data, ["matchPrice", "price", "lastPrice"]) || current?.price || 0
  if (rawPrice <= 0) return current
  const price = current?.price ? normalizeMarketPrice(rawPrice, current.price) ?? rawPrice : rawPrice

  const rawReference = firstPositive(data, ["referencePrice", "refPrice", "reference"]) || current?.reference || price
  const reference = normalizeMarketPrice(rawReference, price) ?? rawReference

  const rawCeiling = firstPositive(data, ["ceilingPrice", "ceiling"]) || current?.ceiling
  const ceiling = rawCeiling ? normalizeMarketPrice(rawCeiling, price) ?? rawCeiling : undefined

  const rawFloor = firstPositive(data, ["floorPrice", "floor"]) || current?.floor
  const floor = rawFloor ? normalizeMarketPrice(rawFloor, price) ?? rawFloor : undefined

  const rawHigh = firstPositive(data, ["highPrice", "high"]) || (current?.high ? Math.max(current.high, price) : price)
  const high = rawHigh ? normalizeMarketPrice(rawHigh, price) ?? rawHigh : price

  const rawLow = firstPositive(data, ["lowPrice", "low"]) || (current?.low ? Math.min(current.low, price) : price)
  const low = rawLow ? normalizeMarketPrice(rawLow, price) ?? rawLow : price

  const rawAvg = firstPositive(data, ["avgPrice", "averagePrice", "avePrice"]) || current?.avgPrice
  const avgPrice = rawAvg ? normalizeMarketPrice(rawAvg, price) ?? rawAvg : undefined
  
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

import { clusterTrades, parseTradeSeconds, type ClusteredTrade } from "@/lib/trade-clustering"

export type { ClusteredTrade }

export interface CachedSessionData {
  prices: number[]
  company: CompanyInfo | null
  foreign: ForeignSnapshot | null
  foreignTimeline: ForeignTimelinePoint[]
  quote: StockQuote | null
  bids: DepthLevel[]
  asks: DepthLevel[]
  trades: StreamTrade[]
  putThrough: PutThroughDeal[]
  cachedAt: number
}

// In-memory client-side cache for session orderbook data
export const sessionOrderBookCache = new Map<string, CachedSessionData>()

function mergeTrades(incoming: StreamTrade[], current: StreamTrade[]) {
  const deduped = new Map<string, StreamTrade>()
  for (const trade of [...incoming, ...current]) deduped.set(trade.id, trade)
  return [...deduped.values()]
    .sort((a, b) => parseTradeSeconds(b.time) - parseTradeSeconds(a.time))
    .slice(0, MAX_SESSION_TRADES)
}

function useDnseOrderBookStream(symbol: string, reconnectKey: number, initialMeta?: StockInitialMeta) {
  const cachedInitial = sessionOrderBookCache.get(symbol)
  const [state, setState] = useState<StreamState>("CONNECTING")
  const [bids, setBids] = useState<DepthLevel[]>(() => cachedInitial?.bids ?? [])
  const [asks, setAsks] = useState<DepthLevel[]>(() => cachedInitial?.asks ?? [])
  const [trades, setTrades] = useState<StreamTrade[]>(() => cachedInitial?.trades ?? [])
  const [foreign, setForeign] = useState<ForeignSnapshot | null>(() => cachedInitial?.foreign ?? null)
  const [foreignEvents, setForeignEvents] = useState<ForeignFlowEvent[]>([])
  const [foreignTimeline, setForeignTimeline] = useState<ForeignTimelinePoint[]>(() => cachedInitial?.foreignTimeline ?? [])
  const [putThroughDeals, setPutThroughDeals] = useState<PutThroughDeal[]>(() => cachedInitial?.putThrough ?? [])
  const [company, setCompany] = useState<CompanyInfo | null>(() => cachedInitial?.company ?? (initialMeta?.companyName ? { nameVi: initialMeta.companyName, sector: initialMeta.sector } : null))
  const [quote, setQuote] = useState<StockQuote | null>(() => {
    if (cachedInitial?.quote) return cachedInitial.quote
    if (!initialMeta?.price) return null
    const price = initialMeta.price
    const reference = initialMeta.reference ? normalizeMarketPrice(initialMeta.reference, price) ?? initialMeta.reference : undefined
    const ceiling = initialMeta.ceiling ? normalizeMarketPrice(initialMeta.ceiling, price) ?? initialMeta.ceiling : undefined
    const floor = initialMeta.floor ? normalizeMarketPrice(initialMeta.floor, price) ?? initialMeta.floor : undefined
    return {
      symbol,
      price,
      reference,
      ceiling,
      floor,
      changePercent: initialMeta.changePercent ?? 0,
      totalVolume: initialMeta.volume,
      volume: initialMeta.volume,
      updatedAt: new Date().toISOString(),
    }
  })
  const [priceHistory, setPriceHistory] = useState<number[]>(() => cachedInitial?.prices ?? (initialMeta?.history ?? []))
  const [historyState, setHistoryState] = useState<HistoryState>(() => cachedInitial ? "READY" : "LOADING")
  const [historyMessage, setHistoryMessage] = useState(() => cachedInitial ? "Đã tải từ bộ nhớ đệm." : "")
  const [updatedAt, setUpdatedAt] = useState("")
  const [error, setError] = useState("")
  const depthRef = useRef<{ bids: DepthLevel[]; asks: DepthLevel[] }>({ bids: cachedInitial?.bids ?? [], asks: cachedInitial?.asks ?? [] })
  const lastFrameAt = useRef(0)
  const lastForeignEventKey = useRef<string>("")

  // Hydrate from initial metadata if symbol changes
  useEffect(() => {
    const cached = sessionOrderBookCache.get(symbol)
    if (cached) {
      setBids(cached.bids)
      setAsks(cached.asks)
      setTrades(cached.trades)
      setForeign(cached.foreign)
      setForeignTimeline(cached.foreignTimeline)
      setPutThroughDeals(cached.putThrough)
      if (cached.company) setCompany(cached.company)
      if (cached.quote) setQuote(cached.quote)
      if (cached.prices.length) setPriceHistory(cached.prices)
      setHistoryState("READY")
      setHistoryMessage("Đã tải từ bộ nhớ đệm.")
    } else if (initialMeta) {
      if (initialMeta.price) {
        const price = initialMeta.price
        const reference = initialMeta.reference ? normalizeMarketPrice(initialMeta.reference, price) ?? initialMeta.reference : undefined
        const ceiling = initialMeta.ceiling ? normalizeMarketPrice(initialMeta.ceiling, price) ?? initialMeta.ceiling : undefined
        const floor = initialMeta.floor ? normalizeMarketPrice(initialMeta.floor, price) ?? initialMeta.floor : undefined
        setQuote({
          symbol,
          price,
          reference,
          ceiling,
          floor,
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

  // Fetch REST session history + initial hydration with smart cache (SWR)
  useEffect(() => {
    const controller = new AbortController()
    let disposed = false
    const cached = sessionOrderBookCache.get(symbol)

    if (!cached) {
      setHistoryState("LOADING")
      setHistoryMessage("")
    }

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

        let nextCompany: CompanyInfo | null = null
        if (payload.company) {
          nextCompany = {
            nameVi: payload.company.nameVi || "",
            nameEn: payload.company.nameEn,
            exchange: payload.company.exchange,
            sector: payload.company.sector,
          }
          setCompany(nextCompany)
        }

        let nextForeign: ForeignSnapshot | null = null
        let nextTimeline: ForeignTimelinePoint[] = []
        if (payload.foreign) {
          const buyVol = number(payload.foreign.totalBuyVolume)
          const sellVol = number(payload.foreign.totalSellVolume)
          const buyVal = number(payload.foreign.totalBuyValue)
          const sellVal = number(payload.foreign.totalSellValue)
          const nowMs = Date.now()
          nextTimeline = [
            { time: "09:15", timestamp: nowMs - 3600000, buyValue: 0, sellValue: 0, netValue: 0 },
            {
              time: timeLabel(payload.foreign.updatedAt || new Date().toISOString()),
              timestamp: nowMs,
              buyValue: buyVal,
              sellValue: sellVal,
              netValue: buyVal - sellVal,
            },
          ]
          setForeignTimeline(nextTimeline)

          nextForeign = {
            symbol,
            totalBuyVolume: buyVol || 0,
            totalSellVolume: sellVol || 0,
            totalBuyValue: buyVal || 0,
            totalSellValue: sellVal || 0,
            availableRoom: nullableNumber(payload.foreign?.availableRoom) ?? null,
            orderLimitQuantity: nullableNumber(payload.foreign?.orderLimitQuantity) ?? null,
            listedShare: nullableNumber(payload.foreign?.listedShare) ?? null,
            updatedAt: payload.foreign?.updatedAt || new Date().toISOString(),
          }
          setForeign(nextForeign)
        }

        let nextBids: DepthLevel[] = []
        let nextAsks: DepthLevel[] = []
        let nextQuoteVal: StockQuote | null = null
        const latest = payload.latestQuote
        if (latest) {
          nextBids = normalizeDepth(latest.bid).sort((a, b) => b.price - a.price)
          nextAsks = normalizeDepth(latest.offer).sort((a, b) => a.price - b.price)
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
          setQuote((current) => {
            nextQuoteVal = nextQuote(symbol, restQuote, current)
            return nextQuoteVal
          })
        }

        const historicalTrades: StreamTrade[] = (payload.trades ?? [])
          .map((trade, index) => {
            const rawPrice = number(trade.price)
            const price = rawPrice > 1000 ? rawPrice / 1000 : rawPrice
            const tradeId = trade.id && trade.id !== "3220" ? trade.id : `${trade.time}-${index}`
            return {
              id: `history-${tradeId}`,
              time: normalizeTime(trade.time),
              price,
              volume: number(trade.volume) * ORDERBOOK_VOLUME_MULTIPLIER,
              side: explicitSide(trade.side),
            }
          })
          .filter((trade) => trade.price > 0 && trade.volume > 0)

        let mergedTradesList = historicalTrades
        if (historicalTrades.length > 0) {
          setTrades((current) => {
            mergedTradesList = mergeTrades(historicalTrades, current)
            return mergedTradesList
          })
        }

        if (payload.tradesTruncated) {
          setHistoryState("PARTIAL")
          setHistoryMessage(`Đã tải ${historicalTrades.length.toLocaleString("vi-VN")} giao dịch (giới hạn thanh khoản).`)
        } else {
          setHistoryState("READY")
          setHistoryMessage(`Đầu phiên 09:00 · ${prices.length} nến · ${historicalTrades.length.toLocaleString("vi-VN")} lệnh.`)
        }

        const putThroughList = payload.putThrough ?? []
        if (putThroughList.length > 0) {
          setPutThroughDeals(putThroughList)
        }

        // Cache the session data for subsequent popup opens
        sessionOrderBookCache.set(symbol, {
          prices,
          company: nextCompany || company,
          foreign: nextForeign || foreign,
          foreignTimeline: nextTimeline.length ? nextTimeline : foreignTimeline,
          quote: nextQuoteVal || quote,
          bids: nextBids.length ? nextBids : bids,
          asks: nextAsks.length ? nextAsks : asks,
          trades: mergedTradesList,
          putThrough: putThroughList,
          cachedAt: Date.now(),
        })
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
  }, [symbol, reconnectKey])

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

        let lastPongAt = Date.now()

        socket = new WebSocket(authJson.url)
        socket.onopen = () => {
          lastFrameAt.current = Date.now()
          lastPongAt = Date.now()
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
          if (action === "pong") {
            lastPongAt = Date.now()
            return
          }
          if (action === "ping") {
            lastPongAt = Date.now()
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
            lastPongAt = Date.now()
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
              if (socket?.readyState === WebSocket.OPEN && Date.now() - lastPongAt > 40_000) {
                forceReconnect("websocket keepalive pong timeout")
              }
            }, 10_000)
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

            setForeign((current) => {
              const nextBuyVol = totalBuyVol || (buyVolume > 0 && current ? current.totalBuyVolume + buyVolume : current?.totalBuyVolume || 0)
              const nextSellVol = totalSellVol || (sellVolume > 0 && current ? current.totalSellVolume + sellVolume : current?.totalSellVolume || 0)
              const nextBuy = totalBuyVal || (buyValue > 0 && current ? current.totalBuyValue + buyValue : current?.totalBuyValue || 0)
              const nextSell = totalSellVal || (sellValue > 0 && current ? current.totalSellValue + sellValue : current?.totalSellValue || 0)
              const nextNet = nextBuy - nextSell

              setForeignTimeline((prev) => {
                const newPoint = {
                  time: timeLabel(time),
                  timestamp: Date.now(),
                  buyValue: nextBuy,
                  sellValue: nextSell,
                  netValue: nextNet,
                }
                if (!prev.length) {
                  return [{ time: "09:15", timestamp: Date.now() - 60000, buyValue: 0, sellValue: 0, netValue: 0 }, newPoint]
                }
                return [...prev.slice(-120), newPoint]
              })

              return {
                symbol,
                totalBuyVolume: nextBuyVol,
                totalSellVolume: nextSellVol,
                totalBuyValue: nextBuy,
                totalSellValue: nextSell,
                availableRoom: room ?? current?.availableRoom ?? null,
                orderLimitQuantity: limit ?? current?.orderLimitQuantity ?? null,
                listedShare: current?.listedShare ?? null,
                investorTypeCode: String(data?.foreignInvestorTypeCode ?? current?.investorTypeCode ?? ""),
                updatedAt: time,
              }
            })

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

  const latestSnapshotRef = useRef({
    prices: priceHistory,
    company,
    foreign,
    foreignTimeline,
    quote,
    bids,
    asks,
    trades,
    putThrough: putThroughDeals,
  })
  latestSnapshotRef.current = {
    prices: priceHistory,
    company,
    foreign,
    foreignTimeline,
    quote,
    bids,
    asks,
    trades,
    putThrough: putThroughDeals,
  }

  useEffect(() => {
    return () => {
      const snap = latestSnapshotRef.current
      if (snap.trades.length || snap.bids.length || snap.asks.length || snap.quote) {
        sessionOrderBookCache.set(symbol, {
          ...snap,
          cachedAt: Date.now(),
        })
      }
    }
  }, [symbol])

  return { state, bids, asks, trades, foreign, foreignEvents, foreignTimeline, putThroughDeals, company, quote, priceHistory, historyState, historyMessage, updatedAt, error }
}

function buildForeignTimeline(
  trades: StreamTrade[],
  foreign: ForeignSnapshot | null,
  referencePrice?: number
): ForeignTimelinePoint[] {
  if (!foreign) return []

  const totalBuyVal = foreign.totalBuyValue || (foreign.totalBuyVolume && referencePrice ? foreign.totalBuyVolume * referencePrice : 0)
  const totalSellVal = foreign.totalSellValue || (foreign.totalSellVolume && referencePrice ? foreign.totalSellVolume * referencePrice : 0)
  const totalNetVal = totalBuyVal - totalSellVal

  if (!trades.length) {
    return [
      { time: "09:15:00", timestamp: 1, buyValue: 0, sellValue: 0, netValue: 0 },
      { time: "Hiện tại", timestamp: 2, buyValue: totalBuyVal, sellValue: totalSellVal, netValue: totalNetVal },
    ]
  }

  // Sort trades chronologically (oldest first)
  const sortedTrades = [...trades].sort((a, b) => {
    const ta = parseTradeSeconds(a.time)
    const tb = parseTradeSeconds(b.time)
    return ta - tb
  })

  // Calculate cumulative buy and sell volume weights over time
  let totalBuyVol = 0
  let totalSellVol = 0
  for (const t of sortedTrades) {
    if (t.side === "BUY") totalBuyVol += t.volume
    else if (t.side === "SELL") totalSellVol += t.volume
    else {
      totalBuyVol += t.volume * 0.5
      totalSellVol += t.volume * 0.5
    }
  }

  totalBuyVol = Math.max(1, totalBuyVol)
  totalSellVol = Math.max(1, totalSellVol)

  // Sample trades into 30~50 uniform time intervals for smooth SVG rendering
  const pointCount = Math.min(60, Math.max(15, sortedTrades.length))
  const step = Math.max(1, Math.floor(sortedTrades.length / pointCount))

  const firstTradeTime = sortedTrades[0]?.time ? timeLabel(sortedTrades[0].time) : "09:15:00"
  const points: ForeignTimelinePoint[] = [
    { time: firstTradeTime.startsWith("09:15") ? "09:15:00" : firstTradeTime, timestamp: 0, buyValue: 0, sellValue: 0, netValue: 0 },
  ]

  let curBuyVol = 0
  let curSellVol = 0

  for (let i = 0; i < sortedTrades.length; i++) {
    const t = sortedTrades[i]
    if (t.side === "BUY") curBuyVol += t.volume
    else if (t.side === "SELL") curSellVol += t.volume
    else {
      curBuyVol += t.volume * 0.5
      curSellVol += t.volume * 0.5
    }

    if (i % step === 0 || i === sortedTrades.length - 1) {
      const buyRatio = Math.min(1, curBuyVol / totalBuyVol)
      const sellRatio = Math.min(1, curSellVol / totalSellVol)
      const buyValue = totalBuyVal * buyRatio
      const sellValue = totalSellVal * sellRatio
      const netValue = buyValue - sellValue

      points.push({
        time: timeLabel(t.time),
        timestamp: i + 1,
        buyValue,
        sellValue,
        netValue,
      })
    }
  }

  // Ensure last point exactly matches current official foreign totals
  const lastPoint = points.at(-1)
  if (lastPoint) {
    lastPoint.buyValue = totalBuyVal
    lastPoint.sellValue = totalSellVal
    lastPoint.netValue = totalNetVal
  }

  return points
}

const ForeignFlowChart = memo(function ForeignFlowChart({
  timeline,
  currentNetValue,
  currentBuyValue,
  currentSellValue,
  height = 140,
}: {
  timeline: ForeignTimelinePoint[]
  currentNetValue: number | null
  currentBuyValue?: number | null
  currentSellValue?: number | null
  height?: number
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const points = useMemo(() => {
    if (timeline.length >= 2) return timeline
    const buy = currentBuyValue || 0
    const sell = currentSellValue || 0
    const net = currentNetValue || (buy - sell)
    return [
      { time: "09:15", timestamp: 1, buyValue: 0, sellValue: 0, netValue: 0 },
      { time: "Hiện tại", timestamp: 2, buyValue: buy, sellValue: sell, netValue: net },
    ]
  }, [timeline, currentNetValue, currentBuyValue, currentSellValue])

  const { coordinates, zeroY, netPathD, netAreaD, buyPathD, sellPathD } = useMemo(() => {
    const netVals = points.map((p) => p.netValue)
    const buyVals = points.map((p) => p.buyValue)
    const sellVals = points.map((p) => p.sellValue)

    const rawMin = Math.min(0, ...netVals, ...sellVals.map((v) => -v))
    const rawMax = Math.max(0, ...netVals, ...buyVals)
    const range = Math.max(1_000_000, rawMax - rawMin)
    const padding = 14
    const usableH = height - padding * 2
    const width = 600

    const coords = points.map((pt, idx) => {
      const x = (idx / (points.length - 1 || 1)) * width
      const netY = height - padding - ((pt.netValue - rawMin) / range) * usableH
      const buyY = height - padding - ((pt.buyValue - rawMin) / range) * usableH
      const sellY = height - padding - ((-pt.sellValue - rawMin) / range) * usableH
      return { x, netY, buyY, sellY, ...pt }
    })

    const zeroYPos = height - padding - ((0 - rawMin) / range) * usableH

    const netD = coords.reduce((acc, pt, idx) => (idx === 0 ? `M ${pt.x},${pt.netY}` : `${acc} L ${pt.x},${pt.netY}`), "")
    const netArea = coords.length ? `${netD} L ${coords.at(-1)?.x},${zeroYPos} L ${coords[0].x},${zeroYPos} Z` : ""
    const buyD = coords.reduce((acc, pt, idx) => (idx === 0 ? `M ${pt.x},${pt.buyY}` : `${acc} L ${pt.x},${pt.buyY}`), "")
    const sellD = coords.reduce((acc, pt, idx) => (idx === 0 ? `M ${pt.x},${pt.sellY}` : `${acc} L ${pt.x},${pt.sellY}`), "")

    return {
      coordinates: coords,
      minNet: rawMin,
      maxNet: rawMax,
      zeroY: zeroYPos,
      netPathD: netD,
      netAreaD: netArea,
      buyPathD: buyD,
      sellPathD: sellD,
    }
  }, [points, height])

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!containerRef.current || coordinates.length < 2) return
    const rect = containerRef.current.getBoundingClientRect()
    const xPct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const index = Math.round(xPct * (coordinates.length - 1))
    setHoverIndex(index)
  }

  const handlePointerLeave = () => setHoverIndex(null)

  const hovered = hoverIndex !== null && coordinates[hoverIndex] ? coordinates[hoverIndex] : null
  const isNetPositive = (currentNetValue || 0) >= 0

  return (
    <div className="flex flex-col space-y-2 rounded-lg border border-border/80 bg-[#121313] p-3">
      {/* Header & Legend */}
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-foreground flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-brand" />
          Biến động GT Khối Ngoại Trong Phiên
          <span className="font-mono text-[10px] text-muted font-normal">({points.length} mốc)</span>
        </span>
        <div className="flex items-center gap-2.5 font-mono text-[10px]">
          <span className="flex items-center gap-1 text-up font-semibold">
            <span className="inline-block h-1.5 w-3 rounded bg-up" /> Mua lũy kế
          </span>
          <span className="flex items-center gap-1 text-down font-semibold">
            <span className="inline-block h-1.5 w-3 rounded bg-down" /> Bán lũy kế
          </span>
          <span className="flex items-center gap-1 text-purple-400 font-bold">
            <span className="inline-block h-2 w-2 rounded-full bg-purple-400" /> Ròng
          </span>
        </div>
      </div>

      {/* SVG Chart Container */}
      <div
        ref={containerRef}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        className="group relative h-[140px] w-full cursor-crosshair select-none overflow-hidden rounded bg-[#161717] p-1.5"
      >
        <svg viewBox="0 0 600 140" preserveAspectRatio="none" className="h-full w-full overflow-visible">
          <defs>
            <linearGradient id="foreignNetGradPos" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22c98a" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#22c98a" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="foreignNetGradNeg" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor="#ff4757" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#ff4757" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Zero baseline */}
          <line x1="0" y1={zeroY} x2="600" y2={zeroY} stroke="#64748b" strokeDasharray="3 3" strokeOpacity="0.5" strokeWidth="1" />

          {/* Net Flow Fill Area */}
          <path d={netAreaD} fill={isNetPositive ? "url(#foreignNetGradPos)" : "url(#foreignNetGradNeg)"} />

          {/* Buy Cumulative Line */}
          <path d={buyPathD} fill="none" stroke="#22c98a" strokeWidth="1.2" strokeDasharray="3 2" strokeOpacity="0.7" />

          {/* Sell Cumulative Line */}
          <path d={sellPathD} fill="none" stroke="#ff4757" strokeWidth="1.2" strokeDasharray="3 2" strokeOpacity="0.7" />

          {/* Net Value Main Line */}
          <path d={netPathD} fill="none" stroke={isNetPositive ? "#22c98a" : "#ff4757"} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />

          {/* Current / Hovered point */}
          {hovered ? (
            <>
              <line x1={hovered.x} y1="0" x2={hovered.x} y2="140" stroke="#ffffff" strokeOpacity="0.3" strokeDasharray="2 2" strokeWidth="1" />
              <circle cx={hovered.x} cy={hovered.netY} r="4.5" fill={hovered.netValue >= 0 ? "#22c98a" : "#ff4757"} stroke="#ffffff" strokeWidth="1.5" />
            </>
          ) : (
            coordinates.at(-1) && (
              <circle
                cx={coordinates.at(-1)?.x}
                cy={coordinates.at(-1)?.netY}
                r="4"
                fill={isNetPositive ? "#22c98a" : "#ff4757"}
                className="animate-pulse"
              />
            )
          )}
        </svg>

        {/* Floating Tooltip */}
        {hovered ? (
          <div className="pointer-events-none absolute left-3 top-2 flex flex-wrap items-center gap-2 font-mono text-[11px] rounded bg-black/85 px-2.5 py-1 backdrop-blur-md border border-border/80 shadow-lg">
            <span className="text-muted-2">{hovered.time}</span>
            <span className="text-muted">·</span>
            <span>
              Mua ròng:{" "}
              <b className={hovered.netValue > 0 ? "text-up" : hovered.netValue < 0 ? "text-down" : "text-ref"}>
                {hovered.netValue > 0 ? "+" : ""}{formatMarketValue(hovered.netValue)}
              </b>
            </span>
            <span className="text-muted">·</span>
            <span className="text-up font-semibold">Mua: {formatMarketValue(hovered.buyValue)}</span>
            <span className="text-muted">·</span>
            <span className="text-down font-semibold">Bán: {formatMarketValue(hovered.sellValue)}</span>
          </div>
        ) : (
          <div className="pointer-events-none absolute bottom-1 right-2 font-mono text-[9px] text-muted-2">
            Đầu phiên 09:15 ➔ Hiện tại
          </div>
        )}
      </div>
    </div>
  )
})

function AllTradesIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </svg>
  )
}

function SmallFishIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M6.5 12c.94-3.46 4.94-6 8.5-6 3.56 0 6.06 2.54 7 6-.94 3.46-3.44 6-7 6s-7.56-2.54-8.5-6Z" />
      <path d="M18 12v.5" />
      <path d="M16 17.93a9.77 9.77 0 0 1 0-11.86" />
      <path d="M7 10.67C7 8 5.58 5.97 2.73 5.5c-1 1.5-1 5 .23 6.5-1.24 1.5-1.24 5-.23 6.5C5.58 18.03 7 16 7 13.33" />
      <circle cx="17" cy="10" r="1" fill="currentColor" />
    </svg>
  )
}

function SharkIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M2 13c1.5-3.5 5.5-6 10-6 3 0 5 1.2 7 3L22 8l-2 5 2 5-3-2c-2 1.8-4 3-7 3-4.5 0-8.5-2.5-10-6Z" />
      <path d="M11 7 14 2l1.5 5" />
      <path d="M8 17l2.5 4" />
      <circle cx="17" cy="11.5" r="1.2" fill="currentColor" />
    </svg>
  )
}

function TapeLoadingSkeleton() {
  return (
    <div className="flex flex-col flex-1 space-y-2.5">
      {/* Connecting banner with spinner */}
      <div className="flex items-center justify-between rounded-lg border border-border/80 bg-[#121313] px-3.5 py-2.5 font-mono text-xs text-muted-2">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-brand" />
          </span>
          <span className="text-foreground font-semibold">Đang kết nối Realtime WebSocket DNSE...</span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted">
          <RefreshCw className="h-3.5 w-3.5 animate-spin text-brand" />
          <span>Đồng bộ khớp lệnh</span>
        </div>
      </div>

      {/* Shimmer 2-column Layout Skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-[1.3fr_1fr] gap-2.5 flex-1 min-h-0">
        <div className="flex-1 rounded-lg border border-border/80 bg-[#121313] overflow-hidden flex flex-col p-3 space-y-2.5">
          <div className="grid grid-cols-[1.2fr_1.1fr_0.75fr] gap-x-2 border-b border-border/60 pb-2">
            <div className="h-3 w-14 bg-[#1f2122] rounded animate-pulse" />
            <div className="h-3 w-16 bg-[#1f2122] rounded animate-pulse ml-auto" />
            <div className="h-3 w-10 bg-[#1f2122] rounded animate-pulse ml-auto" />
          </div>

          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="grid grid-cols-[1.2fr_1.1fr_0.75fr] gap-x-2 items-center py-1 border-b border-border/20 last:border-0">
              <div className="h-3.5 w-16 bg-[#181a1b] rounded animate-pulse" style={{ animationDelay: `${i * 80}ms` }} />
              <div className="h-3.5 w-14 bg-[#181a1b] rounded animate-pulse ml-auto" style={{ animationDelay: `${i * 80}ms` }} />
              <div className="h-3.5 w-10 bg-[#181a1b] rounded animate-pulse ml-auto" style={{ animationDelay: `${i * 80}ms` }} />
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-border/80 bg-[#121313] p-3 space-y-2.5 flex flex-col justify-between">
          <div className="flex items-center justify-between border-b border-border/50 pb-1.5">
            <div className="h-3.5 w-24 bg-[#1f2122] rounded animate-pulse" />
            <div className="h-3 w-12 bg-[#1f2122] rounded animate-pulse" />
          </div>
          <div className="h-14 bg-[#181a1b] rounded-lg animate-pulse" />
          <div className="h-16 bg-[#181a1b] rounded-lg animate-pulse" />
          <div className="h-10 bg-[#181a1b] rounded-lg animate-pulse" />
        </div>
      </div>
    </div>
  )
}

function ForeignRealtimeCard({
  foreign,
  quotePrice,
  foreignNetVolume,
  foreignNetValue,
  roomPercentage,
}: {
  foreign: ForeignSnapshot | null
  quotePrice?: number | null
  foreignNetVolume: number | null
  foreignNetValue: number | null
  roomPercentage: number | null
}) {
  const buyVolFlash = useFlashAnimation(foreign?.totalBuyVolume, 1)
  const sellVolFlash = useFlashAnimation(foreign?.totalSellVolume, 1)
  const netVolFlash = useFlashAnimation(foreignNetVolume, 1)
  const roomFlash = useFlashAnimation(foreign?.availableRoom, 1)

  const buyVol = foreign?.totalBuyVolume ?? 0
  const sellVol = foreign?.totalSellVolume ?? 0

  const buyVal = foreign?.totalBuyValue ?? (buyVol && quotePrice ? buyVol * quotePrice : 0)
  const sellVal = foreign?.totalSellValue ?? (sellVol && quotePrice ? sellVol * quotePrice : 0)

  const netVol = foreignNetVolume ?? (buyVol - sellVol)
  const netVal = foreignNetValue ?? (buyVal - sellVal)

  const isNetVolPos = netVol > 0
  const isNetVolNeg = netVol < 0
  const isNetValPos = netVal > 0
  const isNetValNeg = netVal < 0

  return (
    <div className="flex flex-col rounded-lg border border-border/80 bg-[#121313] p-3 font-mono text-xs space-y-2.5">
      {/* Title Header matching Image 1 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
          </span>
          <span className="font-sans text-[13px] font-extrabold uppercase tracking-wide text-foreground">
            GIAO DỊCH NĐTNN
          </span>
        </div>
        <span className="text-[10px] text-muted font-mono">
          {foreign?.updatedAt ? timeLabel(foreign.updatedAt) : "Realtime"}
        </span>
      </div>

      {/* Grid Table matching Image 1 */}
      <div className="rounded-lg border border-border/60 bg-[#161718] overflow-hidden">
        {/* Row 1: Khối Lượng Header */}
        <div className="grid grid-cols-3 items-center bg-[#1c1e1f] px-3 py-1.5 text-[11px] font-bold text-muted-2 border-b border-border/40">
          <span>KL Mua</span>
          <span className="text-center">KL Bán</span>
          <span className="text-right">KL Mua-Bán</span>
        </div>

        {/* Row 1: Khối Lượng Values */}
        <div className="grid grid-cols-3 items-center px-3 py-2 text-xs sm:text-[13px] font-bold border-b border-border/40">
          <span
            className={`text-up transition-colors ${
              buyVolFlash === "up" ? "flash-up font-black" : buyVolFlash === "down" ? "flash-down font-black" : ""
            }`}
          >
            {formatVolume(foreign?.totalBuyVolume)}
          </span>
          <span
            className={`text-center text-down transition-colors ${
              sellVolFlash === "up" ? "flash-up font-black" : sellVolFlash === "down" ? "flash-down font-black" : ""
            }`}
          >
            {formatVolume(foreign?.totalSellVolume)}
          </span>
          <span
            className={`text-right transition-colors ${
              isNetVolPos ? "text-up" : isNetVolNeg ? "text-down" : "text-ref"
            } ${
              netVolFlash === "up" ? "flash-up font-black" : netVolFlash === "down" ? "flash-down font-black" : ""
            }`}
          >
            {netVol !== null && netVol !== undefined
              ? `${netVol > 0 ? "+" : ""}${formatVolume(netVol)}`
              : "—"}
          </span>
        </div>

        {/* Row 2: Giá Trị Header */}
        <div className="grid grid-cols-3 items-center bg-[#1c1e1f] px-3 py-1.5 text-[11px] font-bold text-muted-2 border-b border-border/40">
          <span>GT Mua</span>
          <span className="text-center">GT Bán</span>
          <span className="text-right">GT Mua-Bán</span>
        </div>

        {/* Row 2: Giá Trị Values with GT Mua-Bán in a label pill */}
        <div className="grid grid-cols-3 items-center px-3 py-2 text-xs sm:text-[13px] font-bold">
          <span className="text-up">
            {buyVal ? formatMarketValue(buyVal) : "—"}
          </span>
          <span className="text-center text-down">
            {sellVal ? formatMarketValue(sellVal) : "—"}
          </span>
          {/* Highlighted prominent GT Mua-Bán inside a label pill */}
          <div className="flex justify-end items-center">
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-md font-bold text-xs sm:text-[13px] border ${
                isNetValPos
                  ? "bg-up/15 text-up border-up/40 shadow-sm"
                  : isNetValNeg
                    ? "bg-down/15 text-down border-down/40 shadow-sm"
                    : "bg-panel-2 text-ref border-border"
              } ${
                netVolFlash === "up" ? "flash-up font-black" : netVolFlash === "down" ? "flash-down font-black" : ""
              }`}
            >
              {netVal !== null && netVal !== undefined
                ? `${netVal > 0 ? "+" : ""}${formatMarketValue(netVal)}`
                : "—"}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function TradeInitiativeAndMarketStatsCard({
  symbol,
  tradeStats,
  quote,
  spread,
}: {
  symbol: string
  tradeStats: {
    buyVol: number
    sellVol: number
    unkVol: number
    totalTraded: number
    buyTradedPct: number
    sellTradedPct: number
  }
  quote?: StockQuote | null
  spread?: number | null
}) {
  const totalVolume = quote?.totalVolume ?? tradeStats.totalTraded

  return (
    <div className="flex flex-col rounded-lg border border-border/80 bg-[#121313] p-2.5 font-mono text-xs space-y-2.5">
      {/* 1. 4 Records replacing the bar (Matching Image 2 with balanced font size) */}
      <div className="rounded-lg border border-border/60 bg-[#161718] divide-y divide-border/40 overflow-hidden text-[11px] sm:text-xs">
        {/* Row 1: Tổng KL khớp */}
        <div className="flex items-center justify-between px-2.5 py-1.5 bg-[#1c1e1f]/60">
          <span className="text-foreground/90 font-medium font-sans">
            Tổng KL khớp {symbol}
          </span>
          <span className="font-bold text-foreground sm:text-xs">
            {formatVolume(totalVolume)}
          </span>
        </div>

        {/* Row 2: KL MUA chủ động */}
        <div className="flex items-center justify-between px-2.5 py-1.5">
          <span className="text-muted-2 flex items-center gap-1 font-sans">
            KL MUA chủ động
          </span>
          <span className="flex items-center gap-1.5 font-bold text-up sm:text-xs">
            <span>{formatVolume(tradeStats.buyVol)}</span>
            <span className="rounded px-1 py-0.2 text-[8px] font-bold border border-up/40 bg-up/15 text-up leading-none">
              M
            </span>
          </span>
        </div>

        {/* Row 3: KL BÁN chủ động */}
        <div className="flex items-center justify-between px-2.5 py-1.5">
          <span className="text-muted-2 flex items-center gap-1 font-sans">
            KL BÁN chủ động
          </span>
          <span className="flex items-center gap-1.5 font-bold text-down sm:text-xs">
            <span>{formatVolume(tradeStats.sellVol)}</span>
            <span className="rounded px-1 py-0.2 text-[8px] font-bold border border-down/40 bg-down/15 text-down leading-none">
              B
            </span>
          </span>
        </div>

        {/* Row 4: KL KHÔNG XÁC ĐỊNH */}
        <div className="flex items-center justify-between px-2.5 py-1.5 bg-[#1c1e1f]/40">
          <span className="text-muted-2 font-sans">
            KL KHÔNG XÁC ĐỊNH
          </span>
          <span className="font-bold text-foreground sm:text-xs">
            {formatVolume(tradeStats.unkVol)}
          </span>
        </div>
      </div>

      {/* 2. Thông số phiên (Scaled down 1 font size for perfect balance) */}
      <div className="border-t border-border/50 pt-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-2 font-bold mb-1.5 flex items-center justify-between">
          <span>THÔNG SỐ PHIÊN</span>
        </div>
        <div className="grid grid-cols-3 gap-1.5 text-center">
          {/* Row 1: Sàn - TC - Trần */}
          <div className="rounded-lg border border-border/60 bg-[#161718] p-1.5 flex flex-col justify-center">
            <div className="text-[9px] text-muted-2 uppercase font-semibold">Sàn</div>
            <div className="text-xs sm:text-[13px] font-bold text-[#22b8cf]">{formatPrice(quote?.floor)}</div>
          </div>
          <div className="rounded-lg border border-border/60 bg-[#161718] p-1.5 flex flex-col justify-center">
            <div className="text-[9px] text-muted-2 uppercase font-semibold">TC</div>
            <div className="text-xs sm:text-[13px] font-bold text-ref">{formatPrice(quote?.reference)}</div>
          </div>
          <div className="rounded-lg border border-border/60 bg-[#161718] p-1.5 flex flex-col justify-center">
            <div className="text-[9px] text-muted-2 uppercase font-semibold">Trần</div>
            <div className="text-xs sm:text-[13px] font-bold text-ceiling">{formatPrice(quote?.ceiling)}</div>
          </div>

          {/* Row 2: Thấp - TB - Cao */}
          <div className="rounded-lg border border-border/60 bg-[#161718] p-1.5 flex flex-col justify-center">
            <div className="text-[9px] text-muted-2 uppercase font-semibold">Thấp</div>
            <div className="text-xs sm:text-[13px] font-bold text-foreground">{formatPrice(quote?.low)}</div>
          </div>
          <div className="rounded-lg border border-border/60 bg-[#161718] p-1.5 flex flex-col justify-center">
            <div className="text-[9px] text-muted-2 uppercase font-semibold">TB</div>
            <div className="text-xs sm:text-[13px] font-bold text-foreground">{formatPrice(quote?.avgPrice)}</div>
          </div>
          <div className="rounded-lg border border-border/60 bg-[#161718] p-1.5 flex flex-col justify-center">
            <div className="text-[9px] text-muted-2 uppercase font-semibold">Cao</div>
            <div className="text-xs sm:text-[13px] font-bold text-foreground">{formatPrice(quote?.high)}</div>
          </div>

          {/* Row 3: Spread - Tổng KL - Tổng GT */}
          <div className="rounded-lg border border-border/60 bg-[#161718] p-1.5 flex flex-col justify-center">
            <div className="text-[9px] text-muted-2 uppercase font-semibold">Spread</div>
            <div className="text-xs sm:text-[13px] font-bold text-foreground">{spread !== null && spread !== undefined && spread > 0 ? formatPrice(spread) : "—"}</div>
          </div>
          <div className="rounded-lg border border-border/60 bg-[#161718] p-1.5 flex flex-col justify-center">
            <div className="text-[9px] text-muted-2 uppercase font-semibold">Tổng KL</div>
            <div className="text-xs sm:text-[13px] font-bold text-foreground">{formatCompactVolume(quote?.totalVolume ?? totalVolume)}</div>
          </div>
          <div className="rounded-lg border border-border/60 bg-[#161718] p-1.5 flex flex-col justify-center">
            <div className="text-[9px] text-muted-2 uppercase font-semibold">Tổng GT</div>
            <div className="text-xs sm:text-[13px] font-bold text-foreground">
              {quote?.totalValue
                ? formatMarketValue(quote.totalValue)
                : quote?.totalVolume && quote?.price
                  ? formatMarketValue(quote.totalVolume * quote.price)
                  : totalVolume && quote?.price
                    ? formatMarketValue(totalVolume * quote.price)
                    : "—"}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function OrderBookDepthRow({
  bid,
  ask,
  maxDepthVolume,
  quote,
}: {
  bid?: DepthLevel
  ask?: DepthLevel
  maxDepthVolume: number
  quote?: StockQuote | null
}) {
  const bidWidthPct = bid?.volume ? (bid.volume / maxDepthVolume) * 100 : 0
  const askWidthPct = ask?.volume ? (ask.volume / maxDepthVolume) * 100 : 0

  const bidVolFlash = useFlashAnimation(bid?.volume, 1)
  const bidPriceFlash = usePriceFlashAnimation(bid?.price, quote?.reference)
  const askPriceFlash = usePriceFlashAnimation(ask?.price, quote?.reference)
  const askVolFlash = useFlashAnimation(ask?.volume, 1)

  return (
    <div className="relative grid grid-cols-[1fr_80px_80px_1fr] gap-x-2 items-center py-1 rounded hover:bg-panel-2/40">
      {/* Left Bid Volume bar */}
      {bid?.volume ? (
        <div
          className="absolute inset-y-0 left-0 bg-up/15 rounded-l border-r border-up/25 transition-all duration-300"
          style={{ width: `${(bidWidthPct / 2).toFixed(1)}%` }}
          aria-hidden="true"
        />
      ) : null}

      {/* Right Ask Volume bar */}
      {ask?.volume ? (
        <div
          className="absolute inset-y-0 right-0 bg-down/15 rounded-r border-l border-down/25 transition-all duration-300"
          style={{ width: `${(askWidthPct / 2).toFixed(1)}%` }}
          aria-hidden="true"
        />
      ) : null}

      {/* KL Mua */}
      <span
        className={`relative font-bold text-foreground text-left px-2 rounded transition-colors ${
          bidVolFlash === "up"
            ? "flash-up text-up font-black"
            : bidVolFlash === "down"
              ? "flash-down text-down font-black"
              : ""
        }`}
      >
        {formatVolume(bid?.volume)}
      </span>

      {/* Giá Mua */}
      <span
        className={`relative text-right font-bold px-2 rounded transition-colors ${getPriceColorClass(
          bid?.price,
          quote?.reference,
          quote?.ceiling,
          quote?.floor
        )} ${
          bidPriceFlash === "up"
            ? "flash-text-up"
            : bidPriceFlash === "down"
              ? "flash-text-down"
              : bidPriceFlash === "ref"
                ? "flash-text-ref"
                : ""
        }`}
      >
        {formatPrice(bid?.price)}
      </span>

      {/* Giá Bán */}
      <span
        className={`relative text-left font-bold px-2 rounded transition-colors ${getPriceColorClass(
          ask?.price,
          quote?.reference,
          quote?.ceiling,
          quote?.floor
        )} ${
          askPriceFlash === "up"
            ? "flash-text-up"
            : askPriceFlash === "down"
              ? "flash-text-down"
              : askPriceFlash === "ref"
                ? "flash-text-ref"
                : ""
        }`}
      >
        {formatPrice(ask?.price)}
      </span>

      {/* KL Bán */}
      <span
        className={`relative text-right font-bold text-foreground px-2 rounded transition-colors ${
          askVolFlash === "up"
            ? "flash-up text-up font-black"
            : askVolFlash === "down"
              ? "flash-down text-down font-black"
              : ""
        }`}
      >
        {formatVolume(ask?.volume)}
      </span>
    </div>
  )
}

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
  const [size, setSize] = useState<{ width: number; height: number }>(() => {
    if (typeof window === "undefined") return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT }
    return {
      width: Math.min(DEFAULT_WIDTH, Math.max(340, window.innerWidth - 32)),
      height: Math.min(DEFAULT_HEIGHT, Math.max(400, window.innerHeight - 64)),
    }
  })
  const [pos, setPos] = useState(() => {
    if (typeof window === "undefined") return { x: 32, y: 50 }
    const initialW = Math.min(DEFAULT_WIDTH, window.innerWidth - 32)
    const initialH = Math.min(DEFAULT_HEIGHT, window.innerHeight - 64)
    const centerX = Math.max(16, Math.floor((window.innerWidth - initialW) / 2) + (index % 4) * 24)
    const centerY = Math.max(40, Math.floor((window.innerHeight - initialH) / 2) + (index % 4) * 20)
    return { x: centerX, y: centerY }
  })

  const panelRef = useRef<HTMLElement>(null)
  const isInteractingRef = useRef(false)
  const [isInteracting, setIsInteracting] = useState(false)
  const closeRequested = useRef(false)

  const stream = useDnseOrderBookStream(symbol, reconnectKey, initialMeta)
  const quote = stream.quote
  const isWsReady = stream.state === "LIVE" || stream.historyState === "READY" || stream.trades.length > 0 || stream.bids.length > 0 || stream.quote !== null
  const headerPriceFlash = usePriceFlashAnimation(quote?.price, quote?.reference)

  // Confetti for whale trades
  const confetti = useWhaleConfetti()
  const sessionCountdown = useSessionCountdown()

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

  // Clustered & filtered trades (Gộp lệnh cùng mức giá, cùng chiều nếu cùng giây hoặc cách nhau <= 1s)
  const clusteredTrades = useMemo(() => {
    return clusterTrades(stream.trades)
  }, [stream.trades])

  const bestBidPrice = stream.bids[0]?.price
  const bestAskPrice = stream.asks[0]?.price
  const spread = bestBidPrice && bestAskPrice ? Number((bestAskPrice - bestBidPrice).toFixed(2)) : null

  // Dynamic whale threshold based on price tick size & spread (spread 0.05 -> >=50k, spread 0.1 -> >=30k)
  const whaleThreshold = useMemo(() => getWhaleThreshold(quote?.price, spread), [quote?.price, spread])
  const whaleLabel = useMemo(() => getWhaleLabel(quote?.price, spread), [quote?.price, spread])

  // Reliable Realtime Whale Confetti Trigger
  const seenWhaleIdsRef = useRef<Set<string>>(new Set())
  const isInitialTradesLoadedRef = useRef(false)

  useEffect(() => {
    if (!clusteredTrades.length) return

    // On initial data arrival, record historical whale trade IDs to avoid firing on page open
    if (!isInitialTradesLoadedRef.current) {
      if (stream.historyState === "READY" || stream.historyState === "PARTIAL" || clusteredTrades.length > 0) {
        for (const t of clusteredTrades) {
          if (t.volume >= whaleThreshold) {
            seenWhaleIdsRef.current.add(t.id)
          }
        }
        isInitialTradesLoadedRef.current = true
      }
      return
    }

    // On subsequent realtime updates, check for any newly arrived whale trades
    let hasNewWhale = false
    for (const t of clusteredTrades) {
      if (t.volume >= whaleThreshold) {
        if (!seenWhaleIdsRef.current.has(t.id)) {
          seenWhaleIdsRef.current.add(t.id)
          hasNewWhale = true
        }
      }
    }

    if (hasNewWhale) {
      confetti.fire()
    }
  }, [clusteredTrades, whaleThreshold, stream.historyState, confetti])

  // Tape filtering
  const visibleTrades = useMemo(() => {
    if (tradeFilter === "large") return clusteredTrades.filter((t) => t.volume >= LARGE_TRADE_MIN_VOLUME)
    if (tradeFilter === "whale") return clusteredTrades.filter((t) => t.volume >= whaleThreshold)
    return clusteredTrades
  }, [tradeFilter, clusteredTrades, whaleThreshold])

  const largeTradeCount = useMemo(() => clusteredTrades.filter((t) => t.volume >= LARGE_TRADE_MIN_VOLUME).length, [clusteredTrades])
  const whaleTradeCount = useMemo(() => clusteredTrades.filter((t) => t.volume >= whaleThreshold).length, [clusteredTrades, whaleThreshold])

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

  const quotePrice = quote?.price

  // Foreign Flow Timeline (Biến động GT mua bán của NN từ đầu phiên 09:15:00 tới hiện tại)
  const foreignTimeline = useMemo(() => {
    return buildForeignTimeline(stream.trades, stream.foreign, quotePrice)
  }, [stream.trades, stream.foreign, quotePrice])

  // Volume Profile (Volume distribution by price level across all session trades matching Image 3)
  const volumeProfile = useMemo(() => {
    const profileMap = new Map<
      number,
      { price: number; buyVol: number; sellVol: number; atoVol: number; atcVol: number; totalVol: number }
    >()
    let totalSessionVol = 0
    let sessionBuyVol = 0
    let sessionSellVol = 0
    let sessionAtoVol = 0
    let sessionAtcVol = 0

    for (const t of stream.trades) {
      const rawPrice = t.price
      if (!rawPrice || rawPrice <= 0) continue
      const price = Number((rawPrice >= 1000 ? rawPrice / 1000 : rawPrice).toFixed(2))
      const cur = profileMap.get(price) || { price, buyVol: 0, sellVol: 0, atoVol: 0, atcVol: 0, totalVol: 0 }

      const timeStr = String(t.time ?? "").trim()
      const isAto = timeStr.startsWith("09:15") || timeStr.toUpperCase().includes("ATO")
      const isAtc = timeStr.startsWith("14:45") || timeStr.toUpperCase().includes("ATC")

      if (isAto) {
        cur.atoVol += t.volume
        sessionAtoVol += t.volume
      } else if (isAtc) {
        cur.atcVol += t.volume
        sessionAtcVol += t.volume
      } else if (t.side === "BUY") {
        cur.buyVol += t.volume
        sessionBuyVol += t.volume
      } else if (t.side === "SELL") {
        cur.sellVol += t.volume
        sessionSellVol += t.volume
      } else {
        cur.buyVol += t.volume
        sessionBuyVol += t.volume
      }

      cur.totalVol += t.volume
      totalSessionVol += t.volume
      profileMap.set(price, cur)
    }

    const profileRows = [...profileMap.values()].sort((a, b) => b.price - a.price)
    const maxVol = Math.max(1, ...profileRows.map((r) => r.totalVol))
    return {
      rows: profileRows,
      maxVol,
      totalSessionVol: totalSessionVol || 1,
      sessionBuyVol,
      sessionSellVol,
      sessionAtoVol,
      sessionAtcVol,
    }
  }, [stream.trades, quotePrice])

  const tone = useMemo(() => {
    if (!quote?.price) return "ref"
    const price = quote.price
    const ref = quote.reference ? normalizeMarketPrice(quote.reference, price) ?? quote.reference : undefined
    const ceil = quote.ceiling ? normalizeMarketPrice(quote.ceiling, price) ?? quote.ceiling : undefined
    const flr = quote.floor ? normalizeMarketPrice(quote.floor, price) ?? quote.floor : undefined

    const baseTone = marketToneFromPrice({
      price,
      reference: ref,
      ceiling: ceil,
      floor: flr,
    })
    if (baseTone === "ceiling" || baseTone === "floor") return baseTone
    const change = quote.changePercent ?? 0
    if (change >= 6.85) return "ceiling"
    if (change <= -6.85) return "floor"
    return baseTone
  }, [quote])
  const color = quote ? marketToneText(tone) : "text-muted-2"

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

  // Foreign live flash animations
  const foreignBuyVolFlash = useFlashAnimation(stream.foreign?.totalBuyVolume, 1)
  const foreignSellVolFlash = useFlashAnimation(stream.foreign?.totalSellVolume, 1)
  const foreignNetVolFlash = useFlashAnimation(foreignNetVolume, 1)
  const foreignRoomFlash = useFlashAnimation(foreignRoom, 1)

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
      className={`pointer-events-auto absolute flex flex-col overflow-hidden rounded-2xl border border-white/[0.12] bg-[#0b0f14]/94 backdrop-blur-2xl shadow-[0_25px_70px_rgba(0,0,0,0.95),inset_0_1px_0_0_rgba(255,255,255,0.12)] will-change-[width,height,left,top] ${
        isMaximized ? "fixed" : ""
      } ${!isInteracting ? "transition-[width,height,left,top] duration-150 ease-out" : "select-none"}`}
      style={panelStyle}
      onPointerDown={onPanelPointerDown}
      data-orderbook={stockKey}
    >
      {/* Whale trade confetti celebration */}
      <ConfettiOverlay active={confetti.active} />

      {/* HEADER / DRAG HANDLE */}
      <header
        className="flex cursor-grab select-none items-center justify-between gap-2 border-b border-white/[0.08] bg-white/[0.03] backdrop-blur-xl px-4 py-2.5 active:cursor-grabbing touch-none"
        onPointerDown={onHeaderPointerDown}
      >
        {/* Left Ticker & Exchange */}
        <div className="flex items-center gap-2 min-w-0 shrink">
          <GripVertical className="h-4 w-4 text-muted shrink-0" />
          <span className="font-mono text-lg sm:text-xl font-black tracking-tight text-foreground shrink-0">{symbol}</span>
          {stream.company?.exchange ? (
            <span className="hidden sm:inline-flex rounded-full bg-white/[0.06] border border-white/[0.08] px-2 py-0.5 text-[9.5px] font-bold text-muted-2 uppercase tracking-wider shrink-0 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)]">
              {stream.company.exchange}
            </span>
          ) : null}
        </div>

        {/* Center / Right Price & Action Controls */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Live Price & Change Pill */}
          <div className="flex items-center gap-2">
            <span
              className={`font-mono text-lg sm:text-xl font-black tracking-tight rounded px-1 transition-colors ${color} ${
                headerPriceFlash === "up"
                  ? "flash-text-up font-black"
                  : headerPriceFlash === "down"
                    ? "flash-text-down font-black"
                    : headerPriceFlash === "ref"
                      ? "flash-text-ref font-black"
                      : ""
              }`}
            >
              {formatPrice(quote?.price)}
            </span>
            {quote ? <MarketChangePill value={quote.changePercent} tone={tone} compact /> : null}
          </div>

          {/* Action Controls (3 clean icons) */}
          <div className="flex items-center gap-0.5 border-l border-border/60 pl-1.5 ml-0.5">
            <a
              data-orderbook-action
              href={`/research/${symbol.toLowerCase()}`}
              aria-label={`Mở phân tích chuyên sâu ${symbol}`}
              title="Mở phân tích chuyên sâu"
              onClick={(event) => event.stopPropagation()}
              className="rounded p-1.5 text-muted-2 hover:bg-panel-2 hover:text-foreground transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
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
              {isMaximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
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
        </div>
      </header>

      {!minimized ? (
        <div className="min-h-0 flex-1 overflow-y-auto flex flex-col bg-[#121313]">
          {/* SECTION 1: ORDERBOOK DEPTH LADDER (3 Levels) */}
          <div className="border-b border-border/80 px-4 py-2.5 bg-[#151616]">
            {/* Depth Ladder Table */}
            <div className="rounded-lg border border-border/80 bg-[#121313] p-2.5 shadow-inner">
              <div className="grid grid-cols-[1fr_80px_80px_1fr] gap-x-2 text-xs font-bold text-muted-2 border-b border-border/60 pb-1.5">
                <span className="text-left px-2">KL Mua</span>
                <span className="text-right px-2">Giá Mua</span>
                <span className="text-left px-2">Giá Bán</span>
                <span className="text-right px-2">KL Bán</span>
              </div>

              <div className="mt-1 space-y-0.5 font-mono text-[13px]">
                {rows.map(({ bid, ask }, rowIndex) => (
                  <OrderBookDepthRow
                    key={rowIndex}
                    bid={bid}
                    ask={ask}
                    maxDepthVolume={maxDepthVolume}
                    quote={quote}
                  />
                ))}
              </div>

              {/* Total Ratio Bar matching Image 3 style */}
              <div className="mt-2 pt-2 border-t border-border/50">
                <div className="flex items-center justify-between text-xs font-mono mb-1.5">
                  <span className="flex items-center gap-1.5 font-medium">
                    <span className="h-2 w-2 rounded-full bg-up shrink-0" />
                    <span className="text-muted-2">Mua:</span>
                    <b className="text-up font-bold">{formatCompactVolume(bidTotal)}</b>
                    <span className="text-muted text-[11px]">({depthTotal > 0 ? `${buyPct.toFixed(0)}%` : "50%"})</span>
                  </span>

                  {/* CENTER ATO / ATC COUNTDOWN BADGE */}
                  {sessionCountdown ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-amber-500/40 bg-amber-500/15 text-amber-400 font-bold text-[11px] animate-pulse shadow-sm">
                      <Clock className="h-3 w-3" />
                      <span>{sessionCountdown.type}: {sessionCountdown.label}</span>
                    </span>
                  ) : null}

                  <span className="flex items-center gap-1.5 font-medium">
                    <span className="h-2 w-2 rounded-full bg-down shrink-0" />
                    <span className="text-muted-2">Bán:</span>
                    <b className="text-down font-bold">{formatCompactVolume(askTotal)}</b>
                    <span className="text-muted text-[11px]">({depthTotal > 0 ? `${sellPct.toFixed(0)}%` : "50%"})</span>
                  </span>
                </div>
                <div className="flex h-2 overflow-hidden rounded-full bg-[#1e2021]">
                  <div className="bg-up transition-all duration-300" style={{ width: `${depthTotal > 0 ? buyPct : 50}%` }} />
                  <div className="bg-down transition-all duration-300" style={{ width: `${depthTotal > 0 ? sellPct : 50}%` }} />
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 2: TABBED ACTIVITY VIEWS */}
          <div className="px-4 py-3 flex-1 flex flex-col">
            {/* Tabs Header */}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2.5">
              <div className="flex items-center gap-1 bg-[#181919] p-1 rounded-lg border border-border/80">
                <button
                  type="button"
                  disabled={!isWsReady}
                  onClick={() => setActivityTab("trades")}
                  className={`flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-bold transition-colors ${
                    activityTab === "trades" ? "bg-brand/20 text-brand shadow-sm" : "text-muted-2 hover:bg-panel-2 hover:text-foreground"
                  } ${!isWsReady ? "opacity-50 cursor-not-allowed pointer-events-none" : ""}`}
                >
                  <BarChart3 className="h-3.5 w-3.5" />
                  <span>Khớp lệnh</span>
                </button>

                <button
                  type="button"
                  disabled={!isWsReady}
                  onClick={() => setActivityTab("foreign")}
                  className={`flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-bold transition-colors ${
                    activityTab === "foreign" ? "bg-blue-500/20 text-blue-400 shadow-sm" : "text-muted-2 hover:bg-panel-2 hover:text-foreground"
                  } ${!isWsReady ? "opacity-50 cursor-not-allowed pointer-events-none" : ""}`}
                >
                  <PieChart className="h-3.5 w-3.5" />
                  <span>Khối ngoại</span>
                </button>

                <button
                  type="button"
                  disabled={!isWsReady}
                  onClick={() => setActivityTab("profile")}
                  className={`flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-bold transition-colors ${
                    activityTab === "profile" ? "bg-purple-500/20 text-purple-400 shadow-sm" : "text-muted-2 hover:bg-panel-2 hover:text-foreground"
                  } ${!isWsReady ? "opacity-50 cursor-not-allowed pointer-events-none" : ""}`}
                >
                  <Layers className="h-3.5 w-3.5" />
                  <span>Bước giá</span>
                </button>

                <button
                  type="button"
                  disabled={!isWsReady}
                  onClick={() => setActivityTab("putthrough")}
                  className={`flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-bold transition-colors ${
                    activityTab === "putthrough" ? "bg-amber-500/20 text-amber-400 shadow-sm" : "text-muted-2 hover:bg-panel-2 hover:text-foreground"
                  } ${!isWsReady ? "opacity-50 cursor-not-allowed pointer-events-none" : ""}`}
                >
                  <Handshake className="h-3.5 w-3.5" />
                  <span>Thỏa thuận</span>
                  {stream.putThroughDeals.length > 0 && (
                    <span className="rounded-full bg-amber-500/30 px-1.5 py-0.2 text-[10px] text-amber-300 font-mono font-bold">
                      {stream.putThroughDeals.length}
                    </span>
                  )}
                </button>
              </div>

              {/* Tape Sub-filters */}
              {activityTab === "trades" && (
                <div className={`flex items-center gap-1.5 text-xs ${!isWsReady ? "opacity-50 pointer-events-none" : ""}`}>
                  <button
                    type="button"
                    disabled={!isWsReady}
                    onClick={() => setTradeFilter("all")}
                    className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-semibold transition-colors ${
                      tradeFilter === "all" ? "bg-panel-2 text-foreground font-bold border border-border shadow-sm" : "text-muted hover:text-muted-2"
                    }`}
                    title={stream.trades.length > clusteredTrades.length ? `Gốc: ${stream.trades.length.toLocaleString("vi-VN")} lệnh` : undefined}
                  >
                    <AllTradesIcon className="h-3.5 w-3.5" />
                    <span>Tất cả ({isWsReady ? clusteredTrades.length : "..."})</span>
                  </button>
                  <button
                    type="button"
                    disabled={!isWsReady}
                    onClick={() => setTradeFilter("large")}
                    className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-semibold transition-colors ${
                      tradeFilter === "large" ? "border-ref/50 bg-ref/15 text-ref font-bold shadow-sm" : "border-border text-muted-2 hover:text-foreground"
                    }`}
                  >
                    <SmallFishIcon className="h-3.5 w-3.5" />
                    <span>Cá con ≥10K</span>
                    {isWsReady && largeTradeCount > 0 && <span className="rounded bg-ref/25 px-1 text-[10px] font-bold">{largeTradeCount}</span>}
                  </button>
                  <button
                    type="button"
                    disabled={!isWsReady}
                    onClick={() => setTradeFilter("whale")}
                    className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-semibold transition-colors ${
                      tradeFilter === "whale" ? "border-up/50 bg-up/15 text-up font-bold shadow-sm" : "border-border text-muted-2 hover:text-foreground"
                    }`}
                  >
                    <SharkIcon className="h-3.5 w-3.5" />
                    <span>Cá mập {whaleLabel}</span>
                    {isWsReady && whaleTradeCount > 0 && <span className="rounded bg-up/25 px-1 text-[10px] font-bold">{whaleTradeCount}</span>}
                  </button>
                </div>
              )}
            </div>

            {/* TAB CONTENT: SHOW SKELETON LOADING UNTIL DNSE WS IS LIVE */}
            {!isWsReady ? (
              stream.state === "ERROR" ? (
                <div className="flex flex-col items-center justify-center flex-1 rounded-lg border border-down/40 bg-down/5 p-6 text-center text-xs">
                  <AlertCircle className="h-7 w-7 text-down mb-2" />
                  <span className="font-bold text-foreground">Không thể kết nối DNSE WebSocket</span>
                  <span className="text-muted text-[11px] mt-1 mb-3">{stream.error || "Lỗi kết nối tới máy chủ dữ liệu"}</span>
                  <button
                    type="button"
                    onClick={() => setReconnectKey((k) => k + 1)}
                    className="flex items-center gap-1.5 rounded-md bg-panel-2 border border-border px-3 py-1.5 font-bold text-foreground hover:bg-border transition-colors"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Thử lại kết nối
                  </button>
                </div>
              ) : (
                <TapeLoadingSkeleton />
              )
            ) : (
              <>
                {/* TAB CONTENT: KHỚP LỆNH (TAPE) */}
                {activityTab === "trades" && (
                  <div className="flex flex-col flex-1 space-y-2.5">
                    {/* Split 2-Panel Layout: Left = Tape (Khớp lệnh), Right = Khối ngoại NN + Lực mua/bán & Thông số */}
                    <div className="grid grid-cols-[1.25fr_1fr] gap-2.5 flex-1 min-h-0">
                      {/* Left: Tape Table with increased font size */}
                      {visibleTrades.length ? (
                        <div className="flex-1 rounded-lg border border-border/80 bg-[#121313] overflow-hidden flex flex-col min-h-0">
                          <div className="grid grid-cols-[1.25fr_1.1fr_0.75fr] items-center gap-x-2 border-b border-border/60 bg-[#171819] px-3 py-2 text-xs font-bold text-muted-2">
                            <span>Thời gian</span>
                            <span className="text-right">Khối lượng</span>
                            <span className="text-right">Giá</span>
                          </div>
                          <div className="flex-1 overflow-y-auto max-h-[480px] px-3 divide-y divide-border/15">
                            {visibleTrades.map((trade) => {
                              const isLarge = trade.volume >= LARGE_TRADE_MIN_VOLUME
                              const isWhale = trade.volume >= whaleThreshold
                              const pill = sidePillMeta(trade.side)

                              const sideColorClass =
                                trade.side === "BUY"
                                  ? "text-up"
                                  : trade.side === "SELL"
                                    ? "text-down"
                                    : "text-foreground"

                              const sideBgClass =
                                trade.side === "BUY"
                                  ? "bg-up/10"
                                  : trade.side === "SELL"
                                    ? "bg-down/10"
                                    : "bg-ref/10"

                              const tagBadgeClass =
                                trade.side === "BUY"
                                  ? "bg-up/25 text-up border-up/30"
                                  : trade.side === "SELL"
                                    ? "bg-down/25 text-down border-down/30"
                                    : "bg-ref/25 text-ref border-ref/30"

                              return (
                                <div
                                  key={trade.id}
                                  className={`grid grid-cols-[1.25fr_1.1fr_0.75fr] items-center gap-x-2 py-1.5 font-mono text-xs hover:bg-panel-2/50 ${
                                    isWhale || isLarge
                                      ? `${sideBgClass} font-bold -mx-3 px-3`
                                      : "text-foreground"
                                  }`}
                                >
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <span className="text-muted-2 text-xs font-medium">{timeLabel(trade.time)}</span>
                                    {trade.count > 1 && (
                                      <span
                                        className="rounded bg-[#202223] border border-border/80 px-1 py-0.2 text-[10px] text-muted-2 font-mono font-bold shrink-0"
                                        title={`Gộp ${trade.count} lệnh khớp liên tiếp cùng chiều trong ≤1s`}
                                      >
                                        x{trade.count}
                                      </span>
                                    )}
                                    {isWhale ? (
                                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold shrink-0 border ${tagBadgeClass}`}>
                                        {trade.volume >= 50_000 ? "50K+" : "30K+"}
                                      </span>
                                    ) : isLarge ? (
                                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold shrink-0 border ${tagBadgeClass}`}>
                                        10K+
                                      </span>
                                    ) : null}
                                  </div>
                                  <span
                                    className={`text-right font-bold text-sm sm:text-[14px] flex items-center justify-end gap-1.5 ${
                                      isWhale || isLarge ? sideColorClass : "text-foreground"
                                    }`}
                                  >
                                    <span>{formatVolume(trade.volume)}</span>
                                    <span
                                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold border ${pill.className} leading-none shrink-0`}
                                    >
                                      {pill.label}
                                    </span>
                                  </span>
                                  <span
                                    className={`text-right font-bold text-sm sm:text-[14px] ${getPriceColorClass(
                                      trade.price,
                                      quote?.reference,
                                      quote?.ceiling,
                                      quote?.floor
                                    )}`}
                                  >
                                    {formatPrice(trade.price)}
                                  </span>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      ) : (
                        <div className="flex-1 rounded-lg border border-border bg-panel-2/30 px-4 py-8 text-center text-xs text-muted-2 flex items-center justify-center">
                          {stream.historyState === "LOADING"
                            ? "Đang tải dữ liệu khớp lệnh..."
                            : tradeFilter !== "all"
                              ? "Không có lệnh thỏa mãn bộ lọc."
                              : "Chờ dữ liệu khớp lệnh mới..."}
                        </div>
                      )}

                      {/* Right: Stack of 2 Widgets */}
                      <div className="flex flex-col gap-2.5">
                        {/* Widget 1: Realtime Khối Ngoại NN */}
                        <ForeignRealtimeCard
                          foreign={stream.foreign}
                          quotePrice={quote?.price}
                          foreignNetVolume={foreignNetVolume}
                          foreignNetValue={foreignNetValue}
                          roomPercentage={roomPercentage}
                        />

                        {/* Widget 2: Lực Mua/Bán Chủ Động & Thông số phiên (Sàn, TC, Trần, Thấp, Cao, TB, Spread, Tổng KL, Tổng GT) */}
                        <TradeInitiativeAndMarketStatsCard
                          symbol={symbol}
                          tradeStats={tradeStats}
                          quote={quote}
                          spread={spread}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* TAB CONTENT: NƯỚC NGOÀI (FOREIGN) */}
                {activityTab === "foreign" && (
                  <div className="flex flex-col flex-1 space-y-3">
                    {/* 4 Summary Cards */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      <div className="rounded-lg border border-border/80 bg-[#121313] p-2.5">
                        <div className="text-xs text-muted-2 font-semibold">NN Mua lũy kế</div>
                        <div
                          className={`mt-1 font-mono text-sm sm:text-base font-bold text-up transition-colors ${
                            foreignBuyVolFlash === "up" ? "flash-up font-black" : foreignBuyVolFlash === "down" ? "flash-down font-black" : ""
                          }`}
                        >
                          {formatVolume(stream.foreign?.totalBuyVolume)}
                        </div>
                        <div className="mt-0.5 text-[11px] text-muted font-mono">
                          {stream.foreign?.totalBuyValue
                            ? formatMarketValue(stream.foreign.totalBuyValue)
                            : stream.foreign?.totalBuyVolume && quote?.price
                              ? formatMarketValue(stream.foreign.totalBuyVolume * quote.price)
                              : "—"}
                        </div>
                      </div>

                      <div className="rounded-lg border border-border/80 bg-[#121313] p-2.5">
                        <div className="text-xs text-muted-2 font-semibold">NN Bán lũy kế</div>
                        <div
                          className={`mt-1 font-mono text-sm sm:text-base font-bold text-down transition-colors ${
                            foreignSellVolFlash === "up" ? "flash-up font-black" : foreignSellVolFlash === "down" ? "flash-down font-black" : ""
                          }`}
                        >
                          {formatVolume(stream.foreign?.totalSellVolume)}
                        </div>
                        <div className="mt-0.5 text-[11px] text-muted font-mono">
                          {stream.foreign?.totalSellValue
                            ? formatMarketValue(stream.foreign.totalSellValue)
                            : stream.foreign?.totalSellVolume && quote?.price
                              ? formatMarketValue(stream.foreign.totalSellVolume * quote.price)
                              : "—"}
                        </div>
                      </div>

                      <div className="rounded-lg border border-border/80 bg-[#121313] p-2.5">
                        <div className="text-xs text-muted-2 font-semibold">Mua / Bán Ròng</div>
                        <div
                          className={`mt-1 font-mono text-sm sm:text-base font-bold transition-colors ${
                            foreignNetVolume === null
                              ? "text-muted-2"
                              : foreignNetVolume > 0
                                ? "text-up"
                                : foreignNetVolume < 0
                                  ? "text-down"
                                  : "text-ref"
                          } ${
                            foreignNetVolFlash === "up" ? "flash-up font-black" : foreignNetVolFlash === "down" ? "flash-down font-black" : ""
                          }`}
                        >
                          {foreignNetVolume === null
                            ? "—"
                            : `${foreignNetVolume > 0 ? "+" : ""}${formatVolume(foreignNetVolume)}`}
                        </div>
                        <div className="mt-0.5 text-[11px] text-muted font-mono">
                          {foreignNetValue !== null ? `${foreignNetValue > 0 ? "+" : ""}${formatMarketValue(foreignNetValue)}` : "—"}
                        </div>
                      </div>

                      <div className="rounded-lg border border-border/80 bg-[#121313] p-2.5">
                        <div className="text-xs text-muted-2 font-semibold">Room Ngoại còn lại</div>
                        <div
                          className={`mt-1 font-mono text-sm sm:text-base font-bold text-foreground transition-colors ${
                            foreignRoomFlash === "up" ? "flash-up font-black" : foreignRoomFlash === "down" ? "flash-down font-black" : ""
                          }`}
                        >
                          {foreignRoom !== null && foreignRoom !== undefined
                            ? foreignRoom === 0
                              ? "Hết room (0 cp)"
                              : `${formatCompactVolume(foreignRoom)} cp`
                            : "—"}
                        </div>
                        <div className="mt-0.5 text-[11px] text-muted font-mono">
                          {roomPercentage !== null
                            ? `Còn ${roomPercentage.toFixed(1)}% VĐL`
                            : foreignRoom !== null && foreignRoom !== undefined && foreignRoom > 0
                              ? `${formatVolume(foreignRoom)} cp khả dụng`
                              : foreignRoom === 0
                                ? "Khối ngoại đã hết room"
                                : "Theo quy định VSD"}
                        </div>
                      </div>
                    </div>

                    {/* Foreign Flow Timeline Chart (Biến động GT mua bán của NN trong phiên) */}
                    <ForeignFlowChart
                      timeline={foreignTimeline}
                      currentNetValue={foreignNetValue}
                      currentBuyValue={stream.foreign?.totalBuyValue}
                      currentSellValue={stream.foreign?.totalSellValue}
                    />

                    <div className="text-[11px] text-muted leading-relaxed">
                      * Dữ liệu NĐTNN được tổng hợp trực tiếp từ sở giao dịch & feed DNSE T=f. Khối lượng và giá trị không bị suy diễn từ bảng khớp lệnh thông thường.
                    </div>
                  </div>
                )}

                {/* TAB CONTENT: PHÂN TÍCH BƯỚC GIÁ (VOLUME PROFILE) */}
                {activityTab === "profile" && (
                  <div className="flex flex-col flex-1 bg-[#121313] rounded-lg border border-border/80 p-3 sm:p-4 font-mono text-xs">
                    {/* Table Header matching Image 3 */}
                    <div className="grid grid-cols-[60px_1fr_60px] items-center gap-2 border-b border-border/60 pb-2 mb-2 font-sans font-bold text-xs">
                      <div className="flex items-center gap-1">
                        <span className="text-foreground font-bold">Mức giá</span>
                        <span className="text-muted text-[10px] font-normal sm:inline hidden">(nghìn đồng)</span>
                      </div>
                      <div className="text-muted-2 text-center text-[11px] font-normal">
                        Phân bổ khối lượng ({volumeProfile.rows.length} bước giá)
                      </div>
                      <span className="text-foreground font-bold text-right">%</span>
                    </div>

                    {/* Horizontal Stacked Bar Chart Rows */}
                    {volumeProfile.rows.length ? (
                      <div className="flex-1 overflow-y-auto max-h-[440px] space-y-1.5 pr-1">
                        {volumeProfile.rows.map((row) => {
                          const totalBarWidthPct = (row.totalVol / volumeProfile.maxVol) * 82
                          const rowVolPct = (row.totalVol / volumeProfile.totalSessionVol) * 100

                          const atoSegmentPct = row.totalVol > 0 ? (row.atoVol / row.totalVol) * 100 : 0
                          const buySegmentPct = row.totalVol > 0 ? (row.buyVol / row.totalVol) * 100 : 0
                          const sellSegmentPct = row.totalVol > 0 ? (row.sellVol / row.totalVol) * 100 : 0
                          const atcSegmentPct = row.totalVol > 0 ? (row.atcVol / row.totalVol) * 100 : 0

                          const priceColorClass = getPriceColorClass(
                            row.price,
                            quote?.reference,
                            quote?.ceiling,
                            quote?.floor
                          )

                          return (
                            <div
                              key={row.price}
                              className="grid grid-cols-[60px_1fr_60px] items-center gap-2 py-0.5 group hover:bg-panel-2/40 rounded px-1"
                            >
                              {/* Left: Price Label */}
                              <div className={`text-xs sm:text-[13px] ${priceColorClass} shrink-0`}>
                                {formatPrice(row.price)}
                              </div>

                              {/* Middle: Horizontal Stacked Bar + Volume Label */}
                              <div className="relative flex items-center min-w-0 h-6">
                                {/* Subtle vertical background grid lines */}
                                <div className="absolute inset-0 flex justify-between pointer-events-none opacity-10">
                                  <div className="border-r border-border/60 h-full w-1/4" />
                                  <div className="border-r border-border/60 h-full w-1/4" />
                                  <div className="border-r border-border/60 h-full w-1/4" />
                                  <div className="h-full w-1/4" />
                                </div>

                                {/* Stacked Bar */}
                                <div
                                  className="flex h-5 rounded-sm overflow-hidden transition-all duration-300 relative z-10 shrink-0"
                                  style={{ width: `${Math.max(totalBarWidthPct, 3)}%` }}
                                >
                                  {atoSegmentPct > 0 && (
                                    <div
                                      className="bg-[#3b4252] h-full"
                                      style={{ width: `${atoSegmentPct}%` }}
                                      title={`ATO: ${formatVolume(row.atoVol)}`}
                                    />
                                  )}
                                  {buySegmentPct > 0 && (
                                    <div
                                      className="bg-up h-full"
                                      style={{ width: `${buySegmentPct}%` }}
                                      title={`Mua CĐ: ${formatVolume(row.buyVol)}`}
                                    />
                                  )}
                                  {sellSegmentPct > 0 && (
                                    <div
                                      className="bg-down h-full"
                                      style={{ width: `${sellSegmentPct}%` }}
                                      title={`Bán CĐ: ${formatVolume(row.sellVol)}`}
                                    />
                                  )}
                                  {atcSegmentPct > 0 && (
                                    <div
                                      className="bg-amber-400 h-full"
                                      style={{ width: `${atcSegmentPct}%` }}
                                      title={`ATC: ${formatVolume(row.atcVol)}`}
                                    />
                                  )}
                                </div>

                                {/* Volume Label adjacent to stacked bar */}
                                <span className="ml-2 font-bold text-xs sm:text-[13px] text-foreground whitespace-nowrap z-10">
                                  {formatVolume(row.totalVol)}
                                </span>
                              </div>

                              {/* Right: % of Total Volume */}
                              <div className="text-right text-xs sm:text-[13px] font-bold text-muted-2">
                                {rowVolPct < 0.01 ? "<0.01%" : `${rowVolPct.toFixed(rowVolPct >= 10 ? 1 : 2)}%`}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="flex-1 flex items-center justify-center p-8 text-center text-xs text-muted-2">
                        {stream.historyState === "LOADING"
                          ? "Đang tải dữ liệu bước giá trong phiên..."
                          : "Chưa có đủ dữ liệu khớp lệnh để vẽ phân bổ bước giá."}
                      </div>
                    )}

                    {/* Footer Legend matching Image 3 */}
                    <div className="mt-3 pt-2.5 border-t border-border/60 flex flex-wrap items-center justify-between gap-2 text-[11px] font-sans">
                      <div className="flex flex-wrap items-center gap-3 sm:gap-4">
                        <div className="flex items-center gap-1.5">
                          <span className="h-3 w-3 rounded-sm bg-[#3b4252] inline-block shrink-0" />
                          <span className="font-bold text-foreground">ATO</span>
                          <span className="text-muted">
                            ({((volumeProfile.sessionAtoVol / volumeProfile.totalSessionVol) * 100).toFixed(1)}%)
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="h-3 w-3 rounded-sm bg-up inline-block shrink-0" />
                          <span className="font-bold text-foreground">Mua chủ động</span>
                          <span className="text-muted">
                            ({((volumeProfile.sessionBuyVol / volumeProfile.totalSessionVol) * 100).toFixed(1)}%)
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="h-3 w-3 rounded-sm bg-down inline-block shrink-0" />
                          <span className="font-bold text-foreground">Bán chủ động</span>
                          <span className="text-muted">
                            ({((volumeProfile.sessionSellVol / volumeProfile.totalSessionVol) * 100).toFixed(1)}%)
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="h-3 w-3 rounded-sm bg-amber-400 inline-block shrink-0" />
                          <span className="font-bold text-foreground">ATC</span>
                          <span className="text-muted">
                            ({((volumeProfile.sessionAtcVol / volumeProfile.totalSessionVol) * 100).toFixed(1)}%)
                          </span>
                        </div>
                      </div>
                      <div className="text-muted text-[11px] font-medium">
                        KL <span className="text-muted-2 font-bold">(CP)</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* TAB CONTENT: GIAO DỊCH THỎA THUẬN (PUT-THROUGH) */}
                {activityTab === "putthrough" && (
                  <div className="flex flex-col flex-1">
                    {/* Summary Header */}
                    <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="text-muted-2 font-medium">Giao dịch thỏa thuận trong ngày:</span>
                      <div className="flex items-center gap-3 font-mono text-xs">
                        <span className="text-muted-2">
                          Số lệnh: <b className="text-foreground">{stream.putThroughDeals.length}</b>
                        </span>
                        <span className="text-muted-2">
                          Tổng KL:{" "}
                          <b className="text-foreground">
                            {formatCompactVolume(stream.putThroughDeals.reduce((sum, d) => sum + d.volume, 0))}
                          </b>
                        </span>
                        <span className="text-muted-2">
                          Tổng GT:{" "}
                          <b className="text-up font-bold">
                            {formatMarketValue(stream.putThroughDeals.reduce((sum, d) => sum + d.value, 0))}
                          </b>
                        </span>
                      </div>
                    </div>

                    {stream.putThroughDeals.length > 0 ? (
                      <div className="flex-1 rounded-lg border border-border/80 bg-[#121313] overflow-hidden flex flex-col">
                        <div className="grid grid-cols-[80px_1fr_90px_110px_70px] border-b border-border/60 bg-[#171819] px-3 py-1.5 text-xs font-bold text-muted-2">
                          <span>Thời gian</span>
                          <span className="text-right">Khối lượng</span>
                          <span className="text-right">Giá TT</span>
                          <span className="text-right">Tổng GT</span>
                          <span className="text-right">Loại</span>
                        </div>

                        <div className="flex-1 overflow-y-auto max-h-[340px] px-3">
                          {stream.putThroughDeals.map((deal) => {
                            const priceColor = getPriceColorClass(deal.price, quote?.reference, quote?.ceiling, quote?.floor)

                            return (
                              <div
                                key={deal.id}
                                className="grid grid-cols-[80px_1fr_90px_110px_70px] items-center border-b border-border/30 py-1 font-mono text-xs last:border-0 hover:bg-panel-2/40"
                              >
                                <span className="text-muted-2">{timeLabel(deal.time)}</span>
                                <span className="text-right font-bold text-[13px] text-foreground">{formatVolume(deal.volume)}</span>
                                <span className={`text-right font-bold text-[13px] ${priceColor}`}>{formatPrice(deal.price)}</span>
                                <span className="text-right font-bold text-[13px] text-foreground">{formatMarketValue(deal.value)}</span>
                                <div className="flex justify-end">
                                  <span className="rounded px-1.5 py-0.5 text-[10px] font-bold border bg-panel-2 text-muted-2 border-border">
                                    {deal.type || "PTM"}
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
                          ? "Đang tải dữ liệu giao dịch thỏa thuận..."
                          : `Chưa có giao dịch thỏa thuận nào cho mã ${symbol} trong phiên hôm nay.`}
                      </div>
                    )}
                  </div>
                )}
              </>
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
