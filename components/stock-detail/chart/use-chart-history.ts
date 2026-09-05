"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { OhlcvBar } from "@/modules/shared/technical/indicators"
import { chartHistoryFloor } from "@/modules/market/chart-data/history-policy"
import { getMarketSessionStatus } from "@/modules/market/realtime/session-countdown"
import type { ChartTimeframe } from "./stock-chart-types"
import {
  initialChartHistoryRange,
  mergeChartBars,
  olderChartHistoryRange,
  requestChartRange,
  type ChartHistoryResponse,
} from "./chart-history"

interface UseChartHistoryOptions {
  ticker: string
  timeframe: ChartTimeframe
  seedDailyBars?: OhlcvBar[]
}

type LiveState = "closed" | "live" | "stale"

const LIVE_REFRESH_INTERVAL_MS = 5_000
const LIVE_REFRESH_LOOKBACK_SECONDS = 12 * 60 * 60
const LIVE_TIMEFRAMES = new Set<ChartTimeframe>(["1m", "15m", "30m", "1h", "2h", "4h"])

function mergeCoverage(
  current: ChartHistoryResponse["coverage"] | null,
  incoming: ChartHistoryResponse["coverage"],
) {
  if (!current) return incoming
  const complete = current.complete && incoming.complete
  return { complete, state: complete ? "COMPLETE" as const : "PARTIAL" as const }
}

function resultLiveState(result: ChartHistoryResponse): LiveState {
  if (result.metadata?.sessionState !== "LIVE") return "closed"
  return result.errors.some((item) => item.code === "PROVIDER_UNAVAILABLE") ? "stale" : "live"
}

export function useChartHistory({ ticker, timeframe, seedDailyBars = [] }: UseChartHistoryOptions) {
  const [bars, setBars] = useState<OhlcvBar[]>(() => timeframe === "1D" ? seedDailyBars : [])
  const [loading, setLoading] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [coverage, setCoverage] = useState<ChartHistoryResponse["coverage"] | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [liveState, setLiveState] = useState<LiveState>("closed")
  const [liveError, setLiveError] = useState<string | null>(null)
  const [liveProvider, setLiveProvider] = useState<string | null>(null)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null)

  const barsRef = useRef(bars)
  const generationRef = useRef(0)
  const olderRequestRef = useRef(false)
  const liveRequestRef = useRef(false)
  const horizonToRef = useRef<number | null>(null)
  const historyCursorRef = useRef<number | null>(null)

  useEffect(() => {
    barsRef.current = bars
  }, [bars])

  useEffect(() => {
    const generation = ++generationRef.current
    const controller = new AbortController()
    const initialBars = timeframe === "1D" ? seedDailyBars : []
    barsRef.current = initialBars
    historyCursorRef.current = null
    setBars(initialBars)
    setLoading(true)
    setLoadingOlder(false)
    olderRequestRef.current = false
    liveRequestRef.current = false
    setError(null)
    setCoverage(null)
    setHasMore(true)
    setLiveState("closed")
    setLiveError(null)
    setLiveProvider(null)
    setLastUpdatedAt(null)

    const to = Math.floor(Date.now() / 1000)
    horizonToRef.current = to
    const range = initialChartHistoryRange(timeframe, to)

    void requestChartRange({ ticker, timeframe, ...range }, controller.signal)
      .then((result) => {
        if (generationRef.current !== generation) return
        let mergedBars: OhlcvBar[] = []
        setBars((current) => {
          mergedBars = mergeChartBars(current, result.bars)
          barsRef.current = mergedBars
          return mergedBars
        })
        historyCursorRef.current = range.from
        setCoverage(result.coverage)
        setHasMore(range.from > chartHistoryFloor(timeframe, to) + 1)
        setLiveState(resultLiveState(result))
        setLiveError(result.errors.some((item) => item.code === "PROVIDER_UNAVAILABLE") ? "Dữ liệu realtime tạm thời không khả dụng." : null)
        setLiveProvider(result.metadata?.provider ?? null)
        setLastUpdatedAt(result.metadata?.lastUpdatedAt ?? result.generatedAt ?? null)
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || generationRef.current !== generation) return
        setError(cause instanceof Error ? cause.message : String(cause))
        setHasMore(false)
      })
      .finally(() => {
        if (generationRef.current === generation) setLoading(false)
      })

    return () => controller.abort()
  }, [seedDailyBars, ticker, timeframe])

  useEffect(() => {
    if (!LIVE_TIMEFRAMES.has(timeframe)) return
    const generation = generationRef.current

    const refreshLiveTail = async () => {
      const now = new Date()
      const session = getMarketSessionStatus(now)
      if (!session.isLiveSession) {
        setLiveState("closed")
        setLiveError(null)
        return
      }
      if (liveRequestRef.current) return

      const to = Math.floor(now.getTime() / 1000)
      const from = Math.max(chartHistoryFloor(timeframe, to), to - LIVE_REFRESH_LOOKBACK_SECONDS)
      if (from >= to) return

      liveRequestRef.current = true
      try {
        const result = await requestChartRange({ ticker, timeframe, from, to })
        if (generationRef.current !== generation) return
        setBars((current) => {
          const mergedBars = mergeChartBars(current, result.bars)
          barsRef.current = mergedBars
          return mergedBars
        })
        const nextLiveState = resultLiveState(result)
        setLiveState(nextLiveState)
        setLiveError(nextLiveState === "stale" ? "Dữ liệu realtime tạm thời không khả dụng." : null)
        if (result.metadata?.provider) setLiveProvider(result.metadata.provider)
        setLastUpdatedAt(result.metadata?.lastUpdatedAt ?? result.generatedAt ?? new Date().toISOString())
      } catch (cause) {
        if (generationRef.current !== generation) return
        setLiveState("stale")
        setLiveError(cause instanceof Error ? cause.message : "Không thể làm mới dữ liệu realtime.")
      } finally {
        liveRequestRef.current = false
      }
    }

    const timer = window.setInterval(() => { void refreshLiveTail() }, LIVE_REFRESH_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [ticker, timeframe])

  const loadOlder = useCallback(async () => {
    if (olderRequestRef.current || !hasMore) return
    const cursor = historyCursorRef.current ?? barsRef.current[0]?.time
    const horizonTo = horizonToRef.current
    if (!cursor || !horizonTo) {
      setHasMore(false)
      return
    }
    const range = olderChartHistoryRange(timeframe, cursor, horizonTo)
    if (!range) {
      setHasMore(false)
      return
    }

    olderRequestRef.current = true
    setLoadingOlder(true)
    const generation = generationRef.current

    try {
      const result = await requestChartRange({ ticker, timeframe, ...range })
      if (generationRef.current !== generation) return
      setBars((current) => {
        const mergedBars = mergeChartBars(current, result.bars)
        barsRef.current = mergedBars
        return mergedBars
      })
      historyCursorRef.current = range.from
      setCoverage((current) => mergeCoverage(current, result.coverage))
      setHasMore(range.from > chartHistoryFloor(timeframe, horizonTo) + 1)
    } catch (cause) {
      if (generationRef.current === generation) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      if (generationRef.current === generation) setLoadingOlder(false)
      olderRequestRef.current = false
    }
  }, [hasMore, ticker, timeframe])

  return {
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
  }
}
