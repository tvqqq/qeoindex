import type {
  ActualScenario,
  AnalysisLog,
  Bias,
  Confidence,
  MarketRegime,
  Outcome,
  PriceSnapshot,
  ProbabilitySet,
  ResearchData,
  Thesis,
} from "@/lib/research-types"

const STOCK_THESIS_DATA_SOURCE_ID =
  process.env.NOTION_STOCK_THESIS_DATA_SOURCE_ID ?? "fa161c1b-3f37-4ee2-8d75-0ca64a05ee90"
const ANALYSIS_LOG_DATA_SOURCE_ID =
  process.env.NOTION_ANALYSIS_LOG_DATA_SOURCE_ID ?? "3642cc21-8280-44e2-bad6-93f9472ce793"
const NOTION_VERSION = "2026-03-11"

const PRICE_SNAPSHOTS: Record<string, PriceSnapshot> = {
  VNINDEX: {
    value: 1792.88,
    changePct: 1.1,
    timestamp: "2026-08-12T04:38:00.000Z",
    source: "Finhay MCP snapshot",
  },
  MSN: {
    value: 67.4,
    changePct: 0.45,
    timestamp: "2026-08-12T04:30:12.000Z",
    source: "Finhay MCP snapshot",
  },
}

const SNAPSHOT_THESES: Thesis[] = [
  {
    id: "3ba21728-2550-8164-bc51-c4dc6d70a8c8",
    notionUrl: "https://app.notion.com/p/3ba2172825508164bc51c4dc6d70a8c8",
    ticker: "VNINDEX",
    company: "VN-Index",
    status: "Watching",
    taBias: "Mixed",
    faBias: "",
    wyckoffState:
      "Primary uptrend; reaccumulation/shakeout candidate. 4H recovery is testing local supply; SOS/Phase D not confirmed.",
    marketRegime: "Neutral",
    baseCase:
      "Recovery/consolidation remains dominant. Hold 1,775–1,756 and test 1,804–1,815; RISK-ON requires higher-timeframe breakout/hold, ideally followed by 1,858–1,868 confirmation.",
    probabilities: { bull: 35, base: 50, bear: 15 },
    support: "1,775; 1,756–1,748; 1,723–1,720; 1,706; structural 1,683–1,658",
    resistance: "1,794–1,804 immediate; 1,815; 1,858–1,868; 1,920–1,947",
    confirmation:
      "RISK-ON requires break → hold → test/follow-through above 1,815; stronger confirmation above 1,858–1,868.",
    invalidation:
      "Bullish recovery weakens on 4H acceptance below 1,756/1,748; stronger warning below 1,706; structural reaccumulation thesis invalidated by break of 1,683–1,658 with expanding supply.",
    whatChanged:
      "12/08 AM: 4H recovery re-accelerated to 1,792.88 and is testing 1,794–1,804 supply. Bull probability increased 30→35%, Bear reduced 20→15%, Base remains 50%. Current 4H bar is incomplete.",
    confidence: "MEDIUM",
    lastAnalysis: "2026-08-12T04:38:00.000Z",
    lastFAUpdate: "",
    updated: "2026-08-12T05:02:05.052Z",
    driveFolder: "",
    price: PRICE_SNAPSHOTS.VNINDEX,
  },
  {
    id: "3b921728-2550-8156-aa3c-db82ea0dc14a",
    notionUrl: "https://app.notion.com/p/3b92172825508156aa3cdb82ea0dc14a",
    ticker: "MSN",
    company: "Masan Group",
    status: "Watching",
    taBias: "Mixed",
    faBias: "Bullish",
    wyckoffState:
      "Weekly trading range ~61–80; 61–63 potential shakeout/Spring candidate chưa xác nhận; Daily/4H recovery attempt, cần Break→Hold→Test→Follow-through",
    marketRegime: "Neutral",
    baseCase:
      "Unchanged: 4H recovery/base-building inside Weekly range. 12/08 morning price 67.4 is pressing the descending 4H resistance but still lacks commitment above 68.5–69.5; stronger confirmation remains 72–73.",
    probabilities: { bull: 30, base: 45, bear: 25 },
    support: "66–66.5 tactical; 63–64 secondary; 61–62 Weekly structural range low",
    resistance:
      "67.8–68 micro trigger; 68.5–69.5 near-term confirmation; 71.5–73 intermediate supply; 76–80 major Weekly/Monthly supply",
    confirmation:
      "Micro trigger 67.8–68.0; canonical confirmation 68.5–69.5, then 71.5–73. Prefer Break → Hold → Test → Follow-through.",
    invalidation:
      "FA: giảm mạnh nếu MHT margin/giá APT đảo chiều, WCM LFL/expansion chậm, hoặc refinancing/CrownX xấu đi. TA: acceptance dưới 61–62 với supply expansion invalidates Spring/base thesis",
    whatChanged:
      "12/08 AM: 4H price improved to 67.4 and is pressing descending resistance/high-volume-node 67.4–68.0. RSI improved, MACD remains flat-positive. No structural confirmation; Bull/Base/Bear stay 30/45/25.",
    confidence: "MEDIUM",
    lastAnalysis: "2026-08-12",
    lastFAUpdate: "2026-08-11",
    updated: "2026-08-12T04:59:23.357Z",
    driveFolder: "https://drive.google.com/drive/folders/18z0ualJMt4FNmUwaeTf2wLDk4stpo9TY",
    price: PRICE_SNAPSHOTS.MSN,
  },
]

const SNAPSHOT_LOGS: AnalysisLog[] = [
  {
    id: "3ba21728-2550-8120-bfcf-dc326c23a16f",
    notionUrl: "https://app.notion.com/p/3ba2172825508120bfcfdc326c23a16f",
    ticker: "MSN",
    analysis: "MSN — 4H Update AM — 2026-08-12",
    date: "2026-08-12",
    timeframes: ["4H"],
    type: ["TA"],
    summary:
      "4H morning partial candle at 11:30: MSN 67.4, O/H/L 67.2/67.8/67.1, holding above MA50 4H ~66.7 and pressing descending resistance. RSI ~52.4; MACD positive but flat. Volume 876.2k is incomplete and not comparable to full 4H bars. No confirmation above 68.5–69.5; probabilities unchanged Bull 30 / Base 45 / Bear 25. Micro trigger 67.8–68; tactical warning <66–66.5.",
    probabilities: { bull: 30, base: 45, bear: 25 },
    outcome: "Pending",
    actualScenario: "Unresolved",
    errorClass: "",
    lessonLearned: "",
    taBias: "Mixed",
    faBias: "Bullish",
    driveEvidence: "",
    sourceChat: "",
    updated: "2026-08-12T04:59:35.603Z",
  },
  {
    id: "3ba21728-2550-819c-a584-da2dc2cc00e2",
    notionUrl: "https://app.notion.com/p/3ba217282550819ca584da2dc2cc00e2",
    ticker: "VNINDEX",
    analysis: "VNINDEX 4H Update — 12/08/2026 AM",
    date: "2026-08-12T04:38:00.000Z",
    timeframes: ["4H"],
    type: ["TA"],
    summary:
      "4H price advanced to 1,792.88 (+1.10%), testing 1,794–1,804 supply. Prior Base case remains valid; no scenario invalidated. Bull probability modestly improved to 35%, Bear reduced to 15%, Base stays 50%. Current 4H candle is incomplete, so breakout/volume confirmation is pending.",
    probabilities: { bull: 35, base: 50, bear: 15 },
    outcome: "Pending",
    actualScenario: "Unresolved",
    errorClass: "",
    lessonLearned: "",
    taBias: "Bullish",
    faBias: "",
    driveEvidence: "",
    sourceChat: "",
    updated: "2026-08-12T04:41:06.120Z",
  },
  {
    id: "3ba21728-2550-819d-a755-fe4894d9eaec",
    notionUrl: "https://app.notion.com/p/3ba217282550819da755fe4894d9eaec",
    ticker: "VNINDEX",
    analysis: "VNINDEX Baseline #1 — 11/08/2026",
    date: "2026-08-11",
    timeframes: ["Monthly", "Weekly", "Daily", "4H"],
    type: ["TA"],
    summary:
      "NEUTRAL, bullish bias. Bull 30% / Base 50% / Bear 20%. Base case: consolidation/recovery around 1,745–1,815. RISK-ON gate 1,815 then 1,858–1,868. Structural bearish invalidation zone 1,683–1,658.",
    probabilities: { bull: 30, base: 50, bear: 20 },
    outcome: "Pending",
    actualScenario: "Unresolved",
    errorClass: "",
    lessonLearned: "",
    taBias: "Mixed",
    faBias: "",
    driveEvidence: "",
    sourceChat: "",
    updated: "2026-08-12T04:41:06.120Z",
  },
  {
    id: "3b921728-2550-8100-8c94-ffe33fe4ed1f",
    notionUrl: "https://app.notion.com/p/3b921728255081008c94ffe33fe4ed1f",
    ticker: "MSN",
    analysis: "MSN — TA Baseline T0 — 2026-08-11",
    date: "2026-08-11",
    timeframes: [],
    type: ["TA"],
    summary:
      "Weekly range ~61–80; 61–63 Spring/shakeout candidate chưa xác nhận. Base 45% = base-building/recovery inside range; Bull 30%; Bear 25%. Confirmation 69.5 then 72–73; structural invalidation acceptance <61–62.",
    probabilities: { bull: 30, base: 45, bear: 25 },
    outcome: "Pending",
    actualScenario: "Unresolved",
    errorClass: "",
    lessonLearned: "",
    taBias: "Mixed",
    faBias: "Bullish",
    driveEvidence: "",
    sourceChat: "",
    updated: "2026-08-11T12:43:53.394Z",
  },
  {
    id: "3b921728-2550-81da-9dea-d46f0fe506ac",
    notionUrl: "https://app.notion.com/p/3b921728255081da9dead46f0fe506ac",
    ticker: "MSN",
    analysis: "MSN — FA Ingest Q2/2026 — 2026-08-11",
    date: "2026-08-11",
    timeframes: [],
    type: ["FA", "Integrated"],
    summary:
      "FA upgraded from bootstrap Mixed to Bullish/medium confidence: Q2/6T earnings and margins improve broadly; WCM conversion strong, MHT drives step-change. Main offsets are working-capital inventory build, ~69tn debt, bond maturities/USD exposure and CrownX put obligation.",
    probabilities: { bull: 30, base: 45, bear: 25 },
    outcome: "Pending",
    actualScenario: "Unresolved",
    errorClass: "",
    lessonLearned: "",
    taBias: "Mixed",
    faBias: "Bullish",
    driveEvidence: "",
    sourceChat: "",
    updated: "2026-08-11T12:43:53.394Z",
  },
]

function getToken() {
  return process.env.NOTION_API_KEY ?? process.env.NOTION_TOKEN ?? ""
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
  const token = getToken()
  if (!token) throw new Error("NOTION_API_KEY is not configured")

  const results: any[] = []
  let startCursor: string | undefined

  do {
    const response = await fetch(
      `https://api.notion.com/v1/data_sources/${dataSourceId}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          page_size: 100,
          ...(startCursor ? { start_cursor: startCursor } : {}),
        }),
        cache: "no-store",
      },
    )

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Notion query failed (${response.status}): ${body.slice(0, 280)}`)
    }

    const payload = await response.json()
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
  return ["Bull", "Base", "Bear", "Unresolved"].includes(value)
    ? (value as ActualScenario)
    : ""
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
  const ticker = titleText(properties.Ticker)
  return {
    id: page.id,
    notionUrl: page.url ?? "",
    ticker,
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
    price: PRICE_SNAPSHOTS[ticker],
  }
}

function parseLog(page: any, tickerByPageId: Map<string, string>): AnalysisLog {
  const properties = page?.properties ?? {}
  const relation = relationIds(properties.Ticker)
  const ticker =
    relation.map((id) => tickerByPageId.get(normalizeId(id))).find(Boolean) ?? ""
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
  return [...rows].sort(
    (a, b) => new Date(b.updated || 0).getTime() - new Date(a.updated || 0).getTime(),
  )
}

export async function getResearchData(): Promise<ResearchData> {
  const token = getToken()
  if (!token) {
    return {
      source: "snapshot",
      generatedAt: "2026-08-12T05:02:05.052Z",
      connection: {
        notionConfigured: false,
        notionLive: false,
        message:
          "Snapshot fallback đang hoạt động. Thêm NOTION_API_KEY vào Vercel để đọc Stock Thesis và Analysis Log trực tiếp.",
      },
      theses: SNAPSHOT_THESES,
      logs: SNAPSHOT_LOGS,
    }
  }

  try {
    const [thesisPages, logPages] = await Promise.all([
      queryDataSource(STOCK_THESIS_DATA_SOURCE_ID),
      queryDataSource(ANALYSIS_LOG_DATA_SOURCE_ID),
    ])

    const theses = sortByUpdated(thesisPages.map(parseThesis))
    const tickerByPageId = new Map(
      theses.map((thesis) => [normalizeId(thesis.id), thesis.ticker] as const),
    )
    const logs = sortByUpdated(
      logPages.map((page) => parseLog(page, tickerByPageId)),
    )

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
    console.error("[StockOS Research] Notion fallback:", error)
    return {
      source: "snapshot",
      generatedAt: "2026-08-12T05:02:05.052Z",
      connection: {
        notionConfigured: true,
        notionLive: false,
        message:
          "Notion đã được cấu hình nhưng truy vấn hiện lỗi; StockOS đang dùng snapshot gần nhất để dashboard không bị gián đoạn.",
      },
      theses: SNAPSHOT_THESES,
      logs: SNAPSHOT_LOGS,
    }
  }
}
