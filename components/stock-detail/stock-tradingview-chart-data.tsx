"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { SlidersHorizontal } from "lucide-react"
import type { OhlcvBar } from "@/modules/shared/technical/indicators"
import { cn } from "@/modules/shared/ui/cn"
import {
  calculateMacdSeries,
  calculateRsiSeries,
  calculateVolumeSma,
} from "./chart/stock-chart-indicators"
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
  exchange?: string
  seedDailyBars: OhlcvBar[]
  isMaximized?: boolean
  onToggleMaximize?: () => void
  currentPrice?: number
  changePct?: number
  navigationTimeframe?: ChartTimeframeNavigationRequest | null
  onTimeframeChange?: (timeframe: ChartTimeframe) => void
}

export interface ChartTimeframeNavigationRequest {
  ticker: string
  timeframe: ChartTimeframe
}

interface TimeframeEventDetail {
  ticker: string
  timeframe: ChartTimeframe
}

const LIVE_TIMEFRAMES = new Set<ChartTimeframe>(["1m", "15m", "30m", "1h", "2h", "4h"])

function formatMetric(value: number | null | undefined, digits = 2) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—"
}

function formatCompactVolume(volume: number | null | undefined) {
  if (typeof volume !== "number" || !Number.isFinite(volume)) return "—"
  if (Math.abs(volume) >= 1_000_000_000) return `${(volume / 1_000_000_000).toFixed(2)}B`
  if (Math.abs(volume) >= 1_000_000) return `${(volume / 1_000_000).toFixed(2)}M`
  if (Math.abs(volume) >= 1_000) return `${(volume / 1_000).toFixed(1)}K`
  return Math.round(volume).toLocaleString("vi-VN")
}

function HistoryBoundChart({
  ticker,
  exchange,
  timeframe,
  seedDailyBars,
  isMaximized,
  onToggleMaximize,
  currentPrice,
  changePct,
  navigationTimeframe,
}: StockTradingViewChartDataProps & { timeframe: ChartTimeframe }) {
  const {
    bars,
    loading,
    loadingOlder,
    error,
    coverage,
    hasMore,
    loadOlder,
    liveState,
    liveError,
    liveProvider,
    lastUpdatedAt,
  } = useChartHistory({ ticker, timeframe, seedDailyBars })

  const dragStartXRef = useRef<number | null>(null)
  const terminalRef = useRef<HTMLDivElement>(null)
  const [paneTime, setPaneTime] = useState<number | null>(null)
  const requestOlder = useCallback(() => {
    if (!loading && !loadingOlder && hasMore) void loadOlder()
  }, [hasMore, loadOlder, loading, loadingOlder])

  // QEO-100 P0: raw 1m has a bounded 31-day product horizon. Hydrate it
  // progressively after the fast initial window so completeness does not
  // depend on mouse/trackpad gesture direction. Stop automatic progression on
  // a transport failure; a reload can retry instead of creating a retry loop.
  useEffect(() => {
    if (timeframe !== "1m" || loading || loadingOlder || !hasMore || error) return
    void loadOlder()
  }, [error, hasMore, loadOlder, loading, loadingOlder, timeframe])

  // Preserve lazy gesture loading for non-1m timeframes. QEO-100 only changes
  // the raw 1m completeness contract; QEO-103 owns cache/retention optimization.
  const handleMouseDownCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (timeframe === "1m") return
    if (event.button === 0) dragStartXRef.current = event.clientX
  }

  const handleMouseMoveCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (timeframe === "1m") return
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
  const liveTimestamp = lastUpdatedAt
    ? new Date(lastUpdatedAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null
  const providerWarning = LIVE_TIMEFRAMES.has(timeframe) && liveState === "stale"
    ? `${liveProvider ?? "Realtime"}${liveTimestamp ? ` · ${liveTimestamp}` : ""}`
    : null

  const paneSeries = useMemo(() => {
    if (!isMaximized || resolvedBars.length === 0) return null
    return {
      volumeMa: calculateVolumeSma(resolvedBars, 20),
      rsi: calculateRsiSeries(resolvedBars, 14),
      macd: calculateMacdSeries(resolvedBars),
    }
  }, [isMaximized, resolvedBars])

  const paneIndex = useMemo(() => {
    if (resolvedBars.length === 0) return -1
    if (paneTime == null) return resolvedBars.length - 1
    return resolvedBars.findIndex((bar) => bar.time === paneTime)
  }, [paneTime, resolvedBars])
  const paneBar = paneIndex >= 0 ? resolvedBars[paneIndex] : null
  const paneVolumeMa = paneIndex >= 0 ? paneSeries?.volumeMa[paneIndex] : null
  const paneRsi = paneIndex >= 0 ? paneSeries?.rsi[paneIndex] : null
  const paneMacd = paneIndex >= 0 ? paneSeries?.macd.macd[paneIndex] : null
  const paneSignal = paneIndex >= 0 ? paneSeries?.macd.signal[paneIndex] : null
  const paneHistogram = paneIndex >= 0 ? paneSeries?.macd.histogram[paneIndex] : null

  const clickChartControl = useCallback((titleFragment: string) => {
    const buttons = terminalRef.current?.querySelectorAll<HTMLButtonElement>("button[title]")
    const button = buttons ? Array.from(buttons).find((candidate) => candidate.title.includes(titleFragment)) : null
    button?.click()
  }, [])

  // QEO-173: the native chart owns crosshair time. Pane chrome observes the
  // existing canonical legend timestamp instead of creating a second hover model.
  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal || !isMaximized) {
      setPaneTime(null)
      return
    }

    const syncPaneTime = () => {
      const legend = terminal.querySelector<HTMLElement>("[data-chart-legend-time]")
      const raw = legend?.getAttribute("data-chart-legend-time")
      const parsed = raw ? Number(raw) : Number.NaN
      setPaneTime(Number.isFinite(parsed) ? parsed : null)
    }

    syncPaneTime()
    const observer = new MutationObserver(syncPaneTime)
    observer.observe(terminal, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-chart-legend-time"],
    })
    return () => observer.disconnect()
  }, [isMaximized, ticker, timeframe])

  // QEO-172: publish render readiness conservatively after the replacement
  // dataset has propagated through child effects and two animation frames. The
  // marker is observational only; it never drives chart behavior.
  useEffect(() => {
    const terminal = terminalRef.current
    terminal?.removeAttribute("data-chart-rendered-key")
    if (loading || resolvedBars.length === 0) return

    let secondFrame = 0
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const latestTime = resolvedBars.at(-1)?.time ?? 0
        terminalRef.current?.setAttribute(
          "data-chart-rendered-key",
          `${ticker.trim().toUpperCase()}:${timeframe}:${resolvedBars.length}:${latestTime}`,
        )
      })
    })

    return () => {
      window.cancelAnimationFrame(firstFrame)
      if (secondFrame) window.cancelAnimationFrame(secondFrame)
    }
  }, [loading, resolvedBars, ticker, timeframe])

  return (
    <div
      ref={terminalRef}
      className={cn("relative min-w-0", styles.terminalSurface, isMaximized && styles.maximized)}
      data-chart-terminal="true"
      data-chart-maximized={isMaximized ? "true" : "false"}
      data-chart-live-state={liveState}
      data-chart-loading={loading ? "true" : "false"}
      onMouseDownCapture={handleMouseDownCapture}
      onMouseMoveCapture={handleMouseMoveCapture}
      onMouseUpCapture={() => { dragStartXRef.current = null }}
      onMouseLeave={() => { dragStartXRef.current = null }}
      onWheelCapture={(event) => {
        if (timeframe !== "1m" && event.deltaY > 0) requestOlder()
      }}
    >
      <CanonicalMinuteBarsContext.Provider value={canonicalMinuteOverride}>
        <StockTradingViewChart
          ticker={ticker}
          bars={resolvedBars}
          hourlyBars={resolvedBars}
          isLoading={loading}
          isMaximized={isMaximized}
          onToggleMaximize={onToggleMaximize}
          currentPrice={currentPrice}
          changePct={changePct}
          navigationTimeframe={navigationTimeframe?.ticker.toUpperCase() === ticker.toUpperCase() ? navigationTimeframe.timeframe : null}
        />
      </CanonicalMinuteBarsContext.Provider>

      <div
        data-chart-financial-header
        className="pointer-events-none absolute left-1/2 top-1 z-40 hidden max-w-[46%] -translate-x-1/2 items-center gap-1.5 overflow-hidden whitespace-nowrap font-mono text-[10px] tabular-nums text-slate-500 lg:flex"
      >
        <span className="font-bold text-slate-200">{ticker.toUpperCase()}</span>
        <span aria-hidden="true">·</span>
        <span className="font-semibold text-slate-200">{formatMetric(currentPrice)}</span>
        <span aria-hidden="true">·</span>
        <span className={changePct == null ? "text-slate-500" : changePct >= 0 ? "text-emerald-400" : "text-rose-400"}>
          {typeof changePct === "number" ? `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%` : "—"}
        </span>
        <span aria-hidden="true">·</span>
        <span className="text-slate-400">{exchange?.toUpperCase() ?? "—"}</span>
        <span aria-hidden="true">·</span>
        <span className={liveState === "live" ? "text-emerald-300" : liveState === "stale" ? "text-amber-300" : "text-slate-500"}>
          {liveState.toUpperCase()}
        </span>
        {providerWarning && (
          <>
            <span aria-hidden="true">·</span>
            <span className="truncate text-amber-300/90">{providerWarning}</span>
          </>
        )}
      </div>

      {loading && (
        <div
          data-chart-loading-indicator
          className="pointer-events-none absolute right-2 top-9 z-40 flex items-center gap-1.5 rounded border border-white/[0.08] bg-[#0b1118]/90 px-2 py-1 font-mono text-[10px] text-slate-400"
        >
          <span className="size-1.5 animate-pulse rounded-full bg-cyan-300/80" />
          Đang tải nến…
        </div>
      )}

      {isMaximized && (
        <>
          <div
            data-chart-pane-header="volume"
            data-chart-pane-time={paneTime ?? ""}
            className="pointer-events-none absolute left-11 top-[55.5%] z-30 flex h-5 max-w-[70%] items-center gap-2 whitespace-nowrap font-mono text-[10px] tabular-nums"
          >
            <span className="font-semibold text-slate-300">Volume</span>
            <span className="text-slate-400">{formatCompactVolume(paneBar?.volume)}</span>
            <span className="text-amber-300/80">MA20 {formatCompactVolume(paneVolumeMa)}</span>
            <button
              type="button"
              title="Cài đặt Volume"
              onClick={() => clickChartControl("Chỉ báo kỹ thuật")}
              className="pointer-events-auto flex size-5 items-center justify-center rounded-sm text-slate-500 transition-colors hover:bg-white/[0.06] hover:text-slate-200"
            >
              <SlidersHorizontal className="size-3" />
            </button>
          </div>

          <div
            data-chart-pane-header="rsi"
            data-chart-pane-time={paneTime ?? ""}
            className="pointer-events-none absolute left-11 top-[70.5%] z-30 flex h-5 max-w-[70%] items-center gap-2 whitespace-nowrap font-mono text-[10px] tabular-nums"
          >
            <span className="font-semibold text-violet-300">RSI 14</span>
            <span className="text-violet-200/85">{formatMetric(paneRsi)}</span>
            <button
              type="button"
              title="Cài đặt RSI"
              onClick={() => clickChartControl("Chỉ báo kỹ thuật")}
              className="pointer-events-auto flex size-5 items-center justify-center rounded-sm text-slate-500 transition-colors hover:bg-white/[0.06] hover:text-slate-200"
            >
              <SlidersHorizontal className="size-3" />
            </button>
            <button
              type="button"
              title="Thu gọn / mở pane RSI"
              onClick={() => clickChartControl("pane RSI")}
              className="pointer-events-auto flex h-5 min-w-5 items-center justify-center rounded-sm px-1 text-[11px] font-bold text-slate-500 transition-colors hover:bg-white/[0.06] hover:text-slate-200"
            >
              ±
            </button>
          </div>

          <div
            data-chart-pane-header="macd"
            data-chart-pane-time={paneTime ?? ""}
            className="pointer-events-none absolute left-11 top-[85.5%] z-30 flex h-5 max-w-[75%] items-center gap-2 whitespace-nowrap font-mono text-[10px] tabular-nums"
          >
            <span className="font-semibold text-sky-300">MACD</span>
            <span className="text-sky-200/85">{formatMetric(paneMacd, 4)}</span>
            <span className="text-orange-300/85">SIG {formatMetric(paneSignal, 4)}</span>
            <span className={typeof paneHistogram === "number" && paneHistogram >= 0 ? "text-emerald-300/85" : "text-rose-300/85"}>
              HIST {formatMetric(paneHistogram, 4)}
            </span>
            <button
              type="button"
              title="Cài đặt MACD"
              onClick={() => clickChartControl("Chỉ báo kỹ thuật")}
              className="pointer-events-auto flex size-5 items-center justify-center rounded-sm text-slate-500 transition-colors hover:bg-white/[0.06] hover:text-slate-200"
            >
              <SlidersHorizontal className="size-3" />
            </button>
            <button
              type="button"
              title="Thu gọn / mở pane MACD"
              onClick={() => clickChartControl("pane MACD")}
              className="pointer-events-auto flex h-5 min-w-5 items-center justify-center rounded-sm px-1 text-[11px] font-bold text-slate-500 transition-colors hover:bg-white/[0.06] hover:text-slate-200"
            >
              ±
            </button>
          </div>
        </>
      )}

      {loadingOlder && (
        <div className="pointer-events-none absolute right-2 top-9 z-30 rounded border border-white/[0.08] bg-[#0c131c]/92 px-2 py-1 font-mono text-[10px] font-medium text-slate-400">
          Đang tải thêm lịch sử…
        </div>
      )}

      {!loading && coverage?.state === "PARTIAL" && liveState !== "stale" && (
        <div className="pointer-events-none absolute left-10 top-9 z-30 rounded border border-amber-300/20 bg-[#17130b]/92 px-2 py-1 font-mono text-[10px] font-medium text-amber-200/80">
          Dữ liệu chưa đầy đủ
        </div>
      )}

      {!loading && error && resolvedBars.length > 0 && (
        <div className={cn(
          "pointer-events-none absolute bottom-8 left-10 z-30 max-w-[70%] rounded border border-rose-300/20",
          "bg-[#180d11]/92 px-2 py-1 font-mono text-[10px] text-rose-200/80",
        )}>
          Không thể tải thêm lịch sử: {error}
        </div>
      )}

      {!loading && liveError && liveState === "stale" && (
        <span className="sr-only" data-chart-live-error>{liveError}</span>
      )}
    </div>
  )
}

export function StockTradingViewChartData(props: StockTradingViewChartDataProps) {
  const { navigationTimeframe, onTimeframeChange, ticker } = props
  const requestedTimeframe = navigationTimeframe?.ticker.toUpperCase() === ticker.toUpperCase()
    ? navigationTimeframe.timeframe
    : null
  const [timeframe, setTimeframe] = useState<ChartTimeframe>(
    () => requestedTimeframe ?? readStoredChartTimeframe(ticker) ?? "1D",
  )

  useEffect(() => {
    const nextTimeframe = requestedTimeframe ?? readStoredChartTimeframe(ticker) ?? "1D"
    setTimeframe(nextTimeframe)
    onTimeframeChange?.(nextTimeframe)
  }, [onTimeframeChange, requestedTimeframe, ticker])

  useEffect(() => {
    const onTimeframe = (event: Event) => {
      const detail = (event as CustomEvent<TimeframeEventDetail>).detail
      if (!detail || detail.ticker !== ticker.toUpperCase()) return
      setTimeframe(detail.timeframe)
      onTimeframeChange?.(detail.timeframe)
    }
    window.addEventListener(CHART_TIMEFRAME_EVENT, onTimeframe)
    return () => window.removeEventListener(CHART_TIMEFRAME_EVENT, onTimeframe)
  }, [onTimeframeChange, ticker])

  return <HistoryBoundChart {...props} timeframe={timeframe} />
}
