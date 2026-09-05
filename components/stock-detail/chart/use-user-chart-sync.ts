"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  DEFAULT_INDICATOR_CONFIG,
  type ChartStyle,
  type ChartTimeframe,
  type DrawingObject,
  type IndicatorConfig,
  type UserChartSettingsPayload,
} from "./stock-chart-types"

interface UseUserChartSyncOptions {
  ticker: string
  defaultTimeframe?: ChartTimeframe
  defaultChartStyle?: ChartStyle
  defaultIndicators?: IndicatorConfig
}

export type SaveStatus = "saved" | "saving" | "offline"

function getLocalKey(ticker: string) {
  return `qeo_chart_settings_${ticker.toUpperCase()}`
}

function readLocalChartSettings(ticker: string): Partial<UserChartSettingsPayload> | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(getLocalKey(ticker))
    return raw ? (JSON.parse(raw) as Partial<UserChartSettingsPayload>) : null
  } catch {
    return null
  }
}

export function useUserChartSync({
  ticker,
  defaultTimeframe = "1D",
  defaultChartStyle = "candles",
  defaultIndicators = DEFAULT_INDICATOR_CONFIG,
}: UseUserChartSyncOptions) {
  const [timeframe, setTimeframe] = useState<ChartTimeframe>(() => {
    return readLocalChartSettings(ticker)?.timeframe || defaultTimeframe
  })
  const [chartStyle, setChartStyle] = useState<ChartStyle>(() => {
    return readLocalChartSettings(ticker)?.chartStyle || defaultChartStyle
  })
  const [indicators, setIndicators] = useState<IndicatorConfig>(() => {
    const local = readLocalChartSettings(ticker)
    return local?.indicators ? { ...defaultIndicators, ...local.indicators } : defaultIndicators
  })
  const [drawings, setDrawings] = useState<DrawingObject[]>(() => {
    const local = readLocalChartSettings(ticker)
    return Array.isArray(local?.drawings) ? local.drawings : []
  })
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved")

  const isLoadedRef = useRef(false)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const currentTickerRef = useRef(ticker)

  // 1. Load data on mount or ticker change
  useEffect(() => {
    currentTickerRef.current = ticker
    isLoadedRef.current = false
    let isCancelled = false

    async function syncSettings() {
      // Check local storage if ticker changed
      const local = readLocalChartSettings(ticker)
      if (local && !isCancelled) {
        if (local.timeframe) setTimeframe(local.timeframe)
        if (local.chartStyle) setChartStyle(local.chartStyle)
        if (local.indicators) setIndicators({ ...defaultIndicators, ...local.indicators })
        if (Array.isArray(local.drawings)) setDrawings(local.drawings)
      }

      // Fetch remote settings from Supabase API
      try {
        const res = await fetch(`/api/user/chart-drawings?ticker=${encodeURIComponent(ticker)}`, {
          cache: "no-store",
        })
        if (!res.ok) return
        const body = await res.json()
        if (isCancelled || !body.ok || !body.data) return

        const remote = body.data as Partial<UserChartSettingsPayload>
        if (remote.timeframe) setTimeframe(remote.timeframe)
        if (remote.chartStyle) setChartStyle(remote.chartStyle)
        if (remote.indicators && Object.keys(remote.indicators).length > 0) {
          setIndicators({ ...DEFAULT_INDICATOR_CONFIG, ...remote.indicators })
        }
        if (Array.isArray(remote.drawings)) {
          setDrawings(remote.drawings)
        }
      } catch (err) {
        console.warn("[useUserChartSync] Failed to fetch remote settings, using local:", err)
      } finally {
        if (!isCancelled) {
          isLoadedRef.current = true
        }
      }
    }

    void syncSettings()

    return () => {
      isCancelled = true
    }
  }, [ticker, defaultTimeframe, defaultChartStyle, defaultIndicators])

  // 2. Debounced save to API and immediate save to localStorage
  const scheduleSave = useCallback(
    (
      newTimeframe: ChartTimeframe,
      newStyle: ChartStyle,
      newIndicators: IndicatorConfig,
      newDrawings: DrawingObject[],
    ) => {
      const currentTicker = currentTickerRef.current
      const payload: UserChartSettingsPayload = {
        ticker: currentTicker,
        timeframe: newTimeframe,
        chartStyle: newStyle,
        indicators: newIndicators,
        drawings: newDrawings,
        updatedAt: new Date().toISOString(),
      }

      // Immediate local save
      try {
        localStorage.setItem(getLocalKey(currentTicker), JSON.stringify(payload))
      } catch {
        // quota exceeded fallback
      }

      // Debounced remote save
      setSaveStatus("saving")
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }

      saveTimeoutRef.current = setTimeout(async () => {
        try {
          const res = await fetch("/api/user/chart-drawings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
          if (res.ok) {
            setSaveStatus("saved")
          } else {
            setSaveStatus("offline")
          }
        } catch {
          setSaveStatus("offline")
        }
      }, 750)
    },
    [],
  )

  // Wrapper setters that trigger sync
  const updateTimeframe = useCallback(
    (tf: ChartTimeframe) => {
      setTimeframe(tf)
      scheduleSave(tf, chartStyle, indicators, drawings)
    },
    [chartStyle, indicators, drawings, scheduleSave],
  )

  const updateChartStyle = useCallback(
    (st: ChartStyle) => {
      setChartStyle(st)
      scheduleSave(timeframe, st, indicators, drawings)
    },
    [timeframe, indicators, drawings, scheduleSave],
  )

  const updateIndicators = useCallback(
    (newInd: IndicatorConfig | ((prev: IndicatorConfig) => IndicatorConfig)) => {
      setIndicators((prev) => {
        const next = typeof newInd === "function" ? newInd(prev) : newInd
        scheduleSave(timeframe, chartStyle, next, drawings)
        return next
      })
    },
    [timeframe, chartStyle, drawings, scheduleSave],
  )

  const updateDrawings = useCallback(
    (newDrawings: DrawingObject[] | ((prev: DrawingObject[]) => DrawingObject[])) => {
      setDrawings((prev) => {
        const next = typeof newDrawings === "function" ? newDrawings(prev) : newDrawings
        scheduleSave(timeframe, chartStyle, indicators, next)
        return next
      })
    },
    [timeframe, chartStyle, indicators, scheduleSave],
  )

  const addDrawing = useCallback(
    (d: DrawingObject) => {
      updateDrawings((prev) => [...prev, d])
    },
    [updateDrawings],
  )

  const modifyDrawing = useCallback(
    (id: string, patch: Partial<DrawingObject>) => {
      updateDrawings((prev) =>
        prev.map((d) => (d.id === id ? { ...d, ...patch } : d)),
      )
    },
    [updateDrawings],
  )

  const deleteDrawing = useCallback(
    (id: string) => {
      updateDrawings((prev) => prev.filter((d) => d.id !== id))
    },
    [updateDrawings],
  )

  const clearAllDrawings = useCallback(() => {
    updateDrawings([])
  }, [updateDrawings])

  return {
    timeframe,
    setTimeframe: updateTimeframe,
    chartStyle,
    setChartStyle: updateChartStyle,
    indicators,
    setIndicators: updateIndicators,
    drawings,
    setDrawings: updateDrawings,
    addDrawing,
    modifyDrawing,
    deleteDrawing,
    clearAllDrawings,
    saveStatus,
  }
}
