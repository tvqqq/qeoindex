import { dnseProviderHealth } from "@/lib/dnse-history"
import { TOP50_HOSE, UNIVERSE_DATE, type UniverseStock } from "@/lib/wyckoff-universe"
import type { HistoricalProvider } from "@/lib/market-history"
import type { ScannerBias, ScannerConfidence, WyckoffScanResult } from "@/lib/wyckoff-engine"
import { getSupabaseScannerData } from "@/lib/scanner-supabase"

const NOTION_VERSION = "2026-03-11"
const UNIVERSE_DATA_SOURCE_ID = process.env.NOTION_WYCKOFF_UNIVERSE_DATA_SOURCE_ID ?? "210c502d-0c32-4fdd-9d69-7ef18e2be7d5"
const SCAN_DATA_SOURCE_ID = process.env.NOTION_DAILY_WYCKOFF_SCAN_DATA_SOURCE_ID ?? "b76e378a-3f0c-4315-82cd-52c844101b73"

export interface UniverseRow extends UniverseStock {
  id: string
  active: boolean
  providerStatus: string
  lastScan: string
  sector: string
}

export interface DailyScanRow {
  id: string
  ticker: string
  date: string
  rank: number
  price: number | null
  changePct: number | null
  volume: number | null
  rsi14: number | null
  macd: number | null
  macdSignal: number | null
  ma20: number | null
  ma50: number | null
  ma200: number | null
  atr14: number | null
  relVolume: number | null
  wyckoffState: string
  phase: string
  taBias: ScannerBias
  bullProbability: number | null
  baseProbability: number | null
  bearProbability: number | null
  support: string
  resistance: string
  confirmation: string
  invalidation: string
  whatChanged: string
  confidence: ScannerConfidence | ""
  provider: string
  providerDetail: string
  status: string
}

export interface ScannerProviderHealth {
  configured: boolean
  provider: "DNSE"
  status: string
  currentProvider: string
  message: string
  lastSuccessAt: string
  lastFailureAt: string
}

export interface ScannerData {
  source: "notion" | "supabase" | "fallback"
  operationalBackend: "notion" | "supabase"
  universeDate: string
  generatedAt: string
  universe: UniverseRow[]
  latestScans: Record<string, DailyScanRow>
  providerHealth: ScannerProviderHealth
}

export type DailyScanStatus = "Complete" | "Incomplete"

function token() {
  return process.env.NOTION_API_KEY ?? process.env.NOTION_TOKEN ?? ""
}

function title(prop: any) {
  return (prop?.title ?? []).map((item: any) => item?.plain_text ?? "").join("")
}
function text(prop: any) {
  return (prop?.rich_text ?? []).map((item: any) => item?.plain_text ?? "").join("")
}
function number(prop: any): number | null {
  return typeof prop?.number === "number" ? prop.number : null
}
function select(prop: any) {
  return prop?.select?.name ?? ""
}
function date(prop: any) {
  return prop?.date?.start ?? ""
}
function checkbox(prop: any) {
  return Boolean(prop?.checkbox)
}

async function notionQuery(dataSourceId: string, body: Record<string, unknown> = {}) {
  const apiKey = token()
  if (!apiKey) throw new Error("NOTION_API_KEY is not configured")
  const response = await fetch(`https://api.notion.com/v1/data_sources/${dataSourceId}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ page_size: 100, ...body }),
    cache: "no-store",
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(`Notion scanner query failed (${response.status}): ${JSON.stringify(payload).slice(0, 240)}`)
  return payload.results ?? []
}

function fallbackUniverse(): UniverseRow[] {
  return TOP50_HOSE.map((row) => ({
    ...row,
    id: `fallback-${row.ticker}`,
    active: true,
    providerStatus: "Pending",
    lastScan: "",
    sector: "",
  }))
}

function parseUniversePage(page: any): UniverseRow | null {
  const props = page?.properties ?? {}
  const ticker = title(props.Ticker).trim().toUpperCase()
  const rank = number(props.Rank)
  const marketCapT = number(props["Market Cap T"])
  if (!ticker || rank == null || marketCapT == null) return null
  return {
    id: page.id,
    ticker,
    rank,
    marketCapT,
    exchange: "HOSE",
    active: checkbox(props.Active),
    providerStatus: select(props["Provider Status"]),
    lastScan: date(props["Last Scan"]),
    sector: text(props.Sector),
  }
}

function parseScanPage(page: any): DailyScanRow | null {
  const props = page?.properties ?? {}
  const ticker = text(props.Ticker).trim().toUpperCase()
  if (!ticker) return null
  return {
    id: page.id,
    ticker,
    date: date(props.Date),
    rank: number(props.Rank) ?? 0,
    price: number(props.Price),
    changePct: number(props["Change Pct"]),
    volume: number(props.Volume),
    rsi14: number(props.RSI14),
    macd: number(props.MACD),
    macdSignal: number(props["MACD Signal"]),
    ma20: number(props.MA20),
    ma50: number(props.MA50),
    ma200: number(props.MA200),
    atr14: number(props.ATR14),
    relVolume: number(props["Rel Volume"]),
    wyckoffState: text(props["Wyckoff State"]),
    phase: text(props.Phase),
    taBias: (select(props["TA Bias"]) || "Neutral") as ScannerBias,
    bullProbability: number(props["Bull Probability"]),
    baseProbability: number(props["Base Probability"]),
    bearProbability: number(props["Bear Probability"]),
    support: text(props.Support),
    resistance: text(props.Resistance),
    confirmation: text(props.Confirmation),
    invalidation: text(props.Invalidation),
    whatChanged: text(props["What Changed"]),
    confidence: select(props.Confidence) as ScannerConfidence | "",
    provider: select(props.Provider),
    providerDetail: "Notion mirror",
    status: select(props.Status),
  }
}

export async function getScannerData(): Promise<ScannerData> {
  const backend = (process.env.STOCKOS_SCANNER_BACKEND ?? "notion").trim().toLowerCase()
  if (backend === "supabase") return getSupabaseScannerData()
  if (backend !== "notion") throw new Error(`Unsupported STOCKOS_SCANNER_BACKEND: ${backend}`)
  let universe = fallbackUniverse()
  const latestScans: Record<string, DailyScanRow> = {}
  let source: ScannerData["source"] = "fallback"
  if (token()) {
    try {
      const [universePages, scanPages] = await Promise.all([
        notionQuery(UNIVERSE_DATA_SOURCE_ID, {
          sorts: [{ property: "Rank", direction: "ascending" }],
        }),
        notionQuery(SCAN_DATA_SOURCE_ID, {
          sorts: [{ property: "Date", direction: "descending" }],
        }),
      ])
      const parsedUniverse = universePages.map(parseUniversePage).filter(Boolean) as UniverseRow[]
      if (parsedUniverse.length) universe = parsedUniverse.filter((row) => row.active).sort((a, b) => a.rank - b.rank)
      for (const page of scanPages) {
        const row = parseScanPage(page)
        if (row && !latestScans[row.ticker]) latestScans[row.ticker] = row
      }
      source = "notion"
    } catch (error) {
      console.error("Scanner Notion read failed", error)
    }
  }
  return {
    source,
    operationalBackend: "notion",
    universeDate: UNIVERSE_DATE,
    generatedAt: new Date().toISOString(),
    universe,
    latestScans,
    providerHealth: {
      ...dnseProviderHealth(),
      status: source === "notion" ? "mirror" : "pending",
      currentProvider: (() => {
        const providers = [...new Set(Object.values(latestScans).map((scan) => scan.provider).filter(Boolean))]
        return providers.length > 1 ? "Mixed providers" : providers[0] === "Fallback" ? "Yahoo fallback" : providers[0] || "Chưa có dữ liệu"
      })(),
      lastSuccessAt: "",
      lastFailureAt: "",
    },
  }
}

function richTextValue(value: string) {
  return { rich_text: value ? [{ type: "text", text: { content: value.slice(0, 1900) } }] : [] }
}
function numberValue(value: number | null | undefined) {
  return { number: typeof value === "number" && Number.isFinite(value) ? value : null }
}

export async function writeDailyScan(
  ticker: string,
  rank: number,
  scanDate: string,
  result: WyckoffScanResult,
  provider: HistoricalProvider = "DNSE",
  status: DailyScanStatus = "Complete",
) {
  const apiKey = token()
  if (!apiKey) throw new Error("NOTION_API_KEY is not configured")
  const t = result.technical
  const properties: Record<string, any> = {
    Scan: { title: [{ type: "text", text: { content: `${ticker} — Daily Scan — ${scanDate}` } }] },
    Ticker: richTextValue(ticker),
    Date: { date: { start: scanDate } },
    Rank: numberValue(rank),
    Price: numberValue(t.price),
    "Change Pct": numberValue(t.changePct),
    Volume: numberValue(t.volume),
    RSI14: numberValue(t.rsi14),
    MACD: numberValue(t.macd),
    "MACD Signal": numberValue(t.macdSignal),
    MA20: numberValue(t.ma20),
    MA50: numberValue(t.ma50),
    MA200: numberValue(t.ma200),
    ATR14: numberValue(t.atr14),
    "Rel Volume": numberValue(t.relVolume),
    "Wyckoff State": richTextValue(result.wyckoffState),
    Phase: richTextValue(result.phase),
    "TA Bias": { select: { name: result.taBias } },
    "Bull Probability": numberValue(result.bullProbability),
    "Base Probability": numberValue(result.baseProbability),
    "Bear Probability": numberValue(result.bearProbability),
    Support: richTextValue(result.support),
    Resistance: richTextValue(result.resistance),
    Confirmation: richTextValue(result.confirmation),
    Invalidation: richTextValue(result.invalidation),
    "What Changed": richTextValue(result.whatChanged),
    Confidence: { select: { name: result.confidence } },
    Provider: { select: { name: provider } },
    Status: { select: { name: status } },
  }
  const response = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ parent: { data_source_id: SCAN_DATA_SOURCE_ID }, properties }),
    cache: "no-store",
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(`Notion scan write failed (${response.status}): ${JSON.stringify(payload).slice(0, 260)}`)
  return payload
}

export function rowToPreviousResult(row?: DailyScanRow): WyckoffScanResult | null {
  if (!row || row.bullProbability == null || row.baseProbability == null || row.bearProbability == null) return null
  return {
    technical: {
      price: row.price ?? 0,
      changePct: row.changePct ?? 0,
      volume: row.volume ?? 0,
      ma20: row.ma20,
      ma50: row.ma50,
      ma200: row.ma200,
      rsi14: row.rsi14,
      macd: row.macd,
      macdSignal: row.macdSignal,
      atr14: row.atr14,
      relVolume: row.relVolume,
    },
    wyckoffState: row.wyckoffState,
    phase: row.phase,
    taBias: row.taBias,
    bullProbability: row.bullProbability,
    baseProbability: row.baseProbability,
    bearProbability: row.bearProbability,
    support: row.support,
    resistance: row.resistance,
    confirmation: row.confirmation,
    invalidation: row.invalidation,
    whatChanged: row.whatChanged,
    confidence: row.confidence || "LOW",
    tags: [],
  }
}
