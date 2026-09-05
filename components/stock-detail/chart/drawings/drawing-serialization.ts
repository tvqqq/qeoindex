import type {
  ChartStyle,
  ChartTimeframe,
  DrawingObject,
  IndicatorConfig,
} from "../stock-chart-types.ts"
import {
  VALID_CHART_TIMEFRAMES,
} from "./drawing-schema.ts"
import {
  migrateDrawings,
  type DrawingMigrationResult,
  type LegacyDrawing,
} from "./drawing-migration.ts"
import type {
  CoordinateAdapter,
  DrawingToolType,
  DrawingVisibility,
  MarketAnchor,
  PersistedDrawingV2,
} from "./drawing-types.ts"

export interface UserChartSettingsPayloadV2 {
  ticker: string
  timeframe: ChartTimeframe
  chartStyle: ChartStyle
  indicators: IndicatorConfig
  drawingsSchemaVersion: 2
  drawings: PersistedDrawingV2[]
  unresolvedLegacyDrawings?: LegacyDrawing[]
  updatedAt?: string
}

export type RuntimeDrawingObject = DrawingObject & {
  sourceTimeframe?: ChartTimeframe
  visibility?: DrawingVisibility
}

export function getLegacyBackupKey(ticker: string): string {
  return `qeo_chart_settings_legacy_backup_${ticker.toUpperCase()}`
}

/**
 * Creates a one-time local backup of the legacy settings payload before destructive migration.
 * Returns true if a backup was newly created, false if a backup already existed or environment is SSR.
 */
export function backupLegacyLocalSettings(ticker: string, rawLocalPayload: string): boolean {
  if (typeof window === "undefined") return false
  const storage = window.localStorage || (typeof localStorage !== "undefined" ? localStorage : null)
  if (!storage) return false
  const key = getLegacyBackupKey(ticker)
  try {
    if (storage.getItem(key)) {
      return false // Backup already preserved
    }
    storage.setItem(key, rawLocalPayload)
    return true
  } catch {
    return false
  }
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return Boolean(val) && typeof val === "object" && !Array.isArray(val)
}

/**
 * Deserializes raw settings (from localStorage or remote API), migrating legacy data safely to V2.
 */
export function deserializeUserChartSettings(
  rawInput: unknown,
  options?: { defaultTimeframe?: ChartTimeframe; defaultChartStyle?: ChartStyle },
): {
  settings: UserChartSettingsPayloadV2
  migrationResult?: DrawingMigrationResult
} {
  let parsed: unknown = rawInput
  if (typeof rawInput === "string") {
    try {
      parsed = JSON.parse(rawInput)
    } catch {
      parsed = {}
    }
  }

  const obj = isPlainObject(parsed) ? parsed : {}
  const ticker = typeof obj.ticker === "string" ? obj.ticker.toUpperCase().trim() : ""
  const defaultTf = options?.defaultTimeframe || "1D"
  const timeframe: ChartTimeframe =
    typeof obj.timeframe === "string" && VALID_CHART_TIMEFRAMES.has(obj.timeframe as ChartTimeframe)
      ? (obj.timeframe as ChartTimeframe)
      : defaultTf

  const chartStyle: ChartStyle =
    typeof obj.chartStyle === "string" &&
    ["candles", "line", "area", "hollow", "bars"].includes(obj.chartStyle)
      ? (obj.chartStyle as ChartStyle)
      : (options?.defaultChartStyle || "candles")

  const indicators: IndicatorConfig = isPlainObject(obj.indicators)
    ? {
        showMa: Boolean(obj.indicators.showMa),
        showRsi: Boolean(obj.indicators.showRsi),
        showMacd: Boolean(obj.indicators.showMacd),
        showIchimoku: Boolean(obj.indicators.showIchimoku),
        showBollinger: Boolean(obj.indicators.showBollinger),
        showVolumeProfile: Boolean(obj.indicators.showVolumeProfile),
        showQeoBase129: Boolean(obj.indicators.showQeoBase129),
      }
    : {
        showMa: false,
        showRsi: false,
        showMacd: false,
        showIchimoku: false,
        showBollinger: false,
        showVolumeProfile: false,
        showQeoBase129: false,
      }

  // Check if payload is already V2
  if (obj.drawingsSchemaVersion === 2 && Array.isArray(obj.drawings)) {
    const migrationResult = migrateDrawings(obj.drawings, { defaultTimeframe: timeframe })
    const existingUnresolved = Array.isArray(obj.unresolvedLegacyDrawings)
      ? (obj.unresolvedLegacyDrawings as LegacyDrawing[])
      : []

    return {
      settings: {
        ticker,
        timeframe,
        chartStyle,
        indicators,
        drawingsSchemaVersion: 2,
        drawings: migrationResult.migrated,
        unresolvedLegacyDrawings: [...existingUnresolved, ...migrationResult.unresolved],
        updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : undefined,
      },
      migrationResult,
    }
  }

  // Legacy payload migration
  const migrationResult = migrateDrawings(Array.isArray(obj.drawings) ? obj.drawings : [], {
    defaultTimeframe: timeframe,
  })

  return {
    settings: {
      ticker,
      timeframe,
      chartStyle,
      indicators,
      drawingsSchemaVersion: 2,
      drawings: migrationResult.migrated,
      unresolvedLegacyDrawings: migrationResult.unresolved,
      updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : undefined,
    },
    migrationResult,
  }
}

/**
 * Converts a canonical PersistedDrawingV2 to a runtime DrawingObject for rendering in canvas.
 * Persistence metadata rides along on the runtime object so normal edits/saves do not rewrite scope.
 */
export function persistedV2ToRuntimeDrawing(
  persisted: PersistedDrawingV2,
  adapter?: CoordinateAdapter,
): RuntimeDrawingObject {
  const points = persisted.anchors.map((anchor) => {
    let x = 0
    let y = 0
    if (adapter?.timeToX) {
      const computedX = adapter.timeToX(anchor.time)
      if (computedX !== null && computedX !== undefined && Number.isFinite(computedX)) {
        x = computedX
      }
    }
    if (adapter?.priceToY) {
      const computedY = adapter.priceToY(anchor.price)
      if (computedY !== null && computedY !== undefined && Number.isFinite(computedY)) {
        y = computedY
      }
    }
    return {
      x,
      y,
      price: anchor.price,
      time: anchor.time,
    }
  })

  return {
    id: persisted.id,
    tool: persisted.tool,
    points,
    color: persisted.style.color,
    lineWidth: persisted.style.lineWidth,
    fontSize: persisted.style.fontSize,
    text: persisted.text,
    iconType: persisted.iconType,
    locked: persisted.locked,
    hidden: persisted.hidden,
    sourceTimeframe: persisted.sourceTimeframe,
    visibility: persisted.visibility,
  }
}

/**
 * Converts a runtime DrawingObject to a canonical PersistedDrawingV2.
 * Strips all ephemeral x and y values. Requires finite time and price.
 */
export function runtimeDrawingToPersistedV2(
  runtime: DrawingObject,
  sourceTimeframe: ChartTimeframe,
  adapter?: CoordinateAdapter,
): PersistedDrawingV2 | null {
  const validTools = new Set([
    "trendline",
    "arrow",
    "horizontal",
    "ray",
    "rectangle",
    "circle",
    "text",
    "icon",
  ])

  if (!validTools.has(runtime.tool)) {
    return null
  }

  const anchors: MarketAnchor[] = []
  for (const pt of runtime.points) {
    let time = pt.time
    let price = pt.price

    // If time or price is missing on the point, attempt runtime conversion via adapter
    if ((time === undefined || !Number.isFinite(time)) && adapter?.xToTime) {
      const computedTime = adapter.xToTime(pt.x)
      if (computedTime !== null && computedTime !== undefined && Number.isFinite(computedTime)) {
        time = computedTime
      }
    }
    if ((price === undefined || !Number.isFinite(price)) && adapter?.yToPrice) {
      const computedPrice = adapter.yToPrice(pt.y)
      if (computedPrice !== null && computedPrice !== undefined && Number.isFinite(computedPrice)) {
        price = computedPrice
      }
    }

    if (
      typeof time !== "number" ||
      !Number.isFinite(time) ||
      typeof price !== "number" ||
      !Number.isFinite(price)
    ) {
      // Cannot create canonical anchor without market coordinates
      return null
    }

    anchors.push({ time, price })
  }

  if (anchors.length === 0 || anchors.length > 8) {
    return null
  }

  const runtimeWithMetadata = runtime as RuntimeDrawingObject
  const persistedSourceTimeframe =
    runtimeWithMetadata.sourceTimeframe && VALID_CHART_TIMEFRAMES.has(runtimeWithMetadata.sourceTimeframe)
      ? runtimeWithMetadata.sourceTimeframe
      : sourceTimeframe
  const persistedVisibility: DrawingVisibility =
    runtimeWithMetadata.visibility === "source-timeframe" ? "source-timeframe" : "global"

  return {
    schemaVersion: 2,
    id: runtime.id,
    tool: runtime.tool as DrawingToolType,
    anchors,
    sourceTimeframe: persistedSourceTimeframe,
    visibility: persistedVisibility,
    style: {
      color: runtime.color || "#00f0ff",
      lineWidth: runtime.lineWidth || 2,
      ...(runtime.fontSize ? { fontSize: runtime.fontSize } : {}),
    },
    ...(runtime.text ? { text: runtime.text } : {}),
    ...(runtime.iconType ? { iconType: runtime.iconType } : {}),
    ...(runtime.locked !== undefined ? { locked: runtime.locked } : {}),
    ...(runtime.hidden !== undefined ? { hidden: runtime.hidden } : {}),
    updatedAt: new Date().toISOString(),
  }
}
