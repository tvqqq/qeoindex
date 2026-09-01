"use client"

import { useMemo, useState, type MouseEvent } from "react"
import { BarChart3, Radar, Search, ShieldCheck, Target, TrendingDown, TrendingUp } from "lucide-react"

import { WyckoffLightweightChart } from "@/components/insights/wyckoff-lightweight-chart"
import type { WyckoffListItem, WyckoffTickerPayload } from "@/components/insights/wyckoff-chart-dashboard"
import { StockIdentity } from "@/components/stock-identity"
import { TopNav } from "@/components/top-nav"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import type { WyckoffChartStudy, WyckoffChartTimeframe } from "@/lib/wyckoff-chart-model"
import { cn } from "@/lib/utils"

interface TickerResponse {
  ok: boolean
  data?: WyckoffTickerPayload
  error?: string
}

type WatchlistStock = WyckoffListItem & { phase1D?: string; phase1W?: string }

function formatNumber(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "—"
  return value.toLocaleString("vi-VN", { maximumFractionDigits: digits })
}

function phaseFor(stock: WatchlistStock, timeframe: WyckoffChartTimeframe) {
  return timeframe === "1W" ? stock.phase1W || "" : stock.phase1D || stock.phase || ""
}

function phaseTone(phase: string) {
  const normalized = phase.toLowerCase()
  if (/accum|markup|spring|sos/.test(normalized)) return "text-emerald-300"
  if (/distrib|markdown|utad|sow/.test(normalized)) return "text-rose-300"
  return "text-slate-400"
}

function updateUrl(ticker: string, timeframe: WyckoffChartTimeframe) {
  if (typeof window === "undefined") return
  const url = new URL(window.location.href)
  url.searchParams.set("ticker", ticker)
  url.searchParams.set("timeframe", timeframe)
  window.history.replaceState(window.history.state, "", url)
}

function phaseLabel(study: WyckoffChartStudy | undefined) {
  return study?.analysis?.phase || "Unclassified"
}

export function WyckoffDailyWeeklyDashboard(props: {
  ticker: string
  companyName?: string
  exchange?: string | null
  studies: WyckoffChartStudy[]
  initialTimeframe: WyckoffChartTimeframe
  stocks: WatchlistStock[]
  generatedAt: string
  dataSource?: string
}) {
  const initialData: WyckoffTickerPayload = {
    ticker: props.ticker,
    companyName: props.companyName?.trim() || props.ticker,
    exchange: props.exchange?.trim() || "HOSE",
    studies: props.studies,
    generatedAt: props.generatedAt,
  }
  const [tickerData, setTickerData] = useState(initialData)
  const [activeTimeframe, setActiveTimeframe] = useState<WyckoffChartTimeframe>(props.initialTimeframe)
  const [query, setQuery] = useState("")
  const [loadingTicker, setLoadingTicker] = useState("")
  const [error, setError] = useState("")

  const activeStudy = useMemo(
    () => tickerData.studies.find((study) => study.timeframe === activeTimeframe) ?? tickerData.studies[0],
    [activeTimeframe, tickerData.studies],
  )
  const selectedStock = useMemo(() => props.stocks.find((stock) => stock.ticker === tickerData.ticker), [props.stocks, tickerData.ticker])
  const latest = activeStudy?.bars.at(-1)
  const filteredStocks = useMemo(() => {
    const normalized = query.trim().toUpperCase()
    if (!normalized) return props.stocks
    return props.stocks.filter((stock) => `${stock.ticker} ${stock.sector} ${stock.phase1D || ""} ${stock.phase1W || ""}`.toUpperCase().includes(normalized))
  }, [props.stocks, query])

  async function selectTicker(event: MouseEvent<HTMLAnchorElement>, ticker: string) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    if (ticker === tickerData.ticker || loadingTicker) return
    setLoadingTicker(ticker)
    setError("")
    try {
      const response = await fetch(`/api/insights/wyckoff?ticker=${encodeURIComponent(ticker)}`, { headers: { Accept: "application/json" } })
      const payload = await response.json() as TickerResponse
      if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error || `Không tải được ${ticker}`)
      setTickerData(payload.data)
      updateUrl(payload.data.ticker, activeTimeframe)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Không tải được ${ticker}`)
    } finally {
      setLoadingTicker("")
    }
  }

  function chooseTimeframe(timeframe: WyckoffChartTimeframe) {
    setActiveTimeframe(timeframe)
    updateUrl(tickerData.ticker, timeframe)
  }

  return (
    <div className="min-h-screen bg-[#05080d] font-ticker text-slate-100">
      <TopNav />
      <main className="mx-auto max-w-[2000px] px-3 py-4 sm:px-4 lg:px-5 xl:px-6">
        <div className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
          <Card className="h-[calc(100vh-76px)] min-h-[640px] gap-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#090e15] py-0 ring-0 xl:sticky xl:top-3.5">
            <CardHeader className="border-b border-white/[0.07] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-lg font-extrabold text-white">Wyckoff Watchlist</CardTitle>
                  <p className="mt-1 text-xs font-semibold text-slate-500">Daily + Weekly · {props.stocks.length} mã</p>
                </div>
                <Radar className="size-5 text-cyan-300" />
              </div>
              <div className="relative mt-3">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-600" />
                <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm mã hoặc Phase..." className="h-9 border-white/[0.08] bg-[#05080e] pl-9" />
              </div>
              {error ? <p className="mt-2 text-xs font-semibold text-rose-300">{error}</p> : null}
            </CardHeader>
            <div className="grid grid-cols-[72px_1fr_1fr] border-b border-white/[0.05] text-[11px] font-extrabold uppercase tracking-[0.06em] text-slate-500">
              <div className="px-3 py-2.5">Mã</div>
              <div className="border-l border-white/[0.05] px-2 py-2.5 text-center text-sky-300">1D</div>
              <div className="border-l border-white/[0.05] px-2 py-2.5 text-center text-violet-300">1W</div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {filteredStocks.map((stock) => {
                const active = stock.ticker === tickerData.ticker
                return (
                  <a
                    key={stock.ticker}
                    href={`/insights/wyckoff?ticker=${encodeURIComponent(stock.ticker)}&timeframe=${activeTimeframe}`}
                    onClick={(event) => void selectTicker(event, stock.ticker)}
                    className={cn(
                      "grid min-h-12 grid-cols-[72px_1fr_1fr] items-stretch border-b border-white/[0.04] transition-colors hover:bg-white/[0.03]",
                      active && "bg-cyan-400/[0.07]",
                    )}
                  >
                    <div className="flex items-center px-3 text-sm font-extrabold text-white">{stock.ticker}</div>
                    <div className={cn("flex items-center justify-center border-l border-white/[0.05] px-2 text-center text-[11px] font-bold", phaseTone(phaseFor(stock, "1D")))}>{phaseFor(stock, "1D") || "—"}</div>
                    <div className={cn("flex items-center justify-center border-l border-white/[0.05] px-2 text-center text-[11px] font-bold", phaseTone(phaseFor(stock, "1W")))}>{phaseFor(stock, "1W") || "—"}</div>
                  </a>
                )
              })}
            </div>
          </Card>

          <div className="min-w-0 space-y-4">
            <Card className="gap-0 rounded-2xl border border-white/[0.08] bg-[#0a1017] py-0 ring-0">
              <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5">
                <StockIdentity ticker={tickerData.ticker} companyName={tickerData.companyName} exchange={tickerData.exchange} detail={selectedStock?.sector || tickerData.sector || ""} logoSize={44} />
                <div className="text-right">
                  <div className="text-xs font-semibold text-slate-500">Giá đóng cửa</div>
                  <div className="mt-1 text-2xl font-extrabold tabular-nums text-white">{formatNumber(latest?.close ?? selectedStock?.price)}</div>
                  <div className="mt-1 text-xs font-semibold text-slate-500">{props.dataSource || "Supabase unified"} · {tickerData.generatedAt.slice(0, 10)}</div>
                </div>
              </CardContent>
            </Card>

            <Card className="gap-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#080c12] py-0 ring-0">
              <CardHeader className="border-b border-white/[0.06] px-4 py-4 sm:px-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2"><BarChart3 className="size-4 text-cyan-300" /><CardTitle className="text-base font-extrabold">Price × Volume × Wyckoff</CardTitle></div>
                  <div className="flex gap-1 rounded-lg border border-white/[0.07] bg-white/[0.025] p-1">
                    {(["1D", "1W"] as const).map((timeframe) => (
                      <Button key={timeframe} type="button" size="sm" variant="ghost" onClick={() => chooseTimeframe(timeframe)} className={cn("h-8 min-w-12 text-xs font-extrabold", activeTimeframe === timeframe && "bg-cyan-400/[0.12] text-cyan-200")}>{timeframe}</Button>
                    ))}
                  </div>
                </div>
              </CardHeader>
              {activeStudy ? <WyckoffLightweightChart ticker={tickerData.ticker} study={activeStudy} loading={Boolean(loadingTicker)} showIntelligence={false} showScenarios={false} /> : null}
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="gap-0 rounded-2xl border border-cyan-400/15 bg-[#0a1017] py-0 ring-0">
                <CardHeader className="border-b border-white/[0.06] p-4"><div className="flex items-center gap-2"><Radar className="size-4 text-cyan-300" /><CardTitle className="text-base">Cấu trúc {activeTimeframe}</CardTitle></div></CardHeader>
                <CardContent className="space-y-3 p-4">
                  <div className={cn("text-lg font-extrabold", phaseTone(phaseLabel(activeStudy)))}>{phaseLabel(activeStudy)}</div>
                  <p className="text-sm font-medium leading-6 text-slate-300">{activeStudy?.phaseGuide.now || "Chưa đủ dữ liệu để phân loại."}</p>
                  <p className="text-xs font-semibold leading-5 text-slate-500"><strong className="text-slate-300">Cần nhìn tiếp:</strong> {activeStudy?.phaseGuide.next || "—"}</p>
                </CardContent>
              </Card>

              <Card className="gap-0 rounded-2xl border border-amber-400/15 bg-[#0a1017] py-0 ring-0">
                <CardHeader className="border-b border-white/[0.06] p-4"><div className="flex items-center gap-2"><Target className="size-4 text-amber-300" /><CardTitle className="text-base">Decision levels</CardTitle></div></CardHeader>
                <CardContent className="grid gap-3 p-4 sm:grid-cols-2">
                  <div className="rounded-xl border border-emerald-400/15 bg-emerald-400/[0.04] p-3"><div className="flex items-center gap-2 text-xs font-bold text-emerald-300"><TrendingUp className="size-3.5" />Support</div><div className="mt-2 text-sm font-extrabold text-white">{activeStudy?.analysis?.support || "—"}</div></div>
                  <div className="rounded-xl border border-rose-400/15 bg-rose-400/[0.04] p-3"><div className="flex items-center gap-2 text-xs font-bold text-rose-300"><TrendingDown className="size-3.5" />Resistance</div><div className="mt-2 text-sm font-extrabold text-white">{activeStudy?.analysis?.resistance || "—"}</div></div>
                  <div className="sm:col-span-2 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 text-xs font-medium leading-5 text-slate-400"><strong className="text-rose-300">Invalidation:</strong> {activeStudy?.analysis?.invalidation || activeStudy?.phaseGuide.risk || "—"}</div>
                </CardContent>
              </Card>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-xs font-semibold text-slate-500">
              <span className="inline-flex items-center gap-2"><ShieldCheck className="size-4 text-cyan-400" />Wyckoff operational contract chỉ dùng nến đã đóng ở 1D và 1W; 1W được aggregate từ raw 1D.</span>
              <Badge variant="outline" className="border-white/[0.08] text-slate-400">{activeStudy?.provider || "—"}</Badge>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
