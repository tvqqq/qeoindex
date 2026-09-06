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

test("QEO-119 backfill failures expose only bounded source identity plus stable reason", async () => {
  const { TickerKnowledgeUnavailableError } = await import("../../modules/ticker-knowledge/domain.ts")
  const { runTickerKnowledgeBackfill } = await import("../../modules/ticker-knowledge/sync.ts")
  const result = await runTickerKnowledgeBackfill({
    batchSize: 2,
    loadPage: async () => ({
      rows: [{ id: "run-good" }, { id: "run-bad" }],
      nextCursor: "next-page",
    }),
    failureId: (row) => row.id,
    syncRow: async (row) => {
      if (row.id === "run-bad") {
        throw new TickerKnowledgeUnavailableError("qdrant_timeout", "do-not-expose-upstream-detail")
      }
    },
  })

  assert.deepEqual(result, {
    processed: 2,
    failed: 1,
    failures: [{ sourceId: "run-bad", reason: "qdrant_timeout" }],
    nextCursor: "next-page",
    completed: false,
  })
  assert.doesNotMatch(JSON.stringify(result), /do-not-expose-upstream-detail/)
})

test("QEO-119 Council sync preserves distinct deterministic and debate-error source versions", async () => {
  const { syncCouncilHistoryKnowledge } = await import("../../modules/ticker-knowledge/sync.ts")
  const batches: string[][] = []
  const result = await syncCouncilHistoryKnowledge({
    ensureReady: async () => undefined,
    upsert: async (items) => {
      batches.push(items.map((item) => item.provenance.sourceVersion))
    },
    deleteSourceVersion: async () => undefined,
    query: async () => [],
  }, {
    id: "run-partial",
    ticker: "PNJ",
    asOfDate: "2026-09-03",
    signal: "BUY_ON_CONFIRMATION",
    councilScore: 62,
    confidence: 62,
    consensus: 60,
    riskStatus: "caution",
    price: 39.8,
    policyVersion: "council-policy-v2",
    evidenceHash: "9".repeat(64),
    createdAt: "2026-09-03T08:55:29.661Z",
    outcome: null,
    debate: {
      status: "partial",
      promptVersion: "llm-debate-v3-first-class-context",
      error: "Validation failed after repair",
      completedAt: "2026-09-03T08:57:16.928Z",
    },
  })

  assert.equal(result.upserted, 2)
  assert.equal(batches.length, 2)
  assert.ok(batches.every((batch) => new Set(batch).size === 1))
  assert.notEqual(batches[0][0], batches[1][0])
})

test("QEO-119 final production actions are explicit and destructive reset is confirmation-gated", () => {
  assert.deepEqual(normalizeTickerKnowledgeAcceptanceCommand({ action: "inventory" }), { action: "inventory" })
  assert.deepEqual(normalizeTickerKnowledgeAcceptanceCommand({ action: "benchmark" }), { action: "benchmark" })
  assert.deepEqual(normalizeTickerKnowledgeAcceptanceCommand({ action: "canary_report" }), { action: "canary_report" })
  assert.deepEqual(normalizeTickerKnowledgeAcceptanceCommand({ action: "canary_stock" }), { action: "canary_stock" })
  assert.deepEqual(normalizeTickerKnowledgeAcceptanceCommand({ action: "canary_council" }), { action: "canary_council" })
  assert.throws(
    () => normalizeTickerKnowledgeAcceptanceCommand({ action: "reset_collection", confirm: "wrong" }),
    /explicit confirmation/i,
  )
  assert.deepEqual(
    normalizeTickerKnowledgeAcceptanceCommand({ action: "reset_collection", confirm: "RESET_DERIVED_TICKER_KNOWLEDGE" }),
    { action: "reset_collection", confirm: "RESET_DERIVED_TICKER_KNOWLEDGE" },
  )
})

test("QEO-119 machine runner owns live inventory benchmark canaries and derived-only rebuild reset", () => {
  const route = source("app/api/ops/ticker-knowledge/acceptance/route.ts")
  assert.match(route, /runServerTickerKnowledgeInventory/)
  assert.match(route, /runServerTickerKnowledgeBenchmark/)
  assert.match(route, /runServerReportQaCanary/)
  assert.match(route, /runServerStockQaCanary/)
  assert.match(route, /runServerCouncilKnowledgeCanary/)
  assert.match(route, /resetServerTickerKnowledgeDerivedCollection/)
  assert.doesNotMatch(route, /QDRANT_API_KEY|OPENAI_API_KEY|content_payload|rawEvidence/)
})

test("QEO-119 live acceptance implementation keeps raw evidence private and reports bounded metrics", () => {
  const live = source("modules/ticker-knowledge/production-live.ts")
  assert.match(live, /evaluateTickerKnowledgeProductionAcceptance/)
  assert.match(live, /retrieveResearchReportQaEvidence/)
  assert.match(live, /retrieveResearchReportQaHybridEvidence/)
  assert.match(live, /buildTickerContext/)
  assert.match(live, /p50|percentile/i)
  assert.match(live, /p95|percentile/i)
  assert.doesNotMatch(live, /return\s+.*(?:content|snippet|question|prompt)/i)
})

test("QEO-117 production snapshot migration is promoted at the exact applied version", () => {
  const sql = source("supabase/migrations/20260906123024_qeo117_ai_council_ticker_knowledge.sql")
  assert.match(sql, /create table if not exists public\.ai_council_ticker_knowledge_snapshots/i)
  assert.match(sql, /run_id uuid primary key references public\.ai_council_runs\(id\)/i)
  assert.match(sql, /grant select on table public\.ai_council_ticker_knowledge_snapshots to authenticated/i)
  assert.match(sql, /before update on public\.ai_council_ticker_knowledge_snapshots/i)
  assert.throws(() => source("supabase/pending-migrations/20260906094500_qeo117_ai_council_ticker_knowledge.sql"))
})
