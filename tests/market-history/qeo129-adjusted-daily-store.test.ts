import assert from "node:assert/strict"
import test from "node:test"

import { rebuildAdjustedDailyRange } from "../../modules/market/history/adjusted-daily-store.ts"

const RUN_ID = "00000000-0000-4000-8000-000000000129"
const LINEAGE = "a".repeat(64)
const FACTOR_VERSION = `qeo124-v1:${LINEAGE}`

function fakeSupabase(options: {
  runStatus?: "candidate" | "active" | "blocked" | "superseded"
  runLineage?: string
  omitReadbackSession?: string
  badReadbackCloseSession?: string
  rawProvider?: string
  rawProviderDetail?: string
} = {}) {
  const calls: Array<{ kind: string; value: unknown }> = []
  const runRow = {
    id: RUN_ID,
    ticker: "VHM",
    factor_version: FACTOR_VERSION,
    engine_version: "qeo124-v1",
    event_lineage_hash: options.runLineage ?? LINEAGE,
    status: options.runStatus ?? "candidate",
  }
  const transitionRows = [{
    effective_session: "2026-08-06",
    cumulative_price_factor: 0.5,
    cumulative_volume_factor: 2,
  }]
  const provider = options.rawProvider ?? "DNSE"
  const providerDetail = options.rawProviderDetail ?? "DNSE direct Daily OHLCV | source basis: raw"
  const rawRows = [
    {
      ticker: "VHM",
      bar_time: "2026-08-04T02:00:00.000Z",
      open: 100,
      high: 110,
      low: 95,
      close: 105,
      volume: 1_000,
      provider,
      provider_detail: providerDetail,
      source_url: "https://services.entrade.com.vn/chart-api/v2/ohlcs/stock",
    },
    {
      ticker: "VHM",
      bar_time: "2026-08-05T02:00:00.000Z",
      open: 110,
      high: 120,
      low: 100,
      close: 115,
      volume: 2_000,
      provider,
      provider_detail: providerDetail,
      source_url: "https://services.entrade.com.vn/chart-api/v2/ohlcs/stock",
    },
  ]

  let adjustedPayload: Array<Record<string, unknown>> = []

  function runQuery() {
    return {
      eq() { return this },
      async maybeSingle() { return { data: runRow, error: null } },
    }
  }

  function transitionsQuery() {
    return {
      eq() { return this },
      async order() { return { data: transitionRows, error: null } },
    }
  }

  function rawQuery() {
    return {
      eq() { return this },
      gte() { return this },
      lte() { return this },
      async order() { return { data: rawRows, error: null } },
    }
  }

  return {
    calls,
    get adjustedPayload() { return adjustedPayload },
    client: {
      from(table: string) {
        calls.push({ kind: `from:${table}`, value: null })
        if (table === "market_adjustment_factor_runs") {
          return { select: () => runQuery() }
        }
        if (table === "market_price_adjustment_factors") {
          return { select: () => transitionsQuery() }
        }
        if (table === "market_ohlcv_history") {
          return { select: () => rawQuery() }
        }
        if (table === "market_ohlcv_adjusted_daily") {
          return {
            async upsert(payload: Array<Record<string, unknown>>) {
              adjustedPayload = payload
              calls.push({ kind: "upsert:adjusted", value: payload })
              return { data: null, error: null }
            },
          }
        }
        if (table === "market_adjusted_daily_rollout") {
          return {
            async upsert(payload: Record<string, unknown>) {
              calls.push({ kind: "upsert:rollout", value: payload })
              return { data: null, error: null }
            },
          }
        }
        throw new Error(`unexpected table ${table}`)
      },
      async rpc(name: string, args: Record<string, unknown>) {
        calls.push({ kind: `rpc:${name}`, value: args })
        assert.equal(name, "qeo_adjusted_daily_readback")
        const readback = adjustedPayload
          .filter((row) => row.session_date !== options.omitReadbackSession)
          .map((row) => ({
            session_date: row.session_date,
            bar_time: row.bar_time,
            open: row.open,
            high: row.high,
            low: row.low,
            close: row.session_date === options.badReadbackCloseSession
              ? Number(row.close) + 1
              : row.close,
            volume: row.volume,
            raw_bar_time: row.raw_bar_time,
            factor_run_id: row.factor_run_id,
            factor_version: row.factor_version,
            event_lineage_hash: row.event_lineage_hash,
            adjustment_engine_version: row.adjustment_engine_version,
          }))
        return { data: readback, error: null }
      },
    },
  }
}

test("QEO-129 counts rebuilt sessions only from exact persisted DB readback", async () => {
  const fake = fakeSupabase({ omitReadbackSession: "2026-08-05" })
  const result = await rebuildAdjustedDailyRange({
    supabase: fake.client as never,
    ticker: "VHM",
    fromDate: "2026-08-04",
    toDate: "2026-08-05",
    expectedFactorRunId: RUN_ID,
    expectedLineageHash: LINEAGE,
  })

  assert.equal(result.rebuiltSessions, 1)
  assert.deepEqual(result.unresolvedSessions, ["2026-08-05"])
  assert.equal(result.factorRunId, RUN_ID)
  assert.equal(result.factorVersion, FACTOR_VERSION)
  assert.equal(result.lineageHash, LINEAGE)

  const rolloutCall = fake.calls.find((call) => call.kind === "upsert:rollout")
  assert.ok(rolloutCall)
  assert.deepEqual(rolloutCall.value, {
    ticker: "VHM",
    status: "blocked",
    factor_run_id: RUN_ID,
    factor_version: FACTOR_VERSION,
    event_lineage_hash: LINEAGE,
    verified_from: null,
    verified_through: null,
    verified_at: null,
    activated_at: null,
    blocked_reason: "PERSISTED_READBACK_MISMATCH",
  })
})

test("QEO-129 blocks rollout when persisted OHLCV differs despite matching run and lineage", async () => {
  const fake = fakeSupabase({ badReadbackCloseSession: "2026-08-05" })
  const result = await rebuildAdjustedDailyRange({
    supabase: fake.client as never,
    ticker: "VHM",
    fromDate: "2026-08-04",
    toDate: "2026-08-05",
    expectedFactorRunId: RUN_ID,
    expectedLineageHash: LINEAGE,
  })

  assert.equal(result.rebuiltSessions, 1)
  assert.deepEqual(result.unresolvedSessions, ["2026-08-05"])

  const rolloutCall = fake.calls.find((call) => call.kind === "upsert:rollout")
  assert.ok(rolloutCall)
  const rollout = rolloutCall.value as Record<string, unknown>
  assert.equal(rollout.status, "blocked")
  assert.equal(rollout.blocked_reason, "PERSISTED_READBACK_MISMATCH")
})

test("QEO-129 persists shadow rollout only after complete exact readback", async () => {
  const fake = fakeSupabase()
  const result = await rebuildAdjustedDailyRange({
    supabase: fake.client as never,
    ticker: "VHM",
    fromDate: "2026-08-04",
    toDate: "2026-08-05",
    expectedFactorRunId: RUN_ID,
    expectedLineageHash: LINEAGE,
  })

  assert.equal(result.rebuiltSessions, 2)
  assert.deepEqual(result.unresolvedSessions, [])
  assert.equal(fake.adjustedPayload.length, 2)
  assert.equal(fake.adjustedPayload[0]?.close, 52.5)
  assert.equal(fake.adjustedPayload[0]?.volume, 2_000)

  const rolloutCall = fake.calls.find((call) => call.kind === "upsert:rollout")
  assert.ok(rolloutCall)
  const rollout = rolloutCall.value as Record<string, unknown>
  assert.equal(rollout.status, "shadow")
  assert.equal(rollout.factor_run_id, RUN_ID)
  assert.equal(rollout.event_lineage_hash, LINEAGE)
  assert.equal(rollout.verified_from, "2026-08-04")
  assert.equal(rollout.verified_through, "2026-08-05")
  assert.equal(rollout.activated_at, null)
  assert.equal(rollout.blocked_reason, null)
  assert.equal(typeof rollout.verified_at, "string")
})

test("QEO-129 refuses adjusted or unknown persisted Daily provenance before any adjusted write", async () => {
  const invalidSources = [
    {
      rawProvider: "Fallback",
      rawProviderDetail: "Yahoo Finance .VN | adjusted OHLC via adjclose/close | source basis: adjusted",
    },
    {
      rawProvider: "TitanLabs",
      rawProviderDetail: "legacy history",
    },
    {
      rawProvider: "VCI",
      rawProviderDetail: "VCI native ONE_DAY · 620d window",
    },
    {
      rawProvider: "DNSE",
      rawProviderDetail: "DNSE direct Daily OHLCV",
    },
  ]

  for (const source of invalidSources) {
    const fake = fakeSupabase(source)
    await assert.rejects(
      rebuildAdjustedDailyRange({
        supabase: fake.client as never,
        ticker: "VHM",
        fromDate: "2026-08-04",
        toDate: "2026-08-05",
        expectedFactorRunId: RUN_ID,
        expectedLineageHash: LINEAGE,
      }),
      /raw price basis/i,
    )
    assert.equal(fake.calls.some((call) => call.kind === "upsert:adjusted"), false)
    assert.equal(fake.calls.some((call) => call.kind === "upsert:rollout"), false)
  }
})

test("QEO-129 fails closed before persistence for blocked/superseded or wrong-lineage runs", async () => {
  for (const runStatus of ["blocked", "superseded"] as const) {
    const fake = fakeSupabase({ runStatus })
    await assert.rejects(
      rebuildAdjustedDailyRange({
        supabase: fake.client as never,
        ticker: "VHM",
        fromDate: "2026-08-04",
        toDate: "2026-08-05",
        expectedFactorRunId: RUN_ID,
        expectedLineageHash: LINEAGE,
      }),
      /factor run/i,
    )
    assert.equal(fake.calls.some((call) => call.kind === "upsert:adjusted"), false)
  }

  const wrongLineage = fakeSupabase({ runLineage: "b".repeat(64) })
  await assert.rejects(
    rebuildAdjustedDailyRange({
      supabase: wrongLineage.client as never,
      ticker: "VHM",
      fromDate: "2026-08-04",
      toDate: "2026-08-05",
      expectedFactorRunId: RUN_ID,
      expectedLineageHash: LINEAGE,
    }),
    /lineage/i,
  )
  assert.equal(wrongLineage.calls.some((call) => call.kind === "upsert:adjusted"), false)
})
