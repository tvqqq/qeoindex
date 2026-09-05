import assert from "node:assert/strict"
import test from "node:test"

import { processResearchReport } from "../../modules/research-reports/analysis/pipeline.ts"

const reportId = "11111111-1111-4111-8111-111111111111"
const runId = "22222222-2222-4222-8222-222222222222"
const contentHash = "a".repeat(64)
const modelRouteKey = "report-ai-v1:gpt-5.6-luna:gpt-5.6-terra:medium"

const analysis = {
  executiveSummary: "Constructive outlook.",
  keyPoints: ["Positive outlook"],
  marketView: null,
  sectorOutlook: null,
  catalysts: [],
  risks: [],
  tickerMentions: [],
  confidence: { score: 90, flags: [] },
}

function client() {
  let publishCalls = 0
  const lookupBuilder = {
    select() { return this },
    eq() { return this },
    async maybeSingle() { return { data: null, error: null } },
  }
  return {
    api: {
      from(table: string) {
        if (table === "market_research_report_analyses") return lookupBuilder
        assert.equal(table, "market_research_reports")
        return {
          update() {
            return { async eq() { return { error: null } } }
          },
        }
      },
      async rpc(name: string) {
        assert.equal(name, "qeo_publish_research_report_analysis")
        publishCalls += 1
        return { data: "analysis-published", error: null }
      },
    },
    publishCalls: () => publishCalls,
  }
}

function baseDeps(analyzeCalls: { count: number }) {
  return {
    runId,
    async fetchPdf() {
      return {
        finalUrl: "https://cdn02.wigroup.vn/report.pdf",
        bytes: new Uint8Array([1]),
        contentHash,
        contentType: "application/pdf",
        byteLength: 1,
      }
    },
    async parsePdf() {
      return {
        status: "parsed" as const,
        pages: [{ pageNumber: 1, text: "Grounded report text." }],
        pageCount: 1,
      }
    },
    async analyzePages() {
      analyzeCalls.count += 1
      return {
        analysis,
        route: {
          model: "gpt-5.6-luna",
          fallbackModel: "gpt-5.6-terra",
          reasoningEffort: "medium" as const,
          modelRouteKey,
        },
        audit: {
          requestedModel: "gpt-5.6-luna",
          responseModel: "gpt-5.6-luna",
          fallbackUsed: false,
          attemptedModels: ["gpt-5.6-luna"],
          responseId: "resp-lease",
          inputTokens: 100,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 40,
          reasoningTokens: 8,
          totalTokens: 140,
          latencyMs: 10,
          estimatedCostUsd: 0.000068,
          pricingVersion: "openai-gpt-5.6-standard-2026-09-05" as const,
        },
      }
    },
  }
}

test("QEO-85 active analysis lease skips concurrent run before AI spend", async () => {
  const state = client()
  const analyzeCalls = { count: 0 }
  let acquireCalls = 0

  const result = await processResearchReport(state.api, {
    id: reportId,
    pdfUrl: "https://cdn02.wigroup.vn/report.pdf",
  }, {
    ...baseDeps(analyzeCalls),
    async acquireLease() {
      acquireCalls += 1
      return { outcome: "busy" as const, expiresAt: "2026-09-05T06:00:00.000Z" }
    },
  })

  assert.equal(acquireCalls, 1)
  assert.equal(result.status, "skipped_concurrent")
  assert.equal(result.aiCalled, false)
  assert.equal(analyzeCalls.count, 0)
  assert.equal(state.publishCalls(), 0)
})

test("QEO-85 owned lease is released as ready only after atomic publish", async () => {
  const state = client()
  const analyzeCalls = { count: 0 }
  const releases: Array<Record<string, unknown>> = []

  const result = await processResearchReport(state.api, {
    id: reportId,
    pdfUrl: "https://cdn02.wigroup.vn/report.pdf",
  }, {
    ...baseDeps(analyzeCalls),
    async acquireLease() {
      return {
        outcome: "acquired" as const,
        leaseToken: "33333333-3333-4333-8333-333333333333",
        expiresAt: "2026-09-05T06:00:00.000Z",
      }
    },
    async releaseLease(_client, input) {
      releases.push(input)
    },
  })

  assert.equal(result.status, "ready")
  assert.equal(analyzeCalls.count, 1)
  assert.equal(state.publishCalls(), 1)
  assert.deepEqual(releases, [{
    leaseToken: "33333333-3333-4333-8333-333333333333",
    terminalOutcome: "ready",
  }])
})

test("QEO-85 owned lease is released as failed when analysis fails", async () => {
  const state = client()
  const analyzeCalls = { count: 0 }
  const releases: Array<Record<string, unknown>> = []

  const result = await processResearchReport(state.api, {
    id: reportId,
    pdfUrl: "https://cdn02.wigroup.vn/report.pdf",
  }, {
    ...baseDeps(analyzeCalls),
    async acquireLease() {
      return {
        outcome: "acquired" as const,
        leaseToken: "44444444-4444-4444-8444-444444444444",
        expiresAt: "2026-09-05T06:00:00.000Z",
      }
    },
    async analyzePages() {
      analyzeCalls.count += 1
      throw new Error("provider failure")
    },
    async releaseLease(_client, input) {
      releases.push(input)
    },
  })

  assert.equal(result.status, "failed")
  assert.equal(analyzeCalls.count, 1)
  assert.equal(state.publishCalls(), 0)
  assert.deepEqual(releases, [{
    leaseToken: "44444444-4444-4444-8444-444444444444",
    terminalOutcome: "failed",
  }])
})
