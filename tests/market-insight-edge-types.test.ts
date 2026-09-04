import test from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { resolve } from "node:path"

import { assertCanonicalWyckoffMembership } from "../lib/wyckoff-canonical-membership.ts"
import type {
  NormalizedIndexRow,
  NormalizedLeaderRow,
} from "../supabase/functions/_shared/market-close-normalizer.ts"

import {
  deriveRiskLabel,
  deriveSentimentLabel,
} from "../supabase/functions/_shared/market-close-normalizer.ts"

function source(path: string) {
  return readFileSync(path, "utf8")
}

test("market-close edge types: deriveRiskLabel matches verified DOM scale", () => {
  assert.equal(deriveRiskLabel(0.25), "Thấp")
  assert.equal(deriveRiskLabel(0.63), "Trung tính")
  assert.equal(deriveRiskLabel(0.75), "Cao")
  assert.equal(deriveRiskLabel(null), null)
})

test("market-close edge types: deriveSentimentLabel matches KFSP psychology labels", () => {
  assert.equal(deriveSentimentLabel(80), "Tham lam tột độ")
  assert.equal(deriveSentimentLabel(60), "Tham lam")
  assert.equal(deriveSentimentLabel(40), "Trung lập")
  assert.equal(deriveSentimentLabel(20), "Sợ hãi")
  assert.equal(deriveSentimentLabel(10), "Sợ hãi tột độ")
  assert.equal(deriveSentimentLabel(null), null)
})

test("market-close edge types: structural interface completeness", () => {
  const dummyIndex: NormalizedIndexRow = {
    session_date: "2026-08-26",
    index_code: "VNINDEX",
    value: 1284.55,
    change: 11.25,
    change_pct: 0.88,
    reference: 1273.30,
    open: 1276.10,
    high: 1286.20,
    low: 1275.40,
    matched_volume: 780450000,
    traded_value: 19850.4,
    previous_value_change_pct: 12.5,
    advances: 274,
    unchanged: 68,
    declines: 122,
    ceilings: 9,
    floors: 1,
    market_pe: 14.35,
    foreign_buy_value: 1350.2,
    foreign_sell_value: 1495.4,
    foreign_net_value: -145.2,
    quality_status: "healthy",
    missing_fields: [],
    evidence_refs: [{ field: "value", source_class: "canonical_market_feed", observed_at: "2026-08-26T08:15:00.000Z" }],
    source_timestamp: "2026-08-26T08:15:00.000Z",
    as_of: "2026-08-26T08:15:00.000Z",
  }

  assert.equal(dummyIndex.foreign_net_value, -145.2)
  assert.equal(dummyIndex.foreign_buy_value, 1350.2)
  assert.equal(dummyIndex.foreign_sell_value, 1495.4)

  const dummyLeader: NormalizedLeaderRow = {
    session_date: "2026-08-26",
    category: "top_volume",
    rank: 1,
    ticker: "SSI",
    price: 36.8,
    change_pct: 3.37,
    estimated_index_points: 0.85,
    metric_value: 36500000,
    metric_label: "36.5M CP",
    quality_status: "healthy",
    missing_fields: [],
    evidence_refs: [{ field: "total_volume", source_class: "market_leaders", observed_at: "2026-08-26T08:15:00.000Z" }],
    source_timestamp: null,
    as_of: "2026-08-26T08:15:00.000Z",
  }

  assert.equal(dummyLeader.estimated_index_points, 0.85)
})

test("direct market snapshot writer fails closed on Vietnam securities holidays", () => {
  const marketSession = source("supabase/functions/market-session/index.ts")
  assert.match(marketSession, /_shared\/vn-market-calendar\.ts/)
  assert.match(marketSession, /isVietnamSecuritiesTradingDateKey/)
  assert.match(marketSession, /NON_TRADING_DAY/)
})

test("market-session writer requires machine auth before service-role access", () => {
  const helperPath = resolve("supabase/functions/_shared/machine-auth.ts")
  assert.equal(existsSync(helperPath), true, "expected shared Edge machine-auth helper")

  const marketSession = source("supabase/functions/market-session/index.ts")
  assert.match(marketSession, /MARKET_SYNC_SECRET/)
  assert.match(marketSession, /CRON_SECRET/)
  assert.match(marketSession, /isMachineRequestAuthorized/)
  assert.match(marketSession, /status:\s*401/)

  const postGate = marketSession.indexOf('if (req.method === "POST")')
  const authGate = marketSession.indexOf("await isMachineRequestAuthorized(")
  const serviceClient = marketSession.indexOf("createClient(")
  assert.ok(postGate >= 0 && authGate > postGate, "POST auth must be scoped to writer path")
  assert.ok(serviceClient > authGate, "auth must run before service-role client construction")
})

test("shared Edge machine auth accepts only exact configured bearer tokens", async () => {
  const helperPath = resolve("supabase/functions/_shared/machine-auth.ts")
  const { isMachineRequestAuthorized } = await import(pathToFileURL(helperPath).href)
  const tokens = ["alpha", "beta"]

  assert.equal(await isMachineRequestAuthorized(new Request("https://example.test", {
    headers: { authorization: "Bearer alpha" },
  }), tokens), true)
  assert.equal(await isMachineRequestAuthorized(new Request("https://example.test", {
    headers: { authorization: "Bearer beta" },
  }), tokens), true)
  assert.equal(await isMachineRequestAuthorized(new Request("https://example.test", {
    headers: { authorization: "Bearer gamma" },
  }), tokens), false)
  assert.equal(await isMachineRequestAuthorized(new Request("https://example.test"), tokens), false)
  assert.equal(await isMachineRequestAuthorized(new Request("https://example.test", {
    headers: { authorization: "Basic alpha" },
  }), tokens), false)
  assert.equal(await isMachineRequestAuthorized(new Request("https://example.test", {
    headers: { authorization: "Bearer alpha" },
  }), []), false)
})

test("QEO-19 canonical Wyckoff membership requires exact ticker and rank parity", () => {
  const canonical = [
    { ticker: "AAA", rank: 1 },
    { ticker: "BBB", rank: 2 },
  ]
  assert.doesNotThrow(() => assertCanonicalWyckoffMembership(canonical, [
    { ticker: "bbb", rank: 2 },
    { ticker: "aaa", rank: 1 },
  ]))
  assert.throws(() => assertCanonicalWyckoffMembership(canonical, [
    { ticker: "AAA", rank: 2 },
    { ticker: "BBB", rank: 1 },
  ]), /rankMismatch/i)
  assert.throws(() => assertCanonicalWyckoffMembership(canonical, [
    { ticker: "AAA", rank: 1 },
  ]), /Canonical Wyckoff membership mismatch/)
})

test("QEO-19 active Wyckoff runtime has no legacy membership-table consumer", () => {
  for (const path of [
    "lib/wyckoff-unified-data.ts",
    "lib/wyckoff-unified-runner.ts",
    "lib/wyckoff-supabase-publish.ts",
    "lib/wyckoff-notion-ingest.ts",
  ]) {
    assert.doesNotMatch(source(path), /wyckoff_universe_memberships/, `${path} still consumes legacy Wyckoff memberships`)
  }
})

test("QEO-19 active KFSP runtime has no provider-token table consumer", () => {
  for (const path of [
    "supabase/functions/kfsp-rating-sync/index.ts",
    "supabase/functions/kfsp-ttai-history-sync/index.ts",
    "supabase/functions/market-insight-eod-sync/index.ts",
  ]) {
    assert.doesNotMatch(source(path), /kfsp_provider_tokens/, `${path} still consumes the legacy KFSP token table`)
  }
})

test("QEO-19 KFSP auth uses shared Vault token cache with service-role-only RPCs", () => {
  const helperPath = "supabase/functions/_shared/kfsp-provider-auth.ts"
  const migrationPath = "supabase/migrations/20260902052909_kfsp_vault_token_cache.sql"
  assert.equal(existsSync(helperPath), true, "shared KFSP provider auth helper must exist")
  assert.equal(existsSync(migrationPath), true, "Vault token-cache compatibility migration must exist")
  if (!existsSync(helperPath) || !existsSync(migrationPath)) return

  const helper = source(helperPath)
  const migration = source(migrationPath)
  assert.match(helper, /qeo_get_kfsp_provider_token_cache/)
  assert.match(helper, /qeo_set_kfsp_provider_token_cache/)
  assert.match(helper, /qeo_get_kfsp_credentials/)
  assert.doesNotMatch(helper, /kfsp_provider_tokens/)
  assert.match(migration, /vault\.decrypted_secrets/i)
  assert.match(migration, /vault\.create_secret/i)
  assert.match(migration, /vault\.update_secret/i)
  assert.match(migration, /grant execute on function public\.qeo_get_kfsp_provider_token_cache\(\) to service_role/i)
  assert.match(migration, /grant execute on function public\.qeo_set_kfsp_provider_token_cache\(text, timestamptz\) to service_role/i)
  assert.match(migration, /from public\.kfsp_provider_tokens/i)
  assert.doesNotMatch(migration, /raise\s+(notice|log|info|warning).*access_token/i)
})

test("QEO-19 physical KFSP token-table cleanup is minimal and preserves Vault RPCs", () => {
  const migrationPath = "supabase/migrations/20260902061819_drop_kfsp_provider_tokens.sql"
  assert.equal(existsSync(migrationPath), true, "KFSP legacy token-table drop migration must exist")
  if (!existsSync(migrationPath)) return

  const migration = source(migrationPath)
  assert.match(migration, /drop\s+table\s+if\s+exists\s+public\.kfsp_provider_tokens/i)
  assert.doesNotMatch(migration, /cascade/i)
  assert.doesNotMatch(migration, /drop\s+function[\s\S]*qeo_(get|set)_kfsp_provider_token_cache/i)
})

test("QEO-19 Wyckoff legacy-table cleanup is promoted after EOD v4 production acceptance", () => {
  const migrationPath = "supabase/migrations/20260903231253_drop_legacy_wyckoff_universe_memberships.sql"
  assert.equal(existsSync(migrationPath), true, "Wyckoff legacy membership DROP must be recorded in active migration history")
  assert.equal(
    existsSync("supabase/pending-migrations/20260902133000_drop_legacy_wyckoff_universe_memberships.sql"),
    false,
    "production-applied Wyckoff legacy membership DROP must leave quarantine",
  )
  if (!existsSync(migrationPath)) return

  const migration = source(migrationPath)
  assert.match(migration, /drop\s+table\s+if\s+exists\s+public\.wyckoff_universe_memberships/i)
  assert.doesNotMatch(migration, /cascade/i)
})
