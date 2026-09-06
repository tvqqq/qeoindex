import assert from "node:assert/strict"
import test from "node:test"

import { freezeCouncilTickerKnowledge } from "../../modules/ai-council/ticker-knowledge-context.ts"
import { createTickerKnowledgeItem } from "../../modules/ticker-knowledge/domain.ts"

const RUN_ID = "11111111-1111-4111-8111-111111111111"
const AS_OF_DATE = "2026-09-05"

class SnapshotClient {
  row: Record<string, unknown> | null = null

  from(table: string) {
    assert.equal(table, "ai_council_ticker_knowledge_snapshots")
    const self = this
    return {
      select(_columns: string) {
        return {
          eq(_column: string, _value: unknown) {
            return {
              async limit(_limit: number) {
                return { data: self.row ? [{ ...self.row }] : [], error: null }
              },
            }
          },
        }
      },
      async upsert(payload: Record<string, unknown>) {
        if (!self.row) self.row = { ...payload, captured_at: "2026-09-05T08:00:00.000Z" }
        return { data: null, error: null }
      },
    }
  }
}

test("QEO-117 persists bounded mandatory deterministic Council context when semantic retrieval is unavailable", async () => {
  const council = createTickerKnowledgeItem({
    ticker: "MSN",
    knowledgeType: "COUNCIL_MEMORY",
    authority: "DETERMINISTIC_SIGNAL",
    sourceType: "AI_COUNCIL",
    logicalKey: "latest-council",
    text: "Deterministic Council state remains usable even when Qdrant semantic retrieval times out.",
    provenance: {
      sourceId: RUN_ID,
      sourceVersion: `policy-v1:${"a".repeat(64)}`,
      runId: RUN_ID,
      asOf: "2026-09-05T00:00:00.000Z",
    },
    projectionVersion: "council-history-knowledge-v1",
  })
  const client = new SnapshotClient()

  const frozen = await freezeCouncilTickerKnowledge(client as never, {
    runId: RUN_ID,
    ticker: "MSN",
    asOfDate: AS_OF_DATE,
    query: "Council advisory context",
  }, {
    buildContext: async () => ({
      ticker: "MSN",
      query: "Council advisory context",
      consumer: "AI_COUNCIL",
      retrievalStatus: "unavailable",
      retrievalReason: "qdrant_timeout",
      items: [council],
      retrievedPointIds: [],
      text: council.text,
      truncated: false,
      telemetry: { totalMs: 5, alwaysLoadMs: 1, retrievalMs: 4, rerankMs: 0, buildMs: 0 },
    }),
  })

  assert.equal(frozen.persisted, true)
  assert.equal(frozen.canUseInPrompt, true)
  assert.equal(frozen.context.status, "ready")
  assert.equal(frozen.context.retrievalStatus, "unavailable")
  assert.equal(frozen.context.retrievalReason, "qdrant_timeout")
  assert.deepEqual(frozen.context.items.map((item) => item.id), [council.id])
  assert.deepEqual(frozen.pointIds, [])
  assert.ok(frozen.context.limitations.some((value) => /semantic retrieval unavailable/i.test(value)))
})
