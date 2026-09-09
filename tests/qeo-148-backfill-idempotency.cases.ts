import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

const ingestionUrl = new URL("../modules/market/chart-data/provider-ingestion.ts", import.meta.url)
const migrationUrl = new URL("../supabase/pending-migrations/20260909160500_qeo148_closed_range_coordination.sql", import.meta.url)

test("QEO-148 reuses a durable closed-range success for 100 ordinary replays", async () => {
  assert.equal(existsSync(ingestionUrl), true, "shared QEO-148 ingestion coordinator must exist")
  const { runClosedRangeIngestion } = await import("../modules/market/chart-data/provider-ingestion.ts")

  let completed = false
  let claimed = false
  let fence = 0
  let providerCalls = 0
  let writes = 0
  let provenanceInserts = 0

  const deps = {
    async claim() {
      if (completed) return { status: "covered" as const }
      if (claimed) return { status: "busy" as const }
      claimed = true
      fence += 1
      return {
        status: "claimed" as const,
        rangeId: "range-1",
        leaseOwner: "owner-1",
        fence,
        previousContentId: null,
        previousProvenanceBatchId: null,
      }
    },
    async complete() {
      completed = true
      claimed = false
      return { status: "completed" as const }
    },
    async abandon() {
      claimed = false
    },
    async wait() {},
  }

  const work = async () => {
    providerCalls += 1
    writes += 1
    provenanceInserts += 1
    return {
      value: "persisted",
      completion: {
        provider: "VCI",
        rowCount: 278,
        provenanceBatchId: "batch-1",
        contentId: "a".repeat(64),
      },
    }
  }

  const first = await runClosedRangeIngestion({
    ticker: "VIC",
    sourceKey: "PRIMARY_PROVIDER",
    from: 1_788_710_880,
    to: 1_788_727_500,
  }, deps, work)
  assert.equal(first.status, "completed")

  for (let index = 0; index < 100; index += 1) {
    const replay = await runClosedRangeIngestion({
      ticker: "VIC",
      sourceKey: "PRIMARY_PROVIDER",
      from: 1_788_710_880,
      to: 1_788_727_500,
    }, deps, work)
    assert.equal(replay.status, "reused")
  }

  assert.equal(providerCalls, 1)
  assert.equal(writes, 1)
  assert.equal(provenanceInserts, 1)
})

test("QEO-148 contention is bounded and failure never publishes success", async () => {
  assert.equal(existsSync(ingestionUrl), true, "shared QEO-148 ingestion coordinator must exist")
  const { runClosedRangeIngestion } = await import("../modules/market/chart-data/provider-ingestion.ts")

  let held = false
  let completed = false
  let fence = 0
  let workCalls = 0
  let abandonCalls = 0
  let waits = 0

  const deps = {
    async claim() {
      if (completed) return { status: "covered" as const }
      if (held) return { status: "busy" as const }
      held = true
      fence += 1
      return {
        status: "claimed" as const,
        rangeId: "range-1",
        leaseOwner: `owner-${fence}`,
        fence,
        previousContentId: null,
        previousProvenanceBatchId: null,
      }
    },
    async complete() {
      completed = true
      held = false
      return { status: "completed" as const }
    },
    async abandon() {
      abandonCalls += 1
      held = false
    },
    async wait() {
      waits += 1
    },
  }

  held = true
  const busy = await runClosedRangeIngestion({
    ticker: "VIC",
    sourceKey: "PRIMARY_PROVIDER",
    from: 100,
    to: 200,
    maxClaimAttempts: 3,
  }, deps, async () => {
    workCalls += 1
    throw new Error("must not run while another lease is active")
  })
  assert.equal(busy.status, "busy")
  assert.equal(workCalls, 0)
  assert.equal(waits, 2)

  held = false
  await assert.rejects(
    runClosedRangeIngestion({
      ticker: "VIC",
      sourceKey: "PRIMARY_PROVIDER",
      from: 100,
      to: 200,
    }, deps, async () => {
      workCalls += 1
      throw new Error("partial persistence")
    }),
    /partial persistence/,
  )
  assert.equal(completed, false)
  assert.equal(abandonCalls, 1)

  const recovered = await runClosedRangeIngestion({
    ticker: "VIC",
    sourceKey: "PRIMARY_PROVIDER",
    from: 100,
    to: 200,
  }, deps, async () => {
    workCalls += 1
    return {
      value: "recovered",
      completion: {
        provider: "VCI",
        rowCount: 2,
        provenanceBatchId: "batch-2",
        contentId: "b".repeat(64),
      },
    }
  })
  assert.equal(recovered.status, "completed")
  assert.equal(completed, true)
})

test("QEO-148 correction revalidation bypasses ordinary success reuse", async () => {
  assert.equal(existsSync(ingestionUrl), true, "shared QEO-148 ingestion coordinator must exist")
  const { runClosedRangeIngestion } = await import("../modules/market/chart-data/provider-ingestion.ts")

  let workCalls = 0
  let claimRevalidate: boolean | null = null
  const previousContentId = "c".repeat(64)
  const deps = {
    async claim(input: { revalidate: boolean }) {
      claimRevalidate = input.revalidate
      return {
        status: "claimed" as const,
        rangeId: "range-correction",
        leaseOwner: "owner-correction",
        fence: 9,
        previousContentId,
        previousProvenanceBatchId: "batch-old",
      }
    },
    async complete() {
      return { status: "completed" as const }
    },
    async abandon() {},
    async wait() {},
  }

  const result = await runClosedRangeIngestion({
    ticker: "VIC",
    sourceKey: "PRIMARY_PROVIDER",
    from: 100,
    to: 200,
    revalidate: true,
  }, deps, async (claim: { previousContentId: string | null }) => {
    workCalls += 1
    assert.equal(claim.previousContentId, previousContentId)
    return {
      value: "correction-checked",
      completion: {
        provider: "VCI",
        rowCount: 2,
        provenanceBatchId: "batch-new",
        contentId: "d".repeat(64),
      },
    }
  })

  assert.equal(result.status, "completed")
  assert.equal(workCalls, 1)
  assert.equal(claimRevalidate, true)
})

test("QEO-148 durable coverage and fencing are server-side and fail closed", () => {
  const hotStore = source("modules/market/chart-data/hot-store.ts")
  const service = source("modules/market/chart-data/service.ts")
  const bootstrap = source("modules/market/chart-data/bootstrap.ts")

  assert.equal(existsSync(migrationUrl), true, "QEO-148 coordination migration must be quarantined in pending-migrations")
  const migration = existsSync(migrationUrl) ? readFileSync(migrationUrl, "utf8") : ""

  assert.match(hotStore, /qeo_chart_intraday_success_coverage/)
  assert.match(hotStore, /qeo_claim_chart_intraday_range/)
  assert.match(hotStore, /qeo_complete_chart_intraday_range/)
  assert.match(hotStore, /qeo_abandon_chart_intraday_range/)
  assert.match(migration, /chart_ohlcv_backfill_ranges/i)
  assert.match(migration, /lease_fence/i)
  assert.match(migration, /lease_expires_at/i)
  assert.match(migration, /success_at/i)
  assert.match(migration, /qeo_chart_intraday_success_coverage/i)
  assert.match(migration, /qeo_claim_chart_intraday_range/i)
  assert.match(migration, /qeo_complete_chart_intraday_range/i)
  assert.match(migration, /qeo_abandon_chart_intraday_range/i)
  assert.match(migration, /lease_fence\s*=\s*p_lease_fence/i)
  assert.match(migration, /lease_expires_at\s*>\s*clock_timestamp\(\)/i)

  assert.match(service, /runClosedRangeIngestion/)
  assert.match(service, /closedProviderRanges/)
  assert.match(service, /liveTailRange/)
  assert.match(bootstrap, /runClosedRangeIngestion/)
})
