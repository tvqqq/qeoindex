import assert from "node:assert/strict"
import test from "node:test"

import {
  findSuccessfulResearchReportAnalysis,
  markResearchReportStatus,
  publishResearchReportAnalysis,
  type ResearchReportAnalysisIdentity,
  type ResearchReportPublishPayload,
} from "../../modules/research-reports/repository.ts"

const identity: ResearchReportAnalysisIdentity = {
  reportId: "11111111-1111-4111-8111-111111111111",
  contentHash: "a".repeat(64),
  analysisVersion: "report-analysis-v1",
  promptVersion: "report-analysis-prompt-v1",
  modelRouteKey: "report-ai-v1:gpt-5.6-luna:gpt-5.6-terra:medium",
}

test("QEO-81 successful-analysis lookup filters every route-aware identity component", async () => {
  const eqCalls: Array<[string, unknown]> = []
  const builder = {
    select(columns: string) {
      assert.equal(columns, "id,report_id,content_hash,analysis_version,prompt_version,model_route_key")
      return this
    },
    eq(column: string, value: unknown) {
      eqCalls.push([column, value])
      return this
    },
    async maybeSingle() {
      return {
        data: {
          id: "analysis-1",
          report_id: identity.reportId,
          content_hash: identity.contentHash,
          analysis_version: identity.analysisVersion,
          prompt_version: identity.promptVersion,
          model_route_key: identity.modelRouteKey,
        },
        error: null,
      }
    },
  }
  const client = {
    from(table: string) {
      assert.equal(table, "market_research_report_analyses")
      return builder
    },
  }

  const result = await findSuccessfulResearchReportAnalysis(client, identity)
  assert.equal(result?.id, "analysis-1")
  assert.deepEqual(eqCalls, [
    ["report_id", identity.reportId],
    ["content_hash", identity.contentHash],
    ["analysis_version", identity.analysisVersion],
    ["prompt_version", identity.promptVersion],
    ["model_route_key", identity.modelRouteKey],
  ])
})

test("QEO-81 report status adapter updates only intended fields and bounds persisted errors", async () => {
  const calls: Array<{ table: string; patch: Record<string, unknown>; filter: [string, unknown] }> = []
  const client = {
    from(table: string) {
      return {
        update(patch: Record<string, unknown>) {
          return {
            async eq(column: string, value: unknown) {
              calls.push({ table, patch, filter: [column, value] })
              return { error: null }
            },
          }
        },
      }
    },
  }

  await markResearchReportStatus(client, identity.reportId, {
    ingestionStatus: "needs_ocr",
    analysisStatus: "needs_ocr",
    analysisError: `analysis failed ${"x".repeat(1200)}`,
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].table, "market_research_reports")
  assert.deepEqual(calls[0].filter, ["id", identity.reportId])
  assert.equal(calls[0].patch.ingestion_status, "needs_ocr")
  assert.equal(calls[0].patch.analysis_status, "needs_ocr")
  assert.equal("ingestion_error" in calls[0].patch, false)
  assert.equal(typeof calls[0].patch.analysis_error, "string")
  assert.ok(String(calls[0].patch.analysis_error).length <= 800)
  assert.equal(typeof calls[0].patch.updated_at, "string")
})

test("QEO-81 atomic publish adapter calls only the canonical service-role RPC", async () => {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = []
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args })
      return { data: "analysis-atomic-1", error: null }
    },
  }
  const payload: ResearchReportPublishPayload = {
    identity,
    reasoningEffort: "medium",
    chunkVersion: "page-safe-v1",
    parsedPageCount: 2,
    modelRequested: "gpt-5.6-luna",
    modelActual: "gpt-5.6-luna",
    responseId: "resp-1",
    inputTokens: 100,
    cachedInputTokens: 20,
    outputTokens: 50,
    reasoningTokens: 10,
    totalTokens: 150,
    latencyMs: 1234,
    estimatedCostUsd: null,
    pricingVersion: null,
    analysis: {
      executiveSummary: "Summary",
      keyPoints: ["Point"],
      marketView: "Constructive",
      sectorOutlook: null,
      catalysts: ["Catalyst"],
      risks: ["Risk"],
      tickerMentions: [{
        ticker: "MSN",
        stance: "positive",
        recommendationText: null,
        targetPrice: 85000,
        targetCurrency: "VND",
        rationale: "Rationale",
        evidence: [{ page: 1, snippet: "MSN maintains a positive outlook." }],
      }],
      confidence: { score: 88, flags: [] },
    },
    chunks: [{
      pageNumber: 1,
      chunkIndex: 0,
      content: "MSN maintains a positive outlook.",
      chunkHash: "b".repeat(64),
      chunkVersion: "page-safe-v1",
    }],
  }

  const result = await publishResearchReportAnalysis(client, payload)
  assert.deepEqual(result, { analysisId: "analysis-atomic-1" })
  assert.equal(rpcCalls.length, 1)
  assert.equal(rpcCalls[0].name, "qeo_publish_research_report_analysis")
  assert.equal(rpcCalls[0].args.p_report_id, identity.reportId)
  assert.equal(rpcCalls[0].args.p_content_hash, identity.contentHash)
  const analysis = rpcCalls[0].args.p_analysis as Record<string, unknown>
  assert.equal(analysis.model_route_key, identity.modelRouteKey)
  assert.equal(analysis.reasoning_effort, "medium")
  assert.equal(analysis.chunk_version, "page-safe-v1")
  assert.deepEqual(rpcCalls[0].args.p_chunks, [{
    page_number: 1,
    chunk_index: 0,
    content: "MSN maintains a positive outlook.",
    chunk_hash: "b".repeat(64),
    chunk_version: "page-safe-v1",
  }])
  assert.deepEqual(rpcCalls[0].args.p_mentions, [{
    ticker: "MSN",
    stance: "positive",
    recommendation_text: null,
    target_price: 85000,
    target_currency: "VND",
    target_source: "report_extracted",
    rationale: "Rationale",
    evidence: [{ page: 1, snippet: "MSN maintains a positive outlook." }],
  }])
})
