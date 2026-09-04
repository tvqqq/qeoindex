import assert from "node:assert/strict"
import test from "node:test"

import { ADMIN_SETTING_CATALOG } from "../modules/admin/catalog.ts"
import { resolveAdminSettings } from "../modules/admin/settings.ts"

test("runtime overrides beat environment and defaults", () => {
  const snapshot = resolveAdminSettings(ADMIN_SETTING_CATALOG, [
    { key: "ai_council.llm_max_tickers", value: 5, version: 2, updated_at: "2026-08-24T00:00:00Z" },
    { key: "admin.refresh_interval_seconds", value: 45, version: 1, updated_at: "2026-08-24T00:00:00Z" },
  ], { AI_COUNCIL_LLM_MAX_TICKERS: "4" })

  assert.equal(snapshot.degraded, false)
  assert.equal(snapshot.byKey["ai_council.llm_max_tickers"].value, 5)
  assert.equal(snapshot.byKey["ai_council.llm_max_tickers"].resolvedFrom, "runtime")
  assert.equal(snapshot.byKey["ai_council.llm_max_tickers"].hasOverride, true)
  assert.equal(snapshot.byKey["ai_council.llm_max_tickers"].version, 2)

  assert.equal(snapshot.byKey["admin.refresh_interval_seconds"].value, 45)
  assert.equal(snapshot.byKey["admin.refresh_interval_seconds"].resolvedFrom, "runtime")
})

test("environment values beat code defaults when runtime override is absent", () => {
  const snapshot = resolveAdminSettings(ADMIN_SETTING_CATALOG, [], {
    AI_COUNCIL_LLM_MAX_TICKERS: "4",
    AI_COUNCIL_LLM_ENABLED: "false",
    AI_COUNCIL_RESEARCH_TICKERS: "VNM,HPG",
  })

  assert.equal(snapshot.byKey["ai_council.llm_max_tickers"].value, 4)
  assert.equal(snapshot.byKey["ai_council.llm_max_tickers"].resolvedFrom, "environment")
  assert.equal(snapshot.byKey["ai_council.llm_max_tickers"].hasOverride, false)

  assert.equal(snapshot.byKey["ai_council.llm_enabled"].value, false)
  assert.equal(snapshot.byKey["ai_council.llm_enabled"].resolvedFrom, "environment")

  assert.deepEqual(snapshot.byKey["ai_council.research_tickers"].value, ["VNM", "HPG"])
  assert.equal(snapshot.byKey["ai_council.research_tickers"].resolvedFrom, "environment")

  // admin.refresh_interval_seconds has no envKey, falls back to code default 30
  assert.equal(snapshot.byKey["admin.refresh_interval_seconds"].value, 30)
  assert.equal(snapshot.byKey["admin.refresh_interval_seconds"].resolvedFrom, "code")
})

test("invalid persisted values degrade and fall back", () => {
  const snapshot = resolveAdminSettings(ADMIN_SETTING_CATALOG, [
    { key: "ai_council.llm_max_tickers", value: 99, version: 1, updated_at: "2026-08-24T00:00:00Z" },
  ], { AI_COUNCIL_LLM_MAX_TICKERS: "4" })

  assert.equal(snapshot.degraded, true)
  assert.equal(snapshot.byKey["ai_council.llm_max_tickers"].value, 4)
  assert.equal(snapshot.byKey["ai_council.llm_max_tickers"].resolvedFrom, "environment")
  assert.equal(snapshot.byKey["ai_council.llm_max_tickers"].hasOverride, false)
})

test("read-only settings always resolve from code/env without override", () => {
  const snapshot = resolveAdminSettings(ADMIN_SETTING_CATALOG, [
    { key: "market.universe_size", value: 50, version: 1, updated_at: "2026-08-24T00:00:00Z" },
  ], {})

  assert.equal(snapshot.byKey["market.universe_size"].value, 200)
  assert.equal(snapshot.byKey["market.universe_size"].resolvedFrom, "code")
  assert.equal(snapshot.byKey["market.universe_size"].editable, false)
})