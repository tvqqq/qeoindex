import type { DailyScanRow } from "@/lib/scanner-data"
import type { BuyDecision, ExitDecision, LiveQuote, OpenRecommendationState } from "@/lib/signal-engine"
import { SIGNAL_ENGINE_VERSION } from "@/lib/signal-engine"
import { invalidateUiCache, readThroughUiCache } from "@/lib/ui-data-cache"

const NOTION_VERSION = "2026-03-11"
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

function token() {
  return process.env.NOTION_API_KEY ?? process.env.NOTION_TOKEN ?? ""
}
function headers() {
  const apiKey = token()
  if (!apiKey) throw new Error("NOTION_API_KEY is not configured")
  return { Authorization: `Bearer ${apiKey}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" }
}
function text(prop: any) { return (prop?.rich_text ?? []).map((item: any) => item?.plain_text ?? "").join("") }
function number(prop: any): number | null { return typeof prop?.number === "number" ? prop.number : null }
function select(prop: any) { return prop?.select?.name ?? "" }
function date(prop: any) { return prop?.date?.start ?? "" }
function rich(value: string) { return { rich_text: value ? [{ type: "text", text: { content: value.slice(0, 1900) } }] : [] } }
function num(value: number | null | undefined) { return { number: typeof value === "number" && Number.isFinite(value) ? value : null } }

async function query(dataSourceId: string, body: Record<string, unknown> = {}, maxPages = 1) {
  const results: any[] = []
  let startCursor: string | undefined
  for (let page = 0; page < maxPages; page += 1) {
    const response = await fetch(`https://api.notion.com/v1/data_sources/${dataSourceId}/query`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ page_size: 100, ...body, ...(startCursor ? { start_cursor: startCursor } : {}) }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    })
    const payload = await response.json()
    if (!response.ok) throw new Error(`Notion signal query failed (${response.status}): ${JSON.stringify(payload).slice(0, 280)}`)
    results.push(...(payload.results ?? []))
    if (!payload.has_more || !payload.next_cursor) break
    startCursor = payload.next_cursor
  }
  return results
}

function parseRecommendation(page: any): TradeRecommendation | null {
  const props = page?.properties ?? {}
  const ticker = text(props.Ticker).trim().toUpperCase()
  if (!ticker) return null
  return {
    id: page.id, notionUrl: page.url ?? "", ticker, status: select(props.Status) as TradeRecommendation["status"],
    buySignal: date(props["Buy Signal"]), buyPrice: number(props["Buy Price"]) ?? 0, buyReason: text(props["Buy Reason"]), stopPrice: number(props["Stop Price"]) ?? 0,
    riskPct: number(props["Risk Pct"]), targetPrice: number(props["Initial Target"]), sellSignal: date(props["Sell Signal"]), sellPrice: number(props["Sell Price"]), sellReason: text(props["Sell Reason"]), returnPct: number(props["Return Pct"]),
    vnindexEntry: number(props["VNINDEX Entry"]), vnindexExit: number(props["VNINDEX Exit"]), vnindexReturnPct: number(props["VNINDEX Return Pct"]), alphaPct: number(props["Alpha Pct"]), outcome: select(props.Outcome) as TradeRecommendation["outcome"],
    dailyBias: select(props["Daily Bias"]), scanDate: date(props["Scan Date"]), confidence: select(props.Confidence), provider: select(props.Provider), engineVersion: text(props["Engine Version"]), lastMonitor: date(props["Last Monitor"]), lastPrice: number(props["Last Price"]), lastRelVolume: number(props["Last Rel Volume"]),
    maxFavorablePct: number(props["Max Favorable Pct"]), maxAdversePct: number(props["Max Adverse Pct"]),
  }
}
function parseEvent(page: any): SignalEventRow | null {
  const props = page?.properties ?? {}
  const ticker = text(props.Ticker).trim().toUpperCase()
  if (!ticker) return null
  return { id: page.id, notionUrl: page.url ?? "", ticker, type: select(props.Type), signalTime: date(props["Signal Time"]), price: number(props.Price), volume: number(props.Volume), relVolume: number(props["Rel Volume"]), rule: text(props.Rule), provider: select(props.Provider), scanDate: date(props["Scan Date"]), dailyBias: select(props["Daily Bias"]), stopPrice: number(props["Stop Price"]), vnindex: number(props.VNINDEX) }
}

function isSignalUiData(value: unknown): value is SignalUiData {
  if (!value || typeof value !== "object") return false
  const data = value as Partial<SignalUiData>
  return typeof data.generatedAt === "string" && Array.isArray(data.recommendations) && Array.isArray(data.events)
}

export async function getRecommendations() {
  if (!token()) return [] as TradeRecommendation[]
  const pages = await query(RECOMMENDATIONS_DATA_SOURCE_ID, { sorts: [{ property: "Buy Signal", direction: "descending" }] })
  return pages.map(parseRecommendation).filter(Boolean) as TradeRecommendation[]
}
export async function getSignalEvents() {
  if (!token()) return [] as SignalEventRow[]
  const pages = await query(SIGNAL_EVENTS_DATA_SOURCE_ID, { sorts: [{ property: "Signal Time", direction: "descending" }] })
  return pages.map(parseEvent).filter(Boolean) as SignalEventRow[]
}

/** Operational monitor path: query all currently Open recommendations directly from Notion. */
export async function getOpenRecommendationsFresh() {
  if (!token()) return [] as TradeRecommendation[]
  const pages = await query(RECOMMENDATIONS_DATA_SOURCE_ID, {
    filter: { property: "Status", select: { equals: "Open" } },
    sorts: [{ property: "Buy Signal", direction: "descending" }],
  }, 5)
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
  if (!token()) return { generatedAt: new Date().toISOString(), recommendations: [], events: [] }
  return readThroughUiCache({ ...SIGNAL_UI_CACHE, validate: isSignalUiData, load: loadSignalUiData })
}

export async function invalidateSignalDataCache() {
  await invalidateUiCache(SIGNAL_UI_CACHE)
}

export async function createBuyRecommendation(args: { scan: DailyScanRow; quote: LiveQuote; decision: BuyDecision; vnindex: number | null }) {
  if (!args.decision.signal || args.decision.stopPrice == null) throw new Error("Cannot persist non-BUY decision")
  const now = new Date(args.quote.timestamp).toISOString()
  const properties: Record<string, any> = {
    Recommendation: { title: [{ type: "text", text: { content: `${args.scan.ticker} — BUY — ${now.slice(0, 16)}` } }] }, Ticker: rich(args.scan.ticker), Status: { select: { name: "Open" } },
    "Buy Signal": { date: { start: now } }, "Buy Price": num(args.quote.price), "Buy Reason": rich(args.decision.reason), "Stop Price": num(args.decision.stopPrice), "Risk Pct": num(args.decision.riskPct), "Initial Target": num(args.decision.targetPrice), "VNINDEX Entry": num(args.vnindex), Outcome: { select: { name: "Open" } },
    "Daily Bias": { select: { name: args.scan.taBias } }, "Scan Date": args.scan.date ? { date: { start: args.scan.date } } : { date: null }, Confidence: args.scan.confidence ? { select: { name: args.scan.confidence } } : { select: null }, Provider: { select: { name: "DNSE" } }, "Engine Version": rich(SIGNAL_ENGINE_VERSION),
    "Last Monitor": { date: { start: now } }, "Last Price": num(args.quote.price), "Last Rel Volume": num(args.decision.volumePace), "Max Favorable Pct": num(0), "Max Adverse Pct": num(0),
  }
  const response = await fetch("https://api.notion.com/v1/pages", { method: "POST", headers: headers(), body: JSON.stringify({ parent: { data_source_id: RECOMMENDATIONS_DATA_SOURCE_ID }, properties }), cache: "no-store" })
  const payload = await response.json()
  if (!response.ok) throw new Error(`Notion BUY recommendation write failed (${response.status}): ${JSON.stringify(payload).slice(0, 300)}`)
  await invalidateSignalDataCache()
  return parseRecommendation(payload)!
}

export async function updateRecommendationMonitor(row: TradeRecommendation, quote: LiveQuote, exit: ExitDecision) {
  return patchPage(row.id, { "Last Monitor": { date: { start: new Date(quote.timestamp).toISOString() } }, "Last Price": num(quote.price), "Last Rel Volume": num(exit.volumePace), "Max Favorable Pct": num(exit.maxFavorablePct), "Max Adverse Pct": num(exit.maxAdversePct) })
}
export async function closeRecommendation(row: TradeRecommendation, quote: LiveQuote, exit: ExitDecision, vnindex: number | null) {
  if (!exit.signal || !exit.type) throw new Error("Cannot close without exit signal")
  const vnindexReturnPct = row.vnindexEntry && vnindex ? ((vnindex - row.vnindexEntry) / row.vnindexEntry) * 100 : null
  const alphaPct = vnindexReturnPct == null ? null : exit.returnPct - vnindexReturnPct
  const outcome = exit.returnPct > 0.2 ? "Win" : exit.returnPct < -0.2 ? "Loss" : "Flat"
  const properties: Record<string, any> = { Status: { select: { name: exit.type === "EXIT_FAIL" ? "Stopped" : "Closed" } }, "Sell Signal": { date: { start: new Date(quote.timestamp).toISOString() } }, "Sell Price": num(quote.price), "Sell Reason": rich(exit.reason), "Return Pct": num(exit.returnPct), "VNINDEX Exit": num(vnindex), "VNINDEX Return Pct": num(vnindexReturnPct), "Alpha Pct": num(alphaPct), Outcome: { select: { name: outcome } }, "Last Monitor": { date: { start: new Date(quote.timestamp).toISOString() } }, "Last Price": num(quote.price), "Last Rel Volume": num(exit.volumePace), "Max Favorable Pct": num(exit.maxFavorablePct), "Max Adverse Pct": num(exit.maxAdversePct) }
  await patchPage(row.id, properties)
  return { returnPct: exit.returnPct, vnindexReturnPct, alphaPct, outcome }
}
async function patchPage(pageId: string, properties: Record<string, any>) {
  const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, { method: "PATCH", headers: headers(), body: JSON.stringify({ properties }), cache: "no-store" })
  const payload = await response.json()
  if (!response.ok) throw new Error(`Notion recommendation update failed (${response.status}): ${JSON.stringify(payload).slice(0, 300)}`)
  await invalidateSignalDataCache()
  return payload
}

export async function createSignalEvent(args: { type: "BUY" | "SELL" | "EXIT_FAIL" | "WATCH"; recommendationId?: string; scan: DailyScanRow | undefined; quote: LiveQuote; rule: string; relVolume: number | null; stopPrice: number | null; vnindex: number | null }) {
  const now = new Date(args.quote.timestamp).toISOString()
  const ticker = args.quote.ticker
  const properties: Record<string, any> = {
    Signal: { title: [{ type: "text", text: { content: `${ticker} — ${args.type} — ${now.slice(0, 16)}` } }] }, Ticker: rich(ticker), Type: { select: { name: args.type } }, "Signal Time": { date: { start: now } }, Price: num(args.quote.price), Volume: num(args.quote.totalVolume), "Rel Volume": num(args.relVolume), Rule: rich(args.rule), "Engine Version": rich(SIGNAL_ENGINE_VERSION), Provider: { select: { name: "DNSE" } }, "Scan Date": args.scan?.date ? { date: { start: args.scan.date } } : { date: null }, "Daily Bias": args.scan?.taBias ? { select: { name: args.scan.taBias } } : { select: null }, "Stop Price": num(args.stopPrice), VNINDEX: num(args.vnindex),
  }
  if (args.recommendationId) properties.Recommendation = { relation: [{ id: args.recommendationId }] }
  const response = await fetch("https://api.notion.com/v1/pages", { method: "POST", headers: headers(), body: JSON.stringify({ parent: { data_source_id: SIGNAL_EVENTS_DATA_SOURCE_ID }, properties }), cache: "no-store" })
  const payload = await response.json()
  if (!response.ok) throw new Error(`Notion signal event write failed (${response.status}): ${JSON.stringify(payload).slice(0, 300)}`)
  await invalidateSignalDataCache()
  return parseEvent(payload)
}
