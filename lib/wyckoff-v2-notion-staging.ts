import {
  WYCKOFF_V2_AGGREGATION_VERSION,
  WYCKOFF_V2_MODEL_VERSION,
  WYCKOFF_V2_PROMPT_VERSION,
  type WyckoffV2Snapshot,
} from "./wyckoff-v2-builder.ts"

const RICH_TEXT_CHUNK = 1900

function titleProperty(value: string) {
  return { title: [{ type: "text", text: { content: value.slice(0, RICH_TEXT_CHUNK) } }] }
}

function selectProperty(value: string | null) {
  return { select: value ? { name: value } : null }
}

function numberProperty(value: number | null | undefined) {
  return { number: typeof value === "number" && Number.isFinite(value) ? value : null }
}

function dateProperty(value: string | null | undefined) {
  return { date: value ? { start: value } : null }
}

function urlProperty(value: string | null | undefined) {
  return { url: value || null }
}

export function chunkedRichTextProperty(value: string | null | undefined) {
  if (!value) return { rich_text: [] }
  const chunks: Array<{ type: "text"; text: { content: string } }> = []
  for (let offset = 0; offset < value.length; offset += RICH_TEXT_CHUNK) {
    chunks.push({ type: "text", text: { content: value.slice(offset, offset + RICH_TEXT_CHUNK) } })
  }
  return { rich_text: chunks }
}

function jsonProperty(value: unknown) {
  return chunkedRichTextProperty(JSON.stringify(value))
}

export interface WyckoffV2RunPropertyInput {
  runKey: string
  scanDate: string
  status: "Writing" | "Ready" | "Ingesting" | "Ingested" | "Partial" | "Error"
  snapshotComplete: number
  snapshotIncomplete: number
  errorCount: number
  errorSummary: string
  startedAt: string
  completedAt?: string | null
  ingestedAt?: string | null
  providerSummary: string
  validationHash: string
  supabaseRunId?: string
}

export function buildWyckoffV2RunProperties(input: WyckoffV2RunPropertyInput) {
  return {
    Run: titleProperty(input.runKey),
    "Run Key": chunkedRichTextProperty(input.runKey),
    "Scan Date": dateProperty(input.scanDate),
    Status: selectProperty(input.status),
    "Universe Key": chunkedRichTextProperty("hose_top100"),
    "Universe Count": numberProperty(100),
    "Snapshot Expected": numberProperty(500),
    "Snapshot Complete": numberProperty(input.snapshotComplete),
    "Snapshot Incomplete": numberProperty(input.snapshotIncomplete),
    "Error Count": numberProperty(input.errorCount),
    "Error Summary": chunkedRichTextProperty(input.errorSummary),
    "Model Version": chunkedRichTextProperty(WYCKOFF_V2_MODEL_VERSION),
    "Aggregation Version": chunkedRichTextProperty(WYCKOFF_V2_AGGREGATION_VERSION),
    "Prompt Version": chunkedRichTextProperty(WYCKOFF_V2_PROMPT_VERSION),
    "Started At": dateProperty(input.startedAt),
    "Completed At": dateProperty(input.completedAt),
    "Ingested At": dateProperty(input.ingestedAt),
    "Provider Summary": chunkedRichTextProperty(input.providerSummary),
    "Validation Hash": chunkedRichTextProperty(input.validationHash),
    "Supabase Run ID": chunkedRichTextProperty(input.supabaseRunId ?? ""),
  }
}

export function buildWyckoffV2SnapshotProperties(row: WyckoffV2Snapshot) {
  return {
    Snapshot: titleProperty(row.snapshot),
    "Snapshot Key": chunkedRichTextProperty(row.snapshotKey),
    "Run Key": chunkedRichTextProperty(row.runKey),
    Ticker: chunkedRichTextProperty(row.ticker),
    Rank: numberProperty(row.rank),
    Exchange: selectProperty(row.exchange),
    Sector: chunkedRichTextProperty(row.sector),
    Timeframe: selectProperty(row.timeframe),
    "Bar Closed At": dateProperty(row.barClosedAt),
    "History Bar Count": numberProperty(row.historyBarCount),
    "History Status": selectProperty(row.historyStatus),
    Provider: chunkedRichTextProperty(row.provider),
    "Provider Detail": chunkedRichTextProperty(row.providerDetail),
    "Source URL": urlProperty(row.sourceUrl),
    "Fetched At": dateProperty(row.fetchedAt),
    "Model Version": chunkedRichTextProperty(row.modelVersion),
    "Aggregation Version": chunkedRichTextProperty(row.aggregationVersion),
    "Prompt Version": chunkedRichTextProperty(row.promptVersion),
    Phase: chunkedRichTextProperty(row.phase),
    "Wyckoff State": chunkedRichTextProperty(row.wyckoffState),
    "TA Bias": selectProperty(row.taBias),
    Confidence: selectProperty(row.confidence),
    "Bull Probability": numberProperty(row.bullProbability),
    "Base Probability": numberProperty(row.baseProbability),
    "Bear Probability": numberProperty(row.bearProbability),
    Support: chunkedRichTextProperty(row.support),
    Resistance: chunkedRichTextProperty(row.resistance),
    Confirmation: chunkedRichTextProperty(row.confirmation),
    Invalidation: chunkedRichTextProperty(row.invalidation),
    "What Changed": chunkedRichTextProperty(row.whatChanged),
    "Technical JSON": jsonProperty(row.technical),
    "Evidence JSON": jsonProperty(row.evidence),
    "Markers JSON": jsonProperty(row.markers),
    "Scenarios JSON": jsonProperty(row.scenarios),
    "Validation Status": selectProperty(row.validationStatus),
    "Validation Error": chunkedRichTextProperty(row.validationError),
  }
}
