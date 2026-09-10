"use client"

import React, { useCallback, useEffect, useRef, useState } from "react"

import { StockAiSidebar } from "./stock-ai-sidebar"
import { StockCompanyHeader } from "./stock-company-header"
import { adjacentWatchlistTicker, shouldIgnoreStockDetailShortcut } from "./stock-detail-shortcuts"
import { StockTradingViewChartData } from "./stock-tradingview-chart-data"
import { StockTabsPanel } from "./stock-tabs-panel"
import { StockWatchlistSidebar } from "./stock-watchlist-sidebar"
import type { ChartTimeframe } from "./chart/stock-chart-types"
import type { StockDetailData } from "./types"
import type { ChartTimeframeNavigationRequest } from "./stock-tradingview-chart-data"
import { TopNav } from "@/components/top-nav"
import { cn } from "@/modules/shared/ui/cn"

export function StockDetailWorkstation({ data: initialData }: { data: StockDetailData }) {
  const [currentData, setCurrentData] = useState<StockDetailData>(initialData)
  const [activeTicker, setActiveTicker] = useState<string>(initialData.ticker)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [chartNavigationTimeframe, setChartNavigationTimeframe] = useState<ChartTimeframeNavigationRequest | null>(null)

  const cacheRef = useRef<Record<string, StockDetailData>>({
    [initialData.ticker.toUpperCase()]: initialData,
  })
  const abortControllerRef = useRef<AbortController | null>(null)
  const centerColumnRef = useRef<HTMLElement>(null)
  const currentChartTimeframeRef = useRef<ChartTimeframe>("1D")
  const chartNavigationTimeframeRef = useRef<ChartTimeframeNavigationRequest | null>(null)
  const visibleWatchlistTickersRef = useRef<string[]>(initialData.watchlist.map((item) => item.ticker))

  const handleChartTimeframeChange = useCallback((timeframe: ChartTimeframe) => {
    currentChartTimeframeRef.current = timeframe
  }, [])

  const handleVisibleWatchlistChange = useCallback((tickers: string[]) => {
    const normalized = tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean)
    const previous = visibleWatchlistTickersRef.current
    if (previous.length === normalized.length && previous.every((ticker, index) => ticker === normalized[index])) return
    visibleWatchlistTickersRef.current = normalized
  }, [])

  const handleSelectTicker = useCallback(
    async (ticker: string) => {
      const sym = ticker.trim().toUpperCase()
      if (!sym || sym === activeTicker) return

      if (chartNavigationTimeframeRef.current && chartNavigationTimeframeRef.current.ticker !== sym) {
        chartNavigationTimeframeRef.current = null
        setChartNavigationTimeframe(null)
      }

      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }

      window.history.pushState(null, "", `/insights/${sym.toLowerCase()}`)
      document.title = `${sym} — Chi tiết Cổ phiếu — QeoIndex`
      setActiveTicker(sym)

      centerColumnRef.current?.scrollTo({ top: 0, behavior: "smooth" })

      if (cacheRef.current[sym]) {
        setCurrentData(cacheRef.current[sym])
        setIsTransitioning(false)
        return
      }

      setIsTransitioning(true)
      const controller = new AbortController()
      abortControllerRef.current = controller

      try {
        const response = await fetch(`/api/insights/stock-detail?ticker=${sym}`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        })

        if (!response.ok) {
          throw new Error(`Failed to load: ${response.statusText}`)
        }

        const json = await response.json()
        if (json.ok && json.data) {
          cacheRef.current[sym] = json.data
          setCurrentData(json.data)
        }
      } catch (err: unknown) {
        if ((err as Error)?.name !== "AbortError") {
          console.error("Error loading stock detail:", err)
        }
      } finally {
        setIsTransitioning(false)
      }
    },
    [activeTicker],
  )

  useEffect(() => {
    const handlePopState = () => {
      const parts = window.location.pathname.split("/").filter(Boolean)
      if (parts[0] === "insights" && parts[1]) {
        const sym = parts[1].toUpperCase()
        if (sym !== activeTicker) {
          handleSelectTicker(sym)
        }
      }
    }

    window.addEventListener("popstate", handlePopState)
    return () => window.removeEventListener("popstate", handlePopState)
  }, [activeTicker, handleSelectTicker])

  const [isChartMaximized, setIsChartMaximized] = useState(false)

  useEffect(() => {
    const handleChartShortcut = (event: KeyboardEvent) => {
      if (shouldIgnoreStockDetailShortcut(event)) return

      const isBackquote = event.key === "`" || event.code === "Backquote"
      if (isBackquote) {
        event.preventDefault()
        setIsChartMaximized((value) => !value)
        return
      }

      if (!isChartMaximized || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return

      const nextTicker = adjacentWatchlistTicker(
        visibleWatchlistTickersRef.current,
        activeTicker,
        event.key === "ArrowUp" ? "previous" : "next",
      )
      if (!nextTicker || nextTicker === activeTicker) return

      event.preventDefault()
      const navigationRequest = {
        ticker: nextTicker,
        timeframe: currentChartTimeframeRef.current,
      }
      chartNavigationTimeframeRef.current = navigationRequest
      setChartNavigationTimeframe(navigationRequest)
      void handleSelectTicker(nextTicker)
    }

    window.addEventListener("keydown", handleChartShortcut)
    return () => window.removeEventListener("keydown", handleChartShortcut)
  }, [activeTicker, currentData.watchlist, handleSelectTicker, isChartMaximized])

  return (
    <div
      data-qeo174-workstation
      className="min-h-screen w-full bg-[radial-gradient(circle_at_50%_-18%,rgba(99,102,241,0.14),transparent_34%),radial-gradient(circle_at_8%_42%,rgba(34,211,238,0.055),transparent_26%),linear-gradient(180deg,#05070a_0%,#03050a_100%)] text-slate-200 lg:h-screen lg:overflow-hidden flex flex-col"
    >
      <TopNav />

      <main className="w-full flex-1 px-2 py-2 sm:px-3 lg:px-4 2xl:px-5 lg:overflow-hidden min-h-0">
        <div
          className={cn(
            "grid grid-cols-1 gap-2.5 h-full lg:overflow-hidden items-stretch",
            isChartMaximized
              ? "lg:grid-cols-[minmax(0,1fr)_250px] xl:grid-cols-[minmax(0,1fr)_260px] 2xl:grid-cols-[minmax(0,1fr)_280px]"
              : "lg:grid-cols-[288px_minmax(0,1fr)_250px] xl:grid-cols-[318px_minmax(0,1fr)_260px] 2xl:grid-cols-[340px_minmax(0,1fr)_280px]",
          )}
        >
          {!isChartMaximized && (
            <aside className="w-full lg:h-full lg:overflow-y-auto no-scrollbar">
              <StockAiSidebar data={currentData} />
            </aside>
          )}

          <section
            ref={centerColumnRef}
            aria-busy={isTransitioning}
            className={cn(
              "relative min-w-0",
              isChartMaximized
                ? "flex flex-col overflow-hidden pb-0 pr-0 lg:h-full"
                : "space-y-2.5 lg:h-full lg:overflow-y-auto pr-1 pb-10",
            )}
          >
            {isTransitioning && (
              <div
                data-qeo173-transition-indicator
                className="pointer-events-none absolute right-2 top-2 z-50 flex items-center gap-1.5 rounded border border-white/[0.08] bg-[#0b1017]/90 px-2 py-1 font-mono text-[10px] tabular-nums text-slate-400"
              >
                <span className="size-1.5 animate-pulse rounded-full bg-cyan-300/80" />
                Đang tải {activeTicker}
              </div>
            )}

            {!isChartMaximized && <StockCompanyHeader data={currentData} />}

            <StockTradingViewChartData
              ticker={currentData.ticker}
              exchange={currentData.exchange}
              seedDailyBars={currentData.bars}
              isMaximized={isChartMaximized}
              onToggleMaximize={() => setIsChartMaximized((prev) => !prev)}
              currentPrice={currentData.price}
              changePct={currentData.changePct}
              navigationTimeframe={chartNavigationTimeframe}
              onTimeframeChange={handleChartTimeframeChange}
            />

            {!isChartMaximized && <StockTabsPanel data={currentData} />}
          </section>

          <aside className="w-full lg:h-full lg:overflow-hidden">
            <StockWatchlistSidebar
              currentTicker={activeTicker}
              items={currentData.watchlist}
              onSelectTicker={handleSelectTicker}
              onVisibleTickersChange={handleVisibleWatchlistChange}
              isTransitioning={isTransitioning}
            />
          </aside>
        </div>
      </main>
    </div>
  )
}
