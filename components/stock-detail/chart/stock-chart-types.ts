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
  iconType?: DrawingIconType
  locked?: boolean
}

export interface IndicatorConfig {
  showMa: boolean
  showRsi: boolean
  showMacd: boolean
  showIchimoku: boolean
  showBollinger: boolean
  showVolumeProfile: boolean
}

export const DEFAULT_INDICATOR_CONFIG: IndicatorConfig = {
  showMa: false,
  showRsi: false,
  showMacd: false,
  showIchimoku: false,
  showBollinger: false,
  showVolumeProfile: false,
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
