import assert from "node:assert/strict"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import test from "node:test"

import { hydrateResearchReportQaEvidence } from "../../modules/research-reports/qa/retrieval.ts"
import type {
  ResearchReportQaEvidenceIdentity,
  ResearchReportQaRetrievalClient,
} from "../../modules/research-reports/qa/types.ts"

const REPORT_ID = "11111111-1111-4111-8111-111111111111"
const ANALYSIS_ID = "33333333-3333-4333-8333-333333333333"
const CHUNK_A = "44444444-4444-4444-8444-444444444444"
const CHUNK_B = "55555555-5555-4555-8555-555555555555"
const BAD_CHUNK = "66666666-6666-4666-8666-666666666666"
const HASH = "a".repeat(64)
const OLD_HASH = "b".repeat(64)
const CHUNK_VERSION = "report-chunk-v1"

const IDENTITY: ResearchReportQaEvidenceIdentity = {
  reportId: REPORT_ID,
  contentHash: HASH,
  chunkVersion: CHUNK_VERSION,
  analysisId: ANALYSIS_ID,
}

function qeo116HydrationMigration() {
  const directories = ["supabase/migrations", "supabase/pending-migrations"].filter(existsSync)
  const matches = directories.flatMap((directory) =>
    readdirSync(directory)
      .filter((name) => name.endsWith("_qeo116_report_qa_hydration.sql"))
      .map((name) => `${directory}/${name}`),
  )
  assert.equal(matches.length, 1, "expected exactly one QEO-116 report Q&A hydration migration")
  return readFileSync(matches[0], "utf8")
}

test("QEO-116 hydration RPC is exact-version and service-role-only", () => {
  const sql = qeo116HydrationMigration()
  assert.match(sql, /create\s+or\s+replace\s+function\s+public\.qeo_hydrate_research_report_chunks\s*\(/i)
  assert.match(sql, /p_report_id\s+uuid/i)
  assert.match(sql, /p_content_hash\s+text/i)
  assert.match(sql, /p_chunk_version\s+text/i)
  assert.match(sql, /p_chunk_ids\s+uuid\[\]/i)
  assert.match(sql, /c\.report_id\s*=\s*p_report_id/i)
  assert.match(sql, /c\.content_hash\s*=\s*p_content_hash/i)
  assert.match(sql, /c\.chunk_version\s*=\s*p_chunk_version/i)
  assert.match(sql, /c\.id\s*=\s*any\s*\(\s*p_chunk_ids\s*\)/i)
  assert.match(sql, /revoke\s+all\s+on\s+function\s+public\.qeo_hydrate_research_report_chunks[\s\S]*?from\s+public,\s*anon,\s*authenticated/i)
  assert.match(sql, /grant\s+execute\s+on\s+function\s+public\.qeo_hydrate_research_report_chunks[\s\S]*?to\s+service_role/i)
})

test("QEO-116 hydrates canonical PostgreSQL text/page in Qdrant rank order and rejects identity leakage", async () => {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = []
  const client: ResearchReportQaRetrievalClient = {
    from() {
      throw new Error("from() must not be used by hydration")
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args })
      return {
        error: null,
        data: [
          {
            id: CHUNK_A,
            report_id: REPORT_ID,
            content_hash: HASH,
            chunk_version: CHUNK_VERSION,
            page_number: 7,
            chunk_index: 1,
            content: "Canonical PostgreSQL text A",
          },
          {
            id: CHUNK_B,
            report_id: REPORT_ID,
            content_hash: HASH,
            chunk_version: CHUNK_VERSION,
            page_number: 9,
            chunk_index: 0,
            content: "Canonical PostgreSQL text B",
          },
          {
            id: BAD_CHUNK,
            report_id: REPORT_ID,
            content_hash: OLD_HASH,
            chunk_version: CHUNK_VERSION,
            page_number: 99,
            chunk_index: 0,
            content: "Historical row must never hydrate",
          },
        ],
      }
    },
  }

  const evidence = await hydrateResearchReportQaEvidence(client, IDENTITY, [
    { chunkId: CHUNK_B, rank: 0.91 },
    { chunkId: CHUNK_A, rank: 0.82 },
    { chunkId: BAD_CHUNK, rank: 0.99 },
  ])

  assert.deepEqual(rpcCalls, [{
    name: "qeo_hydrate_research_report_chunks",
    args: {
      p_report_id: REPORT_ID,
      p_content_hash: HASH,
      p_chunk_version: CHUNK_VERSION,
      p_chunk_ids: [CHUNK_B, CHUNK_A, BAD_CHUNK],
    },
  }])
  assert.deepEqual(evidence.map((row) => row.chunkId), [CHUNK_B, CHUNK_A])
  assert.deepEqual(evidence.map((row) => row.rank), [0.91, 0.82])
  assert.equal(evidence[0].page, 9)
  assert.equal(evidence[0].content, "Canonical PostgreSQL text B")
  assert.equal(evidence[1].page, 7)
  assert.equal(evidence[1].content, "Canonical PostgreSQL text A")
  assert.doesNotMatch(evidence.map((row) => row.content).join(" "), /Historical row/)
})
