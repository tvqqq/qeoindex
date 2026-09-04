import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  ADMIN_ENVIRONMENT_INVENTORY,
  ADMIN_JOB_CATALOG,
  ADMIN_SETTING_CATALOG,
  validateAdminSetting,
} from "../modules/admin/catalog.ts"
import { EFFECTIVE_ADMIN_JOB_CATALOG } from "../modules/admin/effective-job-catalog.ts"
import { sanitizeAdminValue } from "../modules/admin/redact.ts"
import { validateAdminMutationRequest, validateChangeReason } from "../modules/admin/request-security.ts"

test("runtime setting keys are unique and validate their documented bounds", () => {
  const keys = ADMIN_SETTING_CATALOG.map((entry) => entry.key)
  assert.equal(new Set(keys).size, keys.length)

  // admin.refresh_interval_seconds
  assert.equal(validateAdminSetting("admin.refresh_interval_seconds", 15).ok, true)
  assert.equal(validateAdminSetting("admin.refresh_interval_seconds", 300).ok, true)
  assert.equal(validateAdminSetting("admin.refresh_interval_seconds", 14).ok, false)
  assert.equal(validateAdminSetting("admin.refresh_interval_seconds", 301).ok, false)
  assert.equal(validateAdminSetting("admin.refresh_interval_seconds", "30").ok, true)

  // admin.job_history_limit
  assert.equal(validateAdminSetting("admin.job_history_limit", 20).ok, true)
  assert.equal(validateAdminSetting("admin.job_history_limit", 200).ok, true)
  assert.equal(validateAdminSetting("admin.job_history_limit", 19).ok, false)
  assert.equal(validateAdminSetting("admin.job_history_limit", 201).ok, false)

  // scanner.manual_run_limit
  assert.equal(validateAdminSetting("scanner.manual_run_limit", 1).ok, true)
  assert.equal(validateAdminSetting("scanner.manual_run_limit", 200).ok, true)
  assert.equal(validateAdminSetting("scanner.manual_run_limit", 0).ok, false)
  assert.equal(validateAdminSetting("scanner.manual_run_limit", 201).ok, false)

  // ai_council.llm_enabled
  assert.deepEqual(validateAdminSetting("ai_council.llm_enabled", true), { ok: true, value: true })
  assert.deepEqual(validateAdminSetting("ai_council.llm_enabled", false), { ok: true, value: false })
  assert.deepEqual(validateAdminSetting("ai_council.llm_enabled", "true"), { ok: true, value: true })
  assert.deepEqual(validateAdminSetting("ai_council.llm_enabled", "false"), { ok: true, value: false })
  assert.equal(validateAdminSetting("ai_council.llm_enabled", "maybe").ok, false)

  // ai_council.llm_max_tickers
  assert.equal(validateAdminSetting("ai_council.llm_max_tickers", 6).ok, true)
  assert.equal(validateAdminSetting("ai_council.llm_max_tickers", 7).ok, false)
  assert.equal(validateAdminSetting("ai_council.llm_max_tickers", 0).ok, false)

  // ai_council.llm_tickers
  assert.deepEqual(validateAdminSetting("ai_council.llm_tickers", " fpt,MSN,fpt "), {
    ok: true,
    value: ["FPT", "MSN"],
  })
  assert.deepEqual(validateAdminSetting("ai_council.llm_tickers", ["VIC", "vnm"]), {
    ok: true,
    value: ["VIC", "VNM"],
  })

  // ai_council.research_tickers
  assert.deepEqual(validateAdminSetting("ai_council.research_tickers", "MSN, HPG"), {
    ok: true,
    value: ["MSN", "HPG"],
  })

  // Non-editable setting cannot be validated
  const readOnlyDef = ADMIN_SETTING_CATALOG.find((s) => !s.editable)
  assert.ok(readOnlyDef)
  assert.equal(validateAdminSetting(readOnlyDef.key, 123).ok, false)
})

test("setting definitions have required metadata and valid groups", () => {
  const editableKeys = ADMIN_SETTING_CATALOG.filter((s) => s.editable).map((s) => s.key)
  assert.deepEqual(editableKeys.sort(), [
    "admin.job_history_limit",
    "admin.refresh_interval_seconds",
    "ai_council.llm_enabled",
    "ai_council.llm_max_tickers",
    "ai_council.llm_tickers",
    "ai_council.research_tickers",
    "scanner.manual_run_limit",
  ].sort())

  for (const setting of ADMIN_SETTING_CATALOG) {
    assert.ok(setting.key.length > 0)
    assert.ok(setting.label.length > 0)
    assert.ok(setting.description.length > 0)
    assert.ok(["system", "provider", "cache", "market", "scanner", "signals", "wyckoff", "ai_council", "ui", "integration"].includes(setting.group))
  }
})

test("Top Stocks 200 admin contracts stay aligned with the canonical runtime", () => {
  const universeSize = ADMIN_SETTING_CATALOG.find((setting) => setting.key === "market.universe_size")
  assert.ok(universeSize)
  assert.equal(universeSize.defaultValue, 200)
  assert.doesNotMatch(universeSize.description, /Top\s*100/i)

  const requiredSnapshots = ADMIN_SETTING_CATALOG.find((setting) => setting.key === "wyckoff.required_snapshots")
  assert.ok(requiredSnapshots)
  assert.equal(requiredSnapshots.defaultValue, 1_000)
  assert.match(requiredSnapshots.description, /5 timeframe/)

  const marketSync = EFFECTIVE_ADMIN_JOB_CATALOG.find((job) => job.key === "market.sync_universe")
  assert.ok(marketSync)
  assert.match(marketSync.description, /canonical/i)
  assert.doesNotMatch(marketSync.description, /Top\s*100/i)

  const scanner = EFFECTIVE_ADMIN_JOB_CATALOG.find((job) => job.key === "scanner.run")
  assert.ok(scanner)
  assert.equal(scanner.manualPurpose, "recovery")
  assert.deepEqual(scanner.automatedParentKeys, ["signals.daily"])

  const signalMonitor = EFFECTIVE_ADMIN_JOB_CATALOG.find((job) => job.key === "signals.monitor")
  assert.ok(signalMonitor)
  assert.equal(signalMonitor.manualPurpose, "recovery")
  assert.deepEqual(signalMonitor.automatedParentKeys, ["signals.daily"])

  assert.equal(marketSync.manualPurpose, "recovery")
  assert.deepEqual(marketSync.automatedParentKeys, ["market.sync_5m", "market.sync_eod"])

  const ingest = EFFECTIVE_ADMIN_JOB_CATALOG.find((job) => job.key === "wyckoff.ingest")
  assert.ok(ingest)
  assert.equal(ingest.scheduleKind, "manual")
  assert.equal(ingest.manualPolicy, "confirm")
  assert.equal(ingest.manualPurpose, "maintenance")
})

test("QEO-63 EOD v4 Admin catalog mirrors runtime dependency ownership without Drive", () => {
  const eod = EFFECTIVE_ADMIN_JOB_CATALOG.find((job) => job.key === "qeoindex.eod_pipeline")
  assert.ok(eod)
  assert.equal(eod.dependencies?.includes("DRIVE_ARCHIVE"), false)
  assert.deepEqual(eod.dependencies, [
    "KFSP_RATING_REFRESH",
    "TTAI_REFRESH",
    "MARKET_CLOSE_COLLECT",
    "EOD_READY",
    "HISTORY_REFRESH",
    "WYCKOFF_BUILD",
    "SUPABASE_VALIDATE",
    "SUPABASE_PUBLISH",
    "AI_COUNCIL_DETERMINISTIC",
    "MARKET_SYNTHESIS",
    "AI_COUNCIL_LLM",
    "RETENTION_CLEANUP",
    "NOTION_ARCHIVE",
    "COMPLETE",
  ])
})

test("job catalog has all documented jobs with concrete thresholds", () => {
  const jobKeys = ADMIN_JOB_CATALOG.map((j) => j.key)
  assert.equal(new Set(jobKeys).size, jobKeys.length)

  const expectedKeys = [
    "signals.daily",
    "wyckoff.ingest",
    "ai_council.daily",
    "ai_council.debate_daily",
    "market.sync_5m",
    "market.sync_eod",
    "kfsp.rating_daily",
    "kfsp.ttai_history",
    "scanner.run",
    "signals.monitor",
    "market.sync_universe",
    "market.cache_invalidate",
    "wyckoff.run",
  ]
  for (const key of expectedKeys) {
    const job = ADMIN_JOB_CATALOG.find((j) => j.key === key)
    assert.ok(job, `Job ${key} must exist in job catalog`)
    assert.ok(job.freshnessMinutes > 0)
    assert.ok(job.maxDurationMinutes > 0)
  }
})

test("environment inventory covers .env.example plus application runtime keys", () => {
  const envExample = readFileSync(new URL("../.env.example", import.meta.url), "utf8")
  const envKeysFromExample = envExample
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split("=")[0].trim())

  const inventoryKeys = new Set(ADMIN_ENVIRONMENT_INVENTORY.map((item) => item.key))

  for (const key of envKeysFromExample) {
    assert.ok(inventoryKeys.has(key), `Missing ${key} in ADMIN_ENVIRONMENT_INVENTORY`)
  }

  const additionalKeys = [
    "NOTION_TOKEN",
    "SUPABASE_URL",
    "APP_URL",
    "NEXT_PUBLIC_APP_URL",
    "ROOT_ADMIN_USER_IDS",
    "QSTASH_TOKEN",
    "NODE_ENV",
    "VERCEL_ENV",
    "VERCEL_URL",
    "VERCEL_PROJECT_PRODUCTION_URL",
    "VERCEL_GIT_COMMIT_SHA",
    "VERCEL_GIT_PREVIOUS_SHA",
    "NEXT_PUBLIC_GIT_COMMIT_SHA",
    "NEXT_PUBLIC_GIT_COMMIT_DATE",
    "NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA",
  ]

  for (const key of additionalKeys) {
    assert.ok(inventoryKeys.has(key), `Missing additional key ${key} in ADMIN_ENVIRONMENT_INVENTORY`)
  }

  // Verify secret sensitivity
  for (const item of ADMIN_ENVIRONMENT_INVENTORY) {
    if (!item.key.startsWith("NEXT_PUBLIC_") && (/secret|token|password|root_admin/i.test(item.key) || (/key/i.test(item.key) && !/url|id/i.test(item.key)))) {
      assert.equal(item.sensitivity, "secret", `${item.key} must be marked secret`)
    }
  }
})

test("sanitizer removes secret-shaped fields and bounds nested output", () => {
  const value = sanitizeAdminValue({
    authorization: "Bearer abc",
    token: "abc",
    ok: true,
    nested: { cookie: "x", password: "123", apiKey: "xyz", service_role_key: "srk" },
  })
  assert.deepEqual(value, {
    authorization: "[REDACTED]",
    token: "[REDACTED]",
    ok: true,
    nested: {
      cookie: "[REDACTED]",
      password: "[REDACTED]",
      apiKey: "[REDACTED]",
      service_role_key: "[REDACTED]",
    },
  })

  // Error conversion without stack
  const err = new Error("Something broke")
  const sanitizedErr = sanitizeAdminValue(err)
  assert.deepEqual(sanitizedErr, { name: "Error", message: "Something broke" })
})

test("mutation request validation enforces same-origin and change reason", () => {
  assert.equal(validateChangeReason("Short"), null)
  assert.equal(validateChangeReason("   Valid reason for test   "), "Valid reason for test")
  assert.equal(validateChangeReason("x".repeat(241)), null)

  const allowedReq = new Request("https://qeoindex.qeoqeo.com/api/admin/settings/foo", {
    method: "PATCH",
    headers: { origin: "https://qeoindex.qeoqeo.com" },
  })
  assert.deepEqual(validateAdminMutationRequest(allowedReq, { appUrl: "https://qeoindex.qeoqeo.com" }), { ok: true })

  const badOriginReq = new Request("https://qeoindex.qeoqeo.com/api/admin/settings/foo", {
    method: "PATCH",
    headers: { origin: "https://evil.com" },
  })
  const badRes = validateAdminMutationRequest(badOriginReq, { appUrl: "https://qeoindex.qeoqeo.com" })
  assert.equal(badRes.ok, false)
  assert.equal(badRes.status, 403)
})
