"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { OhlcvBar } from "@/modules/shared/technical/indicators"
import { chartHistoryFloor } from "@/modules/market/chart-data/history-policy"
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
    setError(null)
    setCoverage(null)
    setHasMore(true)

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
  }
}
