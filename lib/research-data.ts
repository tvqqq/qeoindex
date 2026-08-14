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

const STOCK_THESIS_DATA_SOURCE_ID = process.env.NOTION_STOCK_THESIS_DATA_SOURCE_ID ?? "fa161c1b-3f37-4ee2-8d75-0ca64a05ee90"
const ANALYSIS_LOG_DATA_SOURCE_ID = process.env.NOTION_ANALYSIS_LOG_DATA_SOURCE_ID ?? "3642cc21-8280-44e2-bad6-93f9472ce793"
const NOTION_VERSION = "2026-03-11"

function token() {
  return process.env.NOTION_API_KEY ?? process.env.NOTION_TOKEN ?? ""
}

function headers() {
  const apiKey = token()
  if (!apiKey) throw new Error("NOTION_API_KEY is not configured")
  return {
    Authorization: `Bearer ${apiKey}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  }
}

function normalizeId(value: string) {
  return value.replaceAll("-", "").toLowerCase()
}
function titleText(property: any): string {
  return (property?.title ?? []).map((item: any) => item?.plain_text ?? "").join("")
}
function richText(property: any): string {
  return (property?.rich_text ?? []).map((item: any) => item?.plain_text ?? "").join("")
}
function selectText(property: any): string {
  return property?.select?.name ?? ""
}
function urlText(property: any): string {
  return property?.url ?? ""
}
function dateText(property: any): string {
  return property?.date?.start ?? ""
}
function numberValue(property: any): number | null {
  return typeof property?.number === "number" ? property.number : null
}
function multiSelect(property: any): string[] {
  return (property?.multi_select ?? []).map((item: any) => item?.name).filter(Boolean)
}
function relationIds(property: any): string[] {
  return (property?.relation ?? []).map((item: any) => item?.id).filter(Boolean)
}

async function queryDataSource(dataSourceId: string) {
  const results: any[] = []
  let startCursor: string | undefined
  do {
    const response = await fetch(`https://api.notion.com/v1/data_sources/${dataSourceId}/query`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        page_size: 100,
        ...(startCursor ? { start_cursor: startCursor } : {}),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    })
    const payload = await response.json()
    if (!response.ok) {
      throw new Error(`Notion query failed (${response.status}): ${JSON.stringify(payload).slice(0, 280)}`)
    }
    results.push(...(payload.results ?? []))
    startCursor = payload.has_more ? payload.next_cursor : undefined
  } while (startCursor)
  return results
}

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
function probabilities(properties: Record<string, any>): ProbabilitySet {
  return {
    bull: numberValue(properties["Bull Probability"]),
    base: numberValue(properties["Base Probability"]),
    bear: numberValue(properties["Bear Probability"]),
  }
}

function parseThesis(page: any): Thesis {
  const properties = page?.properties ?? {}
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

function parseLog(page: any, tickerByPageId: Map<string, string>): AnalysisLog {
  const properties = page?.properties ?? {}
  const ticker = relationIds(properties.Ticker)
    .map((id) => tickerByPageId.get(normalizeId(id)))
    .find(Boolean) ?? ""
  return {
    id: page.id,
    notionUrl: page.url ?? "",
    ticker,
    analysis: titleText(properties.Analysis),
    date: dateText(properties.Date),
    timeframes: multiSelect(properties.Timeframes),
    type: multiSelect(properties.Type),
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

export async function getResearchData(): Promise<ResearchData> {
  if (!token()) {
    return unavailable(false, "Notion chưa được cấu hình cho environment này. StockOS không dùng snapshot/backend dự phòng.")
  }
  try {
    const [thesisPages, logPages] = await Promise.all([
      queryDataSource(STOCK_THESIS_DATA_SOURCE_ID),
      queryDataSource(ANALYSIS_LOG_DATA_SOURCE_ID),
    ])
    const theses = sortByUpdated(thesisPages.map(parseThesis).filter((row) => row.ticker))
    const tickerByPageId = new Map(theses.map((thesis) => [normalizeId(thesis.id), thesis.ticker] as const))
    const logs = sortByUpdated(logPages.map((page) => parseLog(page, tickerByPageId)))
    return {
      source: "notion",
      generatedAt: new Date().toISOString(),
      connection: {
        notionConfigured: true,
        notionLive: true,
        message: "Đang đọc trực tiếp từ canonical Notion Stock Thesis + Analysis Log.",
      },
      theses,
      logs,
    }
  } catch (error) {
    console.error("[StockOS Research] Notion query failed", error)
    return unavailable(true, "Notion đã cấu hình nhưng truy vấn hiện lỗi. StockOS không hiển thị dữ liệu stale/fallback.")
  }
}
