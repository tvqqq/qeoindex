"use client"

import { BarChart3, RefreshCw } from "lucide-react"
import { useEffect, useState } from "react"
import { IndexChartContent } from "@/components/index-chart/index-chart-modal"
import { useIndexCandles } from "@/components/index-chart/use-index-candles"
import type { IndexChartResolution } from "@/modules/market/realtime/index-candles"

const TIME_FORMATTER = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
})

export function IndexChartWorkspace() {
  const [resolution, setResolution] = useState<IndexChartResolution>("1")
  const { candles, isLoading, isRefreshing, errors, generatedAt, lastLiveAt, refresh } = useIndexCandles(true, resolution)
  const [liveClock, setLiveClock] = useState(0)
  const isLive = lastLiveAt > 0 && liveClock >= lastLiveAt && liveClock - lastLiveAt < 20_000
  const hasAnyData = candles.VNINDEX.length > 0 || candles.VN30F1M.length > 0

  useEffect(() => {
    const updateClock = () => setLiveClock(Date.now())
    const initialTimer = window.setTimeout(updateClock, 0)
    const interval = window.setInterval(updateClock, 5_000)
    return () => {
      window.clearTimeout(initialTimer)
      window.clearInterval(interval)
    }
  }, [])

  return (
    <section
      data-market-board-index-chart
      aria-label="Biểu đồ realtime VN-Index và VN30F1M"
      className="flex h-full min-h-[480px] min-w-0 flex-col overflow-hidden border border-white/[0.08] bg-[#070a0e]"
    >
      <header className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] bg-[linear-gradient(110deg,rgba(34,201,138,0.07),rgba(8,12,16,0.96)_34%,rgba(168,85,247,0.055))] px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-400/25 bg-emerald-400/10 text-emerald-300">
            <BarChart3 className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-extrabold tracking-tight text-white sm:text-base">VN Market · Multi-timeframe</h2>
            <p className="mt-0.5 text-[10px] text-slate-500 sm:text-[11px]">
              VN-INDEX cơ sở và VN30F1M phái sinh · OHLCV DNSE
            </p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9.5px] font-bold sm:flex ${
            isLive
              ? "border-emerald-400/25 bg-emerald-400/8 text-emerald-300"
              : hasAnyData
                ? "border-cyan-400/20 bg-cyan-400/7 text-cyan-300"
                : "border-white/[0.1] bg-white/[0.035] text-slate-400"
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${isLive ? "animate-pulse bg-emerald-400" : "bg-slate-500"}`} />
            {isLive ? "DNSE LIVE" : hasAnyData ? "DNSE HISTORY" : "ĐANG KẾT NỐI"}
          </div>
          {generatedAt ? (
            <span className="hidden font-mono text-[9px] text-slate-600 lg:inline">{TIME_FORMATTER.format(new Date(generatedAt))}</span>
          ) : null}
          <button
            type="button"
            onClick={refresh}
            disabled={isRefreshing}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.09] bg-white/[0.035] text-slate-400 transition hover:border-cyan-400/25 hover:bg-cyan-400/8 hover:text-cyan-300 disabled:opacity-50"
            aria-label="Làm mới dữ liệu biểu đồ"
            title="Làm mới history snapshot"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>

      <IndexChartContent
        resolution={resolution}
        onResolutionChange={setResolution}
        candles={candles}
        isLoading={isLoading}
        errors={errors}
      />
    </section>
  )
}
