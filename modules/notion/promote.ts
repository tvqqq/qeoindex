import type { PromotionDraft } from "@/modules/research/multi-timeframe"
import { createDataSourcePage } from "@/modules/notion/client"
import { richTextProperty, titleProperty } from "@/modules/notion/properties"
import type { MarketRegime } from "@/modules/research/types"

const STOCK_THESIS_DATA_SOURCE_ID = process.env.NOTION_STOCK_THESIS_DATA_SOURCE_ID ?? "fa161c1b-3f37-4ee2-8d75-0ca64a05ee90"
const ANALYSIS_LOG_DATA_SOURCE_ID = process.env.NOTION_ANALYSIS_LOG_DATA_SOURCE_ID ?? "3642cc21-8280-44e2-bad6-93f9472ce793"

export async function promoteDraftToNotion(draft: PromotionDraft, marketRegime: MarketRegime | "" = "Neutral") {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())

  const thesis = await createDataSourcePage(STOCK_THESIS_DATA_SOURCE_ID, {
    Ticker: titleProperty(draft.ticker),
    Company: richTextProperty(""),
    Status: { select: { name: "Watching" } },
    "TA Bias": { select: { name: draft.taBias } },
    "Wyckoff State": richTextProperty(draft.wyckoffState),
    "Market Regime": { select: { name: marketRegime || "Neutral" } },
    "Base Case": richTextProperty(draft.baseCase),
    "Bull Probability": { number: draft.bullProbability },
    "Base Probability": { number: draft.baseProbability },
    "Bear Probability": { number: draft.bearProbability },
    Support: richTextProperty(draft.support),
    Resistance: richTextProperty(draft.resistance),
    Confirmation: richTextProperty(draft.confirmation),
    Invalidation: richTextProperty(draft.invalidation),
    "What Changed": richTextProperty(draft.whatChanged),
    Confidence: { select: { name: draft.confidence } },
    "Last Analysis": { date: { start: date } },
  })

  const summary = `${draft.baseCase} Support ${draft.support}. Resistance ${draft.resistance}. Confirmation: ${draft.confirmation}`
  try {
    const log = await createDataSourcePage(ANALYSIS_LOG_DATA_SOURCE_ID, {
      Analysis: titleProperty(`${draft.ticker} — MTF Promotion — ${date}`),
      Ticker: { relation: [{ id: thesis.id }] },
      Date: { date: { start: date } },
      Timeframes: { multi_select: draft.timeframes.map((name) => ({ name })) },
      Type: { multi_select: [{ name: "TA" }] },
      Summary: richTextProperty(summary),
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
