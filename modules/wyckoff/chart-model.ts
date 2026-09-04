import { aggregateWeekly, type OhlcvBar } from "../../lib/technical-indicators.ts"
import { scanWyckoff, type WyckoffScanResult } from "./engine.ts"

export const WYCKOFF_CHART_TIMEFRAMES = ["1D", "1W"] as const
export type WyckoffChartTimeframe = (typeof WYCKOFF_CHART_TIMEFRAMES)[number]
export type WyckoffScenarioHorizon = "intraday" | "swing" | "week" | "month" | "long_term"
export type WyckoffEventLabel = "SPR" | "UT" | "SOS" | "SOW" | "TEST" | "LPS" | "LPSY"

export interface WyckoffEventMarker {
  time: number
  label: WyckoffEventLabel
  tone: "bullish" | "bearish" | "neutral"
  detail: string
}

export interface WyckoffScenarioPoint {
  time: number
  value: number
}

export interface WyckoffScenario {
  key: "bull" | "base" | "bear"
  label: string
  probability: number
  color: string
  target: number
  path: WyckoffScenarioPoint[]
  description: string
  horizon?: WyckoffScenarioHorizon
  trigger?: string
  confirmation?: string
  invalidation?: string
  evidence?: string[]
}

export interface WyckoffPhaseGuide {
  title: string
  now: string
  next: string
  risk: string
}

export interface WyckoffForecastHorizon {
  key: "week" | "month"
  label: string
  sourceTimeframe: WyckoffChartTimeframe
  phase: string
  bias: WyckoffScanResult["taBias"] | null
  confidence: WyckoffScanResult["confidence"] | null
  scenarios: WyckoffScenario[]
}

export interface WyckoffChartStudy {
  timeframe: WyckoffChartTimeframe
  label: string
  bars: OhlcvBar[]
  provider: string
  detail: string
  derived: boolean
  asOf: number | null
  analysis: WyckoffScanResult | null
  phaseGuide: WyckoffPhaseGuide
  markers: WyckoffEventMarker[]
  scenarios: WyckoffScenario[]
  outlooks: WyckoffForecastHorizon[]
  error?: string
}

function phaseGuide(analysis: WyckoffScanResult | null): WyckoffPhaseGuide {
  const phase = analysis?.phase ?? "Unclassified"
  if (/Accumulation\/Reaccumulation Phase C/i.test(phase)) {
    return {
      title: "Phase C · Spring / Shakeout candidate",
      now: "Giá đang kiểm định phía dưới trading range. Spring chỉ là candidate cho tới khi có Test và cầu quay lại rõ ràng.",
      next: "Kịch bản thuận lợi: Test với biên độ và volume co lại, sau đó reclaim range và hình thành SOS.",
      risk: "Acceptance trở lại dưới đáy range với supply mở rộng sẽ phủ định Spring candidate.",
    }
  }
  if (/Distribution\/Redistribution Phase C/i.test(phase)) {
    return {
      title: "Phase C · UT / UTAD candidate",
      now: "Giá đang kiểm định phía trên trading range nhưng chưa giữ được breakout. Đây là cảnh báo cung, chưa phải xác nhận giảm.",
      next: "Kịch bản giảm cần rally test yếu, không reclaim kháng cự và sau đó xuất hiện SOW.",
      risk: "Acceptance trở lại trên kháng cự với demand mở rộng làm UT/UTAD candidate thất bại.",
    }
  }
  if (/Accumulation\/Reaccumulation Phase D/i.test(phase)) {
    return {
      title: "Phase D · SOS candidate",
      now: "Demand đang cố rời trading range. Breakout đơn lẻ chưa đủ; cấu trúc cần Hold → Test → Follow-through.",
      next: "Ưu tiên quan sát LPS/retest giữ trên vùng breakout với volume co lại trước nhịp markup tiếp theo.",
      risk: "Đóng cửa và chấp nhận trở lại trong range làm suy yếu SOS candidate.",
    }
  }
  if (/Distribution\/Redistribution Phase D/i.test(phase)) {
    return {
      title: "Phase D · SOW candidate",
      now: "Supply đang cố đẩy giá rời trading range xuống dưới. Cần giữ dưới hỗ trợ và retest thất bại để xác nhận.",
      next: "Kịch bản giảm tiếp diễn khi rally yếu tạo LPSY rồi mất đáy gần nhất.",
      risk: "Reclaim hỗ trợ cũ với demand mở rộng làm SOW candidate thất bại.",
    }
  }
  if (/Markup|Reaccumulation/i.test(phase)) {
    return {
      title: "Markup / Reaccumulation watch",
      now: "Giá đang ở cấu trúc tăng hoặc tái tích lũy nhưng chưa có event đủ mạnh để gắn Phase hoàn chỉnh.",
      next: "Theo dõi pullback giữ hỗ trợ với volume co lại, rồi demand mở rộng khi vượt swing high.",
      risk: "Mất hỗ trợ cùng supply mở rộng chuyển trọng tâm về trading range hoặc markdown.",
    }
  }
  if (/Markdown|Redistribution/i.test(phase)) {
    return {
      title: "Markdown / Redistribution watch",
      now: "Giá đang ở cấu trúc giảm hoặc tái phân phối; rally hiện tại chưa chứng minh demand kiểm soát.",
      next: "Rally yếu và mất hỗ trợ tiếp theo ủng hộ markdown; reclaim MA/range mới cải thiện cấu trúc.",
      risk: "Demand mở rộng và acceptance trên kháng cự gần nhất phủ định kịch bản giảm chính.",
    }
  }
  return {
    title: "Trading range · Chưa phân loại",
    now: "Evidence hiện tại chưa đủ để gắn nhãn pha Wyckoff đáng tin cậy.",
    next: "Chờ một event có thể kiểm chứng: Spring/UT, SOS/SOW, Test và follow-through tại biên range.",
    risk: "Không dùng một nhãn đơn lẻ làm tín hiệu giao dịch; luôn theo dõi confirmation và invalidation.",
  }
}

function markerFromAnalysis(time: number, analysis: WyckoffScanResult): WyckoffEventMarker | null {
  if (/Spring/i.test(analysis.phase)) return { time, label: "SPR", tone: "bullish", detail: analysis.wyckoffState }
  if (/UT\/UTAD/i.test(analysis.phase)) return { time, label: "UT", tone: "bearish", detail: analysis.wyckoffState }
  if (/SOS/i.test(analysis.phase)) return { time, label: "SOS", tone: "bullish", detail: analysis.wyckoffState }
  if (/SOW/i.test(analysis.phase)) return { time, label: "SOW", tone: "bearish", detail: analysis.wyckoffState }
  return null
}

function eventMarkers(bars: OhlcvBar[]) {
  const markers: WyckoffEventMarker[] = []
  const start = Math.max(60, bars.length - 140)
  let previousLabel = ""
  for (let length = start; length <= bars.length; length += 1) {
    const sample = bars.slice(0, length)
    const analysis = scanWyckoff(sample)
    const marker = markerFromAnalysis(sample.at(-1)!.time, analysis)
    if (!marker) {
      previousLabel = ""
      continue
    }
    if (marker.label === previousLabel) continue
    markers.push(marker)
    previousLabel = marker.label
  }
  return markers.slice(-24)
}

function numericLevels(value: string) {
  return (value.match(/[0-9][0-9,.]*/g) ?? [])
    .map((item) => Number(item.replaceAll(",", "")))
    .filter((item) => Number.isFinite(item) && item > 0)
}

function medianInterval(bars: OhlcvBar[]) {
  const gaps = bars.slice(-20).map((bar, index, array) => index ? bar.time - array[index - 1].time : 0).filter((gap) => gap > 0).sort((a, b) => a - b)
  return gaps[Math.floor(gaps.length / 2)] || 86_400
}

function scenarioPath(startTime: number, step: number, values: number[]) {
  return values.map((value, index) => ({ time: startTime + step * index, value: Math.max(0.01, value) }))
}

function horizonForTimeframe(timeframe: WyckoffChartTimeframe): WyckoffScenarioHorizon {
  return timeframe === "1D" ? "week" : "month"
}

function scenarios(bars: OhlcvBar[], analysis: WyckoffScanResult | null, timeframe: WyckoffChartTimeframe): WyckoffScenario[] {
  if (!bars.length || !analysis) return []
  const latest = bars.at(-1)!
  const atr = analysis.technical.atr14 || bars.slice(-14).reduce((sum, bar) => sum + bar.high - bar.low, 0) / Math.max(1, bars.slice(-14).length) || latest.close * 0.025
  const support = numericLevels(analysis.support).filter((value) => value < latest.close).sort((a, b) => b - a)[0]
  const resistance = numericLevels(analysis.resistance).filter((value) => value > latest.close).sort((a, b) => a - b)[0]
  const bullTarget = Math.max(resistance || 0, latest.close + atr * 2.4)
  const bearTarget = Math.min(support || Number.POSITIVE_INFINITY, latest.close - atr * 2.4)
  const baseTarget = latest.close + (analysis.bullProbability - analysis.bearProbability) / 100 * atr
  const step = medianInterval(bars)
  const horizon = horizonForTimeframe(timeframe)
  return [
    {
      key: "bull", label: "Cầu thắng", probability: analysis.bullProbability, color: "#22c98a", target: bullTarget,
      path: scenarioPath(latest.time, step, [latest.close, latest.close - atr * 0.18, latest.close + atr * 0.35, latest.close + atr * 0.2, bullTarget * 0.985, bullTarget]),
      description: `Giữ vùng xác nhận, Test thành công rồi mở rộng demand về ${bullTarget.toFixed(2)}.`, horizon,
      confirmation: analysis.confirmation, invalidation: analysis.invalidation,
    },
    {
      key: "base", label: "Kiểm định lượng", probability: analysis.baseProbability, color: "#a7b0bd", target: baseTarget,
      path: scenarioPath(latest.time, step, [latest.close, latest.close + atr * 0.1, latest.close - atr * 0.14, latest.close + atr * 0.08, baseTarget - atr * 0.08, baseTarget]),
      description: `Giá tiếp tục kiểm định range quanh ${baseTarget.toFixed(2)} trước khi có event mới.`, horizon,
      confirmation: analysis.confirmation, invalidation: analysis.invalidation,
    },
    {
      key: "bear", label: "Cung áp đảo", probability: analysis.bearProbability, color: "#ff4757", target: Math.max(0.01, bearTarget),
      path: scenarioPath(latest.time, step, [latest.close, latest.close + atr * 0.18, latest.close - atr * 0.3, latest.close - atr * 0.18, bearTarget * 1.012, bearTarget]),
      description: `Mất invalidation/support và supply mở rộng về ${Math.max(0.01, bearTarget).toFixed(2)}.`, horizon,
      confirmation: analysis.confirmation, invalidation: analysis.invalidation,
    },
  ]
}

function buildStudy(args: {
  timeframe: WyckoffChartTimeframe
  label: string
  bars: OhlcvBar[]
  provider: string
  detail: string
  derived: boolean
  analysisOverride?: WyckoffScanResult | null
  markerOverride?: WyckoffEventMarker[]
  scenarioOverride?: WyckoffScenario[]
}) {
  let analysis = args.analysisOverride ?? null
  let error: string | undefined
  if (!analysis && args.bars.length >= 60) {
    try {
      analysis = scanWyckoff(args.bars)
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught)
    }
  } else if (!analysis) {
    error = `Chỉ có ${args.bars.length} bars hoàn tất; cần tối thiểu 60 để gắn nhãn Wyckoff.`
  }
  let markers = args.markerOverride?.length ? args.markerOverride : []
  if (!markers.length && args.bars.length >= 60) {
    try {
      markers = eventMarkers(args.bars)
    } catch {
      markers = []
    }
  }
  const scenarioOverride = args.scenarioOverride?.length === 3 ? args.scenarioOverride : null
  return {
    timeframe: args.timeframe,
    label: args.label,
    bars: args.bars.slice(-260),
    provider: args.provider,
    detail: args.detail,
    derived: args.derived,
    asOf: args.bars.at(-1)?.time ?? null,
    analysis,
    phaseGuide: phaseGuide(analysis),
    markers,
    scenarios: scenarioOverride ?? scenarios(args.bars, analysis, args.timeframe),
    outlooks: [],
    error,
  } satisfies WyckoffChartStudy
}

export function buildWyckoffChartStudies(args: {
  dailyBars: OhlcvBar[]
  dailyProvider: string
  dailyDetail: string
  dailyAnalysis?: WyckoffScanResult | null
  analysisOverrides?: Partial<Record<WyckoffChartTimeframe, WyckoffScanResult | null>>
  markerOverrides?: Partial<Record<WyckoffChartTimeframe, WyckoffEventMarker[]>>
  scenarioOverrides?: Partial<Record<WyckoffChartTimeframe, WyckoffScenario[]>>
  hourlyBars?: OhlcvBar[]
  hourlyProvider?: string
  hourlyDetail?: string
}) {
  const weekly = aggregateWeekly(args.dailyBars)
  const studies = [
    buildStudy({ timeframe: "1D", label: "Ngày", bars: args.dailyBars, provider: args.dailyProvider, detail: args.dailyDetail, derived: false, analysisOverride: args.analysisOverrides?.["1D"] ?? args.dailyAnalysis, markerOverride: args.markerOverrides?.["1D"], scenarioOverride: args.scenarioOverrides?.["1D"] }),
    buildStudy({ timeframe: "1W", label: "Tuần", bars: weekly, provider: args.dailyProvider, detail: `${args.dailyDetail} → Weekly aggregate`, derived: true, analysisOverride: args.analysisOverrides?.["1W"], markerOverride: args.markerOverrides?.["1W"], scenarioOverride: args.scenarioOverrides?.["1W"] }),
  ]
  const byTimeframe = new Map(studies.map((study) => [study.timeframe, study]))
  const outlookConfigs = [
    { key: "week" as const, label: "Trong tuần", sourceTimeframe: "1D" as const },
    { key: "month" as const, label: "Trong tháng", sourceTimeframe: "1W" as const },
  ]
  const outlooks = outlookConfigs.map((config): WyckoffForecastHorizon => {
    const source = byTimeframe.get(config.sourceTimeframe)
    return {
      ...config,
      phase: source?.analysis?.phase ?? "Chưa đủ dữ liệu",
      bias: source?.analysis?.taBias ?? null,
      confidence: source?.analysis?.confidence ?? null,
      scenarios: source?.scenarios ?? [],
    }
  })
  return studies.map((study) => ({ ...study, outlooks }))
}

export function isWyckoffChartTimeframe(value: unknown): value is WyckoffChartTimeframe {
  return typeof value === "string" && (WYCKOFF_CHART_TIMEFRAMES as readonly string[]).includes(value)
}
