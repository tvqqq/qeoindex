"use client"

import React, { useCallback, useEffect, useRef, useState } from "react"

import { StockAiSidebar } from "./stock-ai-sidebar"
import { StockCompanyHeader } from "./stock-company-header"
import { StockTradingViewChart } from "./stock-tradingview-chart"
import { StockTabsPanel } from "./stock-tabs-panel"
import { StockWatchlistSidebar } from "./stock-watchlist-sidebar"
import type { StockDetailData } from "./types"
import { AiLoader } from "@/components/smoothui/ai-loader"
import { TopNav } from "@/components/top-nav"
import { cn } from "@/modules/shared/ui/cn"

export function StockDetailWorkstation({ data: initialData }: { data: StockDetailData }) {
  const [currentData, setCurrentData] = useState<StockDetailData>(initialData)
  const [activeTicker, setActiveTicker] = useState<string>(initialData.ticker)
  const [isTransitioning, setIsTransitioning] = useState(false)

  // In-memory cache for loaded tickers to make back-and-forth switching instantaneous
  const cacheRef = useRef<Record<string, StockDetailData>>({
    [initialData.ticker.toUpperCase()]: initialData,
  })
  const abortControllerRef = useRef<AbortController | null>(null)

  const handleSelectTicker = useCallback(
    async (ticker: string) => {
      const sym = ticker.trim().toUpperCase()
      if (!sym || sym === activeTicker) return

      // Abort any ongoing request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }

      // Update URL & document title without full page reload
      window.history.pushState(null, "", `/insights/${sym.toLowerCase()}`)
      document.title = `${sym} — Chi tiết Cổ phiếu — QeoIndex`
      setActiveTicker(sym)

      // 1. Instant switch if data is already in client cache
      if (cacheRef.current[sym]) {
        setCurrentData(cacheRef.current[sym])
        setIsTransitioning(false)
        return
      }

      // 2. Fetch from API with SmoothUI loading transition
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

  // Sync state if user clicks browser Back / Forward buttons
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

  return (
    <div className="min-h-screen w-full bg-[#06090d] text-white">
      {/* Top Navigation Bar */}
      <TopNav />

      {/* Main Full-Width Workstation Container */}
      <main className="w-full px-2.5 py-3 sm:px-4 lg:px-5 2xl:px-6">
        {/* 3 Columns Master Layout */}
        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[330px_minmax(0,1fr)_270px] 2xl:grid-cols-[360px_minmax(0,1fr)_300px] items-start">
          {/* ========================================================= */}
          {/* COLUMNS 1 & 2 WRAPPER: WITH SMOOTHUI LOADING TRANSITION  */}
          {/* ========================================================= */}
          <div className="relative col-span-1 lg:col-span-2 xl:col-span-2 grid grid-cols-1 gap-3.5 lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[330px_minmax(0,1fr)] 2xl:grid-cols-[360px_minmax(0,1fr)] items-start">
            {/* SmoothUI Floating Loading Indicator */}
            <div
              className={cn(
                "pointer-events-none absolute inset-x-0 top-6 z-40 flex justify-center transition-all duration-300",
                isTransitioning ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2",
              )}
            >
              <div className="rounded-2xl border border-cyan-400/30 bg-[#0b1017]/95 px-4 py-2.5 shadow-[0_8px_32px_rgba(0,0,0,0.8),0_0_24px_rgba(34,211,238,0.2)] backdrop-blur-md">
                <AiLoader label={`Hội đồng AI đang cập nhật dữ liệu ${activeTicker}...`} />
              </div>
            </div>

            {/* COLUMN 1: BÊN TRÁI (~25% WIDTH) */}
            <div
              className={cn(
                "transition-opacity duration-200 ease-out",
                isTransitioning ? "opacity-35 pointer-events-none" : "opacity-100",
              )}
            >
              <StockAiSidebar data={currentData} />
            </div>

            {/* COLUMN 2: GIỮA (~60% WIDTH) */}
            <section
              className={cn(
                "min-w-0 space-y-3.5 transition-opacity duration-200 ease-out",
                isTransitioning ? "opacity-35 pointer-events-none" : "opacity-100",
              )}
            >
              {/* Thông tin công ty & Giá realtime */}
              <StockCompanyHeader data={currentData} />

              {/* TradingView Lightweight Candlestick Chart */}
              <StockTradingViewChart ticker={currentData.ticker} bars={currentData.bars} />

              {/* 4 Tabs Panel: Tổng quan, DN, TA, AI Council */}
              <StockTabsPanel data={currentData} />
            </section>
          </div>

          {/* ========================================================= */}
          {/* COLUMN 3: BÊN PHẢI (~15% WIDTH)                           */}
          {/* Watchlist cổ phiếu (Cố định, không reload khi chọn mã)   */}
          {/* ========================================================= */}
          <StockWatchlistSidebar
            currentTicker={activeTicker}
            items={currentData.watchlist}
            onSelectTicker={handleSelectTicker}
            isTransitioning={isTransitioning}
          />
        </div>
      </main>
    </div>
  )
}
