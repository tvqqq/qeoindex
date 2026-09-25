export const NATIVE_TIME_AXIS_HEIGHT = 28
export const PANE_SEPARATOR_HEIGHT = 1
export const CHART_PANE_COUNT = 6
export const COMPACT_VOLUME_PANE_HEIGHT = 64
export const EXPANDED_SUBPANE_HEIGHT = 92
export const COLLAPSED_SUBPANE_HEIGHT = 24

export interface PaneGeometryInput {
  hostHeight: number
  isMaximized: boolean
  rsiCollapsed: boolean
  macdCollapsed: boolean
  deVisible?: boolean
  amVisible?: boolean
}

export interface PaneGeometry {
  main: number
  volume: number
  rsi: number
  macd: number
  de: number
  am: number
  drawableHeight: number
}

export interface MeasuredPaneGeometry extends PaneGeometry {
  plotTop: number
}

export function drawablePaneBudget(hostHeight: number): number {
  const height = Number.isFinite(hostHeight) ? Math.max(0, Math.floor(hostHeight)) : 0
  const separators = Math.max(0, CHART_PANE_COUNT - 1) * PANE_SEPARATOR_HEIGHT
  return Math.max(0, height - NATIVE_TIME_AXIS_HEIGHT - separators)
}

function fitToBudget(targets: number[], budget: number): number[] {
  const safeTargets = targets.map((target) => Math.max(0, Math.floor(target)))
  const total = safeTargets.reduce((sum, target) => sum + target, 0)
  if (total <= budget) return safeTargets
  if (total === 0 || budget <= 0) return safeTargets.map(() => 0)

  const scaled = safeTargets.map((target) => Math.floor((target * budget) / total))
  let remainder = budget - scaled.reduce((sum, target) => sum + target, 0)
  for (let index = 0; remainder > 0 && index < scaled.length; index += 1) {
    if (safeTargets[index] > 0) {
      scaled[index] += 1
      remainder -= 1
    }
    if (index === scaled.length - 1 && remainder > 0) index = -1
  }
  return scaled
}

/**
 * Canonical native-pane geometry. The returned pane heights are integer CSS
 * pixels, stable for the same inputs, and never consume the native time axis
 * or separator budget.
 */
export function canonicalPaneGeometry(input: PaneGeometryInput): PaneGeometry {
  const drawableHeight = drawablePaneBudget(input.hostHeight)
  if (!input.isMaximized) {
    const volume = Math.min(COMPACT_VOLUME_PANE_HEIGHT, drawableHeight)
    return {
      main: drawableHeight - volume,
      volume,
      rsi: 0,
      macd: 0,
      de: 0,
      am: 0,
      drawableHeight,
    }
  }

  const extraPaneCount = Number(Boolean(input.deVisible)) + Number(Boolean(input.amVisible))
  const targetRatio = extraPaneCount === 0 ? 0.15 : extraPaneCount === 1 ? 0.13 : 0.11
  const targetSubpane = Math.max(extraPaneCount > 0 ? 64 : 72, Math.round(drawableHeight * targetRatio))
  const [volume, rsi, macd, de, am] = fitToBudget([
    targetSubpane,
    input.rsiCollapsed ? COLLAPSED_SUBPANE_HEIGHT : targetSubpane,
    input.macdCollapsed ? COLLAPSED_SUBPANE_HEIGHT : targetSubpane,
    input.deVisible ? targetSubpane : 0,
    input.amVisible ? targetSubpane : 0,
  ], drawableHeight)
  return {
    main: Math.max(0, drawableHeight - volume - rsi - macd - de - am),
    volume,
    rsi,
    macd,
    de,
    am,
    drawableHeight,
  }
}
