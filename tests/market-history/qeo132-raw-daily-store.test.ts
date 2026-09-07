import assert from "node:assert/strict"
import test from "node:test"

import {
  buildRawDailyObservationPayload,
  persistRawDailyObservation,
  readCanonicalRawDaily,
} from "../../modules/market/history/raw-daily-store.ts"

const observation = {
  ticker: "vhm",
  sessionDate: "2026-08-05",
  open: 154.2,
  high: 158.8,
  low: 153,
  close: 153,
  volume: 10_681_100,
  provider: "StockBiz",
  providerDetail: "QEO-132 bounded VHM pilot",
  sourceUrl: "https://web.stockbiz.vn/Stocks/VHM/LookupQuote.aspx?Date=05%2F08%2F2026",
  sourcePriceUnit: "VND_THOUSANDS" as const,
  normalizationVersion: "stockbiz-raw-v1",
  fetchedAt: "2026-09-07T00:00:00Z",
}

test("QEO-132 builds deterministic explicit-RAW persistence payloads independent of fetch time", () => {
  const first = buildRawDailyObservationPayload(observation)
  const replay = buildRawDailyObservationPayload({ ...observation, fetchedAt: "2026-09-08T00:00:00Z" })

  assert.equal(first.ticker, "VHM")
  assert.equal(first.price_basis, "RAW")
  assert.equal(first.source_price_unit, "VND_THOUSANDS")
  assert.match(first.raw_evidence_hash, /^[a-f0-9]{64}$/)
  assert.equal(first.raw_evidence_hash, replay.raw_evidence_hash)
  assert.notEqual(first.fetched_at, replay.fetched_at)

  const corrected = buildRawDailyObservationPayload({ ...observation, close: 154 })
  assert.notEqual(first.raw_evidence_hash, corrected.raw_evidence_hash)
})

test("QEO-132 persists through service RPC and requires exact canonical RAW read-back", async () => {
  let rpcArgs: Record<string, unknown> | null = null
  const canonical = buildRawDailyObservationPayload(observation)
  const evidenceId = "11111111-1111-1111-1111-111111111111"
  const query = {
    select() { return this },
    eq() { return this },
    async maybeSingle() {
      return {
        data: {
          ticker: canonical.ticker,
          session_date: canonical.session_date,
          evidence_id: evidenceId,
          open: canonical.open,
          high: canonical.high,
          low: canonical.low,
          close: canonical.close,
          volume: canonical.volume,
          price_basis: "RAW",
          provider: canonical.provider,
          provider_detail: canonical.provider_detail,
          source_url: canonical.source_url,
          source_price_unit: canonical.source_price_unit,
          normalization_version: canonical.normalization_version,
          raw_evidence_hash: canonical.raw_evidence_hash,
        },
        error: null,
      }
    },
  }
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      assert.equal(name, "qeo_persist_raw_daily_observation")
      rpcArgs = args
      return { data: [{ evidence_id: evidenceId, canonical_selected: true }], error: null }
    },
    from(table: string) {
      assert.equal(table, "market_ohlcv_raw_daily")
      return query
    },
  }

  const result = await persistRawDailyObservation(client as never, observation, { selectCanonical: true })
  assert.deepEqual(result, { evidenceId, canonicalSelected: true })
  assert.notEqual(rpcArgs, null)
  const capturedArgs = rpcArgs as unknown as Record<string, unknown>
  assert.deepEqual(capturedArgs.p_observation, canonical)
  assert.equal(capturedArgs.p_select_canonical, true)
})

test("QEO-132 rejects persistence success when canonical read-back differs", async () => {
  const client = {
    async rpc() {
      return { data: [{ evidence_id: "11111111-1111-1111-1111-111111111111", canonical_selected: true }], error: null }
    },
    from(table: string) {
      assert.equal(table, "market_ohlcv_raw_daily")
      return {
        select() { return this },
        eq() { return this },
        async maybeSingle() {
          return {
            data: {
              ...buildRawDailyObservationPayload(observation),
              session_date: "2026-08-05",
              evidence_id: "11111111-1111-1111-1111-111111111111",
              price_basis: "RAW",
              close: 76.5,
            },
            error: null,
          }
        },
      }
    },
  }

  await assert.rejects(
    () => persistRawDailyObservation(client as never, observation, { selectCanonical: true }),
    /canonical raw Daily read-back mismatch/i,
  )
})

test("QEO-132 canonical raw loader reads only the dedicated raw table and preserves provenance", async () => {
  const seenTables: string[] = []
  const query = {
    select() { return this },
    eq() { return this },
    gte() { return this },
    lte() { return this },
    order: async () => ({
      data: [{
        ticker: "VHM",
        session_date: "2026-08-05",
        evidence_id: "11111111-1111-1111-1111-111111111111",
        open: 154.2,
        high: 158.8,
        low: 153,
        close: 153,
        volume: 10_681_100,
        price_basis: "RAW",
        provider: "StockBiz",
        provider_detail: "QEO-132 bounded VHM pilot",
        source_url: observation.sourceUrl,
        source_price_unit: "VND_THOUSANDS",
        normalization_version: "stockbiz-raw-v1",
        raw_evidence_hash: "a".repeat(64),
      }],
      error: null,
    }),
  }
  const client = {
    from(table: string) {
      seenTables.push(table)
      assert.equal(table, "market_ohlcv_raw_daily")
      return query
    },
  }

  const rows = await readCanonicalRawDaily(client as never, {
    ticker: "vhm",
    from: "2026-08-01",
    to: "2026-08-31",
  })
  assert.deepEqual(seenTables, ["market_ohlcv_raw_daily"])
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.ticker, "VHM")
  assert.equal(rows[0]?.sessionDate, "2026-08-05")
  assert.equal(rows[0]?.close, 153)
  assert.equal(rows[0]?.priceBasis, "RAW")
  assert.equal(rows[0]?.provider, "StockBiz")
  assert.equal(rows[0]?.evidenceId, "11111111-1111-1111-1111-111111111111")
})

test("QEO-132 sanitizes RPC/read failures and never falls back to legacy/provider tables", async () => {
  const rpcClient = {
    async rpc() {
      return { data: null, error: { message: "secret provider credential payload" } }
    },
  }
  await assert.rejects(
    () => persistRawDailyObservation(rpcClient as never, observation, { selectCanonical: true }),
    (error: unknown) => error instanceof Error
      && error.message === "Raw Daily persistence failed"
      && !error.message.includes("credential"),
  )

  const readClient = {
    from(table: string) {
      assert.equal(table, "market_ohlcv_raw_daily")
      return {
        select() { return this },
        eq() { return this },
        gte() { return this },
        lte() { return this },
        order: async () => ({ data: null, error: { message: "legacy fallback hint" } }),
      }
    },
  }
  await assert.rejects(
    () => readCanonicalRawDaily(readClient as never, { ticker: "VHM" }),
    (error: unknown) => error instanceof Error
      && error.message === "Canonical raw Daily read failed"
      && !error.message.includes("fallback"),
  )
})
