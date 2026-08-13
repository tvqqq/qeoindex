"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Activity, CircleAlert, RefreshCw, Search, Wifi, WifiOff } from "lucide-react"
import { SECTOR_ORDER } from "@/lib/market-sectors"

export interface BoardUniverseStock {
  ticker: string
  rank: number
  sector: string
  marketCapT: number
  lastClose?: number | null
  lastCloseDate?: string
}

type StockQuote = {
  symbol: string
  price: number
  reference?: number
  ceiling?: number
  floor?: number
  change?: number
  changePercent: number
  volume?: number
  updatedAt: string
}

type IndexQuote = {
  symbol: string
  value: number
  change?: number
  changePercent: number
  updatedAt: string
}

type QuotePayload = {
  ok: boolean
  state: "LIVE" | "AUTH_REQUIRED"
  provider?: string
  quotes?: Record<string, StockQuote | IndexQuote>
  errors?: Array<{ symbol: string; error: string }>
  generatedAt?: string
  connectUrl?: string
}

const INDEXES = ["VNINDEX", "VN30", "HNXINDEX", "UPCOMINDEX"]
const INDEX_LABELS: Record<string, string> = {
  VNINDEX: "VN-INDEX",
  VN30: "VN30",
  HNXINDEX: "HNX-INDEX",
  UPCOMINDEX: "UPCOM-INDEX",
}

function formatPrice(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "—"
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(value)
}

function formatVolume(value?: number) {
  if (!value || value <= 0) return "—"
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 1 : 2)}tr`
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}k`
  return value.toLocaleString("vi-VN")
}

function pctClass(value?: number) {
  if (typeof value !== "number") return "text-muted-2"
  if (value > 0) return "text-up"
  if (value < 0) return "text-down"
  return "text-ref"
}

function trendLabel(quote?: StockQuote) {
  if (!quote) return ""
  if (quote.ceiling && quote.price >= quote.ceiling) return "Trần"
  if (quote.floor && quote.price <= quote.floor) return "Sàn"
  if (quote.changePercent > 0) return "Tăng"
  if (quote.changePercent < 0) return "Giảm"
  return "TC"
}

function StockRow({ stock, quote }: { stock: BoardUniverseStock; quote?: StockQuote }) {
  const color = pctClass(quote?.changePercent)
  return (
    <Link
      href={`/research/${stock.ticker.toLowerCase()}`}
      className="grid grid-cols-[56px_1fr_66px] items-center gap-2 rounded-md border border-transparent px-2 py-2 transition-colors hover:border-border hover:bg-panel-2/70"
    >
      <div>
        <div className="font-mono text-[13px] font-bold text-foreground">{stock.ticker}</div>
        <div className="text-[10px] text-muted-2">#{stock.rank}</div>
      </div>
      <div className="min-w-0">
        <div className="flex items-baseline gap-1.5">
          <span className={`font-mono text-[13px] font-semibold ${quote ? color : "text-muted-2"}`}>
            {formatPrice(quote?.price)}
          </span>
          {quote ? (
            <span className={`font-mono text-[11px] ${color}`}>
              {quote.changePercent > 0 ? "+" : ""}{quote.changePercent.toFixed(2)}%
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-2">
          <span>KL {formatVolume(quote?.volume)}</span>
          {!quote && stock.lastClose ? <span>Close {formatPrice(stock.lastClose)}</span> : null}
        </div>
      </div>
      <div className="text-right">
        <span className={`text-[10px] font-medium ${quote ? color : "text-muted"}`}>{quote ? trendLabel(quote) : "Chờ live"}</span>
      </div>
    </Link>
  )
}

function IndexStrip({ quotes }: { quotes: Record<string, StockQuote | IndexQuote> }) {
  return (
    <div className="grid grid-cols-2 gap-px border-b border-border bg-border md:grid-cols-4">
      {INDEXES.map((symbol) => {
        const quote = quotes[symbol] as IndexQuote | undefined
        const color = pctClass(quote?.changePercent)
        return (
          <div key={symbol} className="bg-panel px-4 py-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">{INDEX_LABELS[symbol]}</div>
            <div className="mt-0.5 flex items-baseline gap-2">
              <span className={`font-mono text-sm font-bold ${quote ? color : "text-muted-2"}`}>{formatPrice(quote?.value)}</span>
              {quote ? <span className={`font-mono text-xs ${color}`}>{quote.changePercent > 0 ? "+" : ""}{quote.changePercent.toFixed(2)}%</span> : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function LiveMarketBoard({ universe, universeSource }: { universe: BoardUniverseStock[]; universeSource: "notion" | "fallback" }) {
  const [payload, setPayload] = useState<QuotePayload>({ ok: false, state: "AUTH_REQUIRED" })
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [selectedSector, setSelectedSector] = useState<string>("Tất cả")
  const [lastFetch, setLastFetch] = useState<string>("")

  const symbols = useMemo(() => universe.map((stock) => stock.ticker).join(","), [universe])
  const fetchQuotes = useCallback(async () => {
    try {
      const response = await fetch(`/api/finhay/quote?symbols=${encodeURIComponent(symbols)}&indexes=${INDEXES.join(",")}`, { cache: "no-store" })
      const json = await response.json()
      if (response.status === 401) {
        setPayload({ ok: false, state: "AUTH_REQUIRED", connectUrl: json.connectUrl ?? "/api/finhay/auth/start" })
      } else {
        setPayload(json)
        setLastFetch(json.generatedAt ?? new Date().toISOString())
      }
    } catch {
      setPayload((current) => ({ ...current, ok: false }))
    } finally {
      setLoading(false)
    }
  }, [symbols])

  useEffect(() => {
    fetchQuotes()
    const timer = window.setInterval(fetchQuotes, 15_000)
    return () => window.clearInterval(timer)
  }, [fetchQuotes])

  const quotes = payload.quotes ?? {}
  const grouped = useMemo(() => {
    const normalizedQuery = query.trim().toUpperCase()
    return SECTOR_ORDER.map((sector) => {
      const stocks = universe.filter((stock) => stock.sector === sector && (!normalizedQuery || stock.ticker.includes(normalizedQuery)))
      return { sector, stocks }
    }).filter((group) => group.stocks.length > 0 && (selectedSector === "Tất cả" || group.sector === selectedSector))
  }, [universe, query, selectedSector])

  const liveCount = universe.filter((stock) => quotes[stock.ticker]).length
  const advances = universe.filter((stock) => (quotes[stock.ticker] as StockQuote | undefined)?.changePercent > 0).length
  const declines = universe.filter((stock) => (quotes[stock.ticker] as StockQuote | undefined)?.changePercent < 0).length

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <IndexStrip quotes={quotes} />

      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-panel px-3 py-2.5">
        <div className="relative min-w-[210px] flex-1 md:max-w-[320px]">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Tìm mã trong Top 50..."
            className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-3 text-xs text-foreground outline-none focus:border-muted"
          />
        </div>
        <select
          value={selectedSector}
          onChange={(event) => setSelectedSector(event.target.value)}
          className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none"
        >
          <option>Tất cả</option>
          {SECTOR_ORDER.map((sector) => <option key={sector}>{sector}</option>)}
        </select>

        <div className="ml-auto flex items-center gap-3 text-[11px]">
          {payload.state === "LIVE" ? (
            <span className="flex items-center gap-1.5 text-up"><Wifi className="h-3.5 w-3.5" /> Finhay Live · {liveCount}/50</span>
          ) : (
            <a href={payload.connectUrl ?? "/api/finhay/auth/start"} className="flex items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1.5 font-semibold text-background">
              <WifiOff className="h-3.5 w-3.5" /> Kết nối Finhay
            </a>
          )}
          <button type="button" onClick={fetchQuotes} className="rounded-md border border-border p-1.5 text-muted-2 hover:text-foreground" aria-label="Làm mới dữ liệu">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {payload.state !== "LIVE" ? (
        <div className="flex items-start gap-2 border-b border-warning/30 bg-warning/5 px-4 py-2.5 text-xs text-foreground">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>Bảng điện không hiển thị giá giả. Hãy kết nối Finhay để nhận giá realtime; giá Close gần nhất chỉ được dùng làm tham chiếu phụ.</span>
        </div>
      ) : null}

      <div className="flex items-center gap-4 border-b border-border px-4 py-2 text-[11px] text-muted-2">
        <span className="flex items-center gap-1.5"><Activity className="h-3.5 w-3.5" /> {universeSource === "notion" ? "Top 50 HOSE từ Notion" : "Top 50 fallback snapshot"}</span>
        <span>Tăng <b className="text-up">{advances}</b></span>
        <span>Giảm <b className="text-down">{declines}</b></span>
        <span>Đang có giá <b className="text-foreground">{liveCount}</b>/50</span>
        {lastFetch ? <span className="ml-auto">Cập nhật {new Date(lastFetch).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span> : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2.5">
        <div className="grid auto-cols-[250px] grid-flow-col gap-2.5">
          {grouped.map(({ sector, stocks }) => {
            const sectorQuotes = stocks.map((stock) => quotes[stock.ticker] as StockQuote | undefined).filter(Boolean) as StockQuote[]
            const avg = sectorQuotes.length ? sectorQuotes.reduce((sum, quote) => sum + quote.changePercent, 0) / sectorQuotes.length : undefined
            return (
              <section key={sector} className="flex max-h-full min-h-[240px] flex-col rounded-lg border border-border bg-panel">
                <header className="flex items-center justify-between border-b border-border px-3 py-2.5">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">{sector}</h2>
                    <p className="mt-0.5 text-[10px] text-muted-2">{stocks.length} mã Top 50</p>
                  </div>
                  <span className={`font-mono text-xs font-semibold ${pctClass(avg)}`}>
                    {typeof avg === "number" ? `${avg > 0 ? "+" : ""}${avg.toFixed(2)}%` : "—"}
                  </span>
                </header>
                <div className="flex-1 overflow-y-auto p-1.5">
                  {stocks.map((stock) => <StockRow key={stock.ticker} stock={stock} quote={quotes[stock.ticker] as StockQuote | undefined} />)}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
