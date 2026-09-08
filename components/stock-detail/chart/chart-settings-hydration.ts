import type { UserChartSettingsPayloadV2 } from "./drawings/drawing-serialization"

export type ChartSettingsField = "timeframe" | "chartStyle" | "indicators" | "drawings" | "viewSettings"

/** Drawing edits are accepted only after the remote collection is known. */
export function canEditChartDrawings(
  hydrated: boolean,
  hydrationFailed: boolean,
  hasRemoteSettings: boolean,
): boolean {
  return hydrated && !hydrationFailed && hasRemoteSettings
}

/**
 * Return true only when a remote settings response still belongs to the
 * active ticker and no local chart edit happened after the request started.
 */
export function shouldApplyRemoteChartSettings(
  requestRevision: number,
  currentRevision: number,
  isCancelled: boolean,
): boolean {
  return !isCancelled && requestRevision === currentRevision
}

/**
 * Merge the fields that were not locally edited after hydration started. A
 * timeframe click, for example, keeps its local timeframe while adopting the
 * remote drawing set and indicator preferences that were still in flight.
 */
export function mergeRemoteChartSettingsIntoPending(
  pending: UserChartSettingsPayloadV2,
  remote: UserChartSettingsPayloadV2,
  localFieldIntents: ReadonlySet<ChartSettingsField>,
  localDrawingEditIntent: boolean,
): UserChartSettingsPayloadV2 {
  return {
    ...pending,
    ...(localFieldIntents.has("timeframe") ? {} : { timeframe: remote.timeframe }),
    ...(localFieldIntents.has("chartStyle") ? {} : { chartStyle: remote.chartStyle }),
    ...(localFieldIntents.has("indicators") ? {} : { indicators: remote.indicators }),
    ...(localDrawingEditIntent ? {} : { drawings: remote.drawings }),
    ...(remote.unresolvedLegacyDrawings && remote.unresolvedLegacyDrawings.length > 0
      ? { unresolvedLegacyDrawings: remote.unresolvedLegacyDrawings }
      : {}),
  }
}
