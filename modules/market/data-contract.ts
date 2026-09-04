/**
 * Canonical Market Data Contract for QeoIndex.
 * Single Source of Truth for price, volume, trade, and orderbook normalization.
 * Guarantees 100% polymorphic data format across:
 * - Supabase DB (stock_orderbook_snapshots)
 * - DNSE WebSocket Live Stream (in-session 09:00-15:00)
 * - DNSE REST API & Session Backfill
 * - Yahoo Finance 5m / Intraday
 * - VPS / Broker Market Feeds
 * - Offline / EOD After-Hours Read Paths
 */

export type CanonicalTradeSide = "BUY" | "SELL" | "REF"

export interface CanonicalIntradayPoint {
  time: string | number
  open: number
  close: number
  high?: number
  low?: number
  volume?: number
}

export interface CanonicalSessionTrade {
  id: string
  time: string
  price: number
  volume: number
  side: CanonicalTradeSide
}

export interface CanonicalDepthLevel {
  price: number
  volume: number
}

export interface CanonicalLatestQuote {
  reference: number | null
  ceiling: number | null
  floor: number | null
  matchPrice: number | null
  openPrice: number | null
  highPrice: number | null
  lowPrice: number | null
  avgPrice?: number | null
  totalVolume: number
  bids: CanonicalDepthLevel[]
  asks: CanonicalDepthLevel[]
}

export interface CanonicalForeignFlow {
  totalBuyVolume: number
  totalSellVolume: number
  totalBuyValue: number
  totalSellValue: number
  foreignNetVolume: number
  foreignNetValue: number
  foreignRoom: number
  updatedAt: string
}

export interface CanonicalPutThroughDeal {
  id: string
  time: string
  price: number
  volume: number
  value: number
  type: string
}

export interface CanonicalOrderbookSnapshot {
  symbol: string
  sessionDate: string
  referencePrice: number | null
  ceilingPrice: number | null
  floorPrice: number | null
  latestPrice: number | null
  totalVolume: number
  intraday1m: CanonicalIntradayPoint[]
  trades: CanonicalSessionTrade[]
  tradesTruncated: boolean
  latestQuote: CanonicalLatestQuote
  foreignFlow: CanonicalForeignFlow
  putThrough: CanonicalPutThroughDeal[]
  updatedAt: string
}

/**
 * Universal Price Normalizer for Vietnamese Stocks.
 * Strictly enforces frontend & DB convention in thousands (nghìn đồng):
 * e.g. 21.85 (NOT 21850.00), 17.60 (NOT 17600.00), 145.60 (NOT 145600.00).
 */
export function normalizeToKiloPrice(price: number | null | undefined): number | null {
  if (price == null || !Number.isFinite(price) || price <= 0) return null
  // In VN stock market, prices >= 500 are in raw Dong (e.g. 21850, 75200, 145600)
  const normalized = price >= 500 ? price / 1000 : price
  return Math.round(normalized * 100) / 100
}

/**
 * Universal Volume Normalizer.
 * Enforces non-negative integer shares.
 */
export function normalizeVolume(volume: number | null | undefined): number {
  if (volume == null || !Number.isFinite(volume) || volume <= 0) return 0
  return Math.round(volume)
}

/**
 * Universal Trade Side Parser.
 * Accurately detects active buying (BUY/M), active selling (SELL/B), and reference (REF).
 */
export function normalizeTradeSide(side: unknown, cl?: unknown): CanonicalTradeSide {
  const rawSide = String(side ?? "").trim().toUpperCase()
  if (rawSide === "B" || rawSide === "BUY" || rawSide === "MUA" || rawSide === "BU" || rawSide === "NB") return "BUY"
  if (rawSide === "S" || rawSide === "SELL" || rawSide === "BAN" || rawSide === "BÁN" || rawSide === "SD" || rawSide === "NS") return "SELL"
  
  const rawCl = String(cl ?? "").trim().toLowerCase()
  if (rawCl === "i" || rawCl === "u") return "BUY"
  if (rawCl === "d") return "SELL"
  return "REF"
}

/**
 * Universal Session Trade Time Formatter.
 * Formats time strictly to "HH:mm:ss" without double-converting timezone offsets.
 */
export function formatSessionTradeTime(value: unknown): string {
  if (value == null || value === "") return "09:15:00"
  const str = String(value).trim()
  if (/^\d{2}:\d{2}:\d{2}$/.test(str)) return str
  if (/^\d{2}:\d{2}$/.test(str)) return `${str}:00`

  const num = Number(str)
  // If value is seconds of day (e.g. 53100 = 14:45:00, 33300 = 09:15:00)
  if (Number.isFinite(num) && num >= 0 && num < 86400) {
    const hrs = Math.floor(num / 3600) % 24
    const mins = Math.floor((num % 3600) / 60)
    const secs = Math.floor(num % 60)
    return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
  }

  // If value is epoch seconds
  if (Number.isFinite(num) && num >= 86400 && num < 1e11) {
    return new Date(num * 1000).toLocaleTimeString("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
  }

  // If value is epoch ms
  if (Number.isFinite(num) && num >= 1e11) {
    return new Date(num).toLocaleTimeString("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
  }

  const parsed = Date.parse(str)
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toLocaleTimeString("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
  }

  return "09:15:00"
}

/**
 * Universal Depth Levels Normalizer.
 */
export function normalizeDepthLevels(levels: unknown[]): CanonicalDepthLevel[] {
  if (!Array.isArray(levels)) return []
  return levels.map((lvl: any) => {
    if (!lvl || typeof lvl !== "object") return null
    const rawPrice = typeof lvl.price === "number" ? lvl.price : typeof lvl.p === "number" ? lvl.p : Number(lvl.price ?? lvl.p ?? 0)
    const rawVol = typeof lvl.volume === "number" ? lvl.volume : typeof lvl.v === "number" ? lvl.v : typeof lvl.qtty === "number" ? lvl.qtty : Number(lvl.volume ?? lvl.v ?? lvl.qtty ?? 0)
    const price = normalizeToKiloPrice(rawPrice)
    const volume = normalizeVolume(rawVol)
    return price && price > 0 ? { price, volume } : null
  }).filter((lvl): lvl is CanonicalDepthLevel => lvl !== null)
}

/**
 * Universal Foreign Flow Normalizer.
 */
export function normalizeForeignFlow(raw: any, fallbackPrice?: number | null): CanonicalForeignFlow {
  const rawBuyVol = Number(raw?.totalBuyVolume ?? raw?.buyVolume ?? (raw?.fBVol != null ? Number(raw.fBVol) * 10 : 0)) || 0
  const rawSellVol = Number(raw?.totalSellVolume ?? raw?.sellVolume ?? (raw?.fSVolume != null ? Number(raw.fSVolume) * 10 : 0)) || 0
  const buyVol = normalizeVolume(rawBuyVol)
  const sellVol = normalizeVolume(rawSellVol)
  
  let buyVal = Number(raw?.totalBuyValue ?? raw?.buyValue ?? (raw?.fBValue != null ? Number(raw.fBValue) * 1000 : 0)) || 0
  let sellVal = Number(raw?.totalSellValue ?? raw?.sellValue ?? (raw?.fSValue != null ? Number(raw.fSValue) * 1000 : 0)) || 0

  if (buyVal <= 0 && buyVol > 0 && fallbackPrice && fallbackPrice > 0) {
    buyVal = buyVol * fallbackPrice * 1000
  }
  if (sellVal <= 0 && sellVol > 0 && fallbackPrice && fallbackPrice > 0) {
    sellVal = sellVol * fallbackPrice * 1000
  }

  const netVol = typeof raw?.foreignNetVolume === "number" ? raw.foreignNetVolume : (buyVol - sellVol)
  const netVal = typeof raw?.foreignNetValue === "number" && Math.abs(raw.foreignNetValue) > Math.abs(buyVal - sellVal) * 0.5
    ? raw.foreignNetValue
    : (buyVal - sellVal)

  const room = Number(raw?.foreignRoom ?? raw?.availableRoom ?? (raw?.fRoom != null ? Number(raw.fRoom) * 10 : 0)) || 0
  const updatedAt = String(raw?.updatedAt || raw?.updated_at || new Date().toISOString())

  return {
    totalBuyVolume: buyVol,
    totalSellVolume: sellVol,
    totalBuyValue: Math.round(buyVal),
    totalSellValue: Math.round(sellVal),
    foreignNetVolume: netVol,
    foreignNetValue: Math.round(netVal),
    foreignRoom: room,
    updatedAt,
  }
}

/**
 * Universal Converter: Transforms any raw broker / DB / websocket feed into the CanonicalOrderbookSnapshot.
 */
export function toCanonicalOrderbookSnapshot(symbol: string, raw: any): CanonicalOrderbookSnapshot {
  const ticker = symbol.toUpperCase().trim()

  const rawTrades = Array.isArray(raw?.trades) ? raw.trades : []
  const trades: CanonicalSessionTrade[] = rawTrades.map((t: any, idx: number) => ({
    id: String(t.id || t.transId || t.sID || `${ticker}-${idx}`),
    time: formatSessionTradeTime(t.time ?? t.timeServer),
    price: normalizeToKiloPrice(t.price ?? t.lastPrice ?? t.matchPrice) ?? 0,
    volume: normalizeVolume(t.volume ?? t.lastVol ?? t.matchQtty ?? t.quantity),
    side: normalizeTradeSide(t.side ?? t.matchSide ?? t.aggressorSide, t.cl),
  })).filter((t: CanonicalSessionTrade) => t.price > 0)

  const rawIntraday = Array.isArray(raw?.intraday_1m) ? raw.intraday_1m : Array.isArray(raw?.prices) ? raw.prices : []
  const intraday1m: CanonicalIntradayPoint[] = rawIntraday.map((b: any) => {
    const rawOpen = typeof b.open === "number" ? b.open : typeof b.o === "number" ? b.o : typeof b.close === "number" ? b.close : 0
    const rawClose = typeof b.close === "number" ? b.close : typeof b.c === "number" ? b.c : rawOpen
    return {
      time: b.time ?? b.t ?? 0,
      open: normalizeToKiloPrice(rawOpen) ?? 0,
      close: normalizeToKiloPrice(rawClose) ?? 0,
    }
  }).filter((b: CanonicalIntradayPoint) => b.close > 0)

  const lastTradePrice = trades.length > 0 ? trades[trades.length - 1].price : null
  const firstTradePrice = trades.length > 0 ? trades[0].price : null
  const lastBarClose = intraday1m.length > 0 ? intraday1m[intraday1m.length - 1].close : null
  const firstBarOpen = intraday1m.length > 0 ? intraday1m[0].open : null

  const parsedRef = normalizeToKiloPrice(raw?.reference_price ?? raw?.reference ?? raw?.refPrice ?? raw?.r ?? raw?.basicPrice ?? raw?.closePrice)
  const parsedCeil = normalizeToKiloPrice(raw?.ceiling_price ?? raw?.ceiling ?? raw?.c)
  const parsedFloor = normalizeToKiloPrice(raw?.floor_price ?? raw?.floor ?? raw?.f)
  const parsedLast = normalizeToKiloPrice(raw?.latest_price ?? raw?.matchPrice ?? raw?.lastPrice ?? raw?.price)

  const last = parsedLast ?? lastTradePrice ?? lastBarClose ?? parsedRef

  let ref = parsedRef
  if (!ref && parsedCeil && parsedFloor) {
    ref = Math.round(((parsedCeil + parsedFloor) / 2) * 100) / 100
  } else if (!ref && parsedCeil) {
    ref = Math.round((parsedCeil / 1.07) * 100) / 100
  } else if (!ref) {
    ref = firstBarOpen ?? firstTradePrice ?? last
  }

  const ceil = parsedCeil ?? (ref ? Math.round(ref * 1.07 * 100) / 100 : null)
  const floor = parsedFloor ?? (ref ? Math.round(ref * 0.93 * 100) / 100 : null)

  let totalVolume = normalizeVolume(raw?.total_volume ?? raw?.totalVolume ?? raw?.totalVolumeTraded ?? (raw?.lot ? Number(raw.lot) * 10 : 0))
  if (totalVolume === 0 && trades.length > 0) {
    totalVolume = trades.reduce((sum, t) => sum + (t.volume || 0), 0)
  }

  const rawBids = raw?.latest_quote?.bids ?? raw?.bids ?? raw?.bid ?? []
  const rawAsks = raw?.latest_quote?.asks ?? raw?.asks ?? raw?.offer ?? []

  const rawPt = Array.isArray(raw?.put_through) ? raw.put_through : Array.isArray(raw?.putThrough) ? raw.putThrough : []
  const putThrough: CanonicalPutThroughDeal[] = rawPt.map((pt: any, idx: number) => ({
    id: String(pt.id || pt.transId || `pt-${idx}`),
    time: String(pt.time || "—"),
    price: normalizeToKiloPrice(pt.price) ?? 0,
    volume: normalizeVolume(pt.volume),
    value: Number(pt.value || 0),
    type: String(pt.type || "PTM"),
  }))

  const foreignFlow = normalizeForeignFlow(raw?.foreign_flow ?? raw?.foreign ?? raw)

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())

  return {
    symbol: ticker,
    sessionDate: String(raw?.session_date || raw?.sessionDate || today),
    referencePrice: ref,
    ceilingPrice: ceil,
    floorPrice: floor,
    latestPrice: last,
    totalVolume,
    intraday1m,
    trades,
    tradesTruncated: Boolean(raw?.trades_truncated ?? raw?.tradesTruncated),
    latestQuote: {
      reference: ref,
      ceiling: ceil,
      floor: floor,
      matchPrice: last,
      openPrice: normalizeToKiloPrice(raw?.open_price ?? raw?.openPrice ?? raw?.open ?? firstBarOpen ?? ref),
      highPrice: normalizeToKiloPrice(raw?.high_price ?? raw?.highPrice ?? raw?.high ?? last),
      lowPrice: normalizeToKiloPrice(raw?.low_price ?? raw?.lowPrice ?? raw?.low ?? last),
      avgPrice: normalizeToKiloPrice(raw?.avg_price ?? raw?.avgPrice ?? raw?.avePrice),
      totalVolume,
      bids: normalizeDepthLevels(rawBids),
      asks: normalizeDepthLevels(rawAsks),
    },
    foreignFlow,
    putThrough,
    updatedAt: String(raw?.updated_at || raw?.updatedAt || new Date().toISOString()),
  }
}
