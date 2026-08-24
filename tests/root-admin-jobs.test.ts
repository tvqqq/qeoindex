import assert from "node:assert/strict"
import test from "node:test"

import {
  ALLOWLISTED_MANUAL_JOB_KEYS,
  getManualJobCapabilities,
  isManualJobAllowed,
} from "../lib/admin/jobs.ts"

test("only the 4 allowlisted jobs are manual-safe", () => {
  assert.deepEqual([...ALLOWLISTED_MANUAL_JOB_KEYS].sort(), [
    "market.intraday_5m",
    "market.sync_universe",
    "scanner.run",
    "signals.daily",
  ])

  assert.equal(isManualJobAllowed("market.sync_universe"), true)
  assert.equal(isManualJobAllowed("market.intraday_5m"), true)
  assert.equal(isManualJobAllowed("scanner.run"), true)
  assert.equal(isManualJobAllowed("signals.daily"), true)

  assert.equal(isManualJobAllowed("ai_council.daily"), false)
  assert.equal(isManualJobAllowed("ai_council.debate_daily"), false)
  assert.equal(isManualJobAllowed("wyckoff.ingest"), false)
  assert.equal(isManualJobAllowed("arbitrary.job"), false)
})

test("getManualJobCapabilities returns metadata for the 4 manual-safe jobs", () => {
  const capabilities = getManualJobCapabilities()
  assert.equal(capabilities.length, 4)
  const keys = capabilities.map((c) => c.key).sort()
  assert.deepEqual(keys, [
    "market.intraday_5m",
    "market.sync_universe",
    "scanner.run",
    "signals.daily",
  ])
})

test("dispatchManualAdminJob rejects un-allowlisted jobs with error", async () => {
  const { dispatchManualAdminJob } = await import("../lib/admin/jobs.ts")
  const result = await dispatchManualAdminJob({
    key: "ai_council.daily",
    actorUserId: "00000000-0000-4000-8000-000000000001",
    reason: "Thử nghiệm chạy job không được phép",
    requestId: "req-1",
  })

  assert.equal(result.ok, false)
  assert.match(result.error || "", /không cho phép chạy thủ công/)
})

test("dispatchManualAdminJob rejects short change reason", async () => {
  const { dispatchManualAdminJob } = await import("../lib/admin/jobs.ts")
  const result = await dispatchManualAdminJob({
    key: "market.intraday_5m",
    actorUserId: "00000000-0000-4000-8000-000000000001",
    reason: "short",
    requestId: "req-2",
  })

  assert.equal(result.ok, false)
  assert.match(result.error || "", /8 đến 240 ký tự/)
})

