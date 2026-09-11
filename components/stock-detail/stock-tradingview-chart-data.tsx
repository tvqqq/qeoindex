"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { SlidersHorizontal } from "lucide-react"
import type { OhlcvBar } from "@/modules/shared/technical/indicators"
import { cn } from "@/modules/shared/ui/cn"
import {
  prepareInitialChartHistory,
  type PreparedChartHistory,
} from "./chart/chart-history"
import {
  calculateMacdSeries,
  calculateRsiSeries,
  calculateVolumeSma,
} from "./chart/stock-chart-indicators"
import { CanonicalMinuteBarsContext } from "./chart/use-canonical-minute-bars"
import { ALL_TIMEFRAMES, type ChartTimeframe } from "./chart/stock-chart-types"
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
  preparedInitial?: PreparedChartHistory | null
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
const SUPPORTED_TIMEFRAMES = new Set<ChartTimeframe>(ALL_TIMEFRAMES.map(({ id }) => id))

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

function timeframeFromButton(button: HTMLButtonElement) {
  const firstSpan = button.querySelector("span")?.textContent?.trim()
  const exact = button.textContent?.trim()
  const candidate = firstSpan && SUPPORTED_TIMEFRAMES.has(firstSpan as ChartTimeframe)
    ? firstSpan
    : exact && SUPPORTED_TIMEFRAMES.has(exact as ChartTimeframe) ? exact : null
  return candidate as ChartTimeframe | null
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
  preparedInitial,
  onTimeframeClickCapture,
  preparingTimeframe,
}: StockTradingViewChartDataProps & {
  timeframe: ChartTimeframe
  onTimeframeClickCapture: (event: React.MouseEvent<HTMLDivElement>) => void
  preparingTimeframe: ChartTimeframe | null
}) {
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
  } = useChartHistory({ ticker, timeframe, seedDailyBars, preparedInitial })

  const dragStartXRef = useRef<number | null>(null)
  const terminalRef = useRef<HTMLDivElement>(null)
  const [paneTime, setPaneTime] = useState<number | null>(null)
  const requestOlder = useCallback(() => {
    if (!loading && !loadingOlder && hasMore) void loadOlder()
  }, [hasMore, loadOlder, loading, loadingOlder])

  useEffect(() => {
    if (timeframe !== "1m" || loading || loadingOlder || !hasMore || error) return
    void loadOlder()
  }, [error, hasMore, loadOlder, loading, loadingOlder, timeframe])

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
      data-chart-preparing-timeframe={preparingTimeframe ?? ""}
      onClickCapture={onTimeframeClickCapture}
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

      {preparingTimeframe && (
        <div
          data-chart-timeframe-preparing
          className="pointer-events-none absolute right-2 top-9 z-40 flex items-center gap-1.5 rounded border border-white/[0.08] bg-[#0b1118]/90 px-2 py-1 font-mono text-[10px] text-slate-400"
        >
          <span className="size-1.5 animate-pulse rounded-full bg-cyan-300/80" />
          Đang chuẩn bị {preparingTimeframe}…
        </div>
      )}

      {loading && !preparingTimeframe && (
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
  const { navigationTimeframe, onTimeframeChange, preparedInitial: externalPrepared, ticker } = props
  const normalizedTicker = ticker.toUpperCase()
  const externalPreparedForTicker = externalPrepared?.ticker === normalizedTicker ? externalPrepared : null
  const requestedTimeframe = navigationTimeframe?.ticker.toUpperCase() === normalizedTicker
    ? navigationTimeframe.timeframe
    : null
  const initialTimeframe = externalPreparedForTicker?.timeframe
    ?? requestedTimeframe
    ?? readStoredChartTimeframe(ticker)
    ?? "1D"
  const [committedTimeframe, setCommittedTimeframe] = useState<ChartTimeframe>(initialTimeframe)
  const committedTimeframeRef = useRef<ChartTimeframe>(initialTimeframe)
  const [preparedInitial, setPreparedInitial] = useState<PreparedChartHistory | null>(externalPreparedForTicker)
  const [preparingTimeframe, setPreparingTimeframe] = useState<ChartTimeframe | null>(null)
  const [consumedExternalPrepared, setConsumedExternalPrepared] = useState<PreparedChartHistory | null>(null)
  const preparationRef = useRef<{ generation: number; controller: AbortController | null }>({ generation: 0, controller: null })
  const replayTimeframeClickRef = useRef(false)

  // A parent navigation handoff is authoritative only until this wrapper has
  // consumed that exact prepared object. Later direct timeframe changes own
  // their internal prepared state and cannot be pinned by the stale parent prop.
  const pendingExternalPrepared = externalPreparedForTicker && consumedExternalPrepared !== externalPreparedForTicker
    ? externalPreparedForTicker
    : null
  const renderPreparedInitial = pendingExternalPrepared ?? preparedInitial
  const renderTimeframe = pendingExternalPrepared?.timeframe ?? committedTimeframe

  const prepareAndCommit = useCallback(async (nextTimeframe: ChartTimeframe, replayButton?: HTMLButtonElement) => {
    if (nextTimeframe === committedTimeframeRef.current) return
    const generation = preparationRef.current.generation + 1
    preparationRef.current.controller?.abort()
    const controller = new AbortController()
    preparationRef.current = { generation, controller }
    setPreparingTimeframe(nextTimeframe)

    try {
      const prepared = await prepareInitialChartHistory({
        ticker,
        timeframe: nextTimeframe,
        signal: controller.signal,
      })
      if (controller.signal.aborted || preparationRef.current.generation !== generation) return

      flushSync(() => {
        committedTimeframeRef.current = nextTimeframe
        setPreparedInitial(prepared)
        setCommittedTimeframe(nextTimeframe)
        onTimeframeChange?.(nextTimeframe)
        if (replayButton?.isConnected) {
          replayTimeframeClickRef.current = true
          replayButton.click()
        }
      })
    } catch (cause) {
      if (!controller.signal.aborted) console.error("Unable to prepare target chart timeframe:", cause)
    } finally {
      if (preparationRef.current.generation === generation) {
        preparationRef.current.controller = null
        setPreparingTimeframe(null)
      }
    }
  }, [onTimeframeChange, ticker])

  const handleTimeframeClickCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (replayTimeframeClickRef.current) {
      replayTimeframeClickRef.current = false
      return
    }
    const target = event.target as HTMLElement | null
    const button = target?.closest("button") as HTMLButtonElement | null
    if (!button) return
    const nextTimeframe = timeframeFromButton(button)
    if (!nextTimeframe || nextTimeframe === committedTimeframeRef.current) return
    event.preventDefault()
    event.stopPropagation()
    void prepareAndCommit(nextTimeframe, button)
  }, [prepareAndCommit])

  useEffect(() => {
    if (!externalPreparedForTicker || consumedExternalPrepared === externalPreparedForTicker) return
    setConsumedExternalPrepared(externalPreparedForTicker)
    preparationRef.current.controller?.abort()
    committedTimeframeRef.current = externalPreparedForTicker.timeframe
    setPreparedInitial(externalPreparedForTicker)
    setCommittedTimeframe(externalPreparedForTicker.timeframe)
    setPreparingTimeframe(null)
    onTimeframeChange?.(externalPreparedForTicker.timeframe)
  }, [consumedExternalPrepared, externalPreparedForTicker, onTimeframeChange])

  useEffect(() => {
    const onTimeframe = (event: Event) => {
      const detail = (event as CustomEvent<TimeframeEventDetail>).detail
      if (!detail || detail.ticker !== normalizedTicker) return
      if (detail.timeframe === committedTimeframeRef.current) {
        onTimeframeChange?.(detail.timeframe)
        return
      }
      void prepareAndCommit(detail.timeframe)
    }
    window.addEventListener(CHART_TIMEFRAME_EVENT, onTimeframe)
    return () => window.removeEventListener(CHART_TIMEFRAME_EVENT, onTimeframe)
  }, [normalizedTicker, onTimeframeChange, prepareAndCommit])

  useEffect(() => () => preparationRef.current.controller?.abort(), [])

  return (
    <HistoryBoundChart
      {...props}
      timeframe={renderTimeframe}
      preparedInitial={renderPreparedInitial}
      onTimeframeClickCapture={handleTimeframeClickCapture}
      preparingTimeframe={preparingTimeframe}
    />
  )
}