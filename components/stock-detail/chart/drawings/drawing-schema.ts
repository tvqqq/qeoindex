import type { ChartTimeframe } from "../stock-chart-types.ts"
import type {
  DrawingIconType,
  DrawingToolType,
  DrawingVisibility,
  MarketAnchor,
  PersistedDrawingV2,
} from "./drawing-types.ts"

export const DRAWING_SCHEMA_VERSION = 2 as const
export const MAX_DRAWINGS_PER_TICKER = 500
export const MAX_ANCHORS_PER_DRAWING = 8
export const MIN_ANCHORS_PER_DRAWING = 1
export const MAX_DRAWING_TEXT_LENGTH = 2000
export const MAX_DRAWING_ID_LENGTH = 128
export const MIN_LINE_WIDTH = 1
export const MAX_LINE_WIDTH = 20
export const MIN_FONT_SIZE = 8
export const MAX_FONT_SIZE = 72

export const VALID_DRAWING_TOOLS = new Set<DrawingToolType>([
  "trendline",
  "arrow",
  "horizontal",
  "ray",
  "rectangle",
  "circle",
  "text",
  "icon",
])

export const VALID_DRAWING_VISIBILITIES = new Set<DrawingVisibility>([
  "global",
  "source-timeframe",
])

export const VALID_DRAWING_ICONS = new Set<DrawingIconType>([
  "flag",
  "star",
  "alert",
  "target",
  "thumbsUp",
])

export const VALID_CHART_TIMEFRAMES = new Set<ChartTimeframe>([
  "1m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "1D",
  "3D",
  "1W",
  "1M",
  "1Q",
  "1Y",
])

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return Boolean(val) && typeof val === "object" && !Array.isArray(val)
}

export function isValidMarketAnchor(val: unknown): val is MarketAnchor {
  if (!isPlainObject(val)) return false
  return (
    typeof val.time === "number" &&
    Number.isFinite(val.time) &&
    typeof val.price === "number" &&
    Number.isFinite(val.price)
  )
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

export function validateDrawingV2(val: unknown): ValidationResult {
  const errors: string[] = []

  if (!isPlainObject(val)) {
    return { valid: false, errors: ["Drawing must be a plain object."] }
  }

  if (val.schemaVersion !== 2) {
    errors.push(`Expected schemaVersion 2, received ${String(val.schemaVersion)}.`)
  }

  if (typeof val.id !== "string" || val.id.trim().length === 0) {
    errors.push("Drawing id must be a non-empty string.")
  } else if (val.id.length > MAX_DRAWING_ID_LENGTH) {
    errors.push(`Drawing id exceeds maximum length of ${MAX_DRAWING_ID_LENGTH}.`)
  }

  if (typeof val.tool !== "string" || !VALID_DRAWING_TOOLS.has(val.tool as DrawingToolType)) {
    errors.push(`Invalid drawing tool: "${String(val.tool)}".`)
  }

  if (!Array.isArray(val.anchors)) {
    errors.push("Drawing anchors must be an array.")
  } else {
    if (val.anchors.length < MIN_ANCHORS_PER_DRAWING) {
      errors.push(`Drawing must have at least ${MIN_ANCHORS_PER_DRAWING} anchor(s).`)
    }
    if (val.anchors.length > MAX_ANCHORS_PER_DRAWING) {
      errors.push(`Drawing cannot exceed ${MAX_ANCHORS_PER_DRAWING} anchors.`)
    }
    for (let i = 0; i < val.anchors.length; i++) {
      const anchor = val.anchors[i]
      if (!isValidMarketAnchor(anchor)) {
        errors.push(`Anchor at index ${i} must have finite numeric time and price.`)
      }
    }
  }

  if (
    typeof val.sourceTimeframe !== "string" ||
    !VALID_CHART_TIMEFRAMES.has(val.sourceTimeframe as ChartTimeframe)
  ) {
    errors.push(`Invalid sourceTimeframe: "${String(val.sourceTimeframe)}".`)
  }

  if (
    typeof val.visibility !== "string" ||
    !VALID_DRAWING_VISIBILITIES.has(val.visibility as DrawingVisibility)
  ) {
    errors.push(`Invalid visibility: "${String(val.visibility)}".`)
  }

  if (!isPlainObject(val.style)) {
    errors.push("Drawing style must be an object.")
  } else {
    if (typeof val.style.color !== "string" || val.style.color.trim().length === 0) {
      errors.push("Drawing style color must be a non-empty string.")
    } else if (val.style.color.length > 64) {
      errors.push("Drawing style color exceeds maximum length of 64.")
    }

    if (
      typeof val.style.lineWidth !== "number" ||
      !Number.isFinite(val.style.lineWidth) ||
      val.style.lineWidth < MIN_LINE_WIDTH ||
      val.style.lineWidth > MAX_LINE_WIDTH
    ) {
      errors.push(`Drawing style lineWidth must be between ${MIN_LINE_WIDTH} and ${MAX_LINE_WIDTH}.`)
    }

    if (val.style.fontSize !== undefined) {
      if (
        typeof val.style.fontSize !== "number" ||
        !Number.isFinite(val.style.fontSize) ||
        val.style.fontSize < MIN_FONT_SIZE ||
        val.style.fontSize > MAX_FONT_SIZE
      ) {
        errors.push(`Drawing style fontSize must be between ${MIN_FONT_SIZE} and ${MAX_FONT_SIZE}.`)
      }
    }
  }

  if (val.text !== undefined) {
    if (typeof val.text !== "string") {
      errors.push("Drawing text must be a string.")
    } else if (val.text.length > MAX_DRAWING_TEXT_LENGTH) {
      errors.push(`Drawing text exceeds maximum length of ${MAX_DRAWING_TEXT_LENGTH} characters.`)
    }
  }

  if (val.iconType !== undefined) {
    if (typeof val.iconType !== "string" || !VALID_DRAWING_ICONS.has(val.iconType as DrawingIconType)) {
      errors.push(`Invalid iconType: "${String(val.iconType)}".`)
    }
  }

  if (val.locked !== undefined && typeof val.locked !== "boolean") {
    errors.push("Drawing locked flag must be a boolean.")
  }

  if (val.hidden !== undefined && typeof val.hidden !== "boolean") {
    errors.push("Drawing hidden flag must be a boolean.")
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

export function isPersistedDrawingV2(val: unknown): val is PersistedDrawingV2 {
  return validateDrawingV2(val).valid
}

export function validateDrawingsCollectionV2(drawings: unknown): ValidationResult {
  const errors: string[] = []

  if (!Array.isArray(drawings)) {
    return { valid: false, errors: ["Drawings payload must be an array."] }
  }

  if (drawings.length > MAX_DRAWINGS_PER_TICKER) {
    return {
      valid: false,
      errors: [`Drawings count (${drawings.length}) exceeds maximum limit of ${MAX_DRAWINGS_PER_TICKER}.`],
    }
  }

  for (let i = 0; i < drawings.length; i++) {
    const res = validateDrawingV2(drawings[i])
    if (!res.valid) {
      const id = isPlainObject(drawings[i]) && typeof drawings[i].id === "string" ? drawings[i].id : `#${i}`
      errors.push(`Drawing [${id}]: ${res.errors.join("; ")}`)
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}
