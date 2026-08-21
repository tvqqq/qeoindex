"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  EMPTY_VNINDEX_ACCUMULATOR,
  INDEX_CHART_SYMBOLS,
  accumulateVnindexFrame,
  mergeCandleSeries,
  normalizeCandleBar,
  normalizeDnseOhlcFrame,
  upsertCandleBar,
  type CandleBar,
  type IndexChartSymbol,
  type VnIndexAccumulatorState,
} from "@/lib/index-candles"
import { subscribeDnseMarketFrames } from "@/lib/dnse-market-stream"

type CandleMap = Record<IndexChartSymbol, CandleBar[]>
type ErrorMap = Partial<Record<IndexChartSymbol, string>>

type ApiResponse = {
  ok?: boolean
  generatedAt?: string
  candles?: Partial<Record<IndexChartSymbol, unknown[]>>
  errors?: ErrorMap
}

const EMPTY_CANDLES: CandleMap = { VNINDEX: [], VN30F1M: [] }

export function useIndexCandles(open: boolean) {
  const [candles, setCandles] = useState<CandleMap>(EMPTY_CANDLES)
  const [isLoading, setIsLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [errors, setErrors] = useState<ErrorMap>({})
  const [generatedAt, setGeneratedAt] = useState("")
  const [lastLiveAt, setLastLiveAt] = useState(0)

  const candlesRef = useRef<CandleMap>(EMPTY_CANDLES)
  const abortRef = useRef<AbortController | null>(null)
  const openRef = useRef(open)
  const accumulatorRef = useRef<VnIndexAccumulatorState>({ ...EMPTY_VNINDEX_ACCUMULATOR })
  const partialTimesRef = useRef<Record<IndexChartSymbol, Set<number>>>({ VNINDEX: new Set(), VN30F1M: new Set() })
  const fullLiveTimesRef = useRef<Record<IndexChartSymbol, Set<number>>>({ VNINDEX: new Set(), VN30F1M: new Set() })

  const commitCandles = useCallback((next: CandleMap) => {
    candlesRef.current = next
    setCandles(next)
  }, [])

  const applyLiveBar = useCallback((symbol: IndexChartSymbol, bar: CandleBar, partial: boolean) => {
    const partialTimes = partialTimesRef.current[symbol]
    const fullTimes = fullLiveTimesRef.current[symbol]
    if (partial) {
      partialTimes.clear()
      partialTimes.add(bar.time)
      fullTimes.clear()
    } else {
      fullTimes.clear()
      fullTimes.add(bar.time)
      partialTimes.clear()
    }

    const current = candlesRef.current
    const next = {
      ...current,
      [symbol]: upsertCandleBar(current[symbol], bar, partial),
    }
    commitCandles(next)
    setLastLiveAt(Date.now())
    setGeneratedAt(new Date().toISOString())
  }, [commitCandles])

  const performFetch = useCallback(async (manual = false) => {
    if (!openRef.current) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    if (manual) setIsRefreshing(true)
    if (!candlesRef.current.VNINDEX.length && !candlesRef.current.VN30F1M.length) setIsLoading(true)

    try {
      const response = await fetch("/api/market/index-candles", {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      })
      const payload = await response.json() as ApiResponse
      if (controller.signal.aborted || !openRef.current) return

      const current = candlesRef.current
      const next: CandleMap = { ...current }
      for (const symbol of INDEX_CHART_SYMBOLS) {
        const restBars = (payload.candles?.[symbol] ?? [])
          .map((value) => normalizeCandleBar(value))
          .filter((value): value is CandleBar => value !== null)
        if (!restBars.length) continue
        const overlayTimes = new Set<number>([
          ...partialTimesRef.current[symbol],
          ...fullLiveTimesRef.current[symbol],
        ])
        const liveOverlay = current[symbol].filter((bar) => overlayTimes.has(bar.time))
        next[symbol] = mergeCandleSeries(restBars, liveOverlay, partialTimesRef.current[symbol])
      }
      commitCandles(next)
      setErrors(payload.errors ?? {})
      setGeneratedAt(payload.generatedAt ?? new Date().toISOString())
      if (!response.ok && !next.VNINDEX.length && !next.VN30F1M.length) {
        throw new Error("Không tải được dữ liệu nến 1 phút từ DNSE")
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return
      if (!candlesRef.current.VNINDEX.length && !candlesRef.current.VN30F1M.length) {
        const message = error instanceof Error ? error.message : "Không tải được dữ liệu nến"
        setErrors({ VNINDEX: message, VN30F1M: message })
      }
    } finally {
      if (!controller.signal.aborted) {
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
    if (!open) {
      abortRef.current?.abort()
      return
    }

    accumulatorRef.current = { ...EMPTY_VNINDEX_ACCUMULATOR }
    partialTimesRef.current.VNINDEX.clear()
    partialTimesRef.current.VN30F1M.clear()
    fullLiveTimesRef.current.VNINDEX.clear()
    fullLiveTimesRef.current.VN30F1M.clear()

    const unsubscribe = subscribeDnseMarketFrames((frame) => {
      const full = normalizeDnseOhlcFrame(frame)
      if (full) {
        applyLiveBar(full.symbol, full.bar, false)
        return
      }

      if (String(frame.T ?? "") === "mi") {
        const result = accumulateVnindexFrame(accumulatorRef.current, frame)
        if (!result) return
        accumulatorRef.current = result.state
        applyLiveBar("VNINDEX", result.bar, true)
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
      partialTimesRef.current.VNINDEX.clear()
      partialTimesRef.current.VN30F1M.clear()
      fullLiveTimesRef.current.VNINDEX.clear()
      fullLiveTimesRef.current.VN30F1M.clear()
    }
  }, [open, applyLiveBar, performFetch])

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
