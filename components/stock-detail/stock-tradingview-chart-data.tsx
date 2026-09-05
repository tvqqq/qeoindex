"use client"

import React, { useCallback, useEffect, useRef, useState } from "react"
import type { OhlcvBar } from "@/modules/shared/technical/indicators"
import { cn } from "@/modules/shared/ui/cn"
import { CanonicalMinuteBarsContext } from "./chart/use-canonical-minute-bars"
import type { ChartTimeframe } from "./chart/stock-chart-types"
import { useChartHistory } from "./chart/use-chart-history"
import {
  CHART_TIMEFRAME_EVENT,
  readStoredChartTimeframe,
} from "./chart/use-user-chart-sync"
import styles from "./chart/stock-chart-terminal-shell.module.css"
import { StockTradingViewChart } from "./stock-tradingview-chart"

interface StockTradingViewChartDataProps {
  ticker: string
  seedDailyBars: OhlcvBar[]
  isMaximized?: boolean
  onToggleMaximize?: () => void
  currentPrice?: number
  changePct?: number
}

interface TimeframeEventDetail {
  ticker: string
  timeframe: ChartTimeframe
}

function HistoryBoundChart({
  ticker,
  timeframe,
  seedDailyBars,
  isMaximized,
  onToggleMaximize,
  currentPrice,
  changePct,
}: StockTradingViewChartDataProps & { timeframe: ChartTimeframe }) {
  const {
    bars,
    loading,
    loadingOlder,
    error,
    coverage,
    hasMore,
    loadOlder,
  } = useChartHistory({ ticker, timeframe, seedDailyBars })

  const dragStartXRef = useRef<number | null>(null)
  const requestOlder = useCallback(() => {
    if (!loading && !loadingOlder && hasMore) void loadOlder()
  }, [hasMore, loadOlder, loading, loadingOlder])

  const handleMouseDownCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button === 0) dragStartXRef.current = event.clientX
  }

  const handleMouseMoveCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    const start = dragStartXRef.current
    if (start == null || (event.buttons & 1) === 0) return
    if (event.clientX - start >= 80) {
      requestOlder()
      dragStartXRef.current = event.clientX
    }
  }

  const resolvedBars = bars.length ? bars : timeframe === "1D" ? seedDailyBars : []
  const canonicalMinuteOverride = {
    ticker: ticker.trim().toUpperCase(),
    bars: resolvedBars,
  }

  return (
    <div
      className={cn("relative min-w-0", styles.terminalSurface, isMaximized && styles.maximized)}
      data-chart-terminal="true"
      data-chart-maximized={isMaximized ? "true" : "false"}
      onMouseDownCapture={handleMouseDownCapture}
      onMouseMoveCapture={handleMouseMoveCapture}
      onMouseUpCapture={() => { dragStartXRef.current = null }}
      onMouseLeave={() => { dragStartXRef.current = null }}
      onWheelCapture={(event) => {
        if (event.deltaY > 0) requestOlder()
      }}
    >
      <CanonicalMinuteBarsContext.Provider value={canonicalMinuteOverride}>
        <StockTradingViewChart
          ticker={ticker}
          bars={resolvedBars}
          hourlyBars={resolvedBars}
          isMaximized={isMaximized}
          onToggleMaximize={onToggleMaximize}
          currentPrice={currentPrice}
          changePct={changePct}
        />
      </CanonicalMinuteBarsContext.Provider>

      {loadingOlder && (
        <div className="pointer-events-none absolute right-3 top-12 z-30 rounded border border-white/10 bg-[#0c131c]/95 px-2 py-1 font-mono text-[10px] font-medium text-slate-400 shadow-lg">
          Đang tải thêm lịch sử…
        </div>
      )}

      {!loading && coverage?.state === "PARTIAL" && (
        <div className="pointer-events-none absolute left-12 top-12 z-30 rounded border border-amber-300/20 bg-[#17130b]/95 px-2 py-1 font-mono text-[10px] font-medium text-amber-200/80">
          Dữ liệu chưa đầy đủ
        </div>
      )}

      {!loading && error && resolvedBars.length > 0 && (
        <div className={cn(
          "pointer-events-none absolute bottom-9 left-12 z-30 max-w-[70%] rounded border border-rose-300/20",
          "bg-[#180d11]/95 px-2 py-1 font-mono text-[10px] text-rose-200/80",
        )}>
          Không thể tải thêm lịch sử: {error}
        </div>
      )}
    </div>
  )
}

export function StockTradingViewChartData(props: StockTradingViewChartDataProps) {
  const [timeframe, setTimeframe] = useState<ChartTimeframe>(() => readStoredChartTimeframe(props.ticker) ?? "1D")

  useEffect(() => {
    setTimeframe(readStoredChartTimeframe(props.ticker) ?? "1D")
  }, [props.ticker])

  useEffect(() => {
    const onTimeframe = (event: Event) => {
      const detail = (event as CustomEvent<TimeframeEventDetail>).detail
      if (!detail || detail.ticker !== props.ticker.toUpperCase()) return
      setTimeframe(detail.timeframe)
    }
    window.addEventListener(CHART_TIMEFRAME_EVENT, onTimeframe)
    return () => window.removeEventListener(CHART_TIMEFRAME_EVENT, onTimeframe)
  }, [props.ticker])

  return <HistoryBoundChart key={`${props.ticker}:${timeframe}`} {...props} timeframe={timeframe} />
}
