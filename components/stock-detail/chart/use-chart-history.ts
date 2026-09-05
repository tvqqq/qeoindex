"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { OhlcvBar } from "@/modules/shared/technical/indicators"
import type { ChartTimeframe } from "./stock-chart-types"
import {
  historyWindowSeconds,
  mergeChartBars,
  requestChartRange,
  type ChartHistoryResponse,
} from "./chart-history"

interface UseChartHistoryOptions {
  ticker: string
  timeframe: ChartTimeframe
  seedDailyBars?: OhlcvBar[]
}

function mergeCoverage(
  current: ChartHistoryResponse["coverage"] | null,
  incoming: ChartHistoryResponse["coverage"],
) {
  if (!current) return incoming
  const complete = current.complete && incoming.complete
  return { complete, state: complete ? "COMPLETE" as const : "PARTIAL" as const }
}

export function useChartHistory({ ticker, timeframe, seedDailyBars = [] }: UseChartHistoryOptions) {
  const [bars, setBars] = useState<OhlcvBar[]>(() => timeframe === "1D" ? seedDailyBars : [])
  const [loading, setLoading] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [coverage, setCoverage] = useState<ChartHistoryResponse["coverage"] | null>(null)
  const [hasMore, setHasMore] = useState(true)

  const barsRef = useRef(bars)
  const generationRef = useRef(0)
  const olderRequestRef = useRef(false)

  useEffect(() => {
    barsRef.current = bars
  }, [bars])

  useEffect(() => {
    const generation = ++generationRef.current
    const controller = new AbortController()
    const initialBars = timeframe === "1D" ? seedDailyBars : []
    barsRef.current = initialBars
    setBars(initialBars)
    setLoading(true)
    setLoadingOlder(false)
    olderRequestRef.current = false
    setError(null)
    setCoverage(null)
    setHasMore(true)

    const to = Math.floor(Date.now() / 1000)
    const from = Math.max(1, to - historyWindowSeconds(timeframe))

    void requestChartRange({ ticker, timeframe, from, to }, controller.signal)
      .then((result) => {
        if (generationRef.current !== generation) return
        setBars((current) => {
          const merged = mergeChartBars(current, result.bars)
          barsRef.current = merged
          return merged
        })
        setCoverage(result.coverage)
        setHasMore(result.bars.length > 0)
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || generationRef.current !== generation) return
        setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (generationRef.current === generation) setLoading(false)
      })

    return () => controller.abort()
  }, [seedDailyBars, ticker, timeframe])

  const loadOlder = useCallback(async () => {
    if (olderRequestRef.current || !hasMore) return
    const earliest = barsRef.current[0]?.time
    if (!earliest || earliest <= 1) {
      setHasMore(false)
      return
    }

    olderRequestRef.current = true
    setLoadingOlder(true)
    const generation = generationRef.current
    const to = earliest - 1
    const from = Math.max(1, to - historyWindowSeconds(timeframe))

    try {
      const result = await requestChartRange({ ticker, timeframe, from, to })
      if (generationRef.current !== generation) return
      setBars((current) => {
        const merged = mergeChartBars(current, result.bars)
        barsRef.current = merged
        return merged
      })
      setCoverage((current) => mergeCoverage(current, result.coverage))
      if (result.bars.length === 0) setHasMore(false)
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
  }
}
