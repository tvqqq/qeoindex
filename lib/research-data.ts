import {
  isNotionConfigured,
  queryDataSource,
  type NotionPage,
  type NotionProperties,
} from "@/lib/notion/client"
import {
  dateText,
  multiSelectNames,
  normalizeNotionId,
  numberValue,
  pageProperties,
  relationIds,
  richText,
  selectText,
  titleText,
  urlText,
} from "@/lib/notion/properties"
import type {
  ActualScenario,
  AnalysisLog,
  Bias,
  Confidence,
  MarketRegime,
  Outcome,
  ProbabilitySet,
  ResearchData,
  Thesis,
} from "@/lib/research-types"
import { invalidateUiCache, readThroughUiCache } from "@/lib/ui-data-cache"

const STOCK_THESIS_DATA_SOURCE_ID = process.env.NOTION_STOCK_THESIS_DATA_SOURCE_ID ?? "fa161c1b-3f37-4ee2-8d75-0ca64a05ee90"
const ANALYSIS_LOG_DATA_SOURCE_ID = process.env.NOTION_ANALYSIS_LOG_DATA_SOURCE_ID ?? "3642cc21-8280-44e2-bad6-93f9472ce793"
const RESEARCH_CACHE = {
  namespace: "research-read-model-v2",
  tag: "qeoindex-research-read-model-v2",
  ttlSeconds: 60,
} as const
const LOG_SORTS = [{ property: "Date", direction: "descending" }] as const
const PENDING_FILTER = {
  or: [
    { property: "Actual Scenario", select: { equals: "Unresolved" } },
    { property: "Actual Scenario", select: { is_empty: true } },
  ],
} as const

function asBias(value: string): Bias {
  return ["Bullish", "Neutral", "Bearish", "Mixed"].includes(value) ? (value as Bias) : ""
}
function asRegime(value: string): MarketRegime {
  return ["Risk-On", "Neutral", "Risk-Off"].includes(value) ? (value as MarketRegime) : ""
}
function asConfidence(value: string): Confidence {
  return ["HIGH", "MEDIUM", "LOW"].includes(value) ? (value as Confidence) : ""
}
function asOutcome(value: string): Outcome {
  return ["Pending", "Confirmed", "Invalidated", "Mixed"].includes(value) ? (value as Outcome) : ""
}
function asActualScenario(value: string): ActualScenario {
  return ["Bull", "Base", "Bear", "Unresolved"].includes(value) ? (value as ActualScenario) : ""
}
function probabilities(properties: NotionProperties): ProbabilitySet {
  return {
    bull: numberValue(properties["Bull Probability"]),
    base: numberValue(properties["Base Probability"]),
    bear: numberValue(properties["Bear Probability"]),
  }
}

function parseThesis(page: NotionPage): Thesis {
  const properties = pageProperties(page)
  return {
    id: page.id,
    notionUrl: page.url ?? "",
    ticker: titleText(properties.Ticker).trim().toUpperCase(),
    company: richText(properties.Company),
    status: selectText(properties.Status),
    taBias: asBias(selectText(properties["TA Bias"])),
    faBias: asBias(selectText(properties["FA Bias"])),
    wyckoffState: richText(properties["Wyckoff State"]),
    marketRegime: asRegime(selectText(properties["Market Regime"])),
    baseCase: richText(properties["Base Case"]),
    probabilities: probabilities(properties),
    support: richText(properties.Support),
    resistance: richText(properties.Resistance),
    confirmation: richText(properties.Confirmation),
    invalidation: richText(properties.Invalidation),
    whatChanged: richText(properties["What Changed"]),
    confidence: asConfidence(selectText(properties.Confidence)),
    lastAnalysis: dateText(properties["Last Analysis"]),
    lastFAUpdate: dateText(properties["Last FA Update"]),
    updated: page.last_edited_time ?? "",
    driveFolder: urlText(properties["Drive Folder"]),
  }
}

function parseLog(page: NotionPage, tickerByPageId: Map<string, string>): AnalysisLog {
  const properties = pageProperties(page)
  const ticker = relationIds(properties.Ticker)
    .map((id) => tickerByPageId.get(normalizeNotionId(id)))
    .find(Boolean) ?? ""
  return {
    id: page.id,
    notionUrl: page.url ?? "",
    ticker,
    analysis: titleText(properties.Analysis),
    date: dateText(properties.Date),
    timeframes: multiSelectNames(properties.Timeframes),
    type: multiSelectNames(properties.Type),
    summary: richText(properties.Summary),
    probabilities: probabilities(properties),
    outcome: asOutcome(selectText(properties.Outcome)),
    actualScenario: asActualScenario(selectText(properties["Actual Scenario"])),
    errorClass: selectText(properties["Error Class"]),
    lessonLearned: richText(properties["Lesson Learned"]),
    taBias: asBias(selectText(properties["TA Bias"])),
    faBias: asBias(selectText(properties["FA Bias"])),
    driveEvidence: urlText(properties["Drive Evidence"]),
    sourceChat: urlText(properties["Source Chat"]),
    updated: page.last_edited_time ?? "",
  }
}

function sortByUpdated<T extends { updated: string }>(rows: T[]) {
  return [...rows].sort((a, b) => new Date(b.updated || 0).getTime() - new Date(a.updated || 0).getTime())
}

function unavailable(configured: boolean, message: string): ResearchData {
  return {
    source: "notion",
    generatedAt: new Date().toISOString(),
    connection: { notionConfigured: configured, notionLive: false, message },
    theses: [],
    logs: [],
  }
}

function isLiveResearchData(value: unknown): value is ResearchData {
  if (!value || typeof value !== "object") return false
  const data = value as Partial<ResearchData>
  return data.source === "notion"
    && typeof data.generatedAt === "string"
    && Array.isArray(data.theses)
    && Array.isArray(data.logs)
    && data.connection?.notionLive === true
}

function connectionMessage(detail: string) {
  return `Canonical Notion Stock Thesis + Analysis Log; ${detail}; UI read model cache tối đa 60 giây.`
}

async function loadTheses() {
  const { results } = await queryDataSource(STOCK_THESIS_DATA_SOURCE_ID, { maxPages: 2 })
  return sortByUpdated(results.map(parseThesis).filter((row) => row.ticker))
}

function buildData(theses: Thesis[], logPages: NotionPage[], detail: string, extra: Partial<ResearchData> = {}): ResearchData {
  const tickerByPageId = new Map(theses.map((thesis) => [normalizeNotionId(thesis.id), thesis.ticker] as const))
  const logs = sortByUpdated(logPages.map((page) => parseLog(page, tickerByPageId)))
  return {
    source: "notion",
    generatedAt: new Date().toISOString(),
    connection: { notionConfigured: true, notionLive: true, message: connectionMessage(detail) },
    theses,
    logs,
    ...extra,
  }
}

async function countPendingReviews() {
  let count = 0
  let cursor: string | undefined
  for (let page = 0; page < 100; page += 1) {
    const result = await queryDataSource(ANALYSIS_LOG_DATA_SOURCE_ID, {
      filter: PENDING_FILTER as unknown as Record<string, unknown>,
      pageSize: 100,
      startCursor: cursor,
      maxPages: 1,
      filterProperties: ["Actual Scenario"],
    })
    count += result.results.length
    if (!result.hasMore || !result.nextCursor) break
    cursor = result.nextCursor
  }
  return count
}

async function loadBoundedResearchData(): Promise<ResearchData> {
  if (!isNotionConfigured()) return unavailable(false, "Notion chưa được cấu hình cho environment này. QeoIndex không dùng snapshot/backend dự phòng.")
  try {
    const [theses, logResult] = await Promise.all([
      loadTheses(),
      queryDataSource(ANALYSIS_LOG_DATA_SOURCE_ID, { sorts: LOG_SORTS, pageSize: 100, maxPages: 1 }),
    ])
    return buildData(theses, logResult.results, "projection mặc định giới hạn 100 Analysis Log mới nhất")
  } catch (error) {
    console.error("[QeoIndex Research] bounded Notion query failed", error)
    return unavailable(true, "Notion đã cấu hình nhưng truy vấn hiện lỗi. QeoIndex không hiển thị dữ liệu stale/fallback.")
  }
}

async function loadResearchDataCanonical(): Promise<ResearchData> {
  if (!isNotionConfigured()) return unavailable(false, "Notion chưa được cấu hình cho environment này. QeoIndex không dùng snapshot/backend dự phòng.")
  try {
    const [thesisResult, logResult] = await Promise.all([
      queryDataSource(STOCK_THESIS_DATA_SOURCE_ID, { maxPages: 100 }),
      queryDataSource(ANALYSIS_LOG_DATA_SOURCE_ID, { sorts: LOG_SORTS, maxPages: 100 }),
    ])
    const theses = sortByUpdated(thesisResult.results.map(parseThesis).filter((row) => row.ticker))
    return buildData(theses, logResult.results, "fresh canonical read cho operational/write path")
  } catch (error) {
    console.error("[QeoIndex Research] canonical Notion query failed", error)
    return unavailable(true, "Notion đã cấu hình nhưng truy vấn hiện lỗi. QeoIndex không hiển thị dữ liệu stale/fallback.")
  }
}

async function loadOverview(): Promise<ResearchData> {
  if (!isNotionConfigured()) return loadBoundedResearchData()
  try {
    const [theses, pendingReviews] = await Promise.all([loadTheses(), countPendingReviews()])
    return buildData(theses, [], "overview chỉ đọc thesis + pending-review count", { stats: { pendingReviews } })
  } catch (error) {
    console.error("[QeoIndex Research] overview query failed", error)
    return unavailable(true, "Notion đã cấu hình nhưng truy vấn overview hiện lỗi. QeoIndex không hiển thị dữ liệu stale/fallback.")
  }
}

async function loadChanges(): Promise<ResearchData> {
  if (!isNotionConfigured()) return loadBoundedResearchData()
  try {
    const theses = await loadTheses()
    const pages = (await Promise.all(theses.map(async (thesis) => {
      const result = await queryDataSource(ANALYSIS_LOG_DATA_SOURCE_ID, {
        filter: { property: "Ticker", relation: { contains: thesis.id } },
        sorts: LOG_SORTS,
        pageSize: 2,
        maxPages: 1,
      })
      return result.results
    }))).flat()
    return buildData(theses, pages, "changes chỉ đọc hai log mới nhất cho mỗi thesis")
  } catch (error) {
    console.error("[QeoIndex Research] changes query failed", error)
    return unavailable(true, "Notion đã cấu hình nhưng truy vấn changes hiện lỗi. QeoIndex không hiển thị dữ liệu stale/fallback.")
  }
}

async function loadLogPage(startCursor?: string): Promise<ResearchData> {
  if (!isNotionConfigured()) return loadBoundedResearchData()
  try {
    const [theses, logResult] = await Promise.all([
      loadTheses(),
      queryDataSource(ANALYSIS_LOG_DATA_SOURCE_ID, { sorts: LOG_SORTS, pageSize: 50, startCursor, maxPages: 1 }),
    ])
    return buildData(theses, logResult.results, "Analysis Log phân trang 50 bản ghi", {
      pagination: { hasMore: logResult.hasMore, nextCursor: logResult.nextCursor },
    })
  } catch (error) {
    console.error("[QeoIndex Research] log query failed", error)
    return unavailable(true, "Notion đã cấu hình nhưng truy vấn log hiện lỗi. QeoIndex không hiển thị dữ liệu stale/fallback.")
  }
}

async function loadReview(): Promise<ResearchData> {
  if (!isNotionConfigured()) return loadBoundedResearchData()
  try {
    const resolvedFilter = {
      and: [
        { property: "Actual Scenario", select: { is_not_empty: true } },
        { property: "Actual Scenario", select: { does_not_equal: "Unresolved" } },
      ],
    }
    const [theses, resolved, pendingReviews] = await Promise.all([
      loadTheses(),
      queryDataSource(ANALYSIS_LOG_DATA_SOURCE_ID, { filter: resolvedFilter, sorts: LOG_SORTS, pageSize: 100, maxPages: 3 }),
      countPendingReviews(),
    ])
    return buildData(theses, resolved.results, "review chỉ đọc case đã có Actual Scenario", { stats: { pendingReviews } })
  } catch (error) {
    console.error("[QeoIndex Research] review query failed", error)
    return unavailable(true, "Notion đã cấu hình nhưng truy vấn review hiện lỗi. QeoIndex không hiển thị dữ liệu stale/fallback.")
  }
}

async function loadTicker(ticker: string): Promise<ResearchData> {
  if (!isNotionConfigured()) return loadBoundedResearchData()
  try {
    const theses = await loadTheses()
    const thesis = theses.find((row) => row.ticker === ticker.toUpperCase())
    if (!thesis) return buildData(theses, [], `ticker ${ticker.toUpperCase()} chưa có canonical thesis`)
    const logs = await queryDataSource(ANALYSIS_LOG_DATA_SOURCE_ID, {
      filter: { property: "Ticker", relation: { contains: thesis.id } },
      sorts: LOG_SORTS,
      pageSize: 100,
      maxPages: 1,
    })
    return buildData(theses, logs.results, `ticker ${ticker.toUpperCase()} chỉ đọc log của chính mã`)
  } catch (error) {
    console.error("[QeoIndex Research] ticker query failed", error)
    return unavailable(true, "Notion đã cấu hình nhưng truy vấn ticker hiện lỗi. QeoIndex không hiển thị dữ liệu stale/fallback.")
  }
}

function cacheConfig(key: string, name: string, useSharedRedis = true) {
  return {
    ...RESEARCH_CACHE,
    key,
    name,
    useSharedRedis,
    validate: isLiveResearchData,
    shouldCache: (value: ResearchData) => value.connection.notionLive,
  }
}

/** Operational/write paths use this to make canonical decisions without UI-cache staleness. */
export async function getResearchDataFresh(): Promise<ResearchData> {
  return loadResearchDataCanonical()
}

/** Backward-compatible bounded UI projection; never scans an unbounded log history. */
export async function getResearchData(): Promise<ResearchData> {
  if (!isNotionConfigured()) return loadBoundedResearchData()
  return readThroughUiCache({ ...cacheConfig("bounded", "QeoIndex Research bounded projection"), load: loadBoundedResearchData })
}

export async function getResearchOverviewData() {
  if (!isNotionConfigured()) return loadOverview()
  return readThroughUiCache({ ...cacheConfig("overview", "QeoIndex Research overview"), load: loadOverview })
}

export async function getResearchChangesData() {
  if (!isNotionConfigured()) return loadChanges()
  return readThroughUiCache({ ...cacheConfig("changes", "QeoIndex Research changes"), load: loadChanges })
}

export async function getResearchReviewData() {
  if (!isNotionConfigured()) return loadReview()
  return readThroughUiCache({ ...cacheConfig("review", "QeoIndex Research review"), load: loadReview })
}

export async function getResearchLogData(startCursor?: string) {
  if (!isNotionConfigured()) return loadLogPage(startCursor)
  const cursorKey = startCursor ? startCursor.slice(0, 48) : "first"
  return readThroughUiCache({
    ...cacheConfig(`log:${cursorKey}`, "QeoIndex Research log page", false),
    load: () => loadLogPage(startCursor),
  })
}

export async function getResearchTickerData(ticker: string) {
  const normalized = ticker.trim().toUpperCase()
  if (!isNotionConfigured()) return loadTicker(normalized)
  return readThroughUiCache({
    ...cacheConfig(`ticker:${normalized}`, `QeoIndex Research ${normalized}`, false),
    load: () => loadTicker(normalized),
  })
}

export async function invalidateResearchDataCache() {
  const fixed = [
    cacheConfig("bounded", "QeoIndex Research bounded projection"),
    cacheConfig("overview", "QeoIndex Research overview"),
    cacheConfig("changes", "QeoIndex Research changes"),
    cacheConfig("review", "QeoIndex Research review"),
  ]
  await Promise.all(fixed.map((entry) => invalidateUiCache(entry)))
}
