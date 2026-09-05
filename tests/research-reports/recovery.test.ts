import assert from "node:assert/strict"
import test from "node:test"

import { processResearchReport } from "../../modules/research-reports/analysis/pipeline.ts"
import { findLastKnownGoodResearchReportAnalysis } from "../../modules/research-reports/analysis/recovery.ts"

const REPORT_ID = "11111111-1111-4111-8111-111111111111"
const LAST_GOOD_HASH = "b".repeat(64)

function statusOnlyClient() {
  const patches: Array<Record<string, unknown>> = []
  const client = {
    from(table: string) {
      assert.equal(table, "market_research_reports")
      return {
        update(patch: Record<string, unknown>) {
          return {
            async eq(column: string, value: unknown) {
              assert.equal(column, "id")
              assert.equal(value, REPORT_ID)
              patches.push(patch)
              return { error: null }
            },
          }
        },
      }
    },
    async rpc() {
      return { data: null, error: null }
    },
  }
  return { client, patches }
}

test("QEO-87 recovery lookup selects only persisted identity columns from the latest published analysis", async () => {
  const calls: Array<[string, unknown]> = []
  const builder = {
    select(columns: string) {
      assert.equal(columns, "id,report_id,content_hash")
      assert.doesNotMatch(columns, /parsed_page_count/)
      return this
    },
    eq(column: string, value: unknown) {
      calls.push([column, value])
      return this
    },
    order(column: string, options: { ascending: boolean }) {
      assert.equal(column, "created_at")
      assert.deepEqual(options, { ascending: false })
      return this
    },
    limit(count: number) {
      assert.equal(count, 1)
      return this
    },
    async maybeSingle() {
      return {
        data: {
          id: "analysis-last-good",
          report_id: REPORT_ID,
          content_hash: LAST_GOOD_HASH,
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

  const result = await findLastKnownGoodResearchReportAnalysis(client, REPORT_ID)
  assert.deepEqual(calls, [["report_id", REPORT_ID]])
  assert.deepEqual(result, {
    id: "analysis-last-good",
    reportId: REPORT_ID,
    contentHash: LAST_GOOD_HASH,
  })
})

test("QEO-87 pre-hash fetch timeout restores canonical last-known-good identity without hiding the failed attempt", async () => {
  const { client, patches } = statusOnlyClient()
  let aiCalls = 0

  const result = await processResearchReport(client, {
    id: REPORT_ID,
    pdfUrl: "https://cdn02.wigroup.vn/report.pdf",
  }, {
    async fetchPdf() {
      throw new Error("The operation was aborted due to timeout")
    },
    async parsePdf() {
      throw new Error("parse must not run")
    },
    async analyzePages() {
      aiCalls += 1
      throw new Error("AI must not run")
    },
    async findLastKnownGood() {
      return {
        id: "analysis-last-good",
        reportId: REPORT_ID,
        contentHash: LAST_GOOD_HASH,
      }
    },
  })

  assert.equal(result.status, "failed")
  assert.equal(result.contentHash, null)
  assert.equal(result.analysisId, null)
  assert.equal(result.aiCalled, false)
  assert.equal(aiCalls, 0)

  const restored = patches.at(-1)
  assert.ok(restored)
  assert.equal(restored.content_hash, LAST_GOOD_HASH)
  assert.equal("parsed_page_count" in restored, false)
  assert.equal(restored.ingestion_status, "parsed")
  assert.match(String(restored.ingestion_error), /timeout/)
  assert.equal(restored.analysis_status, "ready")
  assert.equal(restored.analysis_error, null)
})

test("QEO-87 pre-hash fetch timeout remains fail-closed when no published analysis can be recovered", async () => {
  const { client, patches } = statusOnlyClient()

  const result = await processResearchReport(client, {
    id: REPORT_ID,
    pdfUrl: "https://cdn02.wigroup.vn/report.pdf",
  }, {
    async fetchPdf() {
      throw new Error("temporary CDN timeout")
    },
    async parsePdf() {
      throw new Error("parse must not run")
    },
    async analyzePages() {
      throw new Error("AI must not run")
    },
    async findLastKnownGood() {
      return null
    },
  })

  assert.equal(result.status, "failed")
  const failed = patches.at(-1)
  assert.ok(failed)
  assert.equal(failed.ingestion_status, "failed")
  assert.match(String(failed.ingestion_error), /temporary CDN timeout/)
  assert.equal("content_hash" in failed, false)
  assert.equal("analysis_status" in failed, false)
  assert.equal("analysis_error" in failed, false)
})
