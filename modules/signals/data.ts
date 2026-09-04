import {
  createDataSourcePage,
  isNotionConfigured,
  queryDataSource,
  updatePageProperties,
  type NotionPage,
  type NotionProperties,
} from "@/modules/notion/client"
import {
  dateText,
  numberProperty,
  numberValue,
  pageProperties,
  richText,
  richTextProperty,
  selectText,
  titleProperty,
} from "@/modules/notion/properties"
import type { DailyScanRow } from "@/modules/signals/scanner/data"
import type { BuyDecision, ExitDecision, LiveQuote, OpenRecommendationState } from "@/modules/signals/engine"
import { SIGNAL_ENGINE_VERSION } from "@/modules/signals/engine"
import { invalidateUiCache, readThroughUiCache } from "@/modules/shared/cache/ui-data-cache"

export const RECOMMENDATIONS_DATA_SOURCE_ID = process.env.NOTION_TRADE_RECOMMENDATIONS_DATA_SOURCE_ID ?? "22e1f263-7d3b-41e3-b73e-91df40cf2a2b"
export const SIGNAL_EVENTS_DATA_SOURCE_ID = process.env.NOTION_SIGNAL_EVENTS_DATA_SOURCE_ID ?? "c8771442-368d-4f6a-9549-4859ce869780"
const SIGNAL_UI_CACHE = {
  namespace: "signal-ui-read-model-v1",
  key: "latest",
  tag: "qeoindex-signal-ui-read-model-v1",
  name: "QeoIndex Signals UI projection",
  ttlSeconds: 20,
} as const

export interface TradeRecommendation extends OpenRecommendationState {
  notionUrl: string
  status: "Open" | "Closed" | "Stopped" | "Cancelled" | ""
  buySignal: string
  buyReason: string
  riskPct: number | null
  targetPrice: number | null
  sellSignal: string
  sellPrice: number | null
  sellReason: string
  returnPct: number | null
  vnindexEntry: number | null
  vnindexExit: number | null
  vnindexReturnPct: number | null
  alphaPct: number | null
  outcome: "Open" | "Win" | "Loss" | "Flat" | ""
  dailyBias: string
  scanDate: string
  confidence: string
  provider: string
  engineVersion: string
  lastMonitor: string
  lastPrice: number | null
  lastRelVolume: number | null
}

export interface SignalEventRow {
  id: string
  notionUrl: string
  ticker: string
  type: string
  signalTime: string
  price: number | null
  volume: number | null
  relVolume: number | null
  rule: string
  provider: string
  scanDate: string
  dailyBias: string
  stopPrice: number | null
  vnindex: number | null
}

export interface SignalUiData {
  generatedAt: string
  recommendations: TradeRecommendation[]
  events: SignalEventRow[]
}

function parseRecommendation(page: NotionPage): TradeRecommendation | null {
  const props = pageProperties(page)
  const ticker = richText(props.Ticker).trim().toUpperCase()
  if (!ticker) return null
  return {
    id: page.id,
    notionUrl: page.url ?? "",
    ticker,
    status: selectText(props.Status) as TradeRecommendation["status"],
    buySignal: dateText(props["Buy Signal"]),
    buyPrice: numberValue(props["Buy Price"]) ?? 0,
    buyReason: richText(props["Buy Reason"]),
    stopPrice: numberValue(props["Stop Price"]) ?? 0,
    riskPct: numberValue(props["Risk Pct"]),
    targetPrice: numberValue(props["Initial Target"]),
    sellSignal: dateText(props["Sell Signal"]),
    sellPrice: numberValue(props["Sell Price"]),
    sellReason: richText(props["Sell Reason"]),
    returnPct: numberValue(props["Return Pct"]),
    vnindexEntry: numberValue(props["VNINDEX Entry"]),
    vnindexExit: numberValue(props["VNINDEX Exit"]),
    vnindexReturnPct: numberValue(props["VNINDEX Return Pct"]),
    alphaPct: numberValue(props["Alpha Pct"]),
    outcome: selectText(props.Outcome) as TradeRecommendation["outcome"],
    dailyBias: selectText(props["Daily Bias"]),
    scanDate: dateText(props["Scan Date"]),
    confidence: selectText(props.Confidence),
    provider: selectText(props.Provider),
    engineVersion: richText(props["Engine Version"]),
    lastMonitor: dateText(props["Last Monitor"]),
    lastPrice: numberValue(props["Last Price"]),
    lastRelVolume: numberValue(props["Last Rel Volume"]),
    maxFavorablePct: numberValue(props["Max Favorable Pct"]),
    maxAdversePct: numberValue(props["Max Adverse Pct"]),
  }
}

function parseEvent(page: NotionPage): SignalEventRow | null {
  const props = pageProperties(page)
  const ticker = richText(props.Ticker).trim().toUpperCase()
  if (!ticker) return null
  return {
    id: page.id,
    notionUrl: page.url ?? "",
    ticker,
    type: selectText(props.Type),
    signalTime: dateText(props["Signal Time"]),
    price: numberValue(props.Price),
    volume: numberValue(props.Volume),
    relVolume: numberValue(props["Rel Volume"]),
    rule: richText(props.Rule),
    provider: selectText(props.Provider),
    scanDate: dateText(props["Scan Date"]),
    dailyBias: selectText(props["Daily Bias"]),
    stopPrice: numberValue(props["Stop Price"]),
    vnindex: numberValue(props.VNINDEX),
  }
}

function isSignalUiData(value: unknown): value is SignalUiData {
  if (!value || typeof value !== "object") return false
  const data = value as Partial<SignalUiData>
  return typeof data.generatedAt === "string" && Array.isArray(data.recommendations) && Array.isArray(data.events)
}

async function recommendationPages(options: Parameters<typeof queryDataSource>[1] = {}) {
  const result = await queryDataSource(RECOMMENDATIONS_DATA_SOURCE_ID, {
    ...options,
    errorContext: "Notion signal query",
  })
  return result.results
}

async function signalEventPages() {
  const result = await queryDataSource(SIGNAL_EVENTS_DATA_SOURCE_ID, {
    sorts: [{ property: "Signal Time", direction: "descending" }],
    errorContext: "Notion signal query",
  })
  return result.results
}

export async function getRecommendations() {
  if (!isNotionConfigured()) return [] as TradeRecommendation[]
  const pages = await recommendationPages({ sorts: [{ property: "Buy Signal", direction: "descending" }] })
  return pages.map(parseRecommendation).filter(Boolean) as TradeRecommendation[]
}

export async function getSignalEvents() {
  if (!isNotionConfigured()) return [] as SignalEventRow[]
  const pages = await signalEventPages()
  return pages.map(parseEvent).filter(Boolean) as SignalEventRow[]
}

/** Operational monitor path: query all currently Open recommendations directly from Notion. */
export async function getOpenRecommendationsFresh() {
  if (!isNotionConfigured()) return [] as TradeRecommendation[]
  const pages = await recommendationPages({
    filter: { property: "Status", select: { equals: "Open" } },
    sorts: [{ property: "Buy Signal", direction: "descending" }],
    maxPages: 5,
  })
  return pages.map(parseRecommendation).filter(Boolean) as TradeRecommendation[]
}

/** Backward-compatible operational alias; intentionally not UI-cached. */
export async function getOpenRecommendations() {
  return getOpenRecommendationsFresh()
}

async function loadSignalUiData(): Promise<SignalUiData> {
  const [recommendations, events] = await Promise.all([getRecommendations(), getSignalEvents()])
  return { generatedAt: new Date().toISOString(), recommendations, events }
}

export async function getSignalUiData(): Promise<SignalUiData> {
  if (!isNotionConfigured()) return { generatedAt: new Date().toISOString(), recommendations: [], events: [] }
  return readThroughUiCache({ ...SIGNAL_UI_CACHE, validate: isSignalUiData, load: loadSignalUiData })
}

export async function invalidateSignalDataCache() {
  await invalidateUiCache(SIGNAL_UI_CACHE)
}

export async function createBuyRecommendation(args: { scan: DailyScanRow; quote: LiveQuote; decision: BuyDecision; vnindex: number | null }) {
  if (!args.decision.signal || args.decision.stopPrice == null) throw new Error("Cannot persist non-BUY decision")
  const now = new Date(args.quote.timestamp).toISOString()
  const properties: NotionProperties = {
    Recommendation: titleProperty(`${args.scan.ticker} — BUY — ${now.slice(0, 16)}`),
    Ticker: richTextProperty(args.scan.ticker),
    Status: { select: { name: "Open" } },
    "Buy Signal": { date: { start: now } },
    "Buy Price": numberProperty(args.quote.price),
    "Buy Reason": richTextProperty(args.decision.reason),
    "Stop Price": numberProperty(args.decision.stopPrice),
    "Risk Pct": numberProperty(args.decision.riskPct),
    "Initial Target": numberProperty(args.decision.targetPrice),
    "VNINDEX Entry": numberProperty(args.vnindex),
    Outcome: { select: { name: "Open" } },
    "Daily Bias": { select: { name: args.scan.taBias } },
    "Scan Date": args.scan.date ? { date: { start: args.scan.date } } : { date: null },
    Confidence: args.scan.confidence ? { select: { name: args.scan.confidence } } : { select: null },
    Provider: { select: { name: "DNSE" } },
    "Engine Version": richTextProperty(SIGNAL_ENGINE_VERSION),
    "Last Monitor": { date: { start: now } },
    "Last Price": numberProperty(args.quote.price),
    "Last Rel Volume": numberProperty(args.decision.volumePace),
    "Max Favorable Pct": numberProperty(0),
    "Max Adverse Pct": numberProperty(0),
  }
  const page = await createDataSourcePage(RECOMMENDATIONS_DATA_SOURCE_ID, properties, {
    errorContext: "Notion BUY recommendation write",
  })
  await invalidateSignalDataCache()
  return parseRecommendation(page)!
}

export async function updateRecommendationMonitor(row: TradeRecommendation, quote: LiveQuote, exit: ExitDecision) {
  return patchPage(row.id, {
    "Last Monitor": { date: { start: new Date(quote.timestamp).toISOString() } },
    "Last Price": numberProperty(quote.price),
    "Last Rel Volume": numberProperty(exit.volumePace),
    "Max Favorable Pct": numberProperty(exit.maxFavorablePct),
    "Max Adverse Pct": numberProperty(exit.maxAdversePct),
  })
}

export async function closeRecommendation(row: TradeRecommendation, quote: LiveQuote, exit: ExitDecision, vnindex: number | null) {
  if (!exit.signal || !exit.type) throw new Error("Cannot close without exit signal")
  const vnindexReturnPct = row.vnindexEntry && vnindex ? ((vnindex - row.vnindexEntry) / row.vnindexEntry) * 100 : null
  const alphaPct = vnindexReturnPct == null ? null : exit.returnPct - vnindexReturnPct
  const outcome = exit.returnPct > 0.2 ? "Win" : exit.returnPct < -0.2 ? "Loss" : "Flat"
  const properties: NotionProperties = {
    Status: { select: { name: exit.type === "EXIT_FAIL" ? "Stopped" : "Closed" } },
    "Sell Signal": { date: { start: new Date(quote.timestamp).toISOString() } },
    "Sell Price": numberProperty(quote.price),
    "Sell Reason": richTextProperty(exit.reason),
    "Return Pct": numberProperty(exit.returnPct),
    "VNINDEX Exit": numberProperty(vnindex),
    "VNINDEX Return Pct": numberProperty(vnindexReturnPct),
    "Alpha Pct": numberProperty(alphaPct),
    Outcome: { select: { name: outcome } },
    "Last Monitor": { date: { start: new Date(quote.timestamp).toISOString() } },
    "Last Price": numberProperty(quote.price),
    "Last Rel Volume": numberProperty(exit.volumePace),
    "Max Favorable Pct": numberProperty(exit.maxFavorablePct),
    "Max Adverse Pct": numberProperty(exit.maxAdversePct),
  }
  await patchPage(row.id, properties)
  return { returnPct: exit.returnPct, vnindexReturnPct, alphaPct, outcome }
}

async function patchPage(pageId: string, properties: NotionProperties) {
  const page = await updatePageProperties(pageId, properties, {
    errorContext: "Notion recommendation update",
  })
  await invalidateSignalDataCache()
  return page
}

export async function createSignalEvent(args: {
  type: "BUY" | "SELL" | "EXIT_FAIL" | "WATCH"
  recommendationId?: string
  scan: DailyScanRow | undefined
  quote: LiveQuote
  rule: string
  relVolume: number | null
  stopPrice: number | null
  vnindex: number | null
}) {
  const now = new Date(args.quote.timestamp).toISOString()
  const ticker = args.quote.ticker
  const properties: NotionProperties = {
    Signal: titleProperty(`${ticker} — ${args.type} — ${now.slice(0, 16)}`),
    Ticker: richTextProperty(ticker),
    Type: { select: { name: args.type } },
    "Signal Time": { date: { start: now } },
    Price: numberProperty(args.quote.price),
    Volume: numberProperty(args.quote.totalVolume),
    "Rel Volume": numberProperty(args.relVolume),
    Rule: richTextProperty(args.rule),
    "Engine Version": richTextProperty(SIGNAL_ENGINE_VERSION),
    Provider: { select: { name: "DNSE" } },
    "Scan Date": args.scan?.date ? { date: { start: args.scan.date } } : { date: null },
    "Daily Bias": args.scan?.taBias ? { select: { name: args.scan.taBias } } : { select: null },
    "Stop Price": numberProperty(args.stopPrice),
    VNINDEX: numberProperty(args.vnindex),
  }
  if (args.recommendationId) properties.Recommendation = { relation: [{ id: args.recommendationId }] }
  const page = await createDataSourcePage(SIGNAL_EVENTS_DATA_SOURCE_ID, properties, {
    errorContext: "Notion signal event write",
  })
  await invalidateSignalDataCache()
  return parseEvent(page)
}
