import "server-only"

import { createHash } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  isNotionConfigured,
  queryDataSource,
  retrieveBlockChildren,
  type NotionBlock,
  type NotionPage,
} from "@/lib/notion/client"
import {
  dateText,
  pageProperties,
  richText,
  selectText,
  titleText,
  urlText,
} from "@/lib/notion/properties"

export const AI_COUNCIL_RESEARCH_CONTEXT_VERSION = "notion-research-context-v1"

const STOCK_THESIS_DATA_SOURCE_ID =
  process.env.NOTION_STOCK_THESIS_DATA_SOURCE_ID ?? "fa161c1b-3f37-4ee2-8d75-0ca64a05ee90"
const RESEARCH_SOURCES_DATA_SOURCE_ID =
  process.env.NOTION_RESEARCH_SOURCES_DATA_SOURCE_ID ?? "f0e2b054-e37c-436b-b0b5-93e97f7f7eec"

const DEFAULT_PILOT_TICKERS = "MSN"
const TOTAL_RESEARCH_TOKEN_BUDGET = 13_000
const CHARS_PER_TOKEN_ESTIMATE = 3
const TOTAL_RESEARCH_CHAR_BUDGET = TOTAL_RESEARCH_TOKEN_BUDGET * CHARS_PER_TOKEN_ESTIMATE
const THESIS_CHAR_BUDGET = 12_000
const BROKER_COMBINED_CHAR_BUDGET = 9_000
const MAX_SOURCE_PAGES = 8
const MAX_BLOCKS_PER_PAGE = 320
const MAX_BLOCK_DEPTH = 2
const BLOCK_PAGE_SIZE = 100
const BLOCK_MAX_PAGES = 3
const BLOCK_TIMEOUT_MS = 6_000

const RELIABILITY_WEIGHT: Record<string, number> = {
  S: 5,
  A: 4,
  B: 3,
  C: 2,
  D: 1,
}

const SOURCE_TYPE_ORDER = [
  "BCTC",
  "IR",
  "AGM",
  "Corporate Action",
  "Broker",
  "Industry",
  "Other",
] as const

const SOURCE_TYPE_CAP: Record<string, number> = {
  BCTC: 1,
  IR: 1,
  AGM: 1,
  "Corporate Action": 1,
  Broker: 3,
  Industry: 1,
  Other: 0,
}

const SOURCE_TYPE_CHAR_BUDGET: Record<string, number> = {
  BCTC: 7_500,
  IR: 6_000,
  AGM: 5_000,
  "Corporate Action": 4_500,
  Broker: 3_500,
  Industry: 4_000,
  Other: 2_500,
}

export type CouncilResearchContextStatus = "ready" | "skipped" | "unavailable"
export type CouncilResearchContextMode =
  | "LIVE_CURRENT_NOTION"
  | "PILOT_DISABLED"
  | "NOTION_UNAVAILABLE"
  | "THESIS_NOT_FOUND"

export interface CouncilResearchThesis {
  pageId: string
  notionUrl: string
  lastEditedAt: string
  ticker: string
  company: string
  status: string
  taBias: string
  faBias: string
  marketRegime: string
  wyckoffState: string
  baseCase: string
  support: string
  resistance: string
  confirmation: string
  invalidation: string
  whatChanged: string
  confidence: string
  lastAnalysis: string
  lastFAUpdate: string
  driveFolder: string
  body: string
  bodyChars: number
  bodyTruncated: boolean
}

export interface CouncilResearchSource {
  pageId: string
  notionUrl: string
  lastEditedAt: string
  document: string
  driveUrl: string
  publisher: string
  reliability: string
  type: string
  period: string
  keyTopics: string
  publishedDate: string
  ingestedDate: string
  body: string
  bodyChars: number
  bodyTruncated: boolean
}

export interface CouncilResearchContext {
  contextVersion: typeof AI_COUNCIL_RESEARCH_CONTEXT_VERSION
  ticker: string
  asOfDate: string
  status: CouncilResearchContextStatus
  mode: CouncilResearchContextMode
  sourceHierarchy: "S>A>B>C>D"
  approximateTokenBudget: number
  approximateTokensUsed: number
  totalBodyChars: number
  truncated: boolean
  thesis: CouncilResearchThesis | null
  sources: CouncilResearchSource[]
  sourcePageIds: string[]
  sourceLastEditedAt: Record<string, string>
  limitations: string[]
}

export interface FrozenCouncilResearchContext {
  contextHash: string
  rawContextHash: string
  promptIdentityHash: string
  context: CouncilResearchContext
  reused: boolean
}

type PersistedResearchContextRow = {
  run_id: string
  ticker: string
  context_hash: string
  raw_context_hash: string
  prompt_identity_hash: string
  context_payload: unknown
}

type SourceMetadata = Omit<CouncilResearchSource, "body" | "bodyChars" | "bodyTruncated">

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : []
}

function richPlainText(value: unknown) {
  return asArray(value)
    .map((item) => {
      const plain = record(item).plain_text
      return typeof plain === "string" ? plain : ""
    })
    .join("")
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  )
}

function sha256(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex")
}

export function configuredCouncilResearchTickers() {
  return new Set(
    (process.env.AI_COUNCIL_RESEARCH_TICKERS || DEFAULT_PILOT_TICKERS)
      .split(",")
      .map((ticker) => ticker.trim().toUpperCase())
      .filter((ticker) => /^[A-Z0-9]{2,12}$/.test(ticker)),
  )
}

export function isCouncilResearchTickerEnabled(ticker: string) {
  return configuredCouncilResearchTickers().has(ticker.toUpperCase())
}

function sourceTypeRank(value: string) {
  const index = SOURCE_TYPE_ORDER.indexOf(value as (typeof SOURCE_TYPE_ORDER)[number])
  return index < 0 ? SOURCE_TYPE_ORDER.length : index
}

function timestamp(value: string) {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function selectCouncilResearchSources(sources: SourceMetadata[]) {
  const selected: SourceMetadata[] = []

  for (const type of SOURCE_TYPE_ORDER) {
    const cap = SOURCE_TYPE_CAP[type] ?? 0
    if (!cap) continue
    const candidates = sources
      .filter((source) => source.type === type)
      .sort((left, right) =>
        (RELIABILITY_WEIGHT[right.reliability] ?? 0) - (RELIABILITY_WEIGHT[left.reliability] ?? 0)
        || timestamp(right.publishedDate) - timestamp(left.publishedDate)
        || timestamp(right.lastEditedAt) - timestamp(left.lastEditedAt),
      )
    selected.push(...candidates.slice(0, cap))
  }

  return selected
    .sort((left, right) =>
      sourceTypeRank(left.type) - sourceTypeRank(right.type)
      || (RELIABILITY_WEIGHT[right.reliability] ?? 0) - (RELIABILITY_WEIGHT[left.reliability] ?? 0)
      || timestamp(right.publishedDate) - timestamp(left.publishedDate),
    )
    .slice(0, MAX_SOURCE_PAGES)
}

function blockOwnText(block: NotionBlock) {
  const payload = record(block[block.type])

  if (block.type === "table_row") {
    const cells = asArray(payload.cells)
      .map((cell) => richPlainText(cell).trim())
      .filter(Boolean)
    return cells.length ? cells.join(" | ") : ""
  }

  if (block.type === "child_page") {
    const title = payload.title
    return typeof title === "string" ? `## ${title}` : ""
  }

  if (block.type === "equation") {
    const expression = payload.expression
    return typeof expression === "string" ? expression : ""
  }

  const text = richPlainText(payload.rich_text).trim()
  if (!text) return block.type === "divider" ? "---" : ""

  if (block.type === "heading_1") return `# ${text}`
  if (block.type === "heading_2") return `## ${text}`
  if (block.type === "heading_3") return `### ${text}`
  if (block.type === "bulleted_list_item") return `- ${text}`
  if (block.type === "numbered_list_item") return `1. ${text}`
  if (block.type === "to_do") return `- ${Boolean(payload.checked) ? "[x]" : "[ ]"} ${text}`
  if (block.type === "quote") return `> ${text}`
  return text
}

async function readNotionPageBody(pageId: string, maxChars: number) {
  const lines: string[] = []
  let bodyChars = 0
  let blocksRead = 0
  let truncated = false
  let stopped = false

  const append = (line: string) => {
    const normalized = line.trim()
    if (!normalized || stopped) return
    const separator = lines.length ? 1 : 0
    const remaining = maxChars - bodyChars - separator
    if (remaining <= 0) {
      truncated = true
      stopped = true
      return
    }
    if (separator) bodyChars += 1
    if (normalized.length > remaining) {
      lines.push(normalized.slice(0, remaining))
      bodyChars += remaining
      truncated = true
      stopped = true
      return
    }
    lines.push(normalized)
    bodyChars += normalized.length
  }

  const walk = async (parentId: string, depth: number): Promise<void> => {
    if (stopped || blocksRead >= MAX_BLOCKS_PER_PAGE) {
      if (blocksRead >= MAX_BLOCKS_PER_PAGE) truncated = true
      return
    }

    let cursor: string | undefined
    for (let page = 0; page < BLOCK_MAX_PAGES; page += 1) {
      if (stopped) break
      const result = await retrieveBlockChildren(parentId, {
        pageSize: BLOCK_PAGE_SIZE,
        startCursor: cursor,
        maxPages: 1,
        timeoutMs: BLOCK_TIMEOUT_MS,
        errorContext: `Notion research block read ${pageId}`,
      })

      for (const block of result.results) {
        if (stopped || blocksRead >= MAX_BLOCKS_PER_PAGE) {
          truncated = true
          stopped = true
          break
        }
        blocksRead += 1
        append(blockOwnText(block))
        if (block.has_children && depth < MAX_BLOCK_DEPTH && !stopped) {
          await walk(block.id, depth + 1)
        }
      }

      if (!result.hasMore || !result.nextCursor) break
      cursor = result.nextCursor
    }
  }

  await walk(pageId, 0)
  return {
    body: lines.join("\n"),
    bodyChars,
    bodyTruncated: truncated,
  }
}

function parseThesisMetadata(page: NotionPage) {
  const properties = pageProperties(page)
  return {
    pageId: page.id,
    notionUrl: page.url || "",
    lastEditedAt: page.last_edited_time || "",
    ticker: titleText(properties.Ticker).trim().toUpperCase(),
    company: richText(properties.Company),
    status: selectText(properties.Status),
    taBias: selectText(properties["TA Bias"]),
    faBias: selectText(properties["FA Bias"]),
    marketRegime: selectText(properties["Market Regime"]),
    wyckoffState: richText(properties["Wyckoff State"]),
    baseCase: richText(properties["Base Case"]),
    support: richText(properties.Support),
    resistance: richText(properties.Resistance),
    confirmation: richText(properties.Confirmation),
    invalidation: richText(properties.Invalidation),
    whatChanged: richText(properties["What Changed"]),
    confidence: selectText(properties.Confidence),
    lastAnalysis: dateText(properties["Last Analysis"]),
    lastFAUpdate: dateText(properties["Last FA Update"]),
    driveFolder: urlText(properties["Drive Folder"]),
  }
}

function parseSourceMetadata(page: NotionPage): SourceMetadata {
  const properties = pageProperties(page)
  return {
    pageId: page.id,
    notionUrl: page.url || "",
    lastEditedAt: page.last_edited_time || "",
    document: titleText(properties.Document),
    driveUrl: urlText(properties["Drive URL"]),
    publisher: richText(properties.Publisher),
    reliability: selectText(properties.Reliability),
    type: selectText(properties.Type),
    period: richText(properties.Period),
    keyTopics: richText(properties["Key Topics"]),
    publishedDate: dateText(properties["Published Date"]),
    ingestedDate: dateText(properties.Ingested),
  }
}

function baseContext(
  ticker: string,
  asOfDate: string,
  status: CouncilResearchContextStatus,
  mode: CouncilResearchContextMode,
  limitations: string[],
): CouncilResearchContext {
  return {
    contextVersion: AI_COUNCIL_RESEARCH_CONTEXT_VERSION,
    ticker,
    asOfDate,
    status,
    mode,
    sourceHierarchy: "S>A>B>C>D",
    approximateTokenBudget: TOTAL_RESEARCH_TOKEN_BUDGET,
    approximateTokensUsed: 0,
    totalBodyChars: 0,
    truncated: false,
    thesis: null,
    sources: [],
    sourcePageIds: [],
    sourceLastEditedAt: {},
    limitations,
  }
}

async function buildCouncilResearchContext(ticker: string, asOfDate: string): Promise<CouncilResearchContext> {
  const normalizedTicker = ticker.trim().toUpperCase()

  if (!isCouncilResearchTickerEnabled(normalizedTicker)) {
    return baseContext(normalizedTicker, asOfDate, "skipped", "PILOT_DISABLED", [
      `Notion research hydration is pilot-gated to ${[...configuredCouncilResearchTickers()].join(", ") || "no tickers"}.`,
      "The deterministic Council and raw TTAI/Wyckoff evidence remain available.",
    ])
  }

  if (!isNotionConfigured()) {
    return baseContext(normalizedTicker, asOfDate, "unavailable", "NOTION_UNAVAILABLE", [
      "Notion credentials are not configured in this runtime.",
      "The deterministic Council and raw TTAI/Wyckoff evidence remain available.",
    ])
  }

  try {
    const thesisResult = await queryDataSource(STOCK_THESIS_DATA_SOURCE_ID, {
      filter: { property: "Ticker", title: { equals: normalizedTicker } },
      pageSize: 1,
      maxPages: 1,
      timeoutMs: 8_000,
      errorContext: `AI Council Stock Thesis ${normalizedTicker}`,
    })
    const thesisPage = thesisResult.results[0]
    if (!thesisPage) {
      return baseContext(normalizedTicker, asOfDate, "unavailable", "THESIS_NOT_FOUND", [
        `No canonical Stock Thesis exists for ${normalizedTicker}.`,
        "The deterministic Council and raw TTAI/Wyckoff evidence remain available.",
      ])
    }

    const thesisMeta = parseThesisMetadata(thesisPage)
    const thesisBody = await readNotionPageBody(
      thesisPage.id,
      Math.min(THESIS_CHAR_BUDGET, TOTAL_RESEARCH_CHAR_BUDGET),
    )
    const thesis: CouncilResearchThesis = { ...thesisMeta, ...thesisBody }

    const sourcesResult = await queryDataSource(RESEARCH_SOURCES_DATA_SOURCE_ID, {
      filter: {
        and: [
          { property: "Ticker", relation: { contains: thesisPage.id } },
          { property: "Status", select: { equals: "Current" } },
          { property: "Published Date", date: { on_or_before: asOfDate } },
          { property: "Ingested", date: { on_or_before: asOfDate } },
        ],
      },
      sorts: [{ property: "Published Date", direction: "descending" }],
      pageSize: 25,
      maxPages: 1,
      timeoutMs: 8_000,
      errorContext: `AI Council Research Sources ${normalizedTicker}`,
    })

    const selectedSources = selectCouncilResearchSources(sourcesResult.results.map(parseSourceMetadata))
    let remainingChars = Math.max(0, TOTAL_RESEARCH_CHAR_BUDGET - thesis.bodyChars)
    let brokerRemainingChars = BROKER_COMBINED_CHAR_BUDGET
    const sources: CouncilResearchSource[] = []

    for (const source of selectedSources) {
      if (remainingChars <= 0) break
      const typeBudget = SOURCE_TYPE_CHAR_BUDGET[source.type] ?? SOURCE_TYPE_CHAR_BUDGET.Other
      const brokerBudget = source.type === "Broker"
        ? Math.min(typeBudget, brokerRemainingChars)
        : typeBudget
      const maxChars = Math.min(remainingChars, brokerBudget)
      if (maxChars <= 0) continue

      try {
        const body = await readNotionPageBody(source.pageId, maxChars)
        sources.push({ ...source, ...body })
        remainingChars -= body.bodyChars
        if (source.type === "Broker") brokerRemainingChars -= body.bodyChars
      } catch (error) {
        console.error(`[AI Council Research] source body read failed ${source.pageId}`, error)
        sources.push({ ...source, body: "", bodyChars: 0, bodyTruncated: false })
      }
    }

    const totalBodyChars = thesis.bodyChars + sources.reduce((sum, source) => sum + source.bodyChars, 0)
    const sourcePageIds = [thesis.pageId, ...sources.map((source) => source.pageId)]
    const sourceLastEditedAt = Object.fromEntries([
      [thesis.pageId, thesis.lastEditedAt],
      ...sources.map((source) => [source.pageId, source.lastEditedAt] as const),
    ])
    const truncated = thesis.bodyTruncated
      || sources.some((source) => source.bodyTruncated)
      || selectedSources.length > sources.length

    const limitations = [
      "Stock Thesis is mutable current Notion content; this exact live retrieval is frozen before the LLM debate so later thesis edits cannot rewrite the run.",
      "Only Research Sources with Status=Current, Published Date<=as-of date, and Ingested<=as-of date are eligible.",
      "Reliability hierarchy is S>A>B>C>D. Broker forecasts, recommendations and target prices are opinions, not verified company facts.",
      "Historical replay before the first frozen research snapshot cannot be reconstructed exactly from current mutable Notion content.",
      "Research text is bounded to an approximate 13k-token budget; OpenAI response usage remains the source of truth for actual token counts.",
    ]
    if (!sources.length) limitations.push("No eligible Research Sources were found; the Council receives Stock Thesis context only.")

    return {
      contextVersion: AI_COUNCIL_RESEARCH_CONTEXT_VERSION,
      ticker: normalizedTicker,
      asOfDate,
      status: "ready",
      mode: "LIVE_CURRENT_NOTION",
      sourceHierarchy: "S>A>B>C>D",
      approximateTokenBudget: TOTAL_RESEARCH_TOKEN_BUDGET,
      approximateTokensUsed: Math.ceil(totalBodyChars / CHARS_PER_TOKEN_ESTIMATE),
      totalBodyChars,
      truncated,
      thesis,
      sources,
      sourcePageIds,
      sourceLastEditedAt,
      limitations,
    }
  } catch (error) {
    console.error(`[AI Council Research] Notion context load failed ${normalizedTicker}`, error)
    return baseContext(normalizedTicker, asOfDate, "unavailable", "NOTION_UNAVAILABLE", [
      "Notion research retrieval failed for this run; no stale or guessed research fallback was used.",
      "The deterministic Council and raw TTAI/Wyckoff evidence remain available.",
    ])
  }
}

async function loadPersistedResearchContext(supabase: SupabaseClient, runId: string) {
  const result = await supabase
    .from("ai_council_llm_research_contexts")
    .select("run_id,ticker,context_hash,raw_context_hash,prompt_identity_hash,context_payload")
    .eq("run_id", runId)
    .limit(1)

  if (result.error) throw new Error(`Load frozen Notion research context failed: ${result.error.message}`)
  return ((result.data || [])[0] || null) as PersistedResearchContextRow | null
}

export async function freezeCouncilResearchContext(
  supabase: SupabaseClient,
  params: {
    runId: string
    ticker: string
    asOfDate: string
    deterministicEvidenceHash: string
    rawContextHash: string
    promptVersion: string
  },
): Promise<FrozenCouncilResearchContext> {
  const existing = await loadPersistedResearchContext(supabase, params.runId)
  if (existing) {
    return {
      contextHash: existing.context_hash,
      rawContextHash: existing.raw_context_hash,
      promptIdentityHash: existing.prompt_identity_hash,
      context: existing.context_payload as CouncilResearchContext,
      reused: true,
    }
  }

  const context = await buildCouncilResearchContext(params.ticker, params.asOfDate)
  const contextHash = sha256(context)
  const promptIdentityHash = sha256({
    deterministicEvidenceHash: params.deterministicEvidenceHash,
    rawContextHash: params.rawContextHash,
    researchContextHash: contextHash,
    promptVersion: params.promptVersion,
  })

  const insert = await supabase
    .from("ai_council_llm_research_contexts")
    .upsert({
      run_id: params.runId,
      ticker: params.ticker,
      as_of_date: params.asOfDate,
      context_version: AI_COUNCIL_RESEARCH_CONTEXT_VERSION,
      context_hash: contextHash,
      raw_context_hash: params.rawContextHash,
      prompt_identity_hash: promptIdentityHash,
      mode: context.mode,
      status: context.status,
      context_payload: context,
      source_page_ids: context.sourcePageIds,
      source_last_edited: context.sourceLastEditedAt,
    }, { onConflict: "run_id", ignoreDuplicates: true })

  if (insert.error) throw new Error(`Freeze Notion research context failed: ${insert.error.message}`)

  const persisted = await loadPersistedResearchContext(supabase, params.runId)
  if (!persisted) throw new Error("Frozen Notion research context was not readable after persistence")

  return {
    contextHash: persisted.context_hash,
    rawContextHash: persisted.raw_context_hash,
    promptIdentityHash: persisted.prompt_identity_hash,
    context: persisted.context_payload as CouncilResearchContext,
    reused: false,
  }
}
