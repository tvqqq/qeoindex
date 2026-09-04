"use client"

import dynamic from "next/dynamic"
import { useCallback, useEffect, useRef, useState } from "react"
import { LoaderCircle, Radar, RefreshCw } from "lucide-react"

import type { WyckoffListItem, WyckoffTickerPayload } from "@/components/insights/wyckoff-chart-dashboard"
import { TopNav } from "@/components/top-nav"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import type { WyckoffChartTimeframe } from "@/modules/wyckoff/chart-model"

const WyckoffDailyWeeklyDashboard = dynamic(
  () => import("@/components/insights/wyckoff-daily-weekly-dashboard").then((module) => module.WyckoffDailyWeeklyDashboard),
  { ssr: false },
)

interface TickerResponse {
  ok: boolean
  data?: WyckoffTickerPayload
  error?: string
}

interface WatchlistResponse {
  ok: boolean
  stocks?: WyckoffListItem[]
}

export function WyckoffDeferredDashboard(props: {
  initialTicker: string
  initialTimeframe: WyckoffChartTimeframe
  initialStocks: WyckoffListItem[]
  generatedAt: string
}) {
  const [initialData, setInitialData] = useState<WyckoffTickerPayload | null>(null)
  const [stocks, setStocks] = useState(props.initialStocks)
  const [error, setError] = useState("")
  const [attempt, setAttempt] = useState(0)
  const selectedAbortRef = useRef<AbortController | null>(null)
  const watchlistAbortRef = useRef<AbortController | null>(null)

  const loadSelectedTicker = useCallback(async () => {
    selectedAbortRef.current?.abort()
    const controller = new AbortController()
    selectedAbortRef.current = controller
    setError("")
    try {
      const response = await fetch(`/api/insights/wyckoff?ticker=${encodeURIComponent(props.initialTicker)}`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      })
      const payload = await response.json() as TickerResponse
      if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error || `Không tải được dữ liệu Wyckoff ${props.initialTicker}`)
      if (!controller.signal.aborted) setInitialData(payload.data)
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Không tải được dữ liệu Wyckoff")
    } finally {
      if (selectedAbortRef.current === controller) selectedAbortRef.current = null
    }
  }, [props.initialTicker])

  useEffect(() => {
    void loadSelectedTicker()
    const frame = requestAnimationFrame(() => {
      watchlistAbortRef.current?.abort()
      const controller = new AbortController()
      watchlistAbortRef.current = controller
      void (async () => {
        try {
          const response = await fetch("/api/insights/wyckoff?mode=watchlist", { signal: controller.signal, headers: { Accept: "application/json" } })
          const payload = await response.json() as WatchlistResponse
          if (response.ok && payload.ok && Array.isArray(payload.stocks) && !controller.signal.aborted) setStocks(payload.stocks)
        } catch {
          // Canonical shell remains usable when phase hydration is temporarily unavailable.
        }
      })()
    })
    return () => {
      cancelAnimationFrame(frame)
      selectedAbortRef.current?.abort()
      watchlistAbortRef.current?.abort()
    }
  }, [attempt, loadSelectedTicker])

  if (initialData) {
    return (
      <WyckoffDailyWeeklyDashboard
        ticker={initialData.ticker}
        companyName={initialData.companyName}
        exchange={initialData.exchange}
        studies={initialData.studies}
        initialTimeframe={props.initialTimeframe}
        stocks={stocks}
        generatedAt={initialData.generatedAt}
        dataSource="Supabase unified"
      />
    )
  }

  return (
    <div className="min-h-screen bg-[#05080d] font-ticker text-slate-100">
      <TopNav />
      <main className="mx-auto max-w-[2000px] px-3 py-4 sm:px-4 lg:px-5 xl:px-6">
        <div className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
          <Card className="hidden h-[calc(100vh-76px)] min-h-[660px] gap-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#090e15] py-0 ring-0 xl:flex">
            <CardContent className="w-full p-4">
              <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
                <div><div className="text-base font-extrabold text-white">Wyckoff Watchlist</div><div className="mt-1 text-xs font-semibold text-slate-500">Daily + Weekly · {stocks.length} mã</div></div>
                <Radar className="size-5 text-cyan-300" />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs font-bold text-slate-500"><span>Mã</span><span className="text-center">1D</span><span className="text-center">1W</span></div>
              <div className="mt-2 space-y-1.5">
                {stocks.slice(0, 10).map((stock) => (
                  <div key={stock.ticker} className="grid h-10 grid-cols-3 items-center rounded-lg bg-white/[0.025] px-2 text-xs">
                    <strong className="text-slate-200">{stock.ticker}</strong><span className="text-center text-slate-600">—</span><span className="text-center text-slate-600">—</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="min-h-[560px] gap-0 rounded-2xl border border-white/[0.08] bg-[#0a1017] py-0 ring-0">
            <CardContent className="flex min-h-[560px] flex-col items-center justify-center p-6 text-center">
              {error ? (
                <><Radar className="size-10 text-rose-300" /><h1 className="mt-4 text-lg font-extrabold text-white">Không tải được Wyckoff {props.initialTicker}</h1><p className="mt-2 max-w-xl text-sm font-medium text-slate-400">{error}</p><Button type="button" variant="outline" className="mt-5" onClick={() => setAttempt((value) => value + 1)}><RefreshCw className="size-4" /> Thử lại</Button></>
              ) : (
                <><LoaderCircle className="size-9 animate-spin text-cyan-300" /><h1 className="mt-4 text-lg font-extrabold text-white">Đang tải Wyckoff {props.initialTicker}</h1><p className="mt-2 text-sm font-medium text-slate-500">Shell canonical {stocks.length} mã đã render · Daily/Weekly chart tải sau paint.</p></>
              )}
              <span className="mt-5 text-[11px] font-semibold text-slate-700">Universe {props.generatedAt.slice(0, 10)}</span>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
