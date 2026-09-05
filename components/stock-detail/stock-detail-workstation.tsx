"use client"

import React, { useCallback, useEffect, useRef, useState } from "react"

import { StockAiSidebar } from "./stock-ai-sidebar"
import { StockCompanyHeader } from "./stock-company-header"
import { StockTradingViewChartData } from "./stock-tradingview-chart-data"
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
  const centerColumnRef = useRef<HTMLElement>(null)

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

      // Scroll center column to top on new ticker selection
      centerColumnRef.current?.scrollTo({ top: 0, behavior: "smooth" })

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

  const [isChartMaximized, setIsChartMaximized] = useState(false)

  return (
    <div className="min-h-screen w-full bg-[#05070a] text-slate-200 lg:h-screen lg:overflow-hidden flex flex-col">
      {/* Top Navigation Bar */}
      <TopNav />

      {/* Main Full-Width Workstation Container */}
      <main className="w-full flex-1 px-2 py-2 sm:px-3 lg:px-4 2xl:px-5 lg:overflow-hidden min-h-0">
        {/* 3 Columns Master Layout (or 2 columns when Chart is Maximized) */}
        <div
          className={cn(
            "grid grid-cols-1 gap-2.5 h-full lg:overflow-hidden items-stretch",
            isChartMaximized
              ? "lg:grid-cols-[minmax(0,1fr)_250px] xl:grid-cols-[minmax(0,1fr)_260px] 2xl:grid-cols-[minmax(0,1fr)_280px]"
              : "lg:grid-cols-[288px_minmax(0,1fr)_250px] xl:grid-cols-[318px_minmax(0,1fr)_260px] 2xl:grid-cols-[340px_minmax(0,1fr)_280px]",
          )}
        >
          {/* ========================================================= */}
          {/* COLUMN 1: BÊN TRÁI (~25% WIDTH) - CỐ ĐỊNH                 */}
          {/* AI Council tổng quan & Quick chatbox với AI               */}
          {/* Ẩn khi phóng to chart                                      */}
          {/* ========================================================= */}
          {!isChartMaximized && (
            <aside
              className={cn(
                "w-full transition-opacity duration-200 ease-out lg:h-full lg:overflow-y-auto no-scrollbar",
                isTransitioning ? "opacity-35 pointer-events-none" : "opacity-100",
              )}
            >
              <StockAiSidebar data={currentData} />
            </aside>
          )}

          {/* ========================================================= */}
          {/* COLUMN 2: GIỮA - SCROLL ĐƯỢC KHI BÌNH THƯỜNG / H-FULL KHI MAXIMIZED */}
          {/* Thông tin công ty, Chart & Tabs                           */}
          {/* ========================================================= */}
          <section
            ref={centerColumnRef}
            className={cn(
              "relative min-w-0 transition-opacity duration-200 ease-out",
              isChartMaximized
                ? "flex flex-col overflow-hidden pb-0 pr-0 lg:h-full"
                : "space-y-2.5 lg:h-full lg:overflow-y-auto pr-1 pb-10",
              isTransitioning ? "opacity-35 pointer-events-none" : "opacity-100",
            )}
          >
            {/* SmoothUI Floating Loading Indicator (absolute positioned to avoid top gap) */}
            <div
              className={cn(
                "pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 z-50 transition-all duration-300",
                isTransitioning ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2 pointer-events-none hidden",
              )}
            >
              <div className="rounded-xl border border-white/15 bg-[#0b1017]/95 px-4 py-2 shadow-[0_8px_32px_rgba(0,0,0,0.8)] backdrop-blur-md">
                <AiLoader label={`Hội đồng AI đang cập nhật dữ liệu ${activeTicker}...`} />
              </div>
            </div>

            {/* Thông tin công ty & Giá realtime (Chỉ hiện khi ở chế độ xem chuẩn) */}
            {!isChartMaximized && <StockCompanyHeader data={currentData} />}

            {/* TradingView Lightweight Candlestick Chart */}
            <StockTradingViewChartData
              ticker={currentData.ticker}
              seedDailyBars={currentData.bars}
              isMaximized={isChartMaximized}
              onToggleMaximize={() => setIsChartMaximized((prev) => !prev)}
              currentPrice={currentData.price}
              changePct={currentData.changePct}
            />

            {/* 6 Tabs Panel: Tổng quan, DN, TA, AI Council (Chỉ hiện khi ở chế độ xem chuẩn) */}
            {!isChartMaximized && <StockTabsPanel data={currentData} />}
          </section>

          {/* ========================================================= */}
          {/* COLUMN 3: BÊN PHẢI (~15% WIDTH) - CỐ ĐỊNH                 */}
          {/* Watchlist cổ phiếu (Cố định, search & filter nội bộ)     */}
          {/* Luôn hiển thị và có thể chuyển đổi cp trực tiếp           */}
          {/* ========================================================= */}
          <aside className="w-full lg:h-full lg:overflow-hidden">
            <StockWatchlistSidebar
              currentTicker={activeTicker}
              items={currentData.watchlist}
              onSelectTicker={handleSelectTicker}
              isTransitioning={isTransitioning}
            />
          </aside>
        </div>
      </main>
    </div>
  )
}
