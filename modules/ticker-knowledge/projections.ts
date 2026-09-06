import { createHash } from "node:crypto"

import type { Thesis } from "@/modules/research/types"
import type {
  ResearchReportEvidenceRef,
  ResearchReportTickerStance,
} from "@/modules/research-reports/types"

import {
  TICKER_KNOWLEDGE_PROJECTION_VERSION,
  createTickerKnowledgeItem,
  normalizeTicker,
  type TickerKnowledgeItem,
} from "./domain.ts"

export const RESEARCH_REPORT_KNOWLEDGE_PROJECTION_VERSION = "research-report-knowledge-v1" as const
export const COUNCIL_HISTORY_KNOWLEDGE_PROJECTION_VERSION = "council-history-knowledge-v1" as const
export const NOTION_THESIS_KNOWLEDGE_PROJECTION_VERSION = "notion-current-thesis-v1" as const

export interface ResearchReportKnowledgeProjectionInput {
  report: {
    id: string
    title: string
    sourceName: string
    publishDate: string
    contentHash: string
  }
  analysis: {
    id: string
    chunkVersion: string
    executiveSummary: string
    keyPoints: readonly string[]
    marketView: string | null
    sectorOutlook: string | null
    catalysts: readonly string[]
    risks: readonly string[]
  }
  mentions: readonly {
    ticker: string
    stance: ResearchReportTickerStance
    recommendationText: string | null
    targetPrice: number | null
    targetCurrency: string | null
    rationale: string
    evidence: readonly ResearchReportEvidenceRef[]
  }[]
  chunks: readonly {
    id: string
    pageNumber: number
    chunkIndex: number
    content: string
    chunkHash: string
  }[]
}

export interface CouncilHistoryKnowledgeProjectionInput {
  id: string
  ticker: string
  asOfDate: string
  signal: string
  councilScore: number
  confidence: number
  consensus: number
  riskStatus: string
  price: number | null
  policyVersion: string
  evidenceHash: string
  createdAt: string
  scenario?: {
    bullCase: unknown
    bearCase: unknown
    probabilities: { bull: number; base: number; bear: number } | null
    confirmation: string
    invalidation: string
    whatChangesDecision: readonly string[] | string
  } | null
  outcome: {
    status: "pending" | "partial" | "matured" | "unavailable"
    sessionsObserved: number
    evaluatedThroughDate: string | null
    return1dPct: number | null
    return5dPct: number | null
    return20dPct: number | null
    mfe20dPct: number | null
    mae20dPct: number | null
    directionCorrect5d: boolean | null
  } | null
  debate?: {
    status: string
    promptVersion: string
    error: string | null
    completedAt: string | null
  } | null
}

function cleanText(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? ""
}

function list(label: string, values: readonly string[]) {
  const cleaned = values.map(cleanText).filter(Boolean)
  return cleaned.length ? `${label}: ${cleaned.join("; ")}` : ""
}

function compactLines(values: readonly (string | null | undefined)[]) {
  return values.map(cleanText).filter(Boolean).join("\n")
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

function stableJson(value: unknown) {
  if (value == null) return ""
  try {
    return JSON.stringify(canonicalize(value))
  } catch {
    return ""
  }
}

function reportSourceVersion(input: ResearchReportKnowledgeProjectionInput) {
  return `${input.report.contentHash}:${input.analysis.id}:${input.analysis.chunkVersion}`
}

function reportProvenance(
  input: ResearchReportKnowledgeProjectionInput,
  extra: Partial<TickerKnowledgeItem["provenance"]> = {},
): TickerKnowledgeItem["provenance"] {
  return {
    sourceId: input.report.id,
    sourceVersion: reportSourceVersion(input),
    contentHash: input.report.contentHash,
    reportId: input.report.id,
    analysisId: input.analysis.id,
    chunkVersion: input.analysis.chunkVersion,
    publishedAt: input.report.publishDate,
    asOf: input.report.publishDate,
    ...extra,
  }
}

function formatTarget(targetPrice: number | null, currency: string | null) {
  if (targetPrice === null || !Number.isFinite(targetPrice)) return ""
  return `${targetPrice}${cleanText(currency) ? ` ${cleanText(currency)}` : ""}`
}

export function projectResearchReportKnowledge(input: ResearchReportKnowledgeProjectionInput): TickerKnowledgeItem[] {
  if (!/^[0-9a-f]{64}$/.test(input.report.contentHash)) throw new Error("Research report projection requires a valid content hash")
  if (!cleanText(input.analysis.id) || !cleanText(input.analysis.chunkVersion)) throw new Error("Research report projection requires exact analysis and chunk versions")

  const items: TickerKnowledgeItem[] = []
  const seenTickers = new Set<string>()
  for (const mention of input.mentions) {
    const ticker = normalizeTicker(mention.ticker)
    if (seenTickers.has(ticker)) continue
    seenTickers.add(ticker)

    const summaryText = compactLines([
      `${input.report.sourceName} — ${input.report.title} (${input.report.publishDate})`,
      `Ticker: ${ticker}`,
      `Executive summary: ${input.analysis.executiveSummary}`,
      list("Key points", input.analysis.keyPoints),
      input.analysis.marketView ? `Market view: ${input.analysis.marketView}` : "",
      input.analysis.sectorOutlook ? `Sector outlook: ${input.analysis.sectorOutlook}` : "",
      list("Catalysts", input.analysis.catalysts),
      list("Risks", input.analysis.risks),
    ])
    if (summaryText) {
      items.push(createTickerKnowledgeItem({
        ticker,
        knowledgeType: "REPORT_SUMMARY",
        authority: "SOURCE_OPINION",
        sourceType: "RESEARCH_REPORT",
        logicalKey: `summary:${input.analysis.id}:${input.analysis.chunkVersion}`,
        text: summaryText,
        provenance: reportProvenance(input),
        projectionVersion: RESEARCH_REPORT_KNOWLEDGE_PROJECTION_VERSION,
      }))
    }

    const brokerText = compactLines([
      `${input.report.sourceName} view on ${ticker}`,
      `Stance: ${mention.stance}`,
      mention.recommendationText ? `Recommendation: ${mention.recommendationText}` : "",
      formatTarget(mention.targetPrice, mention.targetCurrency) ? `Target price: ${formatTarget(mention.targetPrice, mention.targetCurrency)}` : "",
      mention.rationale ? `Rationale: ${mention.rationale}` : "",
      list("Cited evidence", mention.evidence.map((evidence) => `p.${evidence.page}: ${evidence.snippet}`)),
    ])
    if (brokerText) {
      items.push(createTickerKnowledgeItem({
        ticker,
        knowledgeType: "BROKER_VIEW",
        authority: "SOURCE_OPINION",
        sourceType: "RESEARCH_REPORT",
        logicalKey: `broker-view:${input.analysis.id}:${input.analysis.chunkVersion}:${ticker}`,
        text: brokerText,
        provenance: reportProvenance(input),
        projectionVersion: RESEARCH_REPORT_KNOWLEDGE_PROJECTION_VERSION,
      }))
    }

    const citedPages = new Set(mention.evidence.map((evidence) => evidence.page).filter((page) => Number.isInteger(page) && page > 0))
    const relevantChunks = input.chunks.filter((chunk) => citedPages.has(chunk.pageNumber))
    for (const chunk of relevantChunks) {
      const content = cleanText(chunk.content)
      if (!content) continue
      items.push(createTickerKnowledgeItem({
        ticker,
        knowledgeType: "REPORT_CHUNK",
        authority: "SOURCE_OPINION",
        sourceType: "RESEARCH_REPORT",
        logicalKey: `chunk:${input.report.contentHash}:${input.analysis.chunkVersion}:${chunk.id}:${chunk.chunkHash}`,
        text: content,
        provenance: reportProvenance(input, {
          page: chunk.pageNumber,
          chunkId: chunk.id,
          chunkIndex: chunk.chunkIndex,
        }),
        projectionVersion: RESEARCH_REPORT_KNOWLEDGE_PROJECTION_VERSION,
      }))
    }
  }
  return items
}

function numberText(value: number | null) {
  return value === null || !Number.isFinite(value) ? "n/a" : String(value)
}

function scenarioText(scenario: NonNullable<CouncilHistoryKnowledgeProjectionInput["scenario"]>) {
  const probabilities = scenario.probabilities
  const changes = Array.isArray(scenario.whatChangesDecision)
    ? scenario.whatChangesDecision
    : [scenario.whatChangesDecision]
  return compactLines([
    "Deterministic Council scenario set",
    stableJson(scenario.bullCase) ? `Bull case: ${stableJson(scenario.bullCase)}` : "",
    stableJson(scenario.bearCase) ? `Bear case: ${stableJson(scenario.bearCase)}` : "",
    probabilities ? `Probabilities — Bull: ${probabilities.bull}; Base: ${probabilities.base}; Bear: ${probabilities.bear}` : "",
    scenario.confirmation ? `Confirmation: ${scenario.confirmation}` : "",
    scenario.invalidation ? `Invalidation: ${scenario.invalidation}` : "",
    list("What changes decision", changes),
  ])
}

export function projectCouncilHistoryKnowledge(input: CouncilHistoryKnowledgeProjectionInput): TickerKnowledgeItem[] {
  const ticker = normalizeTicker(input.ticker)
  const sourceVersion = `${input.policyVersion}:${input.evidenceHash}`
  const baseProvenance = {
    sourceId: input.id,
    sourceVersion,
    runId: input.id,
    contentHash: input.evidenceHash,
    publishedAt: input.createdAt,
    asOf: input.asOfDate,
  }
  const items: TickerKnowledgeItem[] = [createTickerKnowledgeItem({
    ticker,
    knowledgeType: "COUNCIL_MEMORY",
    authority: "DETERMINISTIC_SIGNAL",
    sourceType: "AI_COUNCIL",
    logicalKey: `decision:${input.id}:${sourceVersion}`,
    text: compactLines([
      `AI Council ${input.asOfDate} — ${ticker}`,
      `Signal: ${input.signal}`,
      `Council score: ${input.councilScore}`,
      `Confidence: ${input.confidence}`,
      `Consensus: ${input.consensus}`,
      `Risk status: ${input.riskStatus}`,
      `Start price: ${numberText(input.price)}`,
      `Policy: ${input.policyVersion}`,
    ]),
    provenance: baseProvenance,
    projectionVersion: COUNCIL_HISTORY_KNOWLEDGE_PROJECTION_VERSION,
  })]

  if (input.scenario) {
    const text = scenarioText(input.scenario)
    if (text) {
      items.push(createTickerKnowledgeItem({
        ticker,
        knowledgeType: "COUNCIL_SCENARIO",
        authority: "DETERMINISTIC_SIGNAL",
        sourceType: "AI_COUNCIL",
        logicalKey: `scenario:${input.id}:${sourceVersion}`,
        text,
        provenance: baseProvenance,
        projectionVersion: COUNCIL_HISTORY_KNOWLEDGE_PROJECTION_VERSION,
      }))
    }
  }

  if (input.outcome && input.outcome.status !== "pending") {
    const outcome = input.outcome
    items.push(createTickerKnowledgeItem({
      ticker,
      knowledgeType: "COUNCIL_OUTCOME",
      authority: "VERIFIED_FACT",
      sourceType: "AI_COUNCIL",
      logicalKey: `outcome:${input.id}:${outcome.status}:${outcome.evaluatedThroughDate ?? "pending"}`,
      text: compactLines([
        `Observed outcome for AI Council run ${input.id}`,
        `Status: ${outcome.status}; sessions observed: ${outcome.sessionsObserved}`,
        `Evaluated through: ${outcome.evaluatedThroughDate ?? "n/a"}`,
        `Return 1D: ${numberText(outcome.return1dPct)}%`,
        `Return 5D: ${numberText(outcome.return5dPct)}%`,
        `Return 20D: ${numberText(outcome.return20dPct)}%`,
        `MFE 20D: ${numberText(outcome.mfe20dPct)}%`,
        `MAE 20D: ${numberText(outcome.mae20dPct)}%`,
        `Direction correct 5D: ${outcome.directionCorrect5d === null ? "n/a" : String(outcome.directionCorrect5d)}`,
      ]),
      provenance: {
        ...baseProvenance,
        asOf: outcome.evaluatedThroughDate ?? input.asOfDate,
      },
      projectionVersion: COUNCIL_HISTORY_KNOWLEDGE_PROJECTION_VERSION,
    }))
  }

  const debateError = cleanText(input.debate?.error)
  if (input.debate && debateError) {
    const debateSourceVersion = `${sourceVersion}:prompt=${cleanText(input.debate.promptVersion) || "unknown"}:status=${cleanText(input.debate.status) || "unknown"}`
    items.push(createTickerKnowledgeItem({
      ticker,
      knowledgeType: "COUNCIL_ERROR",
      authority: "VERIFIED_FACT",
      sourceType: "AI_COUNCIL",
      logicalKey: `debate-error:${input.id}:${debateSourceVersion}`,
      text: compactLines([
        `Advisory LLM debate operational error for Council run ${input.id}`,
        `Status: ${input.debate.status || "unknown"}`,
        `Prompt version: ${input.debate.promptVersion || "unknown"}`,
        `Error: ${debateError.slice(0, 1000)}`,
      ]),
      provenance: {
        ...baseProvenance,
        sourceVersion: debateSourceVersion,
        publishedAt: input.debate.completedAt ?? input.createdAt,
        asOf: input.debate.completedAt ?? input.asOfDate,
      },
      projectionVersion: COUNCIL_HISTORY_KNOWLEDGE_PROJECTION_VERSION,
    }))
  }

  return items
}

function thesisSourceVersion(thesis: Thesis) {
  const canonical = JSON.stringify({
    ticker: normalizeTicker(thesis.ticker),
    status: thesis.status,
    taBias: thesis.taBias,
    faBias: thesis.faBias,
    wyckoffState: thesis.wyckoffState,
    marketRegime: thesis.marketRegime,
    baseCase: thesis.baseCase,
    probabilities: thesis.probabilities,
    support: thesis.support,
    resistance: thesis.resistance,
    confirmation: thesis.confirmation,
    invalidation: thesis.invalidation,
    whatChanged: thesis.whatChanged,
    confidence: thesis.confidence,
    lastAnalysis: thesis.lastAnalysis,
    lastFAUpdate: thesis.lastFAUpdate,
    updated: thesis.updated,
  })
  return createHash("sha256").update(canonical).digest("hex")
}

export function projectCurrentThesisKnowledge(thesis: Thesis): TickerKnowledgeItem {
  const ticker = normalizeTicker(thesis.ticker)
  const sourceVersion = thesisSourceVersion(thesis)
  return createTickerKnowledgeItem({
    ticker,
    knowledgeType: "CURRENT_THESIS",
    authority: "CANONICAL_THESIS",
    sourceType: "NOTION_THESIS",
    logicalKey: "current-thesis",
    text: compactLines([
      `Canonical Stock Thesis — ${ticker}${cleanText(thesis.company) ? ` (${cleanText(thesis.company)})` : ""}`,
      `Status: ${thesis.status || "unknown"}`,
      `TA bias: ${thesis.taBias || "unknown"}; FA bias: ${thesis.faBias || "unknown"}; market regime: ${thesis.marketRegime || "unknown"}`,
      thesis.wyckoffState ? `Wyckoff state: ${thesis.wyckoffState}` : "",
      thesis.baseCase ? `Base case: ${thesis.baseCase}` : "",
      `Probabilities — Bull: ${numberText(thesis.probabilities.bull)}; Base: ${numberText(thesis.probabilities.base)}; Bear: ${numberText(thesis.probabilities.bear)}`,
      thesis.support ? `Support: ${thesis.support}` : "",
      thesis.resistance ? `Resistance: ${thesis.resistance}` : "",
      thesis.confirmation ? `Confirmation: ${thesis.confirmation}` : "",
      thesis.invalidation ? `Invalidation: ${thesis.invalidation}` : "",
      thesis.whatChanged ? `What changed: ${thesis.whatChanged}` : "",
      `Confidence: ${thesis.confidence || "unknown"}`,
      thesis.lastAnalysis ? `Last analysis: ${thesis.lastAnalysis}` : "",
    ]),
    provenance: {
      sourceId: thesis.id,
      sourceVersion,
      publishedAt: thesis.updated || thesis.lastAnalysis || null,
      asOf: thesis.updated || thesis.lastAnalysis || null,
      storagePath: thesis.notionUrl || null,
    },
    projectionVersion: NOTION_THESIS_KNOWLEDGE_PROJECTION_VERSION,
  })
}

export const TICKER_KNOWLEDGE_PROJECTION_FAMILY_VERSION = TICKER_KNOWLEDGE_PROJECTION_VERSION