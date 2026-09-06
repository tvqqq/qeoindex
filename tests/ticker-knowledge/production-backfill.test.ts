import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("QEO-119 Council backfill reads only columns that exist on production ai_council_llm_debates", () => {
  const server = source("modules/ticker-knowledge/canonical-server.ts")
  const debateSelect = server.match(/from\(COUNCIL_DEBATE_TABLE\)[\s\S]*?\.select\("([^"]+)"\)/)?.[1]
  assert.ok(debateSelect, "expected canonical Council debate selector")
  assert.equal(
    debateSelect,
    "run_id,status,prompt_version,error,completed_at,created_at",
    "Council backfill must not select the removed debate id column",
  )
})

test("QEO-119 Report Q&A backfill loads every canonical chunk for the exact report version, not only ticker-cited pages", async () => {
  const { loadCanonicalResearchReportBackfillPage } = await import("../../modules/ticker-knowledge/canonical-backfill.ts")
  const contentHash = "a".repeat(64)
  let selectorsSeen: unknown = null

  const page = await loadCanonicalResearchReportBackfillPage({
    source: {
      loadReports: async () => ({
        rows: [{ id: "report-1", title: "BSR", source_name: "Broker", publish_date: "2026-09-03", content_hash: contentHash, analysis_status: "ready" }],
        nextCursor: null,
      }),
      loadAnalyses: async () => [{
        id: "analysis-1", report_id: "report-1", content_hash: contentHash, chunk_version: "report-chunk-v1",
        executive_summary: "summary", key_points: [], market_view: null, sector_outlook: null, catalysts: [], risks: [],
        processed_at: "2026-09-03T00:00:00Z", created_at: "2026-09-03T00:00:00Z",
      }],
      loadMentions: async () => [{
        analysis_id: "analysis-1", ticker: "BSR", stance: "positive", recommendation_text: "BUY", target_price: 31150,
        target_currency: "VND", rationale: "valuation", evidence: [{ page: 14, snippet: "target" }],
      }],
      loadChunks: async (selectors) => {
        selectorsSeen = selectors
        return [
          { id: "chunk-p9", report_id: "report-1", content_hash: contentHash, chunk_version: "report-chunk-v1", page_number: 9, chunk_index: 0, content: "operating leverage", chunk_hash: "b".repeat(64) },
          { id: "chunk-p14", report_id: "report-1", content_hash: contentHash, chunk_version: "report-chunk-v1", page_number: 14, chunk_index: 0, content: "target price", chunk_hash: "c".repeat(64) },
        ]
      },
    },
  })

  assert.deepEqual(selectorsSeen, [{
    reportId: "report-1",
    contentHash,
    chunkVersion: "report-chunk-v1",
    pages: null,
  }])
  assert.deepEqual(page.rows[0]?.chunks.map((chunk) => chunk.id), ["chunk-p9", "chunk-p14"])
})