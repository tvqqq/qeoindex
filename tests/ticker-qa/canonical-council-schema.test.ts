import test from "node:test"
import assert from "node:assert/strict"

import { resolveTickerQaEvidence } from "../../modules/ticker-qa/canonical.ts"
import { projectCouncilHistoryKnowledge } from "../../modules/ticker-knowledge/projections.ts"

const run = {
  id: "dc47d04c-ae01-4963-a545-d747d97c88a6",
  ticker: "MSN",
  asOfDate: "2026-09-04",
  signal: "WAIT",
  councilScore: 49,
  confidence: 72,
  consensus: 40,
  riskStatus: "approve",
  price: 69,
  policyVersion: "council-policy-v2",
  evidenceHash: "0e4ae0d5646fba6da577f33b8e64611d3df4c08dc6026c4a4303f025388dd22b",
  createdAt: "2026-09-04T09:24:12.592355Z",
  outcome: null,
}

const selected = projectCouncilHistoryKnowledge(run)
  .find((item) => item.knowledgeType === "COUNCIL_MEMORY")!

function productionSchemaClient() {
  return {
    from(table: string) {
      let selectedColumns = ""
      const builder = {
        select(columns: string) {
          selectedColumns = columns
          return builder
        },
        eq() { return builder },
        order() { return builder },
        limit() { return builder },
        async maybeSingle() {
          if (table !== "ai_council_runs") return { data: null, error: null }
          return {
            data: {
              id: run.id,
              ticker: run.ticker,
              as_of_date: run.asOfDate,
              signal: run.signal,
              council_score: run.councilScore,
              confidence: run.confidence,
              consensus: run.consensus,
              risk_status: run.riskStatus,
              price: run.price,
              policy_version: run.policyVersion,
              evidence_hash: run.evidenceHash,
              created_at: run.createdAt,
              bull_case: null,
              bear_case: null,
              confirmation: null,
              invalidation: null,
              what_changes_decision: null,
              decision_payload: null,
            },
            error: null,
          }
        },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          const result = table === "ai_council_llm_debates" && selectedColumns.split(",").includes("id")
            ? { data: null, error: { message: "column ai_council_llm_debates.id does not exist" } }
            : { data: [], error: null }
          return Promise.resolve(result).then(resolve, reject)
        },
      }
      return builder
    },
  }
}

test("QEO-118 canonical Council hydration uses the production ai_council_llm_debates schema", async () => {
  const result = await resolveTickerQaEvidence(
    productionSchemaClient() as never,
    "MSN",
    [selected],
  )

  assert.equal(result.infrastructureFailure, false)
  assert.equal(result.unresolvedCount, 0)
  assert.equal(result.evidence.length, 1)
  assert.equal(result.evidence[0]?.item.knowledgeType, "COUNCIL_MEMORY")
  assert.equal(result.evidence[0]?.item.provenance.runId, run.id)
})
