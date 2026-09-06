import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  normalizeTickerKnowledgeAcceptanceCommand,
  probeTickerKnowledgeReadiness,
} from "../../modules/ticker-knowledge/production-acceptance.ts"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("QEO-119 production health proves readiness plus one hybrid query without requiring evidence hits", async () => {
  const calls: string[] = []
  const health = await probeTickerKnowledgeReadiness({
    ticker: "msn",
    queryText: "target 110000 EBITDA",
    index: {
      ensureReady: async () => { calls.push("ready") },
      upsert: async () => undefined,
      deleteSourceVersion: async () => undefined,
      query: async (input) => {
        calls.push(`query:${input.ticker}:${input.limit}`)
        return []
      },
    },
    now: (() => {
      let value = 100
      return () => (value += 7)
    })(),
  })

  assert.deepEqual(calls, ["ready", "query:MSN:1"])
  assert.equal(health.status, "ready")
  assert.equal(health.collection, "ticker_knowledge")
  assert.equal(health.ticker, "MSN")
  assert.equal(health.hybridQuery, "ready")
  assert.equal(health.resultCount, 0)
  assert.ok(health.latencyMs >= 0)
})

test("QEO-119 backfill command parser is bounded, cursor-resumable and rejects retired thesis actions", () => {
  assert.deepEqual(
    normalizeTickerKnowledgeAcceptanceCommand({ action: "backfill_reports", cursor: "r-100", batchSize: 25 }),
    { action: "backfill_reports", cursor: "r-100", batchSize: 25 },
  )
  assert.deepEqual(
    normalizeTickerKnowledgeAcceptanceCommand({ action: "backfill_council", batchSize: 999 }),
    { action: "backfill_council", cursor: null, batchSize: 100 },
  )
  assert.throws(
    () => normalizeTickerKnowledgeAcceptanceCommand({ action: "rebuild_theses", tickers: ["MSN"] }),
    /Unsupported ticker knowledge acceptance action/,
  )
  assert.throws(
    () => normalizeTickerKnowledgeAcceptanceCommand({ action: "drop_collection" }),
    /Unsupported ticker knowledge acceptance action/,
  )
})

test("QEO-119 production acceptance API is Root Admin-only, same-origin guarded and Notion-free", () => {
  const route = source("app/api/admin/ticker-knowledge/acceptance/route.ts")
  assert.match(route, /requireApiRoot/)
  assert.match(route, /validateAdminMutationRequest/)
  assert.match(route, /probeServerTickerKnowledgeProductionHealth/)
  assert.match(route, /runServerResearchReportKnowledgeBackfillPage/)
  assert.match(route, /runServerCouncilKnowledgeBackfillPage/)
  assert.doesNotMatch(route, /rebuildCurrentThesisKnowledgeFromCanonicalNotion|notion-server|rebuild_theses/)
  assert.match(route, /private, no-store/)
  assert.doesNotMatch(route, /QDRANT_API_KEY|OPENAI_API_KEY|prompt|evidence/i)
})

test("QEO-119 machine acceptance runner accepts only canonical machine or Vault scheduler auth and stays bounded", () => {
  const route = source("app/api/ops/ticker-knowledge/acceptance/route.ts")
  assert.match(route, /isMachineRequestAuthorized/)
  assert.match(route, /process\.env\.CRON_SECRET/)
  assert.match(route, /qeo_verify_eod_scheduler_secret/)
  assert.match(route, /getSupabaseServerClient/)
  assert.doesNotMatch(route, /requireApiRoot|ROOT_ADMIN_USER_IDS/)
  assert.match(route, /normalizeTickerKnowledgeAcceptanceCommand/)
  assert.match(route, /runServerResearchReportKnowledgeBackfillPage/)
  assert.match(route, /runServerCouncilKnowledgeBackfillPage/)
  assert.match(route, /private, no-store/)
  assert.doesNotMatch(route, /rebuild_theses|NOTION_THESIS|CANONICAL_THESIS/)
})
