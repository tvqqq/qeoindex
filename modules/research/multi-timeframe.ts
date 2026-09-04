import { aggregateWeekly, calculateTechnicalSnapshot, type OhlcvBar, type TechnicalSnapshot } from "@/modules/shared/technical/indicators"
import { scanWyckoff, type ScannerBias, type ScannerConfidence, type WyckoffScanResult } from "@/modules/wyckoff/engine"

export type TimeframeKey = "Weekly" | "Daily" | "4H" | "1H"

export interface TimeframeStudy {
  key: TimeframeKey
  label: string
  bars: OhlcvBar[]
  provider: string
  detail: string
  derived: boolean
  available: boolean
  error?: string
  technical?: TechnicalSnapshot
  scan?: WyckoffScanResult
  structure: string
  priceAction: string
  volume: string
}

export interface PromotionDraft {
  ticker: string
  taBias: ScannerBias
  confidence: ScannerConfidence
  bullProbability: number
  baseProbability: number
  bearProbability: number
  wyckoffState: string
  baseCase: string
  support: string
  resistance: string
  confirmation: string
  invalidation: string
  whatChanged: string
  timeframes: TimeframeKey[]
}

function localParts(timestamp: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date(timestamp * 1000))
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ""
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) }
}

export function aggregateFourHour(hourly: OhlcvBar[]): OhlcvBar[] {
  const buckets = new Map<string, OhlcvBar[]>()
  for (const bar of hourly) {
    const local = localParts(bar.time)
    const blockHour = Math.floor(local.hour / 4) * 4
    const key = `${local.date}-${String(blockHour).padStart(2, "0")}`
    const bucket = buckets.get(key) ?? []
    bucket.push(bar)
    buckets.set(key, bucket)
  }
  return [...buckets.values()]
    .map((bucket) => ({
      time: bucket[0].time,
      open: bucket[0].open,
      high: Math.max(...bucket.map((bar) => bar.high)),
      low: Math.min(...bucket.map((bar) => bar.low)),
      close: bucket.at(-1)!.close,
      volume: bucket.reduce((sum, bar) => sum + bar.volume, 0),
    }))
    .sort((a, b) => a.time - b.time)
}

function fmt(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—"
  if (value >= 1000) return Math.round(value).toLocaleString("en-US")
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 })
}

function describeStructure(bars: OhlcvBar[], technical?: TechnicalSnapshot) {
  if (!technical || bars.length < 20) return "Chưa đủ dữ liệu để xác định cấu trúc đáng tin cậy."
  const latest = bars.at(-1)!
  const prior = bars.slice(-21, -1)
  const high20 = Math.max(...prior.map((bar) => bar.high))
  const low20 = Math.min(...prior.map((bar) => bar.low))
  const maState = [
    technical.ma20 != null ? `${latest.close >= technical.ma20 ? "trên" : "dưới"} MA20` : null,
    technical.ma50 != null ? `${latest.close >= technical.ma50 ? "trên" : "dưới"} MA50` : null,
    technical.ma200 != null ? `${latest.close >= technical.ma200 ? "trên" : "dưới"} MA200` : null,
  ].filter(Boolean).join(", ")
  const range = latest.close > high20 ? "breakout khỏi range 20 bar" : latest.close < low20 ? "breakdown khỏi range 20 bar" : "vẫn nằm trong range 20 bar"
  return `Giá ${fmt(latest.close)} ${range}; ${maState || "MA dài hạn chưa đủ dữ liệu"}.`
}

function describePriceAction(bars: OhlcvBar[]) {
  if (bars.length < 2) return "Chưa đủ bar để đọc Price Action."
  const latest = bars.at(-1)!
  const prev = bars.at(-2)!
  const range = Math.max(latest.high - latest.low, 1e-9)
  const closeLocation = ((latest.close - latest.low) / range) * 100
  const body = Math.abs(latest.close - latest.open) / range * 100
  const change = prev.close ? ((latest.close - prev.close) / prev.close) * 100 : 0
  const closeText = closeLocation >= 70 ? "đóng gần high" : closeLocation <= 30 ? "đóng gần low" : "đóng giữa biên"
  return `${change >= 0 ? "+" : ""}${change.toFixed(2)}% so với bar trước; ${closeText} (${closeLocation.toFixed(0)}%), thân nến ~${body.toFixed(0)}% biên độ.`
}

function describeVolume(technical?: TechnicalSnapshot) {
  if (!technical || technical.relVolume == null) return "Chưa đủ baseline volume để so Effort vs Result."
  const rv = technical.relVolume
  const state = rv >= 1.5 ? "effort mở rộng mạnh" : rv >= 1.1 ? "effort cao hơn baseline" : rv <= 0.7 ? "effort co lại rõ" : "effort quanh baseline"
  return `Relative Volume ${rv.toFixed(2)}x — ${state}. Đọc cùng spread/close location, không suy diễn ý chí tổ chức chỉ từ volume.`
}

function study(key: TimeframeKey, bars: OhlcvBar[], provider: string, detail: string, derived = false): TimeframeStudy {
  if (bars.length < 2) {
    return { key, label: key, bars, provider, detail, derived, available: false, error: "Không đủ OHLCV", structure: "Không đủ dữ liệu.", priceAction: "Không đủ dữ liệu.", volume: "Không đủ dữ liệu." }
  }
  const technical = calculateTechnicalSnapshot(bars)
  let scan: WyckoffScanResult | undefined
  let error: string | undefined
  if (bars.length >= 60) {
    try {
      scan = scanWyckoff(bars)
    } catch (scanError) {
      error = scanError instanceof Error ? scanError.message : String(scanError)
    }
  } else {
    error = `Chỉ có ${bars.length} bars; cần >=60 để chạy Wyckoff rule-engine.`
  }
  return {
    key,
    label: key,
    bars: bars.slice(-240),
    provider,
    detail,
    derived,
    available: true,
    error,
    technical,
    scan,
    structure: describeStructure(bars, technical),
    priceAction: describePriceAction(bars),
    volume: describeVolume(technical),
  }
}

export function buildMultiTimeframeStudies(args: {
  dailyBars: OhlcvBar[]
  hourlyBars: OhlcvBar[]
  dailyProvider: string
  dailyDetail: string
  hourlyProvider: string
  hourlyDetail: string
}) {
  const weekly = aggregateWeekly(args.dailyBars)
  const fourHour = aggregateFourHour(args.hourlyBars)
  return [
    study("Weekly", weekly, args.dailyProvider, `${args.dailyDetail} → Weekly aggregate`, true),
    study("Daily", args.dailyBars, args.dailyProvider, args.dailyDetail, false),
    study("4H", fourHour, args.hourlyProvider, `${args.hourlyDetail} → 4H Asia/Ho_Chi_Minh buckets`, true),
    study("1H", args.hourlyBars, args.hourlyProvider, args.hourlyDetail, false),
  ] satisfies TimeframeStudy[]
}

const TF_WEIGHTS: Record<TimeframeKey, number> = { Weekly: 0.3, Daily: 0.35, "4H": 0.2, "1H": 0.15 }

export function buildPromotionDraft(ticker: string, studies: TimeframeStudy[]): PromotionDraft {
  const usable = studies.filter((row) => row.scan)
  const totalWeight = usable.reduce((sum, row) => sum + TF_WEIGHTS[row.key], 0) || 1
  const weighted = (key: "bullProbability" | "baseProbability" | "bearProbability") =>
    Math.round(usable.reduce((sum, row) => sum + (row.scan?.[key] ?? 0) * TF_WEIGHTS[row.key], 0) / totalWeight)
  let bull = weighted("bullProbability")
  let base = weighted("baseProbability")
  let bear = weighted("bearProbability")
  const total = bull + base + bear || 100
  bull = Math.round((bull / total) * 100)
  bear = Math.round((bear / total) * 100)
  base = 100 - bull - bear

  const directional = bull - bear
  const taBias: ScannerBias = directional >= 18 ? "Bullish" : directional <= -18 ? "Bearish" : Math.abs(directional) <= 6 ? "Neutral" : "Mixed"
  // A machine-derived promotion is never HIGH confidence on creation. HIGH is reserved
  // for later human/methodology review of the canonical thesis.
  const confidence: ScannerConfidence = usable.length >= 3 ? "MEDIUM" : "LOW"
  const daily = studies.find((row) => row.key === "Daily")?.scan
  const weekly = studies.find((row) => row.key === "Weekly")?.scan
  const primary = daily ?? weekly ?? usable[0]?.scan
  const tfLine = studies.map((row) => `${row.key}: ${row.scan?.taBias ?? "N/A"} / ${row.scan?.phase ?? "insufficient"}`).join(" | ")

  return {
    ticker,
    taBias,
    confidence,
    bullProbability: bull,
    baseProbability: base,
    bearProbability: bear,
    wyckoffState: tfLine,
    baseCase: `MTF scanner consensus ${bull}/${base}/${bear}. Ưu tiên Daily/Weekly cho structure, 4H/1H cho timing. ${primary?.wyckoffState ?? "Chưa đủ Wyckoff evidence để nâng độ tin cậy."}`,
    support: primary?.support ?? "—",
    resistance: primary?.resistance ?? "—",
    confirmation: primary?.confirmation ?? "Break → Hold → Test → Follow-through tại vùng quyết định gần nhất.",
    invalidation: primary?.invalidation ?? "Thiếu dữ liệu để đặt invalidation có độ tin cậy cao.",
    whatChanged: `Promoted từ Daily Wyckoff Scanner sang canonical thesis bằng MTF workstation. ${tfLine}`,
    timeframes: studies.filter((row) => row.available).map((row) => row.key),
  }
}
