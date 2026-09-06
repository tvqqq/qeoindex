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
  const { RESEARCH_REPORT_QA_PARTITION } = await import("../../modules/ticker-knowledge/partitions.ts")
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
  const reportPartitionChunks = items.filter((item) => item.knowledgeType === "REPORT_CHUNK" && item.ticker === RESEARCH_REPORT_QA_PARTITION)
  const tickerChunks = items.filter((item) => item.knowledgeType === "REPORT_CHUNK" && item.ticker === "MSN")
  assert.equal(reportPartitionChunks.length, 2)
  assert.deepEqual(reportPartitionChunks.map((item) => item.provenance.page), [2, 3])
  assert.equal(tickerChunks.length, 1)
  assert.equal(tickerChunks[0]?.provenance.page, 2)
  assert.equal(tickerChunks[0]?.provenance.chunkId, "chunk-2-0")
  assert.ok(items.every((item) => item.authority === "SOURCE_OPINION"))
  assert.ok(items.every((item) => item.provenance.reportId === "report-1"))
  assert.ok(items.every((item) => item.provenance.analysisId === "analysis-1"))
  assert.ok(items.every((item) => item.provenance.contentHash === "a".repeat(64)))
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

test("QEO-113 sync orchestration upserts deterministic report/Council projections and exposes resumable backfill progress", async () => {
  const {
    runTickerKnowledgeBackfill,
    syncCouncilHistoryKnowledge,
    syncResearchReportKnowledge,
  } = await import("../../modules/ticker-knowledge/sync.ts")
  const upserts: string[][] = []
  const index = {
    ensureReady: async () => undefined,
    upsert: async (items: readonly { id: string }[]) => { upserts.push(items.map((item) => item.id)) },
    deleteSourceVersion: async () => undefined,
    query: async () => [],
  }
  const reportInput = {
    report: { id: "report-1", title: "MSN", sourceName: "HSBC", publishDate: "2026-09-01", contentHash: "a".repeat(64) },
    analysis: { id: "analysis-1", chunkVersion: "v1", executiveSummary: "summary", keyPoints: [], marketView: null, sectorOutlook: null, catalysts: [], risks: [] },
    mentions: [{ ticker: "MSN", stance: "positive" as const, recommendationText: "BUY", targetPrice: 110000, targetCurrency: "VND", rationale: "recovery", evidence: [{ page: 1, snippet: "target" }] }],
    chunks: [{ id: "chunk-1", pageNumber: 1, chunkIndex: 0, content: "target 110000", chunkHash: "b".repeat(64) }],
  }
  const first = await syncResearchReportKnowledge(index, reportInput)
  const retry = await syncResearchReportKnowledge(index, reportInput)
  assert.deepEqual(first.itemIds, retry.itemIds)
  assert.equal(first.sourceId, "report-1")
  assert.equal(first.upserted, 4)
  assert.deepEqual(upserts.slice(0, 2).map((batch) => batch.length), [4, 4])

  const council = await syncCouncilHistoryKnowledge(index, {
    id: "run-1", ticker: "MSN", asOfDate: "2026-09-01", signal: "HOLD", councilScore: 60, confidence: 0.6, consensus: 0.7,
    riskStatus: "normal", price: 80, policyVersion: "p1", evidenceHash: "c".repeat(64), createdAt: "2026-09-01T08:00:00.000Z", outcome: null,
  })
  assert.equal(council.upserted, 1)

  const seen: string[] = []
  const backfill = await runTickerKnowledgeBackfill({
    cursor: "page-1",
    batchSize: 2,
    loadPage: async (cursor, limit) => {
      assert.equal(cursor, "page-1")
      assert.equal(limit, 2)
      return { rows: ["a", "b"], nextCursor: "page-2" }
    },
    syncRow: async (row) => { seen.push(row) },
  })
  assert.deepEqual(seen, ["a", "b"])
  assert.deepEqual(backfill, { processed: 2, failed: 0, nextCursor: "page-2", completed: false })
  assert.equal(upserts.length, 3)
})

test("QEO-113 source reprocessing preserves history until an explicit exact-version tombstone is requested", async () => {
  const {
    syncResearchReportKnowledge,
    tombstoneTickerKnowledgeSourceVersion,
  } = await import("../../modules/ticker-knowledge/sync.ts")
  const deletes: Array<{ ticker: string; sourceType: string; sourceId: string; sourceVersion: string }> = []
  const index = {
    ensureReady: async () => undefined,
    upsert: async () => undefined,
    deleteSourceVersion: async (input: { ticker: string; sourceType: string; sourceId: string; sourceVersion: string }) => { deletes.push(input) },
    query: async () => [],
  }
  const base = {
    report: { id: "report-1", title: "MSN", sourceName: "Broker", publishDate: "2026-09-01", contentHash: "a".repeat(64) },
    analysis: { id: "analysis-1", chunkVersion: "v1", executiveSummary: "first", keyPoints: [], marketView: null, sectorOutlook: null, catalysts: [], risks: [] },
    mentions: [{ ticker: "MSN", stance: "positive" as const, recommendationText: "BUY", targetPrice: 100000, targetCurrency: "VND", rationale: "first", evidence: [] }],
    chunks: [],
  }
  const first = await syncResearchReportKnowledge(index, base)
  const changed = await syncResearchReportKnowledge(index, {
    ...base,
    report: { ...base.report, contentHash: "b".repeat(64) },
    analysis: { ...base.analysis, id: "analysis-2", chunkVersion: "v2" },
  })

  assert.notEqual(first.sourceVersion, changed.sourceVersion)
  assert.deepEqual(deletes, [])

  await tombstoneTickerKnowledgeSourceVersion(index, {
    ticker: "MSN",
    sourceType: "RESEARCH_REPORT",
    sourceId: "report-1",
    sourceVersion: first.sourceVersion,
  })
  assert.deepEqual(deletes, [{
    ticker: "MSN",
    sourceType: "RESEARCH_REPORT",
    sourceId: "report-1",
    sourceVersion: first.sourceVersion,
  }])
})

test("QEO-114 thesis sync is rebuildable and uses the stable CURRENT_THESIS slot", async () => {
  const { syncCurrentThesisKnowledge } = await import("../../modules/ticker-knowledge/sync.ts")
  const writes: string[][] = []
  const index = {
    ensureReady: async () => undefined,
    upsert: async (items: readonly { id: string }[]) => { writes.push(items.map((item) => item.id)) },
    deleteSourceVersion: async () => undefined,
    query: async () => [],
  }
  const thesis = {
    id: "notion-page-1", notionUrl: "", ticker: "MSN", company: "Masan", status: "Current", taBias: "Neutral" as const, faBias: "Neutral" as const,
    wyckoffState: "Range", marketRegime: "Neutral" as const, baseCase: "Wait", probabilities: { bull: 30, base: 50, bear: 20 }, support: "70", resistance: "80",
    confirmation: "80", invalidation: "68", whatChanged: "none", confidence: "LOW" as const, lastAnalysis: "2026-09-01", lastFAUpdate: "2026-09-01", updated: "2026-09-01", driveFolder: "",
  }
  const first = await syncCurrentThesisKnowledge(index, thesis)
  const rebuilt = await syncCurrentThesisKnowledge(index, thesis)
  assert.equal(first.itemIds[0], rebuilt.itemIds[0])
  assert.deepEqual(writes, [[first.itemIds[0]], [first.itemIds[0]]])
})

test("QEO-115 consumer policy preserves contradictory authorities and exposes stage telemetry", async () => {
  const { createTickerKnowledgeItem } = await import("../../modules/ticker-knowledge/domain.ts")
  const { buildTickerContext } = await import("../../modules/ticker-knowledge/context.ts")
  const make = (logicalKey: string, authority: "DETERMINISTIC_SIGNAL" | "SOURCE_OPINION", text: string) => createTickerKnowledgeItem({
    ticker: "MSN", knowledgeType: authority === "DETERMINISTIC_SIGNAL" ? "COUNCIL_MEMORY" : "BROKER_VIEW", authority,
    sourceType: authority === "DETERMINISTIC_SIGNAL" ? "AI_COUNCIL" : "RESEARCH_REPORT", logicalKey, text,
    provenance: { sourceId: logicalKey, sourceVersion: "v1", asOf: "2026-09-01" }, projectionVersion: "v1",
  })
  const deterministic = make("council", "DETERMINISTIC_SIGNAL", "Council says WAIT")
  const opinion = make("broker", "SOURCE_OPINION", "Broker says BUY")
  const index = {
    ensureReady: async () => undefined,
    upsert: async () => undefined,
    deleteSourceVersion: async () => undefined,
    query: async () => [
      { id: opinion.id, score: 0.95, item: opinion, derivedVersions: { embeddingModel: "e", embeddingVersion: "v1", sparseEncoder: "s", sparseVersion: "v1" } },
      { id: deterministic.id, score: 0.8, item: deterministic, derivedVersions: { embeddingModel: "e", embeddingVersion: "v1", sparseEncoder: "s", sparseVersion: "v1" } },
    ],
  }
  const context = await buildTickerContext({ index, ticker: "MSN", query: "What should I do?", consumer: "AI_COUNCIL", now: "2026-09-06" })
  assert.equal(context.consumer, "AI_COUNCIL")
  assert.equal(context.items.length, 2)
  assert.equal(context.items[0].authority, "DETERMINISTIC_SIGNAL")
  assert.equal(context.items[1].authority, "SOURCE_OPINION")
  assert.ok(context.telemetry.totalMs >= 0)
  assert.ok(context.telemetry.retrievalMs >= 0)
  assert.ok(context.telemetry.rerankMs >= 0)
  assert.ok(context.telemetry.buildMs >= 0)
})
