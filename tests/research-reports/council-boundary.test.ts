import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("QEO-86 exposes Council Research Report selection through the public research-reports boundary", () => {
  const index = source("modules/research-reports/index.ts")
  const adapter = source("modules/ai-council/report-evidence.ts")

  assert.match(index, /selectCouncilReportEvidence/)
  assert.match(index, /CouncilReportEvidenceItem/)
  assert.match(adapter, /from "\.\.\/research-reports\/index\.ts"/)
  assert.doesNotMatch(adapter, /research-reports\/council-evidence/)
})

test("QEO-86 AI Council boundary never invokes report provider, PDF ingestion, or raw chunks", () => {
  const adapter = source("modules/ai-council/report-evidence.ts")
  const preMarket = source("modules/ai-council/pre-market-evidence.ts")

  assert.doesNotMatch(adapter, /providers\/topi|pdf-processing|fetchPdf|market_research_report_chunks/)
  assert.doesNotMatch(preMarket, /providers\/topi|pdf-processing|fetchPdf|market_research_report_chunks/)
})

test("QEO-86 README documents immutable Council evidence and QEO-87 rollout ownership", () => {
  const readme = source("modules/research-reports/README.md")

  assert.match(readme, /QEO-86/)
  assert.match(readme, /point-in-time/i)
  assert.match(readme, /ready.*empty.*unavailable/i)
  assert.match(readme, /raw PDF chunks/i)
  assert.match(readme, /SOURCE OPINION/i)
  assert.match(readme, /historical.*snapshot/i)
  assert.match(readme, /prompt identity/i)
  assert.match(readme, /QEO-87/)
  assert.match(readme, /pending.*quarantined/i)
  assert.match(readme, /generated.*Database types/i)
  assert.doesNotMatch(readme, /AI Council report selection remain separate follow-up responsibilities/)
})

test("QEO-113 research report projection preserves exact analysis/chunk provenance and source-opinion authority", async () => {
  const { projectResearchReportKnowledge } = await import("../../modules/ticker-knowledge/projections.ts")
  const items = projectResearchReportKnowledge({
    report: {
      id: "report-1",
      title: "MSN outlook",
      sourceName: "HSBC",
      publishDate: "2026-09-01",
      contentHash: "a".repeat(64),
    },
    analysis: {
      id: "analysis-1",
      chunkVersion: "page-safe-v1",
      executiveSummary: "MSN earnings outlook improves.",
      keyPoints: ["Consumer growth accelerates."],
      marketView: null,
      sectorOutlook: null,
      catalysts: ["margin expansion"],
      risks: ["weaker demand"],
    },
    mentions: [{
      ticker: "MSN",
      stance: "positive",
      recommendationText: "BUY",
      targetPrice: 110000,
      targetCurrency: "VND",
      rationale: "Consumer earnings recovery",
      evidence: [{ page: 2, snippet: "Target price 110,000" }],
    }],
    chunks: [{
      id: "chunk-2-0",
      pageNumber: 2,
      chunkIndex: 0,
      content: "HSBC estimates MSN target price at 110,000 VND.",
      chunkHash: "b".repeat(64),
    }, {
      id: "chunk-3-0",
      pageNumber: 3,
      chunkIndex: 0,
      content: "Sector background unrelated to the cited ticker evidence.",
      chunkHash: "c".repeat(64),
    }],
  })

  assert.deepEqual(new Set(items.map((item) => item.knowledgeType)), new Set(["REPORT_SUMMARY", "BROKER_VIEW", "REPORT_CHUNK"]))
  assert.equal(items.filter((item) => item.knowledgeType === "REPORT_CHUNK").length, 1)
  assert.ok(items.every((item) => item.ticker === "MSN"))
  assert.ok(items.every((item) => item.authority === "SOURCE_OPINION"))
  assert.ok(items.every((item) => item.provenance.reportId === "report-1"))
  assert.ok(items.every((item) => item.provenance.analysisId === "analysis-1"))
  assert.ok(items.every((item) => item.provenance.contentHash === "a".repeat(64)))
  const chunk = items.find((item) => item.knowledgeType === "REPORT_CHUNK")
  assert.equal(chunk?.provenance.page, 2)
  assert.equal(chunk?.provenance.chunkId, "chunk-2-0")
})

test("QEO-113 Council projection separates deterministic decision memory from observed outcome", async () => {
  const { projectCouncilHistoryKnowledge } = await import("../../modules/ticker-knowledge/projections.ts")
  const items = projectCouncilHistoryKnowledge({
    id: "run-1",
    ticker: "MSN",
    asOfDate: "2026-09-01",
    signal: "BUY_ON_CONFIRMATION",
    councilScore: 72,
    confidence: 0.68,
    consensus: 0.74,
    riskStatus: "caution",
    price: 82.5,
    policyVersion: "council-v1",
    evidenceHash: "d".repeat(64),
    createdAt: "2026-09-01T08:00:00.000Z",
    outcome: {
      status: "matured",
      sessionsObserved: 20,
      evaluatedThroughDate: "2026-09-29",
      return1dPct: 1.2,
      return5dPct: 3.4,
      return20dPct: 8.1,
      mfe20dPct: 12,
      mae20dPct: -4,
      directionCorrect5d: true,
    },
  })

  const memory = items.find((item) => item.knowledgeType === "COUNCIL_MEMORY")
  const outcome = items.find((item) => item.knowledgeType === "COUNCIL_OUTCOME")
  assert.equal(memory?.authority, "DETERMINISTIC_SIGNAL")
  assert.equal(outcome?.authority, "VERIFIED_FACT")
  assert.equal(memory?.provenance.runId, "run-1")
  assert.equal(outcome?.provenance.runId, "run-1")
  assert.equal(items.some((item) => item.knowledgeType === "LESSON" || item.knowledgeType === "COUNCIL_ERROR"), false)
})

test("QEO-114 current thesis projection keeps a stable point identity while provenance version changes", async () => {
  const { projectCurrentThesisKnowledge } = await import("../../modules/ticker-knowledge/projections.ts")
  const base = {
    id: "notion-page-1",
    notionUrl: "https://notion.so/1",
    ticker: "MSN",
    company: "Masan Group",
    status: "Current",
    taBias: "Bullish" as const,
    faBias: "Bullish" as const,
    wyckoffState: "Reaccumulation candidate",
    marketRegime: "Neutral" as const,
    baseCase: "Hold range before breakout",
    probabilities: { bull: 35, base: 50, bear: 15 },
    support: "78-80",
    resistance: "86-88",
    confirmation: "Acceptance above 88",
    invalidation: "Acceptance below 78",
    whatChanged: "Demand improved",
    confidence: "MEDIUM" as const,
    lastAnalysis: "2026-09-01",
    lastFAUpdate: "2026-08-31",
    updated: "2026-09-01T09:00:00.000Z",
    driveFolder: "",
  }
  const first = projectCurrentThesisKnowledge(base)
  const changed = projectCurrentThesisKnowledge({ ...base, baseCase: "Breakout confirmed", updated: "2026-09-02T09:00:00.000Z" })

  assert.equal(first.id, changed.id)
  assert.notEqual(first.provenance.sourceVersion, changed.provenance.sourceVersion)
  assert.equal(first.knowledgeType, "CURRENT_THESIS")
  assert.equal(first.authority, "CANONICAL_THESIS")
  assert.equal(first.provenance.sourceId, "notion-page-1")
})

test("QEO-115 context builder always keeps mandatory current state and reports retrieval outage distinctly", async () => {
  const { createTickerKnowledgeItem, TickerKnowledgeUnavailableError } = await import("../../modules/ticker-knowledge/domain.ts")
  const { buildTickerContext } = await import("../../modules/ticker-knowledge/context.ts")
  const thesis = createTickerKnowledgeItem({
    ticker: "MSN",
    knowledgeType: "CURRENT_THESIS",
    authority: "CANONICAL_THESIS",
    sourceType: "NOTION_THESIS",
    logicalKey: "current-thesis",
    text: "Current thesis: hold range before breakout.",
    provenance: { sourceId: "notion-page-1", sourceVersion: "hash-v1", asOf: "2026-09-01T09:00:00.000Z" },
    projectionVersion: "test-v1",
  })
  const unavailable = {
    ensureReady: async () => undefined,
    upsert: async () => undefined,
    deleteSourceVersion: async () => undefined,
    query: async () => { throw new TickerKnowledgeUnavailableError("qdrant_unavailable", "down") },
  }

  const context = await buildTickerContext({
    index: unavailable,
    ticker: "MSN",
    query: "MSN catalyst and current thesis",
    mandatory: [thesis],
    maxChars: 1200,
    now: "2026-09-06T08:00:00.000Z",
  })

  assert.equal(context.retrievalStatus, "unavailable")
  assert.equal(context.retrievalReason, "qdrant_unavailable")
  assert.equal(context.items.length, 1)
  assert.equal(context.items[0].id, thesis.id)
  assert.match(context.text, /Current thesis/)
})
