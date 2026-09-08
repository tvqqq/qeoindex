import {
  DEFAULT_CHART_VIEW_SETTINGS,
  type ChartViewSettings,
  type IndicatorLineStyle,
  type IndicatorStyle,
  type IndicatorStyleKey,
} from "./stock-chart-types.ts"

const STYLE_KEYS: IndicatorStyleKey[] = ["ma", "bollinger", "ichimoku", "qeoBase129", "volume", "rsi", "macd"]
const LINE_STYLES = new Set<IndicatorLineStyle>(["solid", "dashed", "dotted"])
const HEX_COLOR = /^#[0-9a-f]{6}$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function cloneDefaultStyle(key: IndicatorStyleKey): IndicatorStyle {
  return { ...DEFAULT_CHART_VIEW_SETTINGS.indicatorStyles[key] }
}

export function defaultChartViewSettings(): ChartViewSettings {
  return {
    indicatorStyles: Object.fromEntries(
      STYLE_KEYS.map((key) => [key, cloneDefaultStyle(key)]),
    ) as ChartViewSettings["indicatorStyles"],
    indicatorVisibility: { ...DEFAULT_CHART_VIEW_SETTINGS.indicatorVisibility },
    rsiCollapsed: DEFAULT_CHART_VIEW_SETTINGS.rsiCollapsed,
    macdCollapsed: DEFAULT_CHART_VIEW_SETTINGS.macdCollapsed,
  }
}

export function normalizeChartViewSettings(value: unknown): ChartViewSettings {
  const result = defaultChartViewSettings()
  const input = isRecord(value) && isRecord(value.indicatorStyles) ? value.indicatorStyles : {}
  for (const key of STYLE_KEYS) {
    const raw = isRecord(input[key]) ? input[key] : {}
    const fallback = result.indicatorStyles[key]
    result.indicatorStyles[key] = {
      color: typeof raw.color === "string" && HEX_COLOR.test(raw.color) ? raw.color : fallback.color,
      opacity: clampNumber(raw.opacity, 0.1, 1, fallback.opacity),
      width: Math.round(clampNumber(raw.width, 1, 4, fallback.width)),
      lineStyle: typeof raw.lineStyle === "string" && LINE_STYLES.has(raw.lineStyle as IndicatorLineStyle)
        ? raw.lineStyle as IndicatorLineStyle
        : fallback.lineStyle,
    }
  }
  const rawValue = isRecord(value) ? value : null
  const rawVisibility = isRecord(rawValue?.indicatorVisibility) ? rawValue.indicatorVisibility : {}
  for (const key of Object.keys(result.indicatorVisibility) as Array<keyof ChartViewSettings["indicatorVisibility"]>) {
    if (typeof rawVisibility[key] === "boolean") result.indicatorVisibility[key] = rawVisibility[key] as boolean
  }
  if (rawValue) {
    if (typeof rawValue.rsiCollapsed === "boolean") result.rsiCollapsed = rawValue.rsiCollapsed
    if (typeof rawValue.macdCollapsed === "boolean") result.macdCollapsed = rawValue.macdCollapsed
  }
  return result
}

export function validateChartViewSettings(value: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!isRecord(value) || !isRecord(value.indicatorStyles)) {
    return { valid: false, errors: ["viewSettings.indicatorStyles must be an object."] }
  }
  for (const key of STYLE_KEYS) {
    const style = value.indicatorStyles[key]
    if (!isRecord(style)) {
      errors.push(`viewSettings.indicatorStyles.${key} must be an object.`)
      continue
    }
    if (typeof style.color !== "string" || !HEX_COLOR.test(style.color)) {
      errors.push(`viewSettings.indicatorStyles.${key}.color must be a six-digit hex color.`)
    }
    if (typeof style.opacity !== "number" || !Number.isFinite(style.opacity) || style.opacity < 0.1 || style.opacity > 1) {
      errors.push(`viewSettings.indicatorStyles.${key}.opacity must be between 0.1 and 1.`)
    }
    if (typeof style.width !== "number" || !Number.isInteger(style.width) || style.width < 1 || style.width > 4) {
      errors.push(`viewSettings.indicatorStyles.${key}.width must be an integer between 1 and 4.`)
    }
    if (typeof style.lineStyle !== "string" || !LINE_STYLES.has(style.lineStyle as IndicatorLineStyle)) {
      errors.push(`viewSettings.indicatorStyles.${key}.lineStyle is invalid.`)
    }
  }
  if (value.indicatorVisibility !== undefined && !isRecord(value.indicatorVisibility)) {
    errors.push("viewSettings.indicatorVisibility must be an object.")
  }
  if (value.rsiCollapsed !== undefined && typeof value.rsiCollapsed !== "boolean") {
    errors.push("viewSettings.rsiCollapsed must be boolean.")
  }
  if (value.macdCollapsed !== undefined && typeof value.macdCollapsed !== "boolean") {
    errors.push("viewSettings.macdCollapsed must be boolean.")
  }
  return { valid: errors.length === 0, errors }
}

export function chartViewSettingsCacheKey(scope: string): string {
  return `qeo_chart_view_settings_v1_${scope}`
}

export function serializeChartViewSettings(value: ChartViewSettings): string {
  return JSON.stringify(normalizeChartViewSettings(value))
}

export function readCachedChartViewSettings(scope: string): ChartViewSettings | null {
  if (typeof window === "undefined" || !scope) return null
  try {
    const raw = window.localStorage.getItem(chartViewSettingsCacheKey(scope))
    return raw ? normalizeChartViewSettings(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

export function writeCachedChartViewSettings(scope: string, settings: ChartViewSettings): void {
  if (typeof window === "undefined" || !scope) return
  try {
    window.localStorage.setItem(chartViewSettingsCacheKey(scope), serializeChartViewSettings(settings))
  } catch {
    // Remote user_preferences remains authoritative when local storage is unavailable.
  }
}

export { STYLE_KEYS as INDICATOR_STYLE_KEYS }
