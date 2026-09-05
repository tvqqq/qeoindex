export const CHART_RESOLUTIONS = [
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
] as const

export type ChartResolution = (typeof CHART_RESOLUTIONS)[number]
export type CanonicalChartResolution = "1m" | "1D"
export type CanonicalBarSource = "hot" | "cold" | "daily" | "provider"

export function isChartResolution(value: string): value is ChartResolution {
  return (CHART_RESOLUTIONS as readonly string[]).includes(value)
}

export interface CanonicalOhlcvBar {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface SourceTaggedBar {
  source: CanonicalBarSource
  bar: CanonicalOhlcvBar
}

export interface ChartDataGap {
  fromTime: number
  toTime: number
  missingBars: number
}

export type ChartDataIntegrityIssue =
  | { kind: "INVALID_BAR"; time: number | null; source: CanonicalBarSource }
  | { kind: "SOURCE_MISMATCH"; time: number; sources: CanonicalBarSource[] }

export interface ChartDataCoverage {
  complete: boolean
  state: "COMPLETE" | "PARTIAL"
}

export interface ChartDataError {
  code: "PROVIDER_UNAVAILABLE" | "STORAGE_UNAVAILABLE" | "INTEGRITY_WARNING"
}

export interface ChartOhlcvRequest {
  ticker: string
  resolution: ChartResolution
  from: number
  to: number
}

export interface CanonicalChartOhlcvRequest {
  ticker: string
  resolution: CanonicalChartResolution
  from: number
  to: number
}

interface ChartOhlcvPayload {
  bars: CanonicalOhlcvBar[]
  gaps: ChartDataGap[]
  integrityIssues: ChartDataIntegrityIssue[]
  coverage: ChartDataCoverage
  errors: ChartDataError[]
}

export interface ChartOhlcvResult extends ChartOhlcvRequest, ChartOhlcvPayload {}
export interface CanonicalChartOhlcvResult extends CanonicalChartOhlcvRequest, ChartOhlcvPayload {}

export class ChartDataRequestError extends Error {
  readonly code = "INVALID_CHART_DATA_REQUEST"
}

export class ChartDataUnavailableError extends Error {
  readonly code = "CHART_DATA_UNAVAILABLE"
}
