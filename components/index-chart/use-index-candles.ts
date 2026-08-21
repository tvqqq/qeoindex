"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  EMPTY_VNINDEX_ACCUMULATOR,
  INDEX_CHART_SYMBOLS,
  accumulateVnindexFrame,
  mergeMinuteIntoTimeframeSeries,
  mergeTimeframeSeries,
  normalizeCandleBar,
  normalizeDnseOhlcFrame,
  timeframeBucketKey,
  type CandleBar,
  type IndexChartResolution,
  type IndexChartSymbol,
  type VnIndexAccumulatorState,
} from "@/lib/index-candles"
import { subscribeDnseMarketFrames } from "@/lib/dnse-market-stream"

type CandleMap = Record<IndexChartSymbol, CandleBar[]>
type ErrorMap = Partial<Record<IndexChartSymbol, string>>

type ApiResponse = {
  ok?: boolean
  resolution?: IndexChartResolution
  generatedAt?: string
  candles?: Partial<Record<IndexChartSymbol, unknown[]>>
  errors?: ErrorMap
}

function emptyCandles(): CandleMap {
  return { VNINDEX: [], VN30F1M: [] }
}

export function useIndexCandles(open: boolean, resolution: IndexChartResolution) {
  const [candles, setCandles] = useState<CandleMap>(() => emptyCandles())
  const [isLoading, setIsLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [errors, setErrors] = useState<ErrorMap>({})
  const [generatedAt, setGeneratedAt] = useState("")
  const [lastLiveAt, setLastLiveAt] = useState(0)

  const candlesRef = useRef<CandleMap>(emptyCandles())
  const cacheRef = useRef<Partial<Record<IndexChartResolution, CandleMap>>>({})
  const abortRef = useRef<AbortController | null>(null)
  const openRef = useRef(open)
  const resolutionRef = useRef(resolution)
  const accumulatorRef = useRef<VnIndexAccumulatorState>({ ...EMPTY_VNINDEX_ACCUMULATOR })
  const liveBucketKeysRef = useRef<Record<IndexChartSymbol, Set<string>>>({ VNINDEX: new Set(), VN30F1M: new Set() })

  const commitCandles = useCallback((next: CandleMap) => {
    candlesRef.current = next
    cacheRef.current[resolutionRef.current] = next
    setCandles(next)
  }, [])

  const applyLiveMinuteBar = useCallback((symbol: IndexChartSymbol, bar: CandleBar, partialMinute: boolean) => {
    const activeResolution = resolutionRef.current
    liveBucketKeysRef.current[symbol].add(timeframeBucketKey(bar.time, symbol, activeResolution))
    const current = candlesRef.current
    const next = {
      ...current,
      [symbol]: mergeMinuteIntoTimeframeSeries(
        current[symbol],
        bar,
        activeResolution,
        symbol,
        partialMinute,
      ),
    }
    commitCandles(next)
    setLastLiveAt(Date.now())
    setGeneratedAt(new Date().toISOString())
  }, [commitCandles])

  const performFetch = useCallback(async (manual = false) => {
    if (!openRef.current) return
    const requestedResolution = resolutionRef.current
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    if (manual) setIsRefreshing(true)
    if (!candlesRef.current.VNINDEX.length && !candlesRef.current.VN30F1M.length) setIsLoading(true)

    try {
      const response = await fetch(`/api/market/index-candles?resolution=${encodeURIComponent(requestedResolution)}`, {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      })
      const payload = await response.json() as ApiResponse
      if (controller.signal.aborted || !openRef.current || resolutionRef.current !== requestedResolution) return

      const current = candlesRef.current
      const next: CandleMap = { ...current }
      for (const symbol of INDEX_CHART_SYMBOLS) {
        const restBars = (payload.candles?.[symbol] ?? [])
          .map((value) => normalizeCandleBar(value))
          .filter((value): value is CandleBar => value !== null)
        if (!restBars.length) continue

        const liveKeys = liveBucketKeysRef.current[symbol]
        const liveOverlay = current[symbol].filter((bar) =>
          liveKeys.has(timeframeBucketKey(bar.time, symbol, requestedResolution)),
        )
        next[symbol] = mergeTimeframeSeries(
          restBars,
          liveOverlay,
          requestedResolution,
          symbol,
          symbol === "VNINDEX" || requestedResolution !== "1",
        )
      }
      commitCandles(next)
      setErrors(payload.errors ?? {})
      setGeneratedAt(payload.generatedAt ?? new Date().toISOString())
      if (!response.ok && !next.VNINDEX.length && !next.VN30F1M.length) {
        throw new Error(`Không tải được dữ liệu ${requestedResolution} từ DNSE`)
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return
      if (!candlesRef.current.VNINDEX.length && !candlesRef.current.VN30F1M.length) {
        const message = error instanceof Error ? error.message : "Không tải được dữ liệu nến"
        setErrors({ VNINDEX: message, VN30F1M: message })
      }
    } finally {
      if (!controller.signal.aborted && resolutionRef.current === requestedResolution) {
        setIsLoading(false)
        setIsRefreshing(false)
      }
    }
  }, [commitCandles])

  const refresh = useCallback(() => {
    void performFetch(true)
  }, [performFetch])

  useEffect(() => {
    openRef.current = open
    resolutionRef.current = resolution
    if (!open) {
      abortRef.current?.abort()
      return
    }

    const cached = cacheRef.current[resolution] ?? emptyCandles()
    candlesRef.current = cached
    setCandles(cached)
    setErrors({})
    setIsLoading(!cached.VNINDEX.length && !cached.VN30F1M.length)
    setIsRefreshing(false)
    accumulatorRef.current = { ...EMPTY_VNINDEX_ACCUMULATOR }
    liveBucketKeysRef.current.VNINDEX.clear()
    liveBucketKeysRef.current.VN30F1M.clear()

    const unsubscribe = subscribeDnseMarketFrames((frame) => {
      const full = normalizeDnseOhlcFrame(frame)
      if (full) {
        applyLiveMinuteBar(full.symbol, full.bar, false)
        return
      }

      if (String(frame.T ?? "") === "mi") {
        const result = accumulateVnindexFrame(accumulatorRef.current, frame)
        if (!result) return
        accumulatorRef.current = result.state
        applyLiveMinuteBar("VNINDEX", result.bar, true)
      }
    })

    void performFetch(false)
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void performFetch(false)
    }, 30_000)
    const onVisibility = () => {
      if (document.visibilityState === "visible") void performFetch(false)
    }
    document.addEventListener("visibilitychange", onVisibility)

    return () => {
      unsubscribe()
      window.clearInterval(poll)
      document.removeEventListener("visibilitychange", onVisibility)
      abortRef.current?.abort()
      liveBucketKeysRef.current.VNINDEX.clear()
      liveBucketKeysRef.current.VN30F1M.clear()
    }
  }, [open, resolution, applyLiveMinuteBar, performFetch])

  return {
    candles,
    isLoading,
    isRefreshing,
    errors,
    generatedAt,
    lastLiveAt,
    refresh,
  }
}
