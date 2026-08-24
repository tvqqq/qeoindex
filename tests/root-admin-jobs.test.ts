import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  ALLOWLISTED_MANUAL_JOB_KEYS,
  getManualJobCapabilities,
  isManualJobAllowed,
} from "../lib/admin/jobs.ts"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("only the 4 allowlisted jobs are manual-safe", () => {
  assert.deepEqual([...ALLOWLISTED_MANUAL_JOB_KEYS].sort(), [
    "market.sync_universe",
    "scanner.run",
    "signals.monitor",
    "wyckoff.ingest",
  ])

  assert.equal(isManualJobAllowed("market.sync_universe"), true)
  assert.equal(isManualJobAllowed("scanner.run"), true)
  assert.equal(isManualJobAllowed("signals.monitor"), true)
  assert.equal(isManualJobAllowed("wyckoff.ingest"), true)

  assert.equal(isManualJobAllowed("ai_council.daily"), false)
  assert.equal(isManualJobAllowed("ai_council.debate_daily"), false)
  assert.equal(isManualJobAllowed("signals.daily"), false)
  assert.equal(isManualJobAllowed("arbitrary.job"), false)
})

test("getManualJobCapabilities returns metadata for the 4 manual-safe jobs", () => {
  const capabilities = getManualJobCapabilities()
  assert.equal(capabilities.length, 4)
  const keys = capabilities.map((c) => c.key).sort()
  assert.deepEqual(keys, [
    "market.sync_universe",
    "scanner.run",
    "signals.monitor",
    "wyckoff.ingest",
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
    key: "scanner.run",
    actorUserId: "00000000-0000-4000-8000-000000000001",
    reason: "short",
    requestId: "req-2",
  })

  assert.equal(result.ok, false)
  assert.match(result.error || "", /8 đến 240 ký tự/)
})

test("AI Council daily and debate routes hard-stop on stale EOD upstream evidence", () => {
  const daily = source("app/api/ai-council/daily/route.ts")
  const debate = source("app/api/ai-council/debate-daily/route.ts")

  assert.match(daily, /assertAiCouncilEodFreshness/)
  assert.match(daily, /UPSTREAM_STALE/)
  assert.match(debate, /assertAiCouncilEodFreshness/)
  assert.match(debate, /UPSTREAM_STALE/)

  const dailyGuard = daily.indexOf("assertAiCouncilEodFreshness")
  const dailyPersist = daily.indexOf("persistAiCouncilData")
  assert.ok(dailyGuard >= 0 && dailyGuard < dailyPersist, "daily freshness gate must run before persistence")

  const debateGuard = debate.indexOf("assertAiCouncilEodFreshness")
  const debateEnrichment = debate.indexOf("enrichCouncilStocksForDebate")
  assert.ok(debateGuard >= 0 && debateGuard < debateEnrichment, "debate freshness gate must run before evidence freeze or OpenAI work")
})
