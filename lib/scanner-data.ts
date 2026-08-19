import { dnseProviderHealth } from "@/lib/dnse-history"
import type { HistoricalProvider } from "@/lib/market-history"
import {
  createDataSourcePage,
  isNotionConfigured,
  queryDataSource,
  type NotionPage,
  type NotionProperties,
} from "@/lib/notion/client"
import {
  checkboxValue,
  dateText,
  numberProperty,
  numberValue,
  pageProperties,
  richText,
  richTextProperty,
  selectText,
  titleProperty,
  titleText,
} from "@/lib/notion/properties"
import type { ScannerHistoryStatus } from "@/lib/scanner-policy"
import { invalidateUiCache, readThroughUiCache } from "@/lib/ui-data-cache"
import { UNIVERSE_DATE, type UniverseStock } from "@/lib/wyckoff-universe"
import type { ScannerBias, ScannerConfidence, WyckoffScanResult } from "@/lib/wyckoff-engine"

const UNIVERSE_DATA_SOURCE_ID = process.env.NOTION_WYCKOFF_UNIVERSE_DATA_SOURCE_ID ?? "210c502d-0c32-4fdd-9d69-7ef18e2be7d5"
const SCAN_DATA_SOURCE_ID = process.env.NOTION_DAILY_WYCKOFF_SCAN_DATA_SOURCE_ID ?? "b76e378a-3f0c-4315-82cd-52c844101b73"
const SCANNER_CACHE = {
  namespace: "scanner-read-model-v2",
  key: "latest",
  tag: "qeoindex-scanner-read-model-v2",
  name: "QeoIndex Scanner latest-date read model",
  ttlSeconds: 60,
} as const

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
  source: "notion"
  operationalBackend: "notion"
  universeDate: string
  generatedAt: string
  universe: UniverseRow[]
  latestScans: Record<string, DailyScanRow>
  providerHealth: ScannerProviderHealth
}

export type DailyScanStatus = ScannerHistoryStatus

function parseUniversePage(page: NotionPage): UniverseRow | null {
  const props = pageProperties(page)
  const ticker = titleText(props.Ticker).trim().toUpperCase()
  const rank = numberValue(props.Rank)
  const marketCapT = numberValue(props["Market Cap T"])
  if (!ticker || rank == null || marketCapT == null) return null
  return {
    id: page.id,
    ticker,
    rank,
    marketCapT,
    exchange: "HOSE",
    active: checkboxValue(props.Active),
    providerStatus: selectText(props["Provider Status"]),
    lastScan: dateText(props["Last Scan"]),
    sector: richText(props.Sector),
  }
}

function parseScanPage(page: NotionPage): DailyScanRow | null {
  const props = pageProperties(page)
  const ticker = richText(props.Ticker).trim().toUpperCase()
  if (!ticker) return null
  return {
    id: page.id,
    ticker,
    date: dateText(props.Date),
    rank: numberValue(props.Rank) ?? 0,
    price: numberValue(props.Price),
    changePct: numberValue(props["Change Pct"]),
    volume: numberValue(props.Volume),
    rsi14: numberValue(props.RSI14),
    macd: numberValue(props.MACD),
    macdSignal: numberValue(props["MACD Signal"]),
    ma20: numberValue(props.MA20),
    ma50: numberValue(props.MA50),
    ma200: numberValue(props.MA200),
    atr14: numberValue(props.ATR14),
    relVolume: numberValue(props["Rel Volume"]),
    wyckoffState: richText(props["Wyckoff State"]),
    phase: richText(props.Phase),
    taBias: (selectText(props["TA Bias"]) || "Neutral") as ScannerBias,
    bullProbability: numberValue(props["Bull Probability"]),
    baseProbability: numberValue(props["Base Probability"]),
    bearProbability: numberValue(props["Bear Probability"]),
    support: richText(props.Support),
    resistance: richText(props.Resistance),
    confirmation: richText(props.Confirmation),
    invalidation: richText(props.Invalidation),
    whatChanged: richText(props["What Changed"]),
    confidence: selectText(props.Confidence) as ScannerConfidence | "",
    provider: selectText(props.Provider),
    providerDetail: "Notion",
    status: selectText(props.Status),
  }
}

function isScannerData(value: unknown): value is ScannerData {
  if (!value || typeof value !== "object") return false
  const data = value as Partial<ScannerData>
  return data.source === "notion"
    && data.operationalBackend === "notion"
    && typeof data.generatedAt === "string"
    && Array.isArray(data.universe)
    && data.universe.length > 0
    && Boolean(data.latestScans)
    && typeof data.latestScans === "object"
}

async function loadUniverse() {
  const { results } = await queryDataSource(UNIVERSE_DATA_SOURCE_ID, {
    sorts: [{ property: "Rank", direction: "ascending" }],
    maxPages: 2,
    errorContext: "Notion scanner query",
  })
  const universe = results
    .map(parseUniversePage)
    .filter((row): row is UniverseRow => Boolean(row?.active))
    .sort((a, b) => a.rank - b.rank)
  if (!universe.length) throw new Error("Notion Wyckoff Universe returned no active stocks")
  return universe
}

async function loadLatestScanPages() {
  const newest = await queryDataSource(SCAN_DATA_SOURCE_ID, {
    pageSize: 1,
    sorts: [{ property: "Date", direction: "descending" }],
    errorContext: "Notion scanner query",
  })
  const latestDate = newest.results.map(parseScanPage).find(Boolean)?.date ?? ""
  if (!latestDate) return []
  const latest = await queryDataSource(SCAN_DATA_SOURCE_ID, {
    filter: { property: "Date", date: { equals: latestDate } },
    sorts: [{ property: "Rank", direction: "ascending" }],
    maxPages: 2,
    errorContext: "Notion scanner query",
  })
  return latest.results
}

function buildScannerData(universe: UniverseRow[], scanPages: NotionPage[]): ScannerData {
  const latestScans: Record<string, DailyScanRow> = {}
  for (const page of scanPages) {
    const row = parseScanPage(page)
    if (row) latestScans[row.ticker] = row
  }
  const providers = [...new Set(Object.values(latestScans).map((scan) => scan.provider).filter(Boolean))]
  return {
    source: "notion",
    operationalBackend: "notion",
    universeDate: UNIVERSE_DATE,
    generatedAt: new Date().toISOString(),
    universe,
    latestScans,
    providerHealth: {
      ...dnseProviderHealth(),
      status: "notion",
      currentProvider: providers.length > 1 ? "Mixed providers" : providers[0] === "Fallback" ? "Yahoo fallback" : providers[0] || "Chưa có dữ liệu",
      lastSuccessAt: "",
      lastFailureAt: "",
    },
  }
}

async function loadScannerDataCanonical(): Promise<ScannerData> {
  const [universe, scanPages] = await Promise.all([loadUniverse(), loadLatestScanPages()])
  return buildScannerData(universe, scanPages)
}

async function loadScannerTickerDataCanonical(ticker: string): Promise<ScannerData> {
  const normalized = ticker.trim().toUpperCase()
  const [universe, scanResult] = await Promise.all([
    loadUniverse(),
    queryDataSource(SCAN_DATA_SOURCE_ID, {
      pageSize: 1,
      filter: { property: "Ticker", rich_text: { equals: normalized } },
      sorts: [{ property: "Date", direction: "descending" }],
      errorContext: "Notion scanner query",
    }),
  ])
  return buildScannerData(universe, scanResult.results)
}

/** Operational scanner/promotion paths bypass the UI cache for canonical decisions. */
export async function getScannerDataFresh(): Promise<ScannerData> {
  return loadScannerDataCanonical()
}

/** UI-facing read path: regional Runtime Cache -> shared Redis -> canonical Notion. */
export async function getScannerData(): Promise<ScannerData> {
  if (!isNotionConfigured()) return loadScannerDataCanonical()
  return readThroughUiCache({ ...SCANNER_CACHE, validate: isScannerData, load: loadScannerDataCanonical })
}

/** Ticker detail needs the universe for prev/next navigation, but only one scan row. */
export async function getScannerTickerData(ticker: string): Promise<ScannerData> {
  const normalized = ticker.trim().toUpperCase()
  if (!isNotionConfigured()) return loadScannerTickerDataCanonical(normalized)
  return readThroughUiCache({
    namespace: SCANNER_CACHE.namespace,
    key: `ticker:${normalized}`,
    tag: SCANNER_CACHE.tag,
    name: `QeoIndex Scanner ${normalized}`,
    ttlSeconds: SCANNER_CACHE.ttlSeconds,
    validate: isScannerData,
    useSharedRedis: false,
    load: () => loadScannerTickerDataCanonical(normalized),
  })
}

export async function invalidateScannerDataCache() {
  await invalidateUiCache(SCANNER_CACHE)
}

export async function writeDailyScan(
  ticker: string,
  rank: number,
  scanDate: string,
  result: WyckoffScanResult,
  provider: HistoricalProvider = "DNSE",
  status: DailyScanStatus = "Complete",
) {
  const t = result.technical
  const properties: NotionProperties = {
    Scan: titleProperty(`${ticker} — Daily Scan — ${scanDate}`),
    Ticker: richTextProperty(ticker),
    Date: { date: { start: scanDate } },
    Rank: numberProperty(rank),
    Price: numberProperty(t.price),
    "Change Pct": numberProperty(t.changePct),
    Volume: numberProperty(t.volume),
    RSI14: numberProperty(t.rsi14),
    MACD: numberProperty(t.macd),
    "MACD Signal": numberProperty(t.macdSignal),
    MA20: numberProperty(t.ma20),
    MA50: numberProperty(t.ma50),
    MA200: numberProperty(t.ma200),
    ATR14: numberProperty(t.atr14),
    "Rel Volume": numberProperty(t.relVolume),
    "Wyckoff State": richTextProperty(result.wyckoffState),
    Phase: richTextProperty(result.phase),
    "TA Bias": { select: { name: result.taBias } },
    "Bull Probability": numberProperty(result.bullProbability),
    "Base Probability": numberProperty(result.baseProbability),
    "Bear Probability": numberProperty(result.bearProbability),
    Support: richTextProperty(result.support),
    Resistance: richTextProperty(result.resistance),
    Confirmation: richTextProperty(result.confirmation),
    Invalidation: richTextProperty(result.invalidation),
    "What Changed": richTextProperty(result.whatChanged),
    Confidence: { select: { name: result.confidence } },
    Provider: { select: { name: provider } },
    Status: { select: { name: status } },
  }
  return createDataSourcePage(SCAN_DATA_SOURCE_ID, properties, {
    errorContext: "Notion scan write",
    timeoutMs: 10_000,
  })
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
