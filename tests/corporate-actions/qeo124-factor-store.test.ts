import assert from "node:assert/strict"
import test from "node:test"

import { persistFactorRunCandidate } from "../../modules/market/corporate-actions/adjustment/store.ts"
import type { FactorRunCandidate } from "../../modules/market/corporate-actions/adjustment/engine.ts"

const RUN_ID = "00000000-0000-4000-8000-000000000401"
const ACTION_ID = "00000000-0000-4000-8000-000000000402"
const RUN_HASH = "a".repeat(64)
const EVENT_HASH = "b".repeat(64)

function candidate(): FactorRunCandidate {
  return {
    ticker: "AAA",
    factorVersion: `qeo124-v1:${RUN_HASH}`,
    engineVersion: "qeo124-v1",
    eventLineageHash: RUN_HASH,
    asOfDate: "2026-01-10",
    status: "candidate",
    blockedReason: null,
    transitions: [{
      ticker: "AAA",
      effectiveSession: "2026-01-10",
      referenceSession: "2026-01-09",
      referenceRawClose: 100,
      theoreticalExPrice: 90,
      stepPriceFactor: 0.9,
      stepVolumeFactor: 1,
      cumulativePriceFactor: 0.9,
      cumulativeVolumeFactor: 1,
      corporateActionIds: [ACTION_ID],
      eventLineageHash: EVENT_HASH,
      formulaInputs: { cashDividend: 10 },
    }],
  }
}

function fakeSupabase(options: { badReadback?: boolean; rpcError?: boolean } = {}) {
  const expected = candidate()
  const calls: Array<{ kind: string; value: unknown }> = []

  const runRow = {
    id: RUN_ID,
    ticker: expected.ticker,
    factor_version: expected.factorVersion,
    engine_version: expected.engineVersion,
    event_lineage_hash: expected.eventLineageHash,
    as_of_date: expected.asOfDate,
    status: expected.status,
    blocked_reason: expected.blockedReason,
  }
  const transitionRow = {
    run_id: RUN_ID,
    ticker: expected.ticker,
    effective_session: "2026-01-10",
    reference_session: "2026-01-09",
    reference_raw_close: 100,
    step_price_factor: options.badReadback ? 0.91 : 0.9,
    step_volume_factor: 1,
    cumulative_price_factor: 0.9,
    cumulative_volume_factor: 1,
    corporate_action_ids: [ACTION_ID],
    event_lineage_hash: EVENT_HASH,
    formula_inputs: { cashDividend: 10 },
  }

  return {
    calls,
    client: {
      async rpc(name: string, args: unknown) {
        calls.push({ kind: `rpc:${name}`, value: args })
        return options.rpcError
          ? { data: null, error: { message: "provider detail must not leak" } }
          : { data: RUN_ID, error: null }
      },
      from(table: string) {
        calls.push({ kind: `from:${table}`, value: null })
        if (table === "market_adjustment_factor_runs") {
          return {
            select() {
              return {
                eq() {
                  return {
                    async maybeSingle() {
                      return { data: runRow, error: null }
                    },
                  }
                },
              }
            },
          }
        }
        if (table === "market_price_adjustment_factors") {
          return {
            select() {
              return {
                eq() {
                  return {
                    async order() {
                      return { data: [transitionRow], error: null }
                    },
                  }
                },
              }
            },
          }
        }
        throw new Error(`unexpected table ${table}`)
      },
    },
  }
}

test("QEO-124 factor store accepts persistence only after exact run and transition readback", async () => {
  const fake = fakeSupabase()
  const result = await persistFactorRunCandidate(fake.client as never, candidate())

  assert.deepEqual(result, { runId: RUN_ID, persistedTransitions: 1 })
  assert.equal(fake.calls[0]?.kind, "rpc:qeo_persist_adjustment_factor_candidate")
})

test("QEO-124 factor store fails closed on persisted transition mismatch", async () => {
  const fake = fakeSupabase({ badReadback: true })
  await assert.rejects(
    persistFactorRunCandidate(fake.client as never, candidate()),
    /Adjustment factor exact read-back mismatch/,
  )
})

test("QEO-124 factor store sanitizes RPC failures", async () => {
  const fake = fakeSupabase({ rpcError: true })
  await assert.rejects(
    persistFactorRunCandidate(fake.client as never, candidate()),
    (error: unknown) => error instanceof Error
      && error.message === "Adjustment factor persistence failed"
      && !error.message.includes("provider detail"),
  )
})
