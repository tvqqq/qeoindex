// Realtime market data engine (client-simulated).
// Deterministic seeded initial data so server and client render identically,
// then a client-only ticker mutates prices and notifies per-symbol subscribers.

export type Trend = "up" | "down" | "ref" | "ceiling" | "floor"

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
  tickDir: 1 | -1 | 0 // last tick direction, for flash
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

// A few symbols shown at ceiling in the reference design.
const CEILING_SYMBOLS = new Set(["POM", "CRV", "FRT"])

// ---------- tick size (VN market style) ----------
function tickSize(price: number) {
  if (price < 10) return 0.01
  if (price < 50) return 0.05
  return 0.1
}
function roundTick(price: number) {
  const t = tickSize(price)
  return Math.round(price / t) * t
}

// ---------- build initial stocks ----------
function buildStock(symbol: string, group: string, base: number): Stock {
  const rnd = mulberry32(hashStr(group + ":" + symbol))
  const refPrice = roundTick(base)
  const ceiling = roundTick(refPrice * 1.07)
  const floor = roundTick(refPrice * 0.93)

  let price: number
  if (CEILING_SYMBOLS.has(symbol)) {
    price = ceiling
  } else {
    // initial change within roughly -2.5% .. +3%
    const pct = (rnd() - 0.45) * 0.06
    price = roundTick(refPrice * (1 + pct))
  }
  price = Math.min(ceiling, Math.max(floor, price))

  // seed a small history walking toward the current price
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

// ---------- store ----------
type Listener = () => void

class MarketStore {
  private stocks: Record<string, Stock> = {}
  private stockKeys: string[] = []
  private indices: MarketIndex[]
  private symSubs = new Map<string, Set<Listener>>()
  private indexSubs = new Set<Listener>()
  private timer: ReturnType<typeof setInterval> | null = null

  constructor() {
    for (const g of GROUPS) {
      for (const [symbol, base] of Object.entries(g.defs)) {
        const key = `${g.name}:${symbol}`
        this.stocks[key] = buildStock(symbol, g.name, base)
        this.stockKeys.push(key)
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

  private ensureRunning() {
    if (this.timer || typeof window === "undefined") return
    this.timer = setInterval(() => this.tick(), 650)
  }

  private tick() {
    const updates = 34
    const touched = new Set<string>()
    for (let i = 0; i < updates; i++) {
      const key = this.stockKeys[Math.floor(Math.random() * this.stockKeys.length)]
      this.mutate(key)
      touched.add(key)
    }
    touched.forEach((key) => this.symSubs.get(key)?.forEach((cb) => cb()))
    if (Math.random() < 0.6) this.updateIndices()
  }

  private mutate(key: string) {
    const s = this.stocks[key]
    if (!s) return
    if (CEILING_SYMBOLS.has(s.symbol) && Math.random() < 0.7) {
      // keep pinned to ceiling most of the time, just bump volume
      const next = { ...s, volume: s.volume + Math.floor(Math.random() * 20000), tickDir: 0 as const }
      this.stocks[key] = next
      return
    }
    const t = tickSize(s.price)
    const steps = Math.random() < 0.55 ? 1 : Math.random() < 0.85 ? 0 : 2
    const dir = Math.random() < 0.5 ? -1 : 1
    let price = roundTick(s.price + dir * steps * t)
    price = Math.min(s.ceiling, Math.max(s.floor, price))
    const tickDir: 1 | -1 | 0 = price > s.price ? 1 : price < s.price ? -1 : 0

    const history = s.history.slice(1)
    history.push(price)

    this.stocks[key] = finalize({
      ...s,
      price,
      history,
      tickDir,
      volume: s.volume + Math.floor(Math.random() * 60000),
      updatedAt: Date.now(),
    })
  }

  private updateIndices() {
    this.indices = this.indices.map((idx) => {
      const delta = (Math.random() - 0.48) * 0.6
      const value = Math.round((idx.value + delta) * 100) / 100
      const change = Math.round((idx.change + delta) * 100) / 100
      const changePct = Math.round((change / (value - change)) * 10000) / 100
      return { ...idx, value, change, changePct }
    })
    this.indexSubs.forEach((cb) => cb())
  }
}

// module singleton (one per runtime; deterministic initial state)
export const marketStore = new MarketStore()

// ---------- orderbook generation ----------
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

// ---------- formatting ----------
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
