import "server-only"

import { createHmac, randomUUID } from "node:crypto"
import { fetchYahooFiveMinuteSnapshot } from "@/lib/yahoo-history"

const DEFAULT_BASE_URL = "https://openapi.dnse.com.vn"
const VIETNAM_TZ = "Asia/Ho_Chi_Minh"

export interface DnseIntradayPoint {
  time: number
  open: number
  close: number
}

export interface DnseSessionTrade {
  id: string
  time: number
  price: number
  volume: number
  side: string
}

export interface DnseSessionQuote {
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
}

export interface DnseForeignSnapshot {
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

export interface DnseCompanyOverview {
  nameVi: string
  nameEn: string
  exchange: string
  sector?: string
}

export interface DnsePutThroughDeal {
  id: string
  time: string
  price: number
  volume: number
  value: number
  sym: string
  type?: string
}

export interface DnseSessionHistory {
  symbol: string
  sessionStart: number
  generatedAt: string
  prices: DnseIntradayPoint[]
  trades: DnseSessionTrade[]
  tradesTruncated: boolean
  latestQuote: DnseSessionQuote | null
  foreign?: DnseForeignSnapshot | null
  company?: DnseCompanyOverview | null
  putThrough?: DnsePutThroughDeal[]
}

function credentials() {
  const apiKey = process.env.DNSE_API_KEY ?? ""
  const apiSecret = process.env.DNSE_API_SECRET ?? ""
  if (!apiKey || !apiSecret) throw new Error("DNSE server credentials are not configured")
  return { apiKey, apiSecret }
}

function formatDateHeader(date: Date) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${days[date.getUTCDay()]}, ${pad(date.getUTCDate())} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} +0000`
}

function signatureHeaders(method: string, path: string, apiKey: string, apiSecret: string) {
  const dateValue = formatDateHeader(new Date())
  const nonce = randomUUID().replaceAll("-", "")
  const signingString = `(request-target): ${method.toLowerCase()} ${path}\ndate: ${dateValue}\nnonce: ${nonce}`
  const raw = createHmac("sha256", Buffer.from(apiSecret, "utf8")).update(signingString, "utf8").digest("base64")
  const signature = encodeURIComponent(raw)
  return {
    Date: dateValue,
    "X-Signature": `Signature keyId="${apiKey}",algorithm="hmac-sha256",headers="(request-target) date",signature="${signature}",nonce="${nonce}"`,
    "x-api-key": apiKey,
  }
}

async function signedGet(path: string, params?: Record<string, string | number | undefined>) {
  const { apiKey, apiSecret } = credentials()
  const baseUrl = (process.env.DNSE_API_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "")
  const url = new URL(`${baseUrl}${path}`)
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }
  const response = await fetch(url, {
    headers: signatureHeaders("GET", path, apiKey, apiSecret),
    cache: "no-store",
    signal: AbortSignal.timeout(7_000),
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`DNSE ${path} failed (${response.status}): ${body.slice(0, 180)}`)
  try {
    return JSON.parse(body) as unknown
  } catch {
    throw new Error(`DNSE ${path} returned invalid JSON`)
  }
}

function vietnamDateParts(timestampMs: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: VIETNAM_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestampMs))
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ""
  return { year: Number(value("year")), month: Number(value("month")), day: Number(value("day")) }
}

function vietnamDateKey(timestampMs: number) {
  const { year, month, day } = vietnamDateParts(timestampMs)
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function vietnamSessionStart(now: Date) {
  const { year, month, day } = vietnamDateParts(now.getTime())
  // Vietnam is UTC+7 year-round. 09:00 ICT = 02:00 UTC.
  return Math.floor(Date.UTC(year, month - 1, day, 2, 0, 0) / 1000)
}

function numberArray(value: unknown): number[] {
  return Array.isArray(value) ? value.map(Number) : []
}

function finiteNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function timestampSeconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value > 10_000_000_000 ? value / 1000 : value
  if (value && typeof value === "object") {
    const data = value as Record<string, unknown>
    const seconds = finiteNumber(data.Seconds ?? data.seconds)
    if (seconds && seconds > 0) return seconds
  }
  const text = String(value ?? "").trim()
  if (!text) return null
  if (/^\d{2}:\d{2}:\d{2}$/.test(text)) {
    const [hh, mm, ss] = text.split(":").map(Number)
    const { year, month, day } = vietnamDateParts(Date.now())
    return Math.floor(Date.UTC(year, month - 1, day, hh - 7, mm, ss) / 1000)
  }
  const numeric = Number(text)
  if (Number.isFinite(numeric)) return numeric > 10_000_000_000 ? numeric / 1000 : numeric
  const millis = Date.parse(text)
  return Number.isFinite(millis) ? millis / 1000 : null
}

function normalizeIntraday(raw: unknown): DnseIntradayPoint[] {
  const payload: any = raw
  const source: any = payload?.data ?? payload?.result ?? payload
  let points: DnseIntradayPoint[] = []

  if (Array.isArray(source)) {
    points = source.map((row: any) => ({
      time: Number(row?.time ?? row?.t ?? row?.timestamp ?? row?.ts),
      open: Number(row?.open ?? row?.o ?? row?.close ?? row?.c),
      close: Number(row?.close ?? row?.c),
    }))
  } else {
    const times = numberArray(source?.t ?? source?.time ?? source?.timestamps)
    const opens = numberArray(source?.o ?? source?.open)
    const closes = numberArray(source?.c ?? source?.close)
    const length = Math.min(times.length, closes.length)
    points = Array.from({ length }, (_, index) => ({ time: times[index], open: opens[index] || closes[index], close: closes[index] }))
  }

  return points.filter((point) => point.time > 0 && Number.isFinite(point.close) && point.close > 0)
}

function pageRows(payload: any, preferredKey: string) {
  const source: any = payload?.data ?? payload?.result ?? payload
  const candidates = [source?.[preferredKey], source?.items, source?.rows, source, payload?.[preferredKey], payload?.items]
  const rows = candidates.find((value) => Array.isArray(value)) ?? []
  const nextPageToken = String(source?.nextPageToken ?? source?.next_page_token ?? payload?.nextPageToken ?? payload?.next_page_token ?? "").trim()
  return { rows: rows as any[], nextPageToken: nextPageToken || null }
}

function normalizeTrade(row: any, index: number): DnseSessionTrade | null {
  const rawPrice = finiteNumber(row?.matchPrice ?? row?.price ?? row?.lastPrice)
  const price = rawPrice && rawPrice > 1000 ? rawPrice / 1000 : rawPrice
  const volume = finiteNumber(row?.matchQtty ?? row?.quantity ?? row?.qtty ?? row?.volume ?? row?.lastVol)
  const time = timestampSeconds(row?.transactTime ?? row?.time ?? row?.timestamp ?? row?.ts ?? row?.sID ?? row?.timeServer)
  if (!price || price <= 0 || !volume || volume <= 0 || !time || time <= 0) return null
  
  const rawSide = String(row?.side ?? row?.matchSide ?? row?.aggressorSide ?? "").trim().toUpperCase()
  let side = "REF"
  if (rawSide === "B" || rawSide === "BUY" || rawSide === "MUA") side = "BUY"
  else if (rawSide === "S" || rawSide === "SELL" || rawSide === "BAN" || rawSide === "BÁN") side = "SELL"
  else {
    const cl = String(row?.cl ?? "").trim().toLowerCase()
    if (cl === "i" || cl === "u") side = "BUY"
    else if (cl === "d") side = "SELL"
    else side = "REF"
  }

  const sourceId = String(
    row?.transId ||
    row?.tradeId ||
    (row?.sequence ? `seq-${row.sequence}` : "") ||
    (row?.sID ? `sid-${row.sID}-${index}` : "") ||
    (row?.seqNo ? `seqno-${row.seqNo}` : "") ||
    (row?.id && String(row.id).length > 5 ? String(row.id) : "") ||
    ""
  ).trim()
  return {
    id: sourceId || `trade-${Math.round(time * 1000)}-${price}-${volume}-${side}-${index}`,
    time,
    price,
    volume,
    side,
  }
}

function normalizeLatestQuote(raw: unknown): DnseSessionQuote | null {
  const payload: any = raw
  const source: any = payload?.data ?? payload?.result ?? payload
  const row: any = Array.isArray(source) ? source[0] : source?.quote ?? source?.item ?? source
  if (!row || typeof row !== "object") return null
  const bid = Array.isArray(row.bid) ? row.bid : Array.isArray(row.bids) ? row.bids : []
  const offer = Array.isArray(row.offer) ? row.offer : Array.isArray(row.asks) ? row.asks : []
  return {
    time: timestampSeconds(row?.transactTime ?? row?.time ?? row?.timestamp ?? row?.ts),
    bid,
    offer,
    matchPrice: finiteNumber(row?.matchPrice ?? row?.price ?? row?.lastPrice),
    openPrice: finiteNumber(row?.openPrice ?? row?.openingPrice ?? row?.open),
    reference: finiteNumber(row?.referencePrice ?? row?.refPrice ?? row?.reference ?? row?.r ?? row?.basicPrice),
    ceiling: finiteNumber(row?.ceilingPrice ?? row?.ceiling ?? row?.c),
    floor: finiteNumber(row?.floorPrice ?? row?.floor ?? row?.f),
    highPrice: finiteNumber(row?.highPrice ?? row?.highest ?? row?.h),
    lowPrice: finiteNumber(row?.lowPrice ?? row?.lowest ?? row?.l),
    avgPrice: finiteNumber(row?.avgPrice ?? row?.averagePrice ?? row?.avePrice),
    totalVolume: finiteNumber(row?.totalVolumeTraded ?? row?.totalVolume ?? (row?.lot ? Number(row.lot) * 10 : null)),
  }
}

export async function fetchDnseOhlcHistory(symbol: string, resolution: 1 | 5, now = new Date(), maxPoints = 90) {
  const ticker = symbol.trim().toUpperCase()
  if (!/^[A-Z0-9]{2,12}$/.test(ticker)) throw new Error("Invalid DNSE symbol")
  const to = Math.floor(now.getTime() / 1000)
  const from = vietnamSessionStart(now)
  const raw = await signedGet("/price/ohlc", {
    symbol: ticker,
    resolution: String(resolution),
    from,
    to,
    type: "STOCK",
  })
  const today = vietnamDateKey(now.getTime())
  return normalizeIntraday(raw)
    .filter((point) => vietnamDateKey(point.time * 1000) === today)
    .slice(-Math.max(20, Math.min(maxPoints, 360)))
}

export async function fetchDnseMinuteHistory(symbol: string, now = new Date(), maxPoints = 90) {
  return fetchDnseOhlcHistory(symbol, 1, now, maxPoints)
}

async function fetchDnseSessionTrades(symbol: string, now: Date, maxRows = 30_000) {
  const rows: DnseSessionTrade[] = []
  let truncated = false

  // 1. Primary fast full session trades from VPS (all trades from 09:15:00 to current time)
  try {
    const vpsRes = await fetch(`https://bgapidatafeed.vps.com.vn/getliststocktrade/${symbol}`, {
      headers: { "User-Agent": "Mozilla/5.0 StockOS/1.0" },
      signal: AbortSignal.timeout(4500),
    })
    if (vpsRes.ok) {
      const vpsTrades = await vpsRes.json()
      if (Array.isArray(vpsTrades) && vpsTrades.length > 0) {
        for (let i = 0; i < vpsTrades.length; i++) {
          const trade = normalizeTrade(vpsTrades[i], i)
          if (trade) rows.push(trade)
          if (rows.length >= maxRows) {
            truncated = true
            break
          }
        }
      }
    }
  } catch {
    // Ignore VPS error, fallback to DNSE API
  }

  // 2. If VPS returned empty, fallback to DNSE signedGet
  if (!rows.length) {
    const from = vietnamSessionStart(now)
    const to = Math.floor(now.getTime() / 1000)
    let nextPageToken: string | null = null
    let page = 0

    try {
      do {
        const raw = await signedGet(`/price/${symbol}/trades`, {
          boardId: "G1",
          from,
          to,
          limit: 500,
          order: "ASC",
          nextPageToken: nextPageToken ?? undefined,
        })
        const parsed = pageRows(raw, "trades")
        for (let index = 0; index < parsed.rows.length; index += 1) {
          const trade = normalizeTrade(parsed.rows[index], page * 500 + index)
          if (trade) rows.push(trade)
          if (rows.length >= maxRows) {
            truncated = Boolean(parsed.nextPageToken) || index < parsed.rows.length - 1
            break
          }
        }
        nextPageToken = rows.length >= maxRows ? null : parsed.nextPageToken
        page += 1
      } while (nextPageToken && page < 10)
    } catch {
      // Ignore DNSE error
    }
  }

  rows.sort((a, b) => a.time - b.time)
  return { rows, truncated }
}

async function fetchDnseLatestQuote(symbol: string) {
  try {
    return normalizeLatestQuote(await signedGet(`/price/${symbol}/quotes/latest`, { boardId: "G1" }))
  } catch {
    const raw = await signedGet(`/price/${symbol}/quotes`, { boardId: "G1", limit: 1, order: "DESC" })
    return normalizeLatestQuote(raw)
  }
}

function parseDepthLevel(price: number | null | undefined, volume: number | null | undefined): { price: number; volume: number } | null {
  if (!price || !Number.isFinite(price) || price <= 0 || !volume || !Number.isFinite(volume) || volume <= 0) return null
  return {
    price: price > 1000 ? price / 1000 : price,
    volume: volume / 10,
  }
}

function parseVpsPipeDepth(val: unknown): { price: number; volume: number } | null {
  if (typeof val !== "string" || !val) return null
  const parts = val.split("|")
  if (parts.length < 2) return null
  const rawPrice = parseFloat(parts[0])
  const rawVolLot = parseFloat(parts[1])
  if (Number.isFinite(rawPrice) && rawPrice > 0 && Number.isFinite(rawVolLot) && rawVolLot > 0) {
    return {
      price: rawPrice > 1000 ? rawPrice / 1000 : rawPrice,
      volume: rawVolLot,
    }
  }
  return null
}

async function fetchFastMarketOverview(symbol: string) {
  try {
    const [ssiRes, vpsRes] = await Promise.allSettled([
      fetch(`https://iboard-query.ssi.com.vn/stock/${symbol}`, {
        headers: { "User-Agent": "Mozilla/5.0 StockOS/1.0" },
        signal: AbortSignal.timeout(3500),
      }).then((r) => (r.ok ? r.json() : null)),
      fetch(`https://bgapidatafeed.vps.com.vn/getliststockdata/${symbol}`, {
        headers: { "User-Agent": "Mozilla/5.0 StockOS/1.0" },
        signal: AbortSignal.timeout(3500),
      }).then((r) => (r.ok ? r.json() : null)),
    ])

    const ssiData = ssiRes.status === "fulfilled" ? ssiRes.value?.data : null
    const vpsData = vpsRes.status === "fulfilled" && Array.isArray(vpsRes.value) ? vpsRes.value[0] : null

    const company: DnseCompanyOverview = {
      nameVi: String(ssiData?.companyNameVi || ssiData?.clientName || "").trim(),
      nameEn: String(ssiData?.companyNameEn || ssiData?.clientNameEn || "").trim(),
      exchange: String(ssiData?.exchange || "HOSE").toUpperCase(),
    }

    const ceiling = finiteNumber(ssiData?.ceiling ?? (vpsData?.c ? Number(vpsData.c) * 1000 : null))
    const floor = finiteNumber(ssiData?.floor ?? (vpsData?.f ? Number(vpsData.f) * 1000 : null))
    const refPrice = finiteNumber(ssiData?.refPrice ?? (vpsData?.r ? Number(vpsData.r) * 1000 : null))
    const highPrice = finiteNumber(ssiData?.highest ?? (vpsData?.highPrice ? Number(vpsData.highPrice) * 1000 : null))
    const lowPrice = finiteNumber(ssiData?.lowest ?? (vpsData?.lowPrice ? Number(vpsData.lowPrice) * 1000 : null))
    const avgPrice = finiteNumber(ssiData?.avgPrice ?? (vpsData?.avePrice ? Number(vpsData.avePrice) * 1000 : null))
    const isCallAuction = ssiData?.session === "ATO" || ssiData?.session === "ATC" || ssiData?.exchangeSession === "ATO" || ssiData?.exchangeSession === "ATC"
    const totalVolume = finiteNumber(
      (isCallAuction ? ssiData?.expectedMatchedVolume : null) ??
      ssiData?.nmTotalTradedQty ??
      (vpsData?.lot ? Number(vpsData.lot) * 10 : null) ??
      ssiData?.expectedMatchedVolume
    )
    const matchPrice = finiteNumber(
      (isCallAuction ? ssiData?.expectedMatchedPrice : null) ??
      ssiData?.matchedPrice ??
      (vpsData?.lastPrice ? Number(vpsData.lastPrice) * 1000 : null) ??
      ssiData?.expectedMatchedPrice ??
      refPrice
    )

    const foreignBuyVol = finiteNumber(ssiData?.buyForeignQtty ?? (vpsData?.fBVol ? Number(vpsData.fBVol) * 10 : 0)) ?? 0
    const foreignSellVol = finiteNumber(ssiData?.sellForeignQtty ?? (vpsData?.fSVolume ? Number(vpsData.fSVolume) * 10 : 0)) ?? 0
    const foreignBuyVal = finiteNumber(ssiData?.buyForeignValue ?? (vpsData?.fBValue ? Number(vpsData.fBValue) * 1000 : 0)) ?? 0
    const foreignSellVal = finiteNumber(ssiData?.sellForeignValue ?? (vpsData?.fSValue ? Number(vpsData.fSValue) * 1000 : 0)) ?? 0
    // Canonical exchange foreign room from SSI (with VPS * 10 fallback)
    const availableRoom = finiteNumber(ssiData?.remainForeignQtty ?? (vpsData?.fRoom ? Number(vpsData.fRoom) * 10 : null))
    const listedShare = finiteNumber(ssiData?.listedShare)

    // Extract 3-level orderbook depth
    const ssiBids = [
      parseDepthLevel(ssiData?.best1Bid, ssiData?.best1BidVol),
      parseDepthLevel(ssiData?.best2Bid, ssiData?.best2BidVol),
      parseDepthLevel(ssiData?.best3Bid, ssiData?.best3BidVol),
    ].filter(Boolean) as { price: number; volume: number }[]

    const ssiAsks = [
      parseDepthLevel(ssiData?.best1Offer, ssiData?.best1OfferVol),
      parseDepthLevel(ssiData?.best2Offer, ssiData?.best2OfferVol),
      parseDepthLevel(ssiData?.best3Offer, ssiData?.best3OfferVol),
    ].filter(Boolean) as { price: number; volume: number }[]

    const vpsBids = [
      parseVpsPipeDepth(vpsData?.g1),
      parseVpsPipeDepth(vpsData?.g2),
      parseVpsPipeDepth(vpsData?.g3),
    ].filter(Boolean) as { price: number; volume: number }[]

    const vpsAsks = [
      parseVpsPipeDepth(vpsData?.g4),
      parseVpsPipeDepth(vpsData?.g5),
      parseVpsPipeDepth(vpsData?.g6),
    ].filter(Boolean) as { price: number; volume: number }[]

    const bids = ssiBids.length ? ssiBids : vpsBids
    const asks = ssiAsks.length ? ssiAsks : vpsAsks

    const foreign: DnseForeignSnapshot = {
      symbol,
      totalBuyVolume: foreignBuyVol,
      totalSellVolume: foreignSellVol,
      totalBuyValue: foreignBuyVal,
      totalSellValue: foreignSellVal,
      availableRoom,
      orderLimitQuantity: null,
      listedShare,
      updatedAt: new Date().toISOString(),
    }

    return { company, ceiling, floor, refPrice, highPrice, lowPrice, avgPrice, totalVolume, matchPrice, foreign, bids, asks }
  } catch {
    return null
  }
}

async function fetchPutThroughDeals(symbol: string): Promise<DnsePutThroughDeal[]> {
  try {
    const res = await fetch("https://bgapidatafeed.vps.com.vn/getlistpt", {
      headers: { "User-Agent": "Mozilla/5.0 StockOS/1.0" },
      signal: AbortSignal.timeout(3500),
    })
    if (!res.ok) return []
    const list = await res.json()
    if (!Array.isArray(list)) return []
    const ticker = symbol.toUpperCase().trim()
    return list
      .filter((item: any) => String(item?.sym || "").toUpperCase().trim() === ticker)
      .map((item: any, idx: number) => {
        const rawPrice = finiteNumber(item?.price)
        const price = rawPrice && rawPrice > 1000 ? rawPrice / 1000 : (rawPrice ?? 0)
        const volume = finiteNumber(item?.volume) ?? 0
        const rawValue = finiteNumber(item?.value) ?? 0
        // VPS rawValue in getlistpt is in thousand VND -> * 1000 for exact VND
        const value = rawValue > 0 ? rawValue * 1000 : price * 1000 * volume
        return {
          id: String(item?.transId || item?.id || `pt-${idx}`),
          time: String(item?.time || "—"),
          price,
          volume,
          value,
          sym: ticker,
          type: String(item?.type || "PTM"),
        }
      })
      .sort((a, b) => (b.time > a.time ? 1 : -1))
  } catch {
    return []
  }
}

export async function fetchDnseSessionHistory(symbol: string, now = new Date()): Promise<DnseSessionHistory> {
  const ticker = symbol.trim().toUpperCase()
  if (!/^[A-Z0-9]{2,12}$/.test(ticker)) throw new Error("Invalid DNSE symbol")

  const [pricesRes, tradeResult, latestQuoteRes, fastOverviewRes, putThroughRes] = await Promise.allSettled([
    fetchDnseMinuteHistory(ticker, now, 360),
    fetchDnseSessionTrades(ticker, now),
    fetchDnseLatestQuote(ticker),
    fetchFastMarketOverview(ticker),
    fetchPutThroughDeals(ticker),
  ])

  let prices = pricesRes.status === "fulfilled" ? pricesRes.value : []
  const trades = tradeResult.status === "fulfilled" ? tradeResult.value.rows : []
  const tradesTruncated = tradeResult.status === "fulfilled" ? tradeResult.value.truncated : false
  let latestQuote = latestQuoteRes.status === "fulfilled" ? latestQuoteRes.value : null
  const fastOverview = fastOverviewRes.status === "fulfilled" ? fastOverviewRes.value : null
  const putThrough = putThroughRes.status === "fulfilled" ? putThroughRes.value : []

  // Fallback for prices if DNSE 1m returned empty (e.g. outside session or weekend)
  if (!prices.length) {
    try {
      const yahoo = await fetchYahooFiveMinuteSnapshot(ticker, now)
      if (yahoo.bars.length > 0) {
        prices = yahoo.bars.map((b) => ({ time: b.time, open: b.open, close: b.close }))
      }
    } catch {
      // Ignore Yahoo fallback error
    }
  }

  // Synthesize latest quote from overview, trades, and intraday candles
  const lastTradePrice = trades.length > 0 ? trades[trades.length - 1].price : null
  const firstTradePrice = trades.length > 0 ? trades[0].price : null
  const lastBarClose = prices.length > 0 ? prices[prices.length - 1].close : null
  const firstBarOpen = prices.length > 0 ? prices[0].open : null
  const tradeVolume = trades.reduce((sum, t) => sum + (t.volume || 0), 0)

  const matchPrice = latestQuote?.matchPrice || fastOverview?.matchPrice || lastTradePrice || lastBarClose || null
  const explicitRef = latestQuote?.reference ?? fastOverview?.refPrice ?? null
  const explicitCeil = latestQuote?.ceiling ?? fastOverview?.ceiling ?? null
  const explicitFloor = latestQuote?.floor ?? fastOverview?.floor ?? null

  let refPrice = explicitRef
  if (!refPrice && explicitCeil && explicitFloor) {
    refPrice = Math.round(((explicitCeil + explicitFloor) / 2) * 100) / 100
  } else if (!refPrice && explicitCeil) {
    refPrice = Math.round((explicitCeil / 1.07) * 100) / 100
  } else if (!refPrice) {
    refPrice = firstBarOpen ?? firstTradePrice ?? matchPrice ?? null
  }

  const ceilingPrice = explicitCeil ?? (refPrice ? Math.round(refPrice * 1.07 * 100) / 100 : null)
  const floorPrice = explicitFloor ?? (refPrice ? Math.round(refPrice * 0.93 * 100) / 100 : null)

  if (!latestQuote) {
    latestQuote = {
      time: Math.floor(now.getTime() / 1000),
      bid: fastOverview?.bids ?? [],
      offer: fastOverview?.asks ?? [],
      matchPrice,
      openPrice: prices[0]?.open || firstTradePrice || refPrice,
      reference: refPrice,
      ceiling: ceilingPrice,
      floor: floorPrice,
      highPrice: fastOverview?.highPrice ?? matchPrice,
      lowPrice: fastOverview?.lowPrice ?? matchPrice,
      avgPrice: fastOverview?.avgPrice ?? matchPrice,
      totalVolume: fastOverview?.totalVolume || tradeVolume,
    }
  } else {
    latestQuote.matchPrice = latestQuote.matchPrice ?? matchPrice
    latestQuote.reference = latestQuote.reference ?? refPrice
    latestQuote.ceiling = latestQuote.ceiling ?? ceilingPrice
    latestQuote.floor = latestQuote.floor ?? floorPrice
    latestQuote.totalVolume = latestQuote.totalVolume || fastOverview?.totalVolume || tradeVolume
    if (!latestQuote.bid?.length && fastOverview?.bids?.length) {
      latestQuote.bid = fastOverview.bids
    }
    if (!latestQuote.offer?.length && fastOverview?.asks?.length) {
      latestQuote.offer = fastOverview.asks
    }
  }

  return {
    symbol: ticker,
    sessionStart: vietnamSessionStart(now),
    generatedAt: now.toISOString(),
    prices,
    trades,
    tradesTruncated,
    latestQuote,
    foreign: fastOverview?.foreign ?? null,
    company: fastOverview?.company ?? null,
    putThrough,
  }
}

export interface ClusteredTrade {
  id: string
  time: string
  price: number
  volume: number
  side: "BUY" | "SELL" | "UNKNOWN"
  count: number
}

export function parseTradeSeconds(timeStr: string): number {
  if (!timeStr) return 0
  if (timeStr.includes("T") || timeStr.includes("-")) {
    const ms = Date.parse(timeStr)
    if (!Number.isNaN(ms)) return Math.floor(ms / 1000)
  }
  const match = timeStr.match(/(\d{1,2}):(\d{2}):(\d{2})/)
  if (match) {
    const h = parseInt(match[1], 10) || 0
    const m = parseInt(match[2], 10) || 0
    const s = parseInt(match[3], 10) || 0
    return h * 3600 + m * 60 + s
  }
  const parsed = Date.parse(timeStr)
  if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000)
  return 0
}

/**
 * Gộp các giao dịch có cùng action (side) và diễn ra cùng giây hoặc cách nhau <= 1s thành 1 lệnh
 */
export function clusterTrades<T extends { id: string; time: string; price: number; volume: number; side: "BUY" | "SELL" | "UNKNOWN" }>(
  trades: T[]
): ClusteredTrade[] {
  if (!trades.length) return []
  const result: ClusteredTrade[] = []
  let currentCluster: {
    id: string
    time: string
    side: "BUY" | "SELL" | "UNKNOWN"
    totalVolume: number
    totalValue: number
    earliestSec: number
    count: number
  } | null = null

  for (const t of trades) {
    const sec = parseTradeSeconds(t.time)

    if (!currentCluster) {
      currentCluster = {
        id: t.id,
        time: t.time,
        side: t.side,
        totalVolume: t.volume,
        totalValue: t.price * t.volume,
        earliestSec: sec,
        count: 1,
      }
      continue
    }

    const isSameSide = t.side === currentCluster.side
    const secDiff = Math.abs(currentCluster.earliestSec - sec)
    const isWithin1Sec = secDiff <= 1

    if (isSameSide && isWithin1Sec) {
      currentCluster.totalVolume += t.volume
      currentCluster.totalValue += t.price * t.volume
      currentCluster.earliestSec = Math.min(currentCluster.earliestSec, sec)
      currentCluster.count += 1
    } else {
      const avgPrice = currentCluster.totalVolume > 0 
        ? currentCluster.totalValue / currentCluster.totalVolume 
        : 0
      result.push({
        id: currentCluster.id,
        time: currentCluster.time,
        price: avgPrice,
        volume: currentCluster.totalVolume,
        side: currentCluster.side,
        count: currentCluster.count,
      })

      currentCluster = {
        id: t.id,
        time: t.time,
        side: t.side,
        totalVolume: t.volume,
        totalValue: t.price * t.volume,
        earliestSec: sec,
        count: 1,
      }
    }
  }

  if (currentCluster) {
    const avgPrice = currentCluster.totalVolume > 0 
      ? currentCluster.totalValue / currentCluster.totalVolume 
      : 0
    result.push({
      id: currentCluster.id,
      time: currentCluster.time,
      price: avgPrice,
      volume: currentCluster.totalVolume,
      side: currentCluster.side,
      count: currentCluster.count,
    })
  }

  return result
}

