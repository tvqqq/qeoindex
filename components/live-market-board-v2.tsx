"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Activity, ChartNoAxesCombined, CircleAlert, LayoutGrid, RefreshCw, Search, Wifi, WifiOff } from "lucide-react"
import { SECTOR_ORDER } from "@/lib/market-sectors"
import { useOrderBooks } from "@/components/orderbook/orderbook-context"
import { LiveMoverCard, LiveStockRow, boardPctClass, formatBoardPrice, type LiveBoardStock, type LiveStockQuote } from "@/components/live-market-stock"

export type BoardUniverseStock = LiveBoardStock

type IndexQuote = { symbol: string; value: number; change?: number; changePercent: number; updatedAt: string }
type QuotePayload = { ok: boolean; state: "LIVE" | "AUTH_REQUIRED"; quotes?: Record<string, LiveStockQuote | IndexQuote>; generatedAt?: string; connectUrl?: string }
type BoardMode = "sector" | "movers"

const INDEXES = ["VNINDEX", "VN30", "HNXINDEX", "UPCOMINDEX"]
const INDEX_LABELS: Record<string, string> = { VNINDEX: "VN-INDEX", VN30: "VN30", HNXINDEX: "HNX-INDEX", UPCOMINDEX: "UPCOM-INDEX" }

function compareByPerformance(a: BoardUniverseStock, b: BoardUniverseStock, quotes: Record<string, LiveStockQuote | IndexQuote>) {
  const aq = quotes[a.ticker] as LiveStockQuote | undefined
  const bq = quotes[b.ticker] as LiveStockQuote | undefined
  if (aq && bq) {
    if (bq.changePercent !== aq.changePercent) return bq.changePercent - aq.changePercent
    if (bq.volume && aq.volume && bq.volume !== aq.volume) return bq.volume - aq.volume
    return a.rank - b.rank
  }
  if (aq) return -1
  if (bq) return 1
  return a.rank - b.rank
}

function IndexStrip({ quotes }: { quotes: Record<string, LiveStockQuote | IndexQuote> }) {
  return <div className="grid grid-cols-2 gap-px border-b border-border bg-border md:grid-cols-4">
    {INDEXES.map((symbol) => {
      const quote = quotes[symbol] as IndexQuote | undefined
      const color = boardPctClass(quote?.changePercent)
      return <div key={symbol} className="bg-panel px-4 py-2.5">
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">{INDEX_LABELS[symbol]}</div>
        <div className="mt-0.5 flex items-baseline gap-2">
          <span className={`font-mono text-sm font-bold ${quote ? color : "text-muted-2"}`}>{formatBoardPrice(quote?.value)}</span>
          {quote ? <span className={`font-mono text-xs ${color}`}>{quote.changePercent > 0 ? "+" : ""}{quote.changePercent.toFixed(2)}%</span> : null}
        </div>
      </div>
    })}
  </div>
}

export function LiveMarketBoardV2({ universe, universeSource }: { universe: BoardUniverseStock[]; universeSource: "notion" | "fallback" }) {
  const { open: openOrderBook } = useOrderBooks()
  const [payload, setPayload] = useState<QuotePayload>({ ok: false, state: "AUTH_REQUIRED" })
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [selectedSector, setSelectedSector] = useState("Tất cả")
  const [lastFetch, setLastFetch] = useState("")
  const [mode, setMode] = useState<BoardMode>("sector")
  const [priceHistory, setPriceHistory] = useState<Record<string, number[]>>({})
  const symbols = useMemo(() => universe.map((stock) => stock.ticker).join(","), [universe])

  const mergeSparkHistory = useCallback((liveQuotes: Record<string, LiveStockQuote | IndexQuote>) => {
    setPriceHistory((previous) => {
      const next = { ...previous }
      let changed = false
      for (const stock of universe) {
        const quote = liveQuotes[stock.ticker] as LiveStockQuote | undefined
        if (!quote || !Number.isFinite(quote.price) || quote.price <= 0) continue
        const baseline = quote.reference ?? stock.lastClose ?? quote.price
        let series = next[stock.ticker] ?? [baseline]
        if (series.at(-1) !== quote.price || series.length < 2) {
          series = [...series, quote.price].slice(-36)
          next[stock.ticker] = series
          changed = true
        }
      }
      return changed ? next : previous
    })
  }, [universe])

  const fetchQuotes = useCallback(async () => {
    try {
      const response = await fetch(`/api/finhay/quote?symbols=${encodeURIComponent(symbols)}&indexes=${INDEXES.join(",")}`, { cache: "no-store" })
      const json = await response.json()
      if (response.status === 401) setPayload({ ok: false, state: "AUTH_REQUIRED", connectUrl: json.connectUrl ?? "/api/finhay/auth/start" })
      else {
        setPayload(json)
        setLastFetch(json.generatedAt ?? new Date().toISOString())
        if (json.quotes) mergeSparkHistory(json.quotes)
      }
    } catch {
      setPayload((current) => ({ ...current, ok: false }))
    } finally {
      setLoading(false)
    }
  }, [symbols, mergeSparkHistory])

  useEffect(() => {
    fetchQuotes()
    const timer = window.setInterval(fetchQuotes, 15_000)
    return () => window.clearInterval(timer)
  }, [fetchQuotes])

  const quotes = payload.quotes ?? {}
  const normalizedQuery = query.trim().toUpperCase()
  const filtered = useMemo(() => universe.filter((stock) => (!normalizedQuery || stock.ticker.includes(normalizedQuery)) && (selectedSector === "Tất cả" || stock.sector === selectedSector)), [universe, normalizedQuery, selectedSector])
  const movers = useMemo(() => [...filtered].sort((a, b) => compareByPerformance(a, b, quotes)), [filtered, quotes])
  const grouped = useMemo(() => SECTOR_ORDER.map((sector) => ({ sector, stocks: filtered.filter((stock) => stock.sector === sector).sort((a, b) => compareByPerformance(a, b, quotes)) })).filter((group) => group.stocks.length), [filtered, quotes])

  const liveCount = universe.filter((stock) => quotes[stock.ticker]).length
  const advances = universe.filter((stock) => (quotes[stock.ticker] as LiveStockQuote | undefined)?.changePercent > 0).length
  const declines = universe.filter((stock) => (quotes[stock.ticker] as LiveStockQuote | undefined)?.changePercent < 0).length
  const openBook = useCallback((ticker: string) => openOrderBook(`board:${ticker}`, ticker), [openOrderBook])

  return <div className="flex h-full min-h-0 flex-col bg-background">
    <IndexStrip quotes={quotes} />
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-panel px-3 py-2.5">
      <div className="relative min-w-[210px] flex-1 md:max-w-[320px]">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm mã trong Top 50..." className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-3 text-xs text-foreground outline-none focus:border-muted" />
      </div>
      <select value={selectedSector} onChange={(event) => setSelectedSector(event.target.value)} className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none">
        <option>Tất cả</option>{SECTOR_ORDER.map((sector) => <option key={sector}>{sector}</option>)}
      </select>
      <div className="flex items-center rounded-md border border-border bg-background p-0.5">
        <button type="button" onClick={() => setMode("sector")} className={`flex h-7 items-center gap-1.5 rounded px-2 text-[11px] font-medium ${mode === "sector" ? "bg-panel-2 text-foreground" : "text-muted-2"}`}><LayoutGrid className="h-3.5 w-3.5" /> Theo ngành</button>
        <button type="button" onClick={() => setMode("movers")} className={`flex h-7 items-center gap-1.5 rounded px-2 text-[11px] font-medium ${mode === "movers" ? "bg-panel-2 text-foreground" : "text-muted-2"}`}><ChartNoAxesCombined className="h-3.5 w-3.5" /> Top movers</button>
      </div>
      <div className="ml-auto flex items-center gap-3 text-[11px]">
        {payload.state === "LIVE" ? <span className="flex items-center gap-1.5 text-up"><Wifi className="h-3.5 w-3.5" /> Finhay Live · {liveCount}/50</span> : <a href={payload.connectUrl ?? "/api/finhay/auth/start"} className="flex items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1.5 font-semibold text-background"><WifiOff className="h-3.5 w-3.5" /> Kết nối Finhay</a>}
        <button type="button" onClick={fetchQuotes} className="rounded-md border border-border p-1.5 text-muted-2 hover:text-foreground" aria-label="Làm mới dữ liệu"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /></button>
      </div>
    </div>

    {payload.state !== "LIVE" ? <div className="flex items-start gap-2 border-b border-warning/30 bg-warning/5 px-4 py-2.5 text-xs text-foreground"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" /><span>Bảng điện không hiển thị giá giả. Hãy kết nối Finhay để nhận giá realtime; giá Close gần nhất chỉ dùng làm tham chiếu.</span></div> : null}

    <div className="flex items-center gap-4 border-b border-border px-4 py-2 text-[11px] text-muted-2">
      <span className="flex items-center gap-1.5"><Activity className="h-3.5 w-3.5" /> {universeSource === "notion" ? "Top 50 HOSE từ Notion" : "Top 50 fallback snapshot"}</span>
      <span>Tăng <b className="text-up">{advances}</b></span><span>Giảm <b className="text-down">{declines}</b></span><span>Đang có giá <b className="text-foreground">{liveCount}</b>/50</span><span className="hidden sm:inline">Tự xếp hạng theo % thay đổi</span>
      {lastFetch ? <span className="ml-auto">Cập nhật {new Date(lastFetch).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span> : null}
    </div>

    <div className="min-h-0 flex-1 overflow-auto p-2.5">
      {mode === "sector" ? <div className="grid auto-cols-[330px] grid-flow-col gap-2.5">
        {grouped.map(({ sector, stocks }) => {
          const sectorQuotes = stocks.map((stock) => quotes[stock.ticker] as LiveStockQuote | undefined).filter(Boolean) as LiveStockQuote[]
          const avg = sectorQuotes.length ? sectorQuotes.reduce((sum, quote) => sum + quote.changePercent, 0) / sectorQuotes.length : undefined
          return <section key={sector} className="flex max-h-full min-h-[240px] flex-col rounded-lg border border-border bg-panel">
            <header className="flex items-center justify-between border-b border-border px-3 py-2.5"><div><h2 className="text-sm font-semibold text-foreground">{sector}</h2><p className="mt-0.5 text-[10px] text-muted-2">{stocks.length} mã · xếp theo %</p></div><span className={`font-mono text-xs font-semibold ${boardPctClass(avg)}`}>{typeof avg === "number" ? `${avg > 0 ? "+" : ""}${avg.toFixed(2)}%` : "—"}</span></header>
            <div className="flex-1 overflow-y-auto p-1.5">{stocks.map((stock) => <LiveStockRow key={stock.ticker} stock={stock} quote={quotes[stock.ticker] as LiveStockQuote | undefined} history={priceHistory[stock.ticker] ?? []} onOpen={() => openBook(stock.ticker)} />)}</div>
          </section>
        })}
      </div> : <div className="mx-auto grid max-w-[1500px] grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">{movers.map((stock) => <LiveMoverCard key={stock.ticker} stock={stock} quote={quotes[stock.ticker] as LiveStockQuote | undefined} history={priceHistory[stock.ticker] ?? []} onOpen={() => openBook(stock.ticker)} />)}</div>}
    </div>
  </div>
}
