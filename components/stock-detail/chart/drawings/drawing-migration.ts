import type { ChartTimeframe } from "../stock-chart-types.ts"
import {
  VALID_CHART_TIMEFRAMES,
  VALID_DRAWING_ICONS,
  VALID_DRAWING_TOOLS,
  validateDrawingV2,
} from "./drawing-schema.ts"
import type {
  DrawingIconType,
  DrawingToolType,
  MarketAnchor,
  PersistedDrawingV2,
} from "./drawing-types.ts"

export interface LegacyDrawingPoint {
  x: number
  y: number
  price?: number
  time?: number
}

export interface LegacyDrawing {
  id: string
  tool: string
  points: LegacyDrawingPoint[]
  color?: string
  lineWidth?: number
  text?: string
  fontSize?: number
  iconType?: string
  locked?: boolean
  hidden?: boolean
  [key: string]: unknown
}

export interface DrawingMigrationWarning {
  drawingId: string
  reason: string
}

export interface DrawingMigrationResult {
  migrated: PersistedDrawingV2[]
  unresolved: LegacyDrawing[]
  warnings: DrawingMigrationWarning[]
}

export interface MigrationOptions {
  defaultTimeframe?: ChartTimeframe
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return Boolean(val) && typeof val === "object" && !Array.isArray(val)
}

/**
 * Migrates a collection of unknown / legacy drawings to PersistedDrawingV2.
 * Never derives or guesses time/price from x/y coordinates.
 * Drawings that cannot be safely migrated are preserved in the `unresolved` bucket.
 */
export function migrateDrawings(
  rawDrawings: unknown,
  options?: MigrationOptions,
): DrawingMigrationResult {
  const result: DrawingMigrationResult = {
    migrated: [],
    unresolved: [],
    warnings: [],
  }

  if (!Array.isArray(rawDrawings)) {
    return result
  }

  const defaultTf: ChartTimeframe =
    options?.defaultTimeframe && VALID_CHART_TIMEFRAMES.has(options.defaultTimeframe)
      ? options.defaultTimeframe
      : "1D"

  for (let i = 0; i < rawDrawings.length; i++) {
    const raw = rawDrawings[i]
    if (!isPlainObject(raw)) {
      result.warnings.push({
        drawingId: `#${i}`,
        reason: "Entry is not a valid object; rejected.",
      })
      continue
    }

    // Check if already V2 schema
    if (raw.schemaVersion === 2) {
      const validation = validateDrawingV2(raw)
      if (validation.valid) {
        result.migrated.push(raw as unknown as PersistedDrawingV2)
      } else {
        const id = typeof raw.id === "string" ? raw.id : `#${i}`
        result.warnings.push({
          drawingId: id,
          reason: `V2 schema validation failed: ${validation.errors.join("; ")}`,
        })
        result.unresolved.push(raw as unknown as LegacyDrawing)
      }
      continue
    }

    // Attempt legacy migration
    const id = typeof raw.id === "string" && raw.id.trim().length > 0 ? raw.id.trim() : `migrated-${i + 1}`
    const rawTool = typeof raw.tool === "string" ? raw.tool : ""

    // Ephemeral tools like "cursor" or "eraser" are not drawings
    if (rawTool === "cursor" || rawTool === "eraser") {
      continue
    }

    if (!VALID_DRAWING_TOOLS.has(rawTool as DrawingToolType)) {
      result.unresolved.push(raw as unknown as LegacyDrawing)
      result.warnings.push({
        drawingId: id,
        reason: `Legacy drawing has unknown tool "${rawTool}"; cannot migrate.`,
      })
      continue
    }

    const points = Array.isArray(raw.points) ? raw.points : []
    if (points.length === 0) {
      result.unresolved.push(raw as unknown as LegacyDrawing)
      result.warnings.push({
        drawingId: id,
        reason: "Legacy drawing contains no points.",
      })
      continue
    }

    if (points.length > 8) {
      result.unresolved.push(raw as unknown as LegacyDrawing)
      result.warnings.push({
        drawingId: id,
        reason: `Legacy drawing exceeds 8 points (${points.length}).`,
      })
      continue
    }

    // Inspect points for valid time + price
    let hasMissingCoordinates = false
    const anchors: MarketAnchor[] = []

    for (let pIdx = 0; pIdx < points.length; pIdx++) {
      const pt = points[pIdx]
      if (!isPlainObject(pt)) {
        hasMissingCoordinates = true
        break
      }

      const time = pt.time
      const price = pt.price

      if (
        typeof time !== "number" ||
        !Number.isFinite(time) ||
        typeof price !== "number" ||
        !Number.isFinite(price)
      ) {
        hasMissingCoordinates = true
        break
      }

      anchors.push({ time, price })
    }

    if (hasMissingCoordinates) {
      // INVARIANT: Do NOT derive or guess permanent coordinates from legacy x/y.
      result.unresolved.push(raw as unknown as LegacyDrawing)
      result.warnings.push({
        drawingId: id,
        reason: "Missing or non-finite time/price coordinates; preserving without guessing.",
      })
      continue
    }

    // Construct valid PersistedDrawingV2
    const color =
      typeof raw.color === "string" && raw.color.trim().length > 0
        ? raw.color.trim().slice(0, 64)
        : "#00f0ff"

    const lineWidth =
      typeof raw.lineWidth === "number" && Number.isFinite(raw.lineWidth)
        ? Math.min(Math.max(Math.round(raw.lineWidth), 1), 20)
        : 2

    const fontSize =
      typeof raw.fontSize === "number" && Number.isFinite(raw.fontSize)
        ? Math.min(Math.max(Math.round(raw.fontSize), 8), 72)
        : undefined

    const iconType =
      typeof raw.iconType === "string" && VALID_DRAWING_ICONS.has(raw.iconType as DrawingIconType)
        ? (raw.iconType as DrawingIconType)
        : undefined

    const text =
      typeof raw.text === "string" ? raw.text.slice(0, 2000) : undefined

    const migratedDrawing: PersistedDrawingV2 = {
      schemaVersion: 2,
      id,
      tool: rawTool as DrawingToolType,
      anchors,
      sourceTimeframe: defaultTf,
      visibility: "global",
      style: {
        color,
        lineWidth,
        ...(fontSize !== undefined ? { fontSize } : {}),
      },
      ...(text !== undefined ? { text } : {}),
      ...(iconType !== undefined ? { iconType } : {}),
      ...(raw.locked !== undefined ? { locked: Boolean(raw.locked) } : {}),
      ...(raw.hidden !== undefined ? { hidden: Boolean(raw.hidden) } : {}),
    }

    const validation = validateDrawingV2(migratedDrawing)
    if (validation.valid) {
      result.migrated.push(migratedDrawing)
    } else {
      result.unresolved.push(raw as unknown as LegacyDrawing)
      result.warnings.push({
        drawingId: id,
        reason: `Migrated drawing validation failed: ${validation.errors.join("; ")}`,
      })
    }
  }

  return result
}
