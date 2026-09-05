export type CanonicalChartResolution = "1m" | "1D"
export type CanonicalBarSource = "hot" | "cold" | "daily" | "provider"

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
  resolution: CanonicalChartResolution
  from: number
  to: number
}

export interface ChartOhlcvResult extends ChartOhlcvRequest {
  bars: CanonicalOhlcvBar[]
  gaps: ChartDataGap[]
  integrityIssues: ChartDataIntegrityIssue[]
  coverage: ChartDataCoverage
  errors: ChartDataError[]
}

export class ChartDataRequestError extends Error {
  readonly code = "INVALID_CHART_DATA_REQUEST"
}

export class ChartDataUnavailableError extends Error {
  readonly code = "CHART_DATA_UNAVAILABLE"
}
