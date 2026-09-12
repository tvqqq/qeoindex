"use client"

import React, { useCallback, useEffect, useRef, useState } from "react"

import { StockAiSidebar } from "./stock-ai-sidebar"
import { StockCompanyHeader } from "./stock-company-header"
import { adjacentWatchlistTicker, shouldIgnoreStockDetailShortcut } from "./stock-detail-shortcuts"
import { StockTradingViewChartData } from "./stock-tradingview-chart-data"
import { StockTabsPanel } from "./stock-tabs-panel"
import tabRailStyles from "./stock-tabs-panel.module.css"
import { StockWatchlistSidebar } from "./stock-watchlist-sidebar"
import {
  adjacentPrefetchTargets,
  prefetchInitialStableChartHistory,
  prepareInitialChartHistory,
  type PreparedChartHistory,
} from "./chart/chart-history"
import type { ChartTimeframe } from "./chart/stock-chart-types"
import type { StockDetailData } from "./types"
import type { ChartTimeframeNavigationRequest } from "./stock-tradingview-chart-data"
import { TopNav } from "@/components/top-nav"
import { cn } from "@/modules/shared/ui/cn"

type NavigationHistoryMode = "push" | "none"

export function StockDetailWorkstation({ data: initialData }: { data: StockDetailData }) {
  const [currentData, setCurrentData] = useState<StockDetailData>(initialData)
  const [activeTicker, setActiveTicker] = useState<string>(initialData.ticker)
  const [pendingTicker, setPendingTicker] = useState<string | null>(null)
  const [chartNavigationTimeframe, setChartNavigationTimeframe] = useState<ChartTimeframeNavigationRequest | null>(null)
  const [preparedChartInitial, setPreparedChartInitial] = useState<PreparedChartHistory | null>(null)
  const [currentChartTimeframe, setCurrentChartTimeframe] = useState<ChartTimeframe>("1D")
  const [prefetchRevision, setPrefetchRevision] = useState(0)
  const isTransitioning = pendingTicker !== null

  const cacheRef = useRef<Record<string, StockDetailData>>({
    [initialData.ticker.toUpperCase()]: initialData,
  })
  const inFlightStockDetailRef = useRef(new Map<string, Promise<StockDetailData>>())
  const navigationAbortControllerRef = useRef<AbortController | null>(null)
  const navigationGenerationRef = useRef(0)
  const centerColumnRef = useRef<HTMLElement>(null)
  const currentChartTimeframeRef = useRef<ChartTimeframe>("1D")
  const chartNavigationTimeframeRef = useRef<ChartTimeframeNavigationRequest | null>(null)
  const visibleWatchlistTickersRef = useRef<string[]>(initialData.watchlist.map((item) => item.ticker.toUpperCase()))

  const getStockDetail = useCallback((ticker: string) => {
    const sym = ticker.trim().toUpperCase()
    const cached = cacheRef.current[sym]
    if (cached) return Promise.resolve(cached)
    const existing = inFlightStockDetailRef.current.get(sym)
    if (existing) return existing

    const request = fetch(`/api/insights/stock-detail?ticker=${encodeURIComponent(sym)}`, {
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Failed to load ${sym}: ${response.statusText}`)
        const json = await response.json()
        if (!json.ok || !json.data) throw new Error(`Stock detail response missing data for ${sym}`)
        const data = json.data as StockDetailData
        cacheRef.current[sym] = data
        return data
      })
      .finally(() => {
        inFlightStockDetailRef.current.delete(sym)
      })

    inFlightStockDetailRef.current.set(sym, request)
    return request
  }, [])

  const handleChartTimeframeChange = useCallback((timeframe: ChartTimeframe) => {
    currentChartTimeframeRef.current = timeframe
    setCurrentChartTimeframe(timeframe)
  }, [])

  const handleVisibleWatchlistChange = useCallback((tickers: string[]) => {
    const normalized = tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean)
    const previous = visibleWatchlistTickersRef.current
    if (previous.length === normalized.length && previous.every((ticker, index) => ticker === normalized[index])) return
    visibleWatchlistTickersRef.current = normalized
    setPrefetchRevision((value) => value + 1)
  }, [])

  const handleSelectTicker = useCallback(
    async (ticker: string, options: { history?: NavigationHistoryMode } = {}) => {
      const sym = ticker.trim().toUpperCase()
      if (!sym || sym === activeTicker || sym === pendingTicker) return

      const generation = navigationGenerationRef.current + 1
      navigationGenerationRef.current = generation
      navigationAbortControllerRef.current?.abort()
      const controller = new AbortController()
      navigationAbortControllerRef.current = controller
      setPendingTicker(sym)

      const navigationRequest = chartNavigationTimeframeRef.current?.ticker === sym
        ? chartNavigationTimeframeRef.current
        : { ticker: sym, timeframe: currentChartTimeframeRef.current }
      const targetTimeframe = navigationRequest.timeframe

      try {
        const [targetData, targetPrepared] = await Promise.all([
          getStockDetail(sym),
          prepareInitialChartHistory({
            ticker: sym,
            timeframe: targetTimeframe,
            signal: controller.signal,
          }),
        ])
        if (controller.signal.aborted || navigationGenerationRef.current !== generation) return

        setPreparedChartInitial(targetPrepared)
        chartNavigationTimeframeRef.current = navigationRequest
        setChartNavigationTimeframe(navigationRequest)
        currentChartTimeframeRef.current = targetTimeframe
        setCurrentChartTimeframe(targetTimeframe)
        setCurrentData(targetData)
        setActiveTicker(sym)
        setPendingTicker(null)

        if ((options.history ?? "push") === "push") {
          window.history.pushState(null, "", `/insights/${sym.toLowerCase()}`)
        }
        document.title = `${sym} — Chi tiết Cổ phiếu — QeoIndex`
        centerColumnRef.current?.scrollTo({ top: 0, behavior: "smooth" })
      } catch (err: unknown) {
        if ((err as Error)?.name !== "AbortError") {
          console.error("Error preparing stock detail navigation:", err)
        }
        if (navigationGenerationRef.current === generation) setPendingTicker(null)
      } finally {
        if (navigationGenerationRef.current === generation) navigationAbortControllerRef.current = null
      }
    },
    [activeTicker, getStockDetail, pendingTicker],
  )

  useEffect(() => {
    const handlePopState = () => {
      const parts = window.location.pathname.split("/").filter(Boolean)
      if (parts[0] === "insights" && parts[1]) {
        const sym = parts[1].toUpperCase()
        if (sym !== activeTicker) void handleSelectTicker(sym, { history: "none" })
      }
    }

    window.addEventListener("popstate", handlePopState)
    return () => window.removeEventListener("popstate", handlePopState)
  }, [activeTicker, handleSelectTicker])

  useEffect(() => {
    let cancelled = false
    const warmAdjacent = () => {
      if (cancelled) return
      const targets = adjacentPrefetchTargets(visibleWatchlistTickersRef.current, activeTicker)
      for (const ticker of targets) {
        void Promise.allSettled([
          getStockDetail(ticker),
          prefetchInitialStableChartHistory({ ticker, timeframe: currentChartTimeframe }),
        ])
      }
    }

    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(warmAdjacent, { timeout: 800 })
      return () => {
        cancelled = true
        window.cancelIdleCallback(id)
      }
    }

    const timer = window.setTimeout(warmAdjacent, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [activeTicker, currentChartTimeframe, getStockDetail, prefetchRevision])

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
  }, [activeTicker, handleSelectTicker, isChartMaximized])

  useEffect(() => () => navigationAbortControllerRef.current?.abort(), [])

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
                Đang tải {pendingTicker}
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
              preparedInitial={preparedChartInitial}
              onTimeframeChange={handleChartTimeframeChange}
            />

            <div className={tabRailStyles.cardRailScope}>
              {!isChartMaximized && <StockTabsPanel data={currentData} />}
            </div>
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
