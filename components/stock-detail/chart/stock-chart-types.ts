export type ChartTimeframe =
  | "1m"
  | "15m"
  | "30m"
  | "1h"
  | "2h"
  | "4h"
  | "1D"
  | "3D"
  | "1W"
  | "1M"
  | "1Q"
  | "1Y"

export const QUICK_TIMEFRAMES: ChartTimeframe[] = ["15m", "1h", "1D", "1W"]

export const ALL_TIMEFRAMES: { id: ChartTimeframe; label: string; group: string }[] = [
  { id: "1m", label: "1 phút", group: "Phút" },
  { id: "15m", label: "15 phút", group: "Phút" },
  { id: "30m", label: "30 phút", group: "Phút" },
  { id: "1h", label: "1 giờ", group: "Giờ" },
  { id: "2h", label: "2 giờ", group: "Giờ" },
  { id: "4h", label: "4 giờ", group: "Giờ" },
  { id: "1D", label: "1 ngày", group: "Ngày / Tuần" },
  { id: "3D", label: "3 ngày", group: "Ngày / Tuần" },
  { id: "1W", label: "1 tuần", group: "Ngày / Tuần" },
  { id: "1M", label: "1 tháng", group: "Tháng / Quý / Năm" },
  { id: "1Q", label: "1 quý", group: "Tháng / Quý / Năm" },
  { id: "1Y", label: "1 năm", group: "Tháng / Quý / Năm" },
]

export type ChartStyle = "candles" | "line" | "area" | "hollow" | "bars"

export type DrawingTool =
  | "cursor"
  | "trendline"
  | "arrow"
  | "horizontal"
  | "ray"
  | "rectangle"
  | "circle"
  | "text"
  | "icon"
  | "eraser"

export type DrawingIconType = "flag" | "star" | "alert" | "target" | "thumbsUp"

export interface DrawingPoint {
  x: number
  y: number
  price?: number
  time?: number
}

export interface DrawingObject {
  id: string
  tool: DrawingTool
  points: DrawingPoint[]
  color: string
  lineWidth: number
  text?: string
  fontSize?: number
  iconType?: DrawingIconType
  locked?: boolean
  hidden?: boolean
}

export interface UserChartSettingsPayload {
  ticker: string
  timeframe: ChartTimeframe
  chartStyle: ChartStyle
  indicators: IndicatorConfig
  drawings: DrawingObject[]
  updatedAt?: string
}


export interface IndicatorConfig {
  showMa: boolean
  showRsi: boolean
  showMacd: boolean
  showIchimoku: boolean
  showBollinger: boolean
  showVolumeProfile: boolean
  /** QeoIndex-only 129-bar Ichimoku base line. Optional keeps old persisted payloads source-compatible. */
  showQeoBase129?: boolean
}

export type IndicatorStyleKey =
  | "ma"
  | "bollinger"
  | "ichimoku"
  | "qeoBase129"
  | "volume"
  | "rsi"
  | "macd"

export type IndicatorLineStyle = "solid" | "dashed" | "dotted"

export interface IndicatorStyle {
  color: string
  opacity: number
  width: number
  lineStyle: IndicatorLineStyle
}

export type IndicatorStyles = Record<IndicatorStyleKey, IndicatorStyle>

export interface ChartViewSettings {
  indicatorStyles: IndicatorStyles
  indicatorVisibility: Pick<IndicatorConfig, "showMa" | "showRsi" | "showMacd" | "showIchimoku" | "showBollinger" | "showVolumeProfile" | "showQeoBase129">
  rsiCollapsed: boolean
  macdCollapsed: boolean
}

export const DEFAULT_CHART_VIEW_SETTINGS: ChartViewSettings = {
  indicatorStyles: {
    ma: { color: "#f8fafc", opacity: 1, width: 1, lineStyle: "solid" },
    bollinger: { color: "#38bdf8", opacity: 0.86, width: 1, lineStyle: "solid" },
    ichimoku: { color: "#22c55e", opacity: 0.86, width: 1, lineStyle: "solid" },
    qeoBase129: { color: "#ec4899", opacity: 0.9, width: 2, lineStyle: "solid" },
    volume: { color: "#f59e0b", opacity: 0.86, width: 1, lineStyle: "solid" },
    rsi: { color: "#a78bfa", opacity: 1, width: 2, lineStyle: "solid" },
    macd: { color: "#38bdf8", opacity: 1, width: 2, lineStyle: "solid" },
  },
  indicatorVisibility: {
    showMa: false,
    showRsi: true,
    showMacd: true,
    showIchimoku: false,
    showBollinger: false,
    showVolumeProfile: false,
    showQeoBase129: false,
  },
  rsiCollapsed: false,
  macdCollapsed: false,
}

export const DEFAULT_INDICATOR_CONFIG: IndicatorConfig = {
  showMa: false,
  showRsi: false,
  showMacd: false,
  showIchimoku: false,
  showBollinger: false,
  showVolumeProfile: false,
  showQeoBase129: false,
}

export interface VolumeProfileBucket {
  price: number
  volume: number
  isPoc: boolean
}

export interface VolumeProfileData {
  buckets: VolumeProfileBucket[]
  pocPrice: number
  maxBucketVol: number
}
