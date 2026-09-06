import type { ResearchReportTickerStance } from "@/modules/research-reports/types"

import type {
  CouncilHistoryKnowledgeProjectionInput,
  ResearchReportKnowledgeProjectionInput,
} from "./projections.ts"

type CanonicalRow = Record<string, unknown>

const HASH_64 = /^[0-9a-f]{64}$/
const REPORT_STANCES = new Set<ResearchReportTickerStance>(["positive", "negative", "neutral", "mixed"])
const OUTCOME_STATUSES = new Set(["pending", "partial", "matured", "unavailable"] as const)

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function nullableText(value: unknown) {
  const result = text(value)
  return result || null
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function integer(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isInteger(value) ? value : fallback
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null
}

function stringList(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.map(text).filter(Boolean)
}

function object(value: unknown): CanonicalRow | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as CanonicalRow
    : null
}

function timestamp(value: unknown) {
  const raw = text(value)
  if (!raw) return 0
  const parsed = new Date(raw).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

function latestFirst(left: CanonicalRow, right: CanonicalRow, primary: string, secondary: string) {
  const rightTime = timestamp(right[primary]) || timestamp(right[secondary])
  const leftTime = timestamp(left[primary]) || timestamp(left[secondary])
  return rightTime - leftTime || text(right.id).localeCompare(text(left.id))
}

function evidenceRefs(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const row = object(entry)
    if (!row) return []
    const page = integer(row.page, -1)
    const snippet = text(row.snippet)
    return page > 0 && snippet ? [{ page, snippet }] : []
  })
}

function stance(value: unknown): ResearchReportTickerStance | null {
  const candidate = text(value) as ResearchReportTickerStance
  return REPORT_STANCES.has(candidate) ? candidate : null
}

export function assembleResearchReportProjectionInputs(input: {
  reports: readonly CanonicalRow[]
  analyses: readonly CanonicalRow[]
  mentions: readonly CanonicalRow[]
  chunks: readonly CanonicalRow[]
}): ResearchReportKnowledgeProjectionInput[] {
  const reports = [...input.reports]
    .filter((row) => text(row.analysis_status).toLowerCase() === "ready" && HASH_64.test(text(row.content_hash)))
    .sort((left, right) => text(left.publish_date).localeCompare(text(right.publish_date)) || text(left.id).localeCompare(text(right.id)))

  const result: ResearchReportKnowledgeProjectionInput[] = []
  for (const report of reports) {
    const reportId = text(report.id)
    const contentHash = text(report.content_hash)
    if (!reportId) continue

    const analysis = input.analyses
      .filter((row) => text(row.report_id) === reportId && text(row.content_hash) === contentHash && text(row.chunk_version))
      .sort((left, right) => latestFirst(left, right, "processed_at", "created_at"))[0]
    if (!analysis) continue

    const analysisId = text(analysis.id)
    const chunkVersion = text(analysis.chunk_version)
    if (!analysisId || !chunkVersion) continue

    const mentions = input.mentions
      .filter((row) => text(row.analysis_id) === analysisId)
      .flatMap((row) => {
        const ticker = text(row.ticker).toUpperCase()
        const parsedStance = stance(row.stance)
        if (!ticker || !parsedStance) return []
        return [{
          ticker,
          stance: parsedStance,
          recommendationText: nullableText(row.recommendation_text),
          targetPrice: finiteNumber(row.target_price),
          targetCurrency: nullableText(row.target_currency),
          rationale: text(row.rationale),
          evidence: evidenceRefs(row.evidence),
        }]
      })
      .sort((left, right) => left.ticker.localeCompare(right.ticker))

    const citedPages = new Set(mentions.flatMap((mention) => mention.evidence.map((entry) => entry.page)))
    const chunks = input.chunks
      .filter((row) => (
        text(row.report_id) === reportId
        && text(row.content_hash) === contentHash
        && text(row.chunk_version) === chunkVersion
        && citedPages.has(integer(row.page_number, -1))
      ))
      .flatMap((row) => {
        const id = text(row.id)
        const pageNumber = integer(row.page_number, -1)
        const chunkIndex = integer(row.chunk_index, -1)
        const content = text(row.content)
        const chunkHash = text(row.chunk_hash)
        if (!id || pageNumber <= 0 || chunkIndex < 0 || !content || !HASH_64.test(chunkHash)) return []
        return [{ id, pageNumber, chunkIndex, content, chunkHash }]
      })
      .sort((left, right) => left.pageNumber - right.pageNumber || left.chunkIndex - right.chunkIndex || left.id.localeCompare(right.id))

    result.push({
      report: {
        id: reportId,
        title: text(report.title),
        sourceName: text(report.source_name),
        publishDate: text(report.publish_date),
        contentHash,
      },
      analysis: {
        id: analysisId,
        chunkVersion,
        executiveSummary: text(analysis.executive_summary),
        keyPoints: stringList(analysis.key_points),
        marketView: nullableText(analysis.market_view),
        sectorOutlook: nullableText(analysis.sector_outlook),
        catalysts: stringList(analysis.catalysts),
        risks: stringList(analysis.risks),
      },
      mentions,
      chunks,
    })
  }

  return result
}

function probabilitiesFromDecision(value: unknown) {
  const decision = object(value)
  const probabilities = object(decision?.probabilities)
  if (!probabilities) return null
  const bull = finiteNumber(probabilities.bull)
  const base = finiteNumber(probabilities.base)
  const bear = finiteNumber(probabilities.bear)
  if (bull === null || base === null || bear === null) return null
  return { bull, base, bear }
}

function outcomeStatus(value: unknown): CouncilHistoryKnowledgeProjectionInput["outcome"] extends infer T
  ? T extends { status: infer S } ? S | null : never
  : never {
  const candidate = text(value) as "pending" | "partial" | "matured" | "unavailable"
  return OUTCOME_STATUSES.has(candidate) ? candidate : null
}

function scenarioFromRun(run: CanonicalRow): CouncilHistoryKnowledgeProjectionInput["scenario"] {
  const bullCase = run.bull_case ?? null
  const bearCase = run.bear_case ?? null
  const probabilities = probabilitiesFromDecision(run.decision_payload)
  const confirmation = text(run.confirmation)
  const invalidation = text(run.invalidation)
  const rawChanges = run.what_changes_decision
  const whatChangesDecision = Array.isArray(rawChanges) ? stringList(rawChanges) : text(rawChanges)
  const hasScenario = bullCase != null || bearCase != null || probabilities !== null || confirmation || invalidation
    || (Array.isArray(whatChangesDecision) ? whatChangesDecision.length > 0 : Boolean(whatChangesDecision))
  return hasScenario ? { bullCase, bearCase, probabilities, confirmation, invalidation, whatChangesDecision } : null
}

export function assembleCouncilProjectionInputs(input: {
  runs: readonly CanonicalRow[]
  outcomes: readonly CanonicalRow[]
  debates?: readonly CanonicalRow[]
}): CouncilHistoryKnowledgeProjectionInput[] {
  const outcomeByRun = new Map<string, CanonicalRow>()
  for (const row of input.outcomes) {
    const runId = text(row.run_id)
    if (!runId) continue
    const existing = outcomeByRun.get(runId)
    if (!existing || latestFirst(existing, row, "last_refreshed_at", "evaluated_through_date") > 0) outcomeByRun.set(runId, row)
  }

  const debateByRun = new Map<string, CanonicalRow>()
  for (const row of input.debates ?? []) {
    const runId = text(row.run_id)
    if (!runId) continue
    const existing = debateByRun.get(runId)
    if (!existing || latestFirst(existing, row, "completed_at", "created_at") > 0) debateByRun.set(runId, row)
  }

  return [...input.runs]
    .sort((left, right) => text(left.as_of_date).localeCompare(text(right.as_of_date)) || text(left.id).localeCompare(text(right.id)))
    .flatMap((run) => {
      const id = text(run.id)
      const ticker = text(run.ticker).toUpperCase()
      const asOfDate = text(run.as_of_date)
      const signal = text(run.signal)
      const councilScore = finiteNumber(run.council_score)
      const confidence = finiteNumber(run.confidence)
      const consensus = finiteNumber(run.consensus)
      const riskStatus = text(run.risk_status)
      const policyVersion = text(run.policy_version)
      const evidenceHash = text(run.evidence_hash)
      const createdAt = text(run.created_at)
      if (!id || !ticker || !asOfDate || !signal || councilScore === null || confidence === null || consensus === null || !riskStatus || !policyVersion || !HASH_64.test(evidenceHash) || !createdAt) return []

      const outcomeRow = outcomeByRun.get(id)
      const status = outcomeStatus(outcomeRow?.outcome_status)
      const outcome: CouncilHistoryKnowledgeProjectionInput["outcome"] = outcomeRow && status ? {
        status,
        sessionsObserved: integer(outcomeRow.sessions_observed, 0),
        evaluatedThroughDate: nullableText(outcomeRow.evaluated_through_date),
        return1dPct: finiteNumber(outcomeRow.return_1d_pct),
        return5dPct: finiteNumber(outcomeRow.return_5d_pct),
        return20dPct: finiteNumber(outcomeRow.return_20d_pct),
        mfe20dPct: finiteNumber(outcomeRow.mfe_20d_pct),
        mae20dPct: finiteNumber(outcomeRow.mae_20d_pct),
        directionCorrect5d: booleanOrNull(outcomeRow.direction_correct_5d),
      } : null

      const debateRow = debateByRun.get(id)
      const debate: CouncilHistoryKnowledgeProjectionInput["debate"] = debateRow ? {
        status: text(debateRow.status),
        promptVersion: text(debateRow.prompt_version),
        error: nullableText(debateRow.error),
        completedAt: nullableText(debateRow.completed_at),
      } : null

      return [{
        id,
        ticker,
        asOfDate,
        signal,
        councilScore,
        confidence,
        consensus,
        riskStatus,
        price: finiteNumber(run.price),
        policyVersion,
        evidenceHash,
        createdAt,
        scenario: scenarioFromRun(run),
        outcome,
        debate,
      }]
    })
}
