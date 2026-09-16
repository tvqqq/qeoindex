"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import type { OhlcvBar } from "@/modules/shared/technical/indicators"
import { chartHistoryFloor } from "@/modules/market/chart-data/history-policy"
import type { ChartTimeframe } from "./stock-chart-types"
import {
  deriveChartBarsFromDailySeed,
  loadInitialChartHistory,
  mergeChartBars,
  olderChartHistoryRange,
  requestChartRange,
  type ChartHistoryResponse,
  type PreparedChartHistory,
} from "./chart-history"

interface UseChartHistoryOptions {
  ticker: string
  timeframe: ChartTimeframe
  seedDailyBars?: OhlcvBar[]
  preparedInitial?: PreparedChartHistory | null
}

type LiveState = "closed" | "live" | "stale"

function mergeCoverage(
  current: ChartHistoryResponse["coverage"] | null,
  incoming: ChartHistoryResponse["coverage"],
) {
  if (!current) return incoming
  const complete = current.complete && incoming.complete
  return { complete, state: complete ? "COMPLETE" as const : "PARTIAL" as const }
}

function preparedMatches(prepared: PreparedChartHistory | null | undefined, ticker: string, timeframe: ChartTimeframe) {
  return Boolean(
    prepared
    && prepared.ticker === ticker.trim().toUpperCase()
    && prepared.timeframe === timeframe,
  )
}

export function useChartHistory({
  ticker,
  timeframe,
  seedDailyBars = [],
  preparedInitial = null,
}: UseChartHistoryOptions) {
  const exactPrepared = preparedMatches(preparedInitial, ticker, timeframe) ? preparedInitial : null
  const seedBars = useMemo(
    () => deriveChartBarsFromDailySeed(seedDailyBars, timeframe),
    [seedDailyBars, timeframe],
  )
  const hasUsableDailySeed = seedBars.length > 0
  const [bars, setBars] = useState<OhlcvBar[]>(() => exactPrepared?.result.bars ?? seedBars)
  const [loading, setLoading] = useState(() => !exactPrepared && !hasUsableDailySeed)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [coverage, setCoverage] = useState<ChartHistoryResponse["coverage"] | null>(() => exactPrepared?.result.coverage ?? null)
  const [hasMore, setHasMore] = useState(true)
  const [liveState] = useState<LiveState>("closed")
  const [liveError] = useState<string | null>(null)
  const [liveProvider] = useState<string | null>(null)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(() => exactPrepared?.result.metadata?.lastUpdatedAt ?? exactPrepared?.result.generatedAt ?? null)

  const barsRef = useRef(bars)
  const generationRef = useRef(0)
  const olderRequestRef = useRef(false)
  const horizonToRef = useRef<number | null>(null)
  const historyCursorRef = useRef<number | null>(null)

  useEffect(() => {
    barsRef.current = bars
  }, [bars])

  useLayoutEffect(() => {
    const generation = ++generationRef.current
    const controller = new AbortController()
    const prepared = preparedMatches(preparedInitial, ticker, timeframe) ? preparedInitial : null
    const initialBars = prepared?.result.bars ?? seedBars
    barsRef.current = initialBars
    historyCursorRef.current = prepared?.range.from ?? null
    setBars(initialBars)
    setLoading(!prepared && !hasUsableDailySeed)
    setLoadingOlder(false)
    olderRequestRef.current = false
    setError(null)
    setCoverage(prepared?.result.coverage ?? null)
    setLastUpdatedAt(prepared?.result.metadata?.lastUpdatedAt ?? prepared?.result.generatedAt ?? null)

    if (prepared) {
      const horizonTo = prepared.range.to
      horizonToRef.current = horizonTo
      setHasMore(prepared.range.from > chartHistoryFloor(timeframe, horizonTo) + 1)
      return () => controller.abort()
    }

    if (hasUsableDailySeed) {
      const horizonTo = seedDailyBars.at(-1)?.time ?? seedBars.at(-1)?.time ?? null
      const historyCursor = seedDailyBars.at(0)?.time ?? seedBars.at(0)?.time ?? null
      horizonToRef.current = horizonTo
      historyCursorRef.current = historyCursor
      setHasMore(Boolean(
        horizonTo
        && historyCursor
        && historyCursor > chartHistoryFloor(timeframe, horizonTo) + 1,
      ))
      setLoading(false)
      return () => controller.abort()
    }

    const now = new Date()
    const to = Math.floor(now.getTime() / 1000)
    horizonToRef.current = to

    void loadInitialChartHistory({ ticker, timeframe, now, signal: controller.signal })
      .then(({ range, result }) => {
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
  }, [hasUsableDailySeed, preparedInitial, seedBars, seedDailyBars, ticker, timeframe])

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