"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  DEFAULT_INDICATOR_CONFIG,
  type ChartStyle,
  type ChartTimeframe,
  type DrawingObject,
  type IndicatorConfig,
} from "./stock-chart-types"
import {
  backupLegacyLocalSettings,
  deserializeUserChartSettings,
  isDrawingVisibleOnTimeframe,
  persistedV2ToRuntimeDrawing,
  runtimeDrawingToPersistedV2,
  type LegacyDrawing,
  type PersistedDrawingV2,
  type RuntimeDrawingObject,
  type UserChartSettingsPayloadV2,
} from "./drawings"

interface UseUserChartSyncOptions {
  ticker: string
  defaultTimeframe?: ChartTimeframe
  defaultChartStyle?: ChartStyle
  defaultIndicators?: IndicatorConfig
}

export type SaveStatus = "saved" | "saving" | "offline"
export const CHART_TIMEFRAME_EVENT = "qeo:chart-timeframe"

function getLocalKey(ticker: string) {
  return `qeo_chart_settings_${ticker.toUpperCase()}`
}

function readLocalChartSettings(ticker: string): {
  settings: UserChartSettingsPayloadV2 | null
  raw: string | null
} {
  if (typeof window === "undefined" || !window.localStorage) {
    return { settings: null, raw: null }
  }
  try {
    const raw = localStorage.getItem(getLocalKey(ticker))
    if (!raw) return { settings: null, raw: null }
    const { settings } = deserializeUserChartSettings(raw)
    return { settings, raw }
  } catch {
    return { settings: null, raw: null }
  }
}

export function readStoredChartTimeframe(ticker: string): ChartTimeframe | null {
  return readLocalChartSettings(ticker).settings?.timeframe ?? null
}

function mergeUnresolvedLegacyDrawings(
  current: LegacyDrawing[],
  incoming: LegacyDrawing[] | undefined,
): LegacyDrawing[] {
  if (!incoming || incoming.length === 0) return current

  const merged = [...current]
  const seen = new Set(current.map((drawing) => JSON.stringify(drawing)))
  for (const drawing of incoming) {
    const key = JSON.stringify(drawing)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(drawing)
  }
  return merged
}

export function useUserChartSync({
  ticker,
  defaultTimeframe = "1D",
  defaultChartStyle = "candles",
  defaultIndicators = DEFAULT_INDICATOR_CONFIG,
}: UseUserChartSyncOptions) {
  const [timeframe, setTimeframe] = useState<ChartTimeframe>(() => {
    return readLocalChartSettings(ticker).settings?.timeframe || defaultTimeframe
  })
  const [chartStyle, setChartStyle] = useState<ChartStyle>(() => {
    return readLocalChartSettings(ticker).settings?.chartStyle || defaultChartStyle
  })
  const [indicators, setIndicators] = useState<IndicatorConfig>(() => {
    const local = readLocalChartSettings(ticker).settings
    return local?.indicators ? { ...defaultIndicators, ...local.indicators } : defaultIndicators
  })
  const [allDrawings, setAllDrawings] = useState<DrawingObject[]>(() => {
    const local = readLocalChartSettings(ticker).settings
    if (local?.drawings && Array.isArray(local.drawings)) {
      return local.drawings.map((d) => persistedV2ToRuntimeDrawing(d))
    }
    return []
  })
  const drawings = useMemo(
    () =>
      allDrawings.filter((drawing) =>
        isDrawingVisibleOnTimeframe(drawing as RuntimeDrawingObject, timeframe),
      ),
    [allDrawings, timeframe],
  )
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved")

  const isLoadedRef = useRef(false)
  const currentTickerRef = useRef(ticker)
  const unresolvedLegacyDrawingsRef = useRef<LegacyDrawing[]>([])
  const localRevisionRef = useRef(0)
  const inFlightRevisionRef = useRef<number | null>(null)
  const pendingSaveRef = useRef<{
    revision: number
    payload: UserChartSettingsPayloadV2
  } | null>(null)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (typeof window === "undefined") return
    window.dispatchEvent(new CustomEvent(CHART_TIMEFRAME_EVENT, {
      detail: { ticker: ticker.toUpperCase(), timeframe },
    }))
  }, [ticker, timeframe])

  // Remote coalesced queue execution worker
  const drainSaveQueue = useCallback(() => {
    async function execute() {
      if (inFlightRevisionRef.current !== null) {
        return
      }

      if (!pendingSaveRef.current) {
        setSaveStatus("saved")
        return
      }

      const { revision, payload } = pendingSaveRef.current
      pendingSaveRef.current = null
      inFlightRevisionRef.current = revision
      setSaveStatus("saving")

      try {
        const res = await fetch("/api/user/chart-drawings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          setSaveStatus("offline")
        }
      } catch {
        setSaveStatus("offline")
      } finally {
        inFlightRevisionRef.current = null
        if (pendingSaveRef.current !== null) {
          void execute()
        } else {
          setSaveStatus((prev) => (prev === "offline" ? "offline" : "saved"))
        }
      }
    }

    void execute()
  }, [])

  // 1. Load data on mount or ticker change
  useEffect(() => {
    currentTickerRef.current = ticker
    unresolvedLegacyDrawingsRef.current = []
    isLoadedRef.current = false
    setAllDrawings([])
    let isCancelled = false

    async function syncSettings() {
      // Check local storage if ticker changed
      const { settings: local, raw } = readLocalChartSettings(ticker)
      if (raw && !raw.includes('\"drawingsSchemaVersion\":2')) {
        backupLegacyLocalSettings(ticker, raw)
      }

      if (local && !isCancelled) {
        unresolvedLegacyDrawingsRef.current = mergeUnresolvedLegacyDrawings(
          unresolvedLegacyDrawingsRef.current,
          local.unresolvedLegacyDrawings,
        )
        if (local.timeframe) setTimeframe(local.timeframe)
        if (local.chartStyle) setChartStyle(local.chartStyle)
        if (local.indicators) setIndicators({ ...defaultIndicators, ...local.indicators })
        if (Array.isArray(local.drawings)) {
          setAllDrawings(local.drawings.map((d) => persistedV2ToRuntimeDrawing(d)))
        }
      }

      // Fetch remote settings from Supabase API
      try {
        const res = await fetch(`/api/user/chart-drawings?ticker=${encodeURIComponent(ticker)}`, {
          cache: "no-store",
        })
        if (!res.ok) return
        const body = await res.json()
        if (isCancelled || !body.ok || !body.data) return

        const { settings: remote } = deserializeUserChartSettings(body.data)
        unresolvedLegacyDrawingsRef.current = mergeUnresolvedLegacyDrawings(
          unresolvedLegacyDrawingsRef.current,
          remote.unresolvedLegacyDrawings,
        )
        if (remote.timeframe) setTimeframe(remote.timeframe)
        if (remote.chartStyle) setChartStyle(remote.chartStyle)
        if (remote.indicators && Object.keys(remote.indicators).length > 0) {
          setIndicators({ ...DEFAULT_INDICATOR_CONFIG, ...remote.indicators })
        }
        if (Array.isArray(remote.drawings)) {
          setAllDrawings(remote.drawings.map((d) => persistedV2ToRuntimeDrawing(d)))
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

  // 2. Debounced coalesced remote save and immediate localStorage write
  const scheduleSave = useCallback(
    (
      newTimeframe: ChartTimeframe,
      newStyle: ChartStyle,
      newIndicators: IndicatorConfig,
      newDrawings: (DrawingObject | PersistedDrawingV2)[],
    ) => {
      const currentTicker = currentTickerRef.current
      localRevisionRef.current += 1
      const currentRevision = localRevisionRef.current

      // Convert runtime drawings to canonical PersistedDrawingV2
      const persistedDrawings: PersistedDrawingV2[] = []
      for (const d of newDrawings) {
        if ("schemaVersion" in d && d.schemaVersion === 2) {
          persistedDrawings.push(d)
        } else {
          const converted = runtimeDrawingToPersistedV2(d as DrawingObject, newTimeframe)
          if (converted) {
            persistedDrawings.push(converted)
          }
        }
      }

      const payload: UserChartSettingsPayloadV2 = {
        ticker: currentTicker,
        timeframe: newTimeframe,
        chartStyle: newStyle,
        indicators: newIndicators,
        drawingsSchemaVersion: 2,
        drawings: persistedDrawings,
        ...(unresolvedLegacyDrawingsRef.current.length > 0
          ? { unresolvedLegacyDrawings: unresolvedLegacyDrawingsRef.current }
          : {}),
        updatedAt: new Date().toISOString(),
      }

      // Immediate local save with legacy backup safeguard
      try {
        const rawExisting = localStorage.getItem(getLocalKey(currentTicker))
        if (rawExisting && !rawExisting.includes('\"drawingsSchemaVersion\":2')) {
          backupLegacyLocalSettings(currentTicker, rawExisting)
        }
        localStorage.setItem(getLocalKey(currentTicker), JSON.stringify(payload))
      } catch {
        // Quota exceeded fallback
      }

      // Enqueue latest revision
      pendingSaveRef.current = {
        revision: currentRevision,
        payload,
      }
      setSaveStatus("saving")

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }

      saveTimeoutRef.current = setTimeout(() => {
        drainSaveQueue()
      }, 750)
    },
    [drainSaveQueue],
  )

  // Wrapper setters that trigger sync
  const updateTimeframe = useCallback(
    (tf: ChartTimeframe) => {
      setTimeframe(tf)
      scheduleSave(tf, chartStyle, indicators, allDrawings)
    },
    [chartStyle, indicators, allDrawings, scheduleSave],
  )

  const updateChartStyle = useCallback(
    (st: ChartStyle) => {
      setChartStyle(st)
      scheduleSave(timeframe, st, indicators, allDrawings)
    },
    [timeframe, indicators, allDrawings, scheduleSave],
  )

  const updateIndicators = useCallback(
    (newInd: IndicatorConfig | ((prev: IndicatorConfig) => IndicatorConfig)) => {
      setIndicators((prev) => {
        const next = typeof newInd === "function" ? newInd(prev) : newInd
        scheduleSave(timeframe, chartStyle, next, allDrawings)
        return next
      })
    },
    [timeframe, chartStyle, allDrawings, scheduleSave],
  )

  const updateDrawings = useCallback(
    (newDrawings: DrawingObject[] | ((prev: DrawingObject[]) => DrawingObject[])) => {
      setAllDrawings((prev) => {
        const next = typeof newDrawings === "function" ? newDrawings(prev) : newDrawings
        scheduleSave(timeframe, chartStyle, indicators, next)
        return next
      })
    },
    [timeframe, chartStyle, indicators, scheduleSave],
  )

  const addDrawing = useCallback(
    (d: DrawingObject) => {
      const runtimeDrawing = d as RuntimeDrawingObject
      const drawingWithPersistenceMetadata: RuntimeDrawingObject = {
        ...runtimeDrawing,
        sourceTimeframe: runtimeDrawing.sourceTimeframe ?? timeframe,
        visibility: runtimeDrawing.visibility ?? "global",
      }
      updateDrawings((prev) => [...prev, drawingWithPersistenceMetadata])
    },
    [timeframe, updateDrawings],
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
