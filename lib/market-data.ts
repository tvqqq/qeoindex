// Realtime market data engine connected to DNSE OpenAPI WebSocket.
// Renders initial layout with default data, then connects to DNSE WS for live updates.

export type Trend = "up" | "down" | "ref" | "ceiling" | "floor"
export type WSStatus = "disconnected" | "connecting" | "connected" | "error"

export interface Stock {
  symbol: string
  group: string
  price: number
  refPrice: number
  ceiling: number
  floor: number
  change: number // absolute
  changePct: number
  volume: number
  history: number[]
  trend: Trend
  tickDir: 1 | -1 | 0 // last tick direction, for flash animation
  updatedAt: number
}

export interface MarketIndex {
  name: string
  value: number
  change: number
  changePct: number
}

export interface OrderRow {
  price: number
  volume: number
}

export interface OrderBook {
  bids: OrderRow[]
  asks: OrderRow[]
}

// ---------- seeded RNG (mulberry32) ----------
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashStr(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// ---------- group definitions (symbol -> base price) ----------
type Def = Record<string, number>

export const GROUPS: { name: string; label: string; defs: Def }[] = [
  {
    name: "vn30",
    label: "VN30",
    defs: {
      MBB: 20.5, VJC: 127.3, DGC: 44.15, LPB: 52.9, SSB: 15.4, VNM: 62.6, VHM: 72.1,
      VIB: 14.95, FPT: 72.1, SSI: 25.2, BCM: 41.45, BID: 39.6, MSN: 67.8, STB: 74.7,
      VIC: 208.5, HDB: 26.95, MWG: 73.0, VCB: 60.3, HPG: 22.1, TPB: 14.75, ACB: 22.65,
      SHB: 12.0, VPB: 25.8, TCB: 31.25, CTG: 32.65, GVR: 31.6,
    },
  },
  {
    name: "bds",
    label: "Bất động sản",
    defs: {
      CRV: 24.5, HQC: 2.25, HUT: 13.8, L18: 15.5, NLG: 22.9, HDC: 12.1, SGR: 12.4,
      DIG: 11.1, KDH: 18.3, CEO: 12.3, KBC: 28.4, VHM: 72.1, DXS: 5.96, QCG: 10.2,
      DXG: 11.1, KHG: 4.8, PDR: 12.15, BCM: 41.45, HTN: 7.48, DC4: 6.75, IJC: 7.94,
      VIC: 208.5, TCH: 12.3, SCR: 4.61, NVL: 13.85, HHS: 8.2,
    },
  },
  {
    name: "chung",
    label: "Chứng khoán",
    defs: {
      HCM: 27.0, CTS: 23.5, FTS: 23.05, APS: 6.5, VIX: 14.35, TVB: 7.3, VCI: 22.65,
      VIG: 4.2, SBS: 4.7, ORS: 14.5, VDS: 12.4, BSI: 29.65, TCX: 40.65, TVS: 14.0,
      AAS: 7.4, SHS: 16.2, BVS: 28.0, MBS: 19.2, PSI: 9.7, AGR: 13.5, DSE: 22.55,
      VND: 17.15, CTG: 32.65, APG: 5.05, VPX: 25.85, TCI: 11.4,
    },
  },
  {
    name: "bank",
    label: "Ngân hàng",
    defs: {
      MBB: 20.5, OCB: 10.85, BVB: 12.65, EVF: 12.65, LPB: 52.9, SSB: 15.4, BAB: 10.8,
      VIB: 14.95, VAB: 10.15, MSB: 16.3, EIB: 18.2, BID: 39.6, STB: 74.7, ABB: 16.8,
      HDB: 26.95, VCB: 60.3, TPB: 14.75, ACB: 22.65, SHB: 12.0, VPB: 25.8, TCB: 31.25,
      KLB: 12.85, CTG: 32.65, NAB: 11.95, NVB: 11.2,
    },
  },
  {
    name: "thep",
    label: "Thép",
    defs: {
      POM: 3.5, SMC: 10.75, HSG: 11.0, VCA: 6.0, NSH: 4.3, TLH: 3.99, SHI: 14.0,
      HPG: 22.1, GDA: 12.5, NKG: 11.2, VGS: 18.1, TVN: 9.2, SHA: 3.92,
    },
  },
  {
    name: "daukhi",
    label: "Dầu khí",
    defs: {
      PVT: 19.75, PVP: 17.8, PVS: 35.4, PVB: 21.5, PVD: 18.35, CNG: 22.0, PLC: 20.5,
      BSR: 26.55, OIL: 13.6, PVC: 12.2, GAS: 79.1,
    },
  },
  {
    name: "banle",
    label: "Bán lẻ",
    defs: {
      FRT: 146.5, DGW: 41.4, PET: 39.35, MSN: 67.8, MWG: 73.0, MCH: 135.5, PNJ: 35.55,
      PSD: 12.6,
    },
  },
  {
    name: "baohiem",
    label: "Bảo hiểm",
    defs: {
      PTI: 19.0, PRE: 29.5, BMI: 13.7, VNR: 18.4, PGI: 68.5, PVI: 51.1, ABI: 18.8,
      BIC: 21.2, MIG: 16.75, BVH: 66.1,
    },
  },
  {
    name: "bdskcn",
    label: "BĐS KCN",
    defs: {
      SZL: 50.0, IDC: 34.7, KBC: 28.4, NTC: 129.5, BCM: 41.45, TIP: 17.1, SIP: 51.1,
      D2D: 28.5, GVR: 31.6, DTD: 12.1, PHR: 59.3, LHG: 28.7, IDV: 20.1, SZC: 20.15,
    },
  },
  {
    name: "congnghe",
    label: "Công nghệ",
    defs: {
      ITD: 12.5, YEG: 18.4, FOX: 88.5, FPT: 72.1, CMG: 42.3, FOC: 55.0, VTP: 96.4,
      ELC: 21.7, CTR: 118.5, VGI: 84.2,
    },
  },
]

const CEILING_SYMBOLS = new Set(["POM", "CRV", "FRT"])

function tickSize(price: number) {
  if (price < 10) return 0.01
  if (price < 50) return 0.05
  return 0.1
}

function roundTick(price: number) {
  const t = tickSize(price)
  return Math.round(price / t) * t
}

function buildStock(symbol: string, group: string, base: number): Stock {
  const rnd = mulberry32(hashStr(group + ":" + symbol))
  const refPrice = roundTick(base)
  const ceiling = roundTick(refPrice * 1.07)
  const floor = roundTick(refPrice * 0.93)

  let price: number
  if (CEILING_SYMBOLS.has(symbol)) {
    price = ceiling
  } else {
    const pct = (rnd() - 0.45) * 0.06
    price = roundTick(refPrice * (1 + pct))
  }
  price = Math.min(ceiling, Math.max(floor, price))

  const history: number[] = []
  let p = refPrice
  for (let i = 0; i < 24; i++) {
    const target = refPrice + ((price - refPrice) * i) / 23
    p = target + (rnd() - 0.5) * tickSize(base) * 2
    history.push(Math.round(p * 100) / 100)
  }
  history[history.length - 1] = price

  const volume = Math.floor(rnd() * 9_000_000) + 20_000

  return finalize({
    symbol,
    group,
    price,
    refPrice,
    ceiling,
    floor,
    change: 0,
    changePct: 0,
    volume,
    history,
    trend: "ref",
    tickDir: 0,
    updatedAt: 0,
  })
}

function finalize(s: Stock): Stock {
  const change = Math.round((s.price - s.refPrice) * 100) / 100
  const changePct = Math.round((change / s.refPrice) * 10000) / 100
  let trend: Trend = "ref"
  if (s.price >= s.ceiling) trend = "ceiling"
  else if (s.price <= s.floor) trend = "floor"
  else if (change > 0) trend = "up"
  else if (change < 0) trend = "down"
  return { ...s, change, changePct, trend }
}

// ---------- Store with DNSE WebSocket integration ----------
type Listener = () => void

interface StreamAuthPayload {
  url: string
  auth: {
    action: "auth"
    api_key: string
    signature: string
    timestamp: number
    nonce: string
  }
}

class MarketStore {
  private stocks: Record<string, Stock> = {}
  private stockKeys: string[] = []
  private symbolToKeysMap = new Map<string, string[]>()
  private indices: MarketIndex[]
  private symSubs = new Map<string, Set<Listener>>()
  private indexSubs = new Set<Listener>()
  private statusSubs = new Set<Listener>()
  
  private status: WSStatus = "disconnected"
  private ws: WebSocket | null = null
  private pingTimer: any = null
  private reconnectTimer: any = null
  private reconnectAttempts = 0
  private isConnecting = false
  private streamAuth: StreamAuthPayload | null = null

  constructor() {
    for (const g of GROUPS) {
      for (const [symbol, base] of Object.entries(g.defs)) {
        const key = `${g.name}:${symbol}`
        this.stocks[key] = buildStock(symbol, g.name, base)
        this.stockKeys.push(key)

        const keys = this.symbolToKeysMap.get(symbol) || []
        keys.push(key)
        this.symbolToKeysMap.set(symbol, keys)
      }
    }

    this.indices = [
      { name: "VN-INDEX", value: 1779.58, change: 2.81, changePct: 0.2 },
      { name: "VN30", value: 1929.33, change: 4.15, changePct: 0.2 },
      { name: "HNX", value: 288.92, change: 1.24, changePct: 0.4 },
      { name: "UPCOM", value: 127.56, change: 0.24, changePct: 0.2 },
    ]
  }

  getGroupKeys(group: string) {
    return this.stockKeys.filter((k) => k.startsWith(group + ":"))
  }
  getStock = (key: string) => this.stocks[key]
  getIndices = () => this.indices
  getStatus = () => this.status

  subscribeStock = (key: string, cb: Listener) => {
    let set = this.symSubs.get(key)
    if (!set) {
      set = new Set()
      this.symSubs.set(key, set)
    }
    set.add(cb)
    this.ensureRunning()
    return () => {
      set!.delete(cb)
    }
  }

  subscribeIndices = (cb: Listener) => {
    this.indexSubs.add(cb)
    this.ensureRunning()
    return () => {
      this.indexSubs.delete(cb)
    }
  }

  subscribeStatus = (cb: Listener) => {
    this.statusSubs.add(cb)
    this.ensureRunning()
    return () => {
      this.statusSubs.delete(cb)
    }
  }

  private setStatus(status: WSStatus) {
    this.status = status
    this.statusSubs.forEach((cb) => cb())
  }

  private ensureRunning() {
    if (typeof window === "undefined" || this.ws || this.isConnecting) return
    this.connectDNSE()
  }

  private async connectDNSE() {
    this.isConnecting = true
    this.setStatus("connecting")
    console.log("[DNSE WS] Client connecting to DNSE WebSocket endpoint...")

    try {
      const response = await fetch("/api/market/stream-auth", {
        cache: "no-store",
        headers: { Accept: "application/json" },
      })
      const payload = await response.json()
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message ?? `DNSE stream auth failed (${response.status})`)
      }

      this.streamAuth = { url: payload.url, auth: payload.auth }
      this.ws = new WebSocket(this.streamAuth.url)

      this.ws.onopen = () => {
        console.log("[DNSE WS] WebSocket socket opened. Waiting for welcome message...")
        this.reconnectAttempts = 0
      }

      this.ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data)
          await this.handleWSMessage(data)
        } catch (err) {
          console.error("[DNSE WS] Error parsing message:", err)
        }
      }

      this.ws.onerror = (err) => {
        console.error("[DNSE WS] Socket Error:", err)
        this.setStatus("error")
      }

      this.ws.onclose = (event) => {
        console.log(`[DNSE WS] Connection closed (code ${event.code})`)
        this.isConnecting = false
        this.ws = null
        this.stopPingTimer()
        this.setStatus("disconnected")
        this.scheduleReconnect()
      }
    } catch (e) {
      console.error("[DNSE WS] Exception connecting:", e)
      this.isConnecting = false
      this.setStatus("error")
      this.scheduleReconnect()
    }
  }

  private async handleWSMessage(data: any) {
    const action = data.action

    if (action === "welcome") {
      console.log(`[DNSE WS] Welcome received (session: ${data.session_id}). Authenticating...`)
      if (!this.streamAuth) throw new Error("DNSE stream auth payload is unavailable")
      this.send(this.streamAuth.auth)
      return
    }

    if (action === "auth_success") {
      console.log("[DNSE WS] ✅ Authenticated successfully with DNSE! Subscribing to market feeds...")
      this.setStatus("connected")
      this.subscribeChannels()
      this.startPingTimer()
      return
    }

    if (action === "ping") {
      this.send({ action: "pong", timestamp: data.timestamp })
      return
    }

    if (action === "subscribed") {
      console.log(`[DNSE WS] Active subscription: ${data.channel}`)
      return
    }

    // Realtime Tick Data (T === "t")
    if (data.T === "t" && data.symbol) {
      const symbol = data.symbol as string
      const keys = this.symbolToKeysMap.get(symbol)
      if (keys && keys.length > 0) {
        const matchPrice = data.matchPrice ?? 0
        const totalVol = data.totalVolumeTraded ?? 0
        
        for (const key of keys) {
          const s = this.stocks[key]
          if (!s) continue

          const price = matchPrice > 0 ? matchPrice : s.price
          const tickDir: 1 | -1 | 0 = price > s.price ? 1 : price < s.price ? -1 : 0
          const history = s.history.slice(1)
          history.push(price)

          const nextStock = finalize({
            ...s,
            price,
            history,
            tickDir,
            volume: totalVol > 0 ? totalVol : s.volume + (data.matchQtty || 0),
            updatedAt: Date.now(),
          })

          this.stocks[key] = nextStock
          this.symSubs.get(key)?.forEach((cb) => cb())
        }
      }
      return
    }

    // Realtime Index Data (T === "mi")
    if (data.T === "mi" && data.indexName) {
      const idxName = data.indexName.toUpperCase()
      this.indices = this.indices.map((idx) => {
        if (idx.name.toUpperCase().replace("-", "") === idxName || (idxName === "VNINDEX" && idx.name === "VN-INDEX")) {
          return {
            ...idx,
            value: data.valueIndexes ?? idx.value,
            change: data.changedValue ?? idx.change,
            changePct: data.changedRatio ?? idx.changePct,
          }
        }
        return idx
      })
      this.indexSubs.forEach((cb) => cb())
    }
  }

  private subscribeChannels() {
    const allSymbols = Array.from(this.symbolToKeysMap.keys())
    const subMsg = {
      action: "subscribe",
      channels: [
        {
          name: "tick.G1.json",
          symbols: allSymbols,
        },
        { name: "market_index.VNINDEX.json" },
        { name: "market_index.VN30.json" },
        { name: "order.STOCK.json" },
        { name: "position.STOCK.json" }
      ],
    }
    this.send(subMsg)
  }

  private send(payload: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload))
    }
  }

  private startPingTimer() {
    this.stopPingTimer()
    this.pingTimer = setInterval(() => {
      this.send({ action: "ping", timestamp: Date.now() })
    }, 25000)
  }

  private stopPingTimer() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return
    this.reconnectAttempts += 1
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000)
    console.log(`[DNSE WS] Reconnecting in ${delay}ms...`)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connectDNSE()
    }, delay)
  }
}

export const marketStore = new MarketStore()

export function generateOrderBook(stock: Stock, seed = Math.random() * 1e9): OrderBook {
  const rnd = mulberry32((seed | 0) ^ hashStr(stock.symbol))
  const t = tickSize(stock.price)
  const asks: OrderRow[] = []
  const bids: OrderRow[] = []
  for (let i = 1; i <= 10; i++) {
    const askPrice = roundTick(stock.price + i * t)
    if (askPrice <= stock.ceiling)
      asks.push({ price: askPrice, volume: Math.floor(rnd() * 90000) + 500 })
    const bidPrice = roundTick(stock.price - (i - 1) * t)
    if (bidPrice >= stock.floor)
      bids.push({ price: bidPrice, volume: Math.floor(rnd() * 90000) + 500 })
  }
  return { asks: asks.reverse(), bids }
}

export function formatVolume(v: number): string {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + "M"
  if (v >= 1_000) return (v / 1_000).toFixed(1) + "K"
  return String(v)
}
export function formatPrice(p: number): string {
  return p.toFixed(2)
}
export function formatPct(p: number): string {
  return (p > 0 ? "+" : "") + p.toFixed(1) + "%"
}
export function formatSigned(n: number): string {
  return (n > 0 ? "+" : "") + n.toFixed(2)
}

export function trendColor(trend: Trend): string {
  switch (trend) {
    case "up":
      return "text-up"
    case "down":
      return "text-down"
    case "ceiling":
      return "text-ceiling"
    case "floor":
      return "text-[color:var(--color-cyan,#22b8cf)]"
    default:
      return "text-ref"
  }
}
