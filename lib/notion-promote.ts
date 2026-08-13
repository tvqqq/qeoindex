import type { PromotionDraft } from "@/lib/multi-timeframe"
import type { MarketRegime } from "@/lib/research-types"

const STOCK_THESIS_DATA_SOURCE_ID = process.env.NOTION_STOCK_THESIS_DATA_SOURCE_ID ?? "fa161c1b-3f37-4ee2-8d75-0ca64a05ee90"
const ANALYSIS_LOG_DATA_SOURCE_ID = process.env.NOTION_ANALYSIS_LOG_DATA_SOURCE_ID ?? "3642cc21-8280-44e2-bad6-93f9472ce793"
const NOTION_VERSION = "2026-03-11"

function token() {
  return process.env.NOTION_API_KEY ?? process.env.NOTION_TOKEN ?? ""
}

function richText(value: string) {
  return { rich_text: value ? [{ type: "text", text: { content: value.slice(0, 1900) } }] : [] }
}

function title(value: string) {
  return { title: [{ type: "text", text: { content: value.slice(0, 1900) } }] }
}

async function createPage(dataSourceId: string, properties: Record<string, unknown>) {
  const apiKey = token()
  if (!apiKey) throw new Error("NOTION_API_KEY is not configured")
  const response = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      parent: { type: "data_source_id", data_source_id: dataSourceId },
      properties,
    }),
    cache: "no-store",
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(`Notion page create failed (${response.status}): ${JSON.stringify(payload).slice(0, 360)}`)
  return payload
}

export async function promoteDraftToNotion(draft: PromotionDraft, marketRegime: MarketRegime | "" = "Neutral") {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())

  const thesis = await createPage(STOCK_THESIS_DATA_SOURCE_ID, {
    Ticker: title(draft.ticker),
    Company: richText(""),
    Status: { select: { name: "Watching" } },
    "TA Bias": { select: { name: draft.taBias } },
    "Wyckoff State": richText(draft.wyckoffState),
    "Market Regime": { select: { name: marketRegime || "Neutral" } },
    "Base Case": richText(draft.baseCase),
    "Bull Probability": { number: draft.bullProbability },
    "Base Probability": { number: draft.baseProbability },
    "Bear Probability": { number: draft.bearProbability },
    Support: richText(draft.support),
    Resistance: richText(draft.resistance),
    Confirmation: richText(draft.confirmation),
    Invalidation: richText(draft.invalidation),
    "What Changed": richText(draft.whatChanged),
    Confidence: { select: { name: draft.confidence } },
    "Last Analysis": { date: { start: date } },
  })

  const summary = `${draft.baseCase} Support ${draft.support}. Resistance ${draft.resistance}. Confirmation: ${draft.confirmation}`
  try {
    const log = await createPage(ANALYSIS_LOG_DATA_SOURCE_ID, {
      Analysis: title(`${draft.ticker} — MTF Promotion — ${date}`),
      Ticker: { relation: [{ id: thesis.id }] },
      Date: { date: { start: date } },
      Timeframes: { multi_select: draft.timeframes.map((name) => ({ name })) },
      Type: { multi_select: [{ name: "TA" }] },
      Summary: richText(summary),
      "Bull Probability": { number: draft.bullProbability },
      "Base Probability": { number: draft.baseProbability },
      "Bear Probability": { number: draft.bearProbability },
      Outcome: { select: { name: "Pending" } },
      "Actual Scenario": { select: { name: "Unresolved" } },
      "TA Bias": { select: { name: draft.taBias } },
    })
    return { thesis, log }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`PARTIAL_PROMOTION: Stock Thesis ${thesis.id} đã được tạo nhưng Analysis Log thất bại. Không tự rollback canonical record. ${reason}`)
  }
}
