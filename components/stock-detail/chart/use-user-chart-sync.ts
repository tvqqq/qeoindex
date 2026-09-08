"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import {
  DEFAULT_INDICATOR_CONFIG,
  type ChartViewSettings,
  type ChartStyle,
  type ChartTimeframe,
  type DrawingObject,
  type IndicatorConfig,
} from "./stock-chart-types"
import {
  defaultChartViewSettings,
  normalizeChartViewSettings,
  readCachedChartViewSettings,
  writeCachedChartViewSettings,
} from "./chart-view-settings"
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
import {
  canEditChartDrawings,
  mergeRemoteChartSettingsIntoPending,
  shouldApplyRemoteChartSettings,
  type ChartSettingsField,
} from "./chart-settings-hydration"

interface UseUserChartSyncOptions {
  ticker: string
  preferredTimeframe?: ChartTimeframe | null
  defaultTimeframe?: ChartTimeframe
  defaultChartStyle?: ChartStyle
  defaultIndicators?: IndicatorConfig
}

export type SaveStatus = "saved" | "saving" | "offline"
export type DrawingSyncStatus = "hydrating" | "ready" | "offline"
export const CHART_TIMEFRAME_EVENT = "qeo:chart-timeframe"
export { shouldApplyRemoteChartSettings } from "./chart-settings-hydration"

interface ChartSyncGeneration {
  id: number
  ticker: string
  requestRevision: number
  hydrated: boolean
  hydrationFailed: boolean
  localFieldIntents: Set<ChartSettingsField>
  localDrawingEditIntent: boolean
  remoteSettings: UserChartSettingsPayloadV2 | null
  unresolvedLegacyDrawings: LegacyDrawing[]
  remoteViewSettings: ChartViewSettings | null
  viewSettingsScope: string | null
}

interface PendingChartSave {
  generationId: number
  revision: number
  payload: UserChartSettingsPayloadV2
}

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
  preferredTimeframe = null,
  defaultTimeframe = "1D",
  defaultChartStyle = "candles",
  defaultIndicators = DEFAULT_INDICATOR_CONFIG,
}: UseUserChartSyncOptions) {
  const [timeframe, setTimeframe] = useState<ChartTimeframe>(() => {
    return preferredTimeframe ?? readLocalChartSettings(ticker).settings?.timeframe ?? defaultTimeframe
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
  const generationSequenceRef = useRef(0)
  const activeGenerationRef = useRef<ChartSyncGeneration>({
    id: 0,
    ticker: ticker.toUpperCase(),
    requestRevision: 0,
    hydrated: false,
    hydrationFailed: false,
    localFieldIntents: new Set(),
    localDrawingEditIntent: false,
    remoteSettings: null,
    unresolvedLegacyDrawings: [],
    remoteViewSettings: null,
    viewSettingsScope: null,
  })
  const generationsRef = useRef(new Map<number, ChartSyncGeneration>())
  const localRevisionRef = useRef(0)
  const inFlightSaveRef = useRef<PendingChartSave | null>(null)
  const pendingSaveRef = useRef(new Map<number, PendingChartSave>())
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const retryHydrationRef = useRef<(() => void) | null>(null)
  const viewSettingsScopeRef = useRef<string | null>(null)
  const [viewSettings, setViewSettings] = useState<ChartViewSettings>(() => defaultChartViewSettings())
  const [drawingSyncStatus, setDrawingSyncStatus] = useState<DrawingSyncStatus>("hydrating")

  const normalizedTicker = ticker.toUpperCase()

  // Update the cross-ticker guard before browser events can reach the newly
  // committed chart. The save callback also compares its render-time ticker
  // so a click in the narrow pre-effect window cannot target the old queue.
  useLayoutEffect(() => {
    currentTickerRef.current = normalizedTicker
  }, [normalizedTicker])

  useEffect(() => {
    if (typeof window === "undefined") return
    window.dispatchEvent(new CustomEvent(CHART_TIMEFRAME_EVENT, {
      detail: { ticker: ticker.toUpperCase(), timeframe },
    }))
  }, [ticker, timeframe])

  const writeLocalPayload = useCallback((payload: UserChartSettingsPayloadV2) => {
    try {
      localStorage.setItem(getLocalKey(payload.ticker), JSON.stringify(payload))
    } catch {
      // Local storage is a best-effort cache; remote persistence remains the authority.
    }
  }, [])

  const mergeRemoteFieldsIntoPendingSave = useCallback((generation: ChartSyncGeneration) => {
    const remote = generation.remoteSettings
    if (!remote) return
    const pending = pendingSaveRef.current.get(generation.id)
    if (!pending) return

    const mergedRemote = mergeRemoteChartSettingsIntoPending(
      pending.payload,
      remote,
      generation.localFieldIntents,
      generation.localDrawingEditIntent,
    )
    const payload: UserChartSettingsPayloadV2 = {
      ...mergedRemote,
      ...(remote.unresolvedLegacyDrawings && remote.unresolvedLegacyDrawings.length > 0
        ? { unresolvedLegacyDrawings: mergeUnresolvedLegacyDrawings(
            pending.payload.unresolvedLegacyDrawings ?? [],
            remote.unresolvedLegacyDrawings,
          ) }
        : {}),
    }
    const merged = { ...pending, payload }
    pendingSaveRef.current.set(generation.id, merged)
    writeLocalPayload(payload)
    if (generation.localFieldIntents.has("viewSettings") && generation.viewSettingsScope && payload.viewSettings) {
      writeCachedChartViewSettings(generation.viewSettingsScope, payload.viewSettings)
    }
  }, [writeLocalPayload])

  // Remote coalesced queue execution worker. Each generation owns its ticker
  // and payload, so switching tickers can never retarget an older save.
  const drainSaveQueue = useCallback(() => {
    async function execute() {
      if (inFlightSaveRef.current !== null) {
        return
      }

      const pending = [...pendingSaveRef.current.values()]
        .sort((left, right) => left.revision - right.revision)
        .find((candidate) => {
          const generation = generationsRef.current.get(candidate.generationId)
          if (!generation?.hydrated) return false
          // A failed hydration leaves the remote drawing set unknown. Even a
          // deliberate local edit must wait for a successful merge so a full
          // payload can never replace unknown remote objects with a partial set.
          if (generation.hydrationFailed) return false
          return true
        })

      if (!pending) {
        if (pendingSaveRef.current.size === 0) {
          const active = activeGenerationRef.current
          setSaveStatus(!active.hydrated ? "saving" : active.hydrationFailed ? "offline" : "saved")
        } else {
          const waitingForHydration = [...pendingSaveRef.current.values()].some((candidate) => {
            const generation = generationsRef.current.get(candidate.generationId)
            return Boolean(generation && !generation.hydrated && !generation.hydrationFailed)
          })
          setSaveStatus(waitingForHydration ? "saving" : "offline")
        }
        return
      }

      pendingSaveRef.current.delete(pending.generationId)
      inFlightSaveRef.current = pending
      setSaveStatus("saving")

      try {
        const res = await fetch("/api/user/chart-drawings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(pending.payload),
        })
        if (!res.ok) {
          setSaveStatus("offline")
        }
      } catch {
        setSaveStatus("offline")
      } finally {
        inFlightSaveRef.current = null
        const generation = generationsRef.current.get(pending.generationId)
        if (generation && pendingSaveRef.current.has(generation.id)) {
          void execute()
        } else if (pendingSaveRef.current.size > 0) {
          void execute()
        } else {
          setSaveStatus((prev) => (prev === "offline" ? "offline" : "saved"))
        }
        if (generation && generation.id !== activeGenerationRef.current.id && !pendingSaveRef.current.has(generation.id)) {
          generationsRef.current.delete(generation.id)
        }
      }
    }

    void execute()
  }, [])

  const markLocalFieldIntent = useCallback((field: ChartSettingsField) => {
    const generation = activeGenerationRef.current
    generation.localFieldIntents.add(field)
    if (field === "drawings") generation.localDrawingEditIntent = true
  }, [])

  // 1. Load data on mount or ticker change
  useEffect(() => {
    const generation: ChartSyncGeneration = {
      id: generationSequenceRef.current + 1,
      ticker: ticker.toUpperCase(),
      requestRevision: localRevisionRef.current,
      hydrated: false,
      hydrationFailed: false,
      localFieldIntents: new Set(preferredTimeframe ? ["timeframe"] : []),
      localDrawingEditIntent: false,
      remoteSettings: null,
      unresolvedLegacyDrawings: [],
      remoteViewSettings: null,
      viewSettingsScope: null,
    }
    generationSequenceRef.current = generation.id
    generationsRef.current.set(generation.id, generation)
    activeGenerationRef.current = generation
    currentTickerRef.current = generation.ticker
    unresolvedLegacyDrawingsRef.current = []
    isLoadedRef.current = false
    setDrawingSyncStatus("hydrating")
    setAllDrawings([])
    let isCancelled = false

    async function syncSettings() {
      generation.hydrated = false
      generation.hydrationFailed = false
      generation.remoteSettings = null
      generation.remoteViewSettings = null
      generation.viewSettingsScope = null
      if (!isCancelled && activeGenerationRef.current.id === generation.id) {
        setDrawingSyncStatus("hydrating")
      }
      const { settings: local, raw } = readLocalChartSettings(ticker)
      if (raw && !raw.includes('\"drawingsSchemaVersion\":2')) {
        backupLegacyLocalSettings(ticker, raw)
      }

      if (local && !isCancelled && activeGenerationRef.current.id === generation.id) {
        generation.unresolvedLegacyDrawings = mergeUnresolvedLegacyDrawings(
          generation.unresolvedLegacyDrawings,
          local.unresolvedLegacyDrawings,
        )
        unresolvedLegacyDrawingsRef.current = generation.unresolvedLegacyDrawings
        setTimeframe(preferredTimeframe ?? local.timeframe ?? defaultTimeframe)
        if (local.chartStyle) setChartStyle(local.chartStyle)
        if (local.indicators) setIndicators({ ...defaultIndicators, ...local.indicators })
        if (Array.isArray(local.drawings)) {
          setAllDrawings(local.drawings.map((d) => persistedV2ToRuntimeDrawing(d)))
        }
      }

      const requestRevision = generation.requestRevision
      try {
        const res = await fetch(`/api/user/chart-drawings?ticker=${encodeURIComponent(ticker)}`, {
          cache: "no-store",
        })
        if (!res.ok) throw new Error(`Chart settings request failed with ${res.status}`)
        const body = await res.json()
        if (!body.ok || !body.data) throw new Error("Chart settings response was missing data")

        const { settings: remote } = deserializeUserChartSettings(body.data)
        const remoteViewSettings = normalizeChartViewSettings(body.viewSettings ?? remote.viewSettings)
        const scope = typeof body.viewSettingsScope === "string"
          ? body.viewSettingsScope
          : typeof remote.viewSettingsScope === "string" ? remote.viewSettingsScope : null
        const viewSettingsConfigured = body.viewSettingsConfigured === true
        generation.remoteSettings = remote
        generation.remoteViewSettings = remoteViewSettings
        generation.viewSettingsScope = scope
        const current = !isCancelled && activeGenerationRef.current.id === generation.id
        if (current && !generation.localFieldIntents.has("viewSettings")) {
          setDrawingSyncStatus("ready")
          viewSettingsScopeRef.current = scope
          setViewSettings(remoteViewSettings)
          if (scope) writeCachedChartViewSettings(scope, remoteViewSettings)
        } else if (current) {
          setDrawingSyncStatus("ready")
          viewSettingsScopeRef.current = scope
        }
        const revisionMatches = shouldApplyRemoteChartSettings(
          requestRevision,
          localRevisionRef.current,
          false,
        )
        const canApplyField = (field: ChartSettingsField) =>
          current && (revisionMatches || !generation.localFieldIntents.has(field))

        generation.unresolvedLegacyDrawings = mergeUnresolvedLegacyDrawings(
          generation.unresolvedLegacyDrawings,
          remote.unresolvedLegacyDrawings,
        )
        if (current) unresolvedLegacyDrawingsRef.current = generation.unresolvedLegacyDrawings
        if (canApplyField("timeframe")) setTimeframe(remote.timeframe)
        if (canApplyField("chartStyle")) setChartStyle(remote.chartStyle)
        if (canApplyField("indicators")) setIndicators({ ...DEFAULT_INDICATOR_CONFIG, ...remote.indicators })
        if (
          current
          && viewSettingsConfigured
          && !generation.localFieldIntents.has("indicators")
          && canApplyField("viewSettings")
        ) {
          setIndicators({ ...DEFAULT_INDICATOR_CONFIG, ...remoteViewSettings.indicatorVisibility })
        }
        if (current && canApplyField("viewSettings")) {
          setViewSettings(remoteViewSettings)
          if (scope) writeCachedChartViewSettings(scope, remoteViewSettings)
        }
        if (canApplyField("drawings") && !generation.localDrawingEditIntent) {
          setAllDrawings(remote.drawings.map((d) => persistedV2ToRuntimeDrawing(d)))
        }
        mergeRemoteFieldsIntoPendingSave(generation)
      } catch (err) {
        generation.hydrationFailed = true
        if (!isCancelled && activeGenerationRef.current.id === generation.id) {
          const cachedViewSettings = viewSettingsScopeRef.current
            ? readCachedChartViewSettings(viewSettingsScopeRef.current)
            : null
          if (cachedViewSettings) setViewSettings(cachedViewSettings)
          setDrawingSyncStatus("offline")
          setSaveStatus("offline")
          console.warn("[useUserChartSync] Failed to fetch remote settings, using local:", err)
        }
      } finally {
        generation.hydrated = true
        if (!isCancelled && activeGenerationRef.current.id === generation.id) {
          isLoadedRef.current = true
        }
        drainSaveQueue()
      }
    }

    const retry = () => {
      if (isCancelled || activeGenerationRef.current.id !== generation.id) return
      void syncSettings()
    }
    retryHydrationRef.current = retry
    void syncSettings()

    return () => {
      isCancelled = true
      if (retryHydrationRef.current === retry) retryHydrationRef.current = null
    }
  }, [defaultChartStyle, defaultIndicators, defaultTimeframe, drainSaveQueue, mergeRemoteFieldsIntoPendingSave, preferredTimeframe, ticker])

  const retryChartHydration = useCallback(() => {
    retryHydrationRef.current?.()
  }, [])

  // 2. Debounced coalesced remote save and immediate localStorage write
  const scheduleSave = useCallback(
    (
      newTimeframe: ChartTimeframe,
      newStyle: ChartStyle,
      newIndicators: IndicatorConfig,
      newDrawings: (DrawingObject | PersistedDrawingV2)[],
      newViewSettings?: ChartViewSettings,
    ) => {
      const generation = activeGenerationRef.current
      const currentTicker = currentTickerRef.current
      if (!generation.ticker || generation.ticker !== currentTicker || generation.ticker !== normalizedTicker) return
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
        ticker: generation.ticker,
        timeframe: newTimeframe,
        chartStyle: newStyle,
        indicators: newIndicators,
        drawingsSchemaVersion: 2,
        drawings: persistedDrawings,
        ...((newViewSettings ?? (generation.localFieldIntents.has("viewSettings")
          ? pendingSaveRef.current.get(generation.id)?.payload.viewSettings
          : undefined)) ? {
          viewSettings: newViewSettings ?? pendingSaveRef.current.get(generation.id)?.payload.viewSettings,
          ...(generation.viewSettingsScope ? { viewSettingsScope: generation.viewSettingsScope } : {}),
        } : {}),
        ...(unresolvedLegacyDrawingsRef.current.length > 0
          ? { unresolvedLegacyDrawings: unresolvedLegacyDrawingsRef.current }
          : {}),
        updatedAt: new Date().toISOString(),
      }

      writeLocalPayload(payload)

      pendingSaveRef.current.set(generation.id, {
        generationId: generation.id,
        revision: currentRevision,
        payload,
      })
      setSaveStatus("saving")
      if (generation.viewSettingsScope && newViewSettings) {
        writeCachedChartViewSettings(generation.viewSettingsScope, newViewSettings)
      }

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }

      saveTimeoutRef.current = setTimeout(() => {
        drainSaveQueue()
      }, 750)
    },
    [drainSaveQueue, normalizedTicker, writeLocalPayload],
  )

  // Wrapper setters that trigger sync
  const updateTimeframe = useCallback(
    (tf: ChartTimeframe) => {
      markLocalFieldIntent("timeframe")
      setTimeframe(tf)
      scheduleSave(tf, chartStyle, indicators, allDrawings)
    },
    [allDrawings, chartStyle, indicators, markLocalFieldIntent, scheduleSave],
  )

  const updateChartStyle = useCallback(
    (st: ChartStyle) => {
      markLocalFieldIntent("chartStyle")
      setChartStyle(st)
      scheduleSave(timeframe, st, indicators, allDrawings)
    },
    [allDrawings, indicators, markLocalFieldIntent, scheduleSave, timeframe],
  )

  const updateIndicators = useCallback(
    (newInd: IndicatorConfig | ((prev: IndicatorConfig) => IndicatorConfig)) => {
      markLocalFieldIntent("indicators")
      setIndicators((prev) => {
        const next = typeof newInd === "function" ? newInd(prev) : newInd
        scheduleSave(timeframe, chartStyle, next, allDrawings)
        return next
      })
    },
    [allDrawings, chartStyle, markLocalFieldIntent, scheduleSave, timeframe],
  )

  const updateDrawings = useCallback(
    (newDrawings: DrawingObject[] | ((prev: DrawingObject[]) => DrawingObject[])) => {
      const generation = activeGenerationRef.current
      if (!canEditChartDrawings(
        generation.hydrated,
        generation.hydrationFailed,
        generation.remoteSettings !== null,
      )) return
      markLocalFieldIntent("drawings")
      setAllDrawings((prev) => {
        const next = typeof newDrawings === "function" ? newDrawings(prev) : newDrawings
        scheduleSave(timeframe, chartStyle, indicators, next)
        return next
      })
    },
    [chartStyle, indicators, markLocalFieldIntent, scheduleSave, timeframe],
  )

  const updateViewSettings = useCallback(
    (nextSettings: ChartViewSettings | ((prev: ChartViewSettings) => ChartViewSettings)) => {
      markLocalFieldIntent("viewSettings")
      const next = typeof nextSettings === "function" ? nextSettings(viewSettings) : nextSettings
      setViewSettings(next)
      scheduleSave(timeframe, chartStyle, indicators, allDrawings, next)
    },
    [allDrawings, chartStyle, indicators, markLocalFieldIntent, scheduleSave, timeframe, viewSettings],
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
    viewSettings,
    setViewSettings: updateViewSettings,
    drawings,
    setDrawings: updateDrawings,
    addDrawing,
    modifyDrawing,
    deleteDrawing,
    clearAllDrawings,
    saveStatus,
    drawingSyncStatus,
    retryChartHydration,
  }
}
