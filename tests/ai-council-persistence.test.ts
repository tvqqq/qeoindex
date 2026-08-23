import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("AI Council audit schema preserves immutable evidence revisions with authenticated read-only access", () => {
  const migration = source("supabase/migrations/20260823111530_ai_council_history.sql")

  for (const table of ["ai_council_runs", "ai_council_votes", "ai_council_outcomes"]) {
    assert.ok(migration.includes(`public.${table}`), `${table} should be part of the persistence contract`)
  }
  assert.match(migration, /unique \(ticker, as_of_date, policy_version, evidence_hash\)/)
  assert.match(migration, /evidence_hash ~ '\^\[0-9a-f\]\{64\}\$'/)
  assert.match(migration, /enable row level security/)
  assert.match(migration, /for select to authenticated using \(true\)/)
})

test("P3 adds point-in-time benchmark, structured confirmations, and calibrated agent statistics", () => {
  const schema = source("supabase/migrations/20260823113042_ai_council_learning_schema.sql")

  for (const table of ["ai_council_market_benchmarks", "ai_council_confirmations", "ai_council_agent_stats"]) {
    assert.ok(schema.includes(`public.${table}`), `${table} should be part of the P3 learning contract`)
  }
  assert.match(schema, /market_regime text not null default 'UNKNOWN'/)
  assert.match(schema, /weight_profile jsonb not null default '\{\}'::jsonb/)
  assert.match(schema, /calibration_version text not null default 'static-v1'/)
  assert.match(schema, /grant select on table public\.ai_council_agent_stats to authenticated/)
  assert.doesNotMatch(schema, /grant (?:insert|update|delete)[^;]*ai_council_agent_stats[^;]*to authenticated/i)
})

test("BUY_ON_CONFIRMATION is resolved by a forward state machine without rewriting the source run", () => {
  const migration = source("supabase/migrations/20260823113057_ai_council_confirmation_engine.sql")

  assert.match(migration, /where r\.signal = 'BUY_ON_CONFIRMATION'/)
  assert.match(migration, /n\.signal = 'BUY' and n\.risk_status = 'approve' and n\.confirmation_pending = false/)
  assert.match(migration, /n\.signal in \('REDUCE', 'SELL'\)/)
  assert.match(migration, /n\.risk_status = 'veto'/)
  assert.match(migration, /p_expiry_sessions integer default 10/)
  assert.match(migration, /trigger_direction_correct_5d/)
  assert.doesNotMatch(migration, /update public\.ai_council_runs/i)
})

test("P3 outcome refresh computes VNINDEX alpha and calibration stays sample-gated", () => {
  const migration = source("supabase/migrations/20260823113128_ai_council_benchmark_and_calibration.sql")

  assert.match(migration, /ai_council_market_benchmarks/)
  assert.match(migration, /alpha_5d_pct = case/)
  assert.match(migration, /a\.return_5d_pct - a\.benchmark_return_5d_pct/)
  assert.match(migration, /when r\.signal = 'BUY_ON_CONFIRMATION' then c\.trigger_direction_correct_5d/)
  assert.match(migration, /s\.sample_count >= 30/)
  assert.match(migration, /s\.sample_count >= 20/)
  assert.match(migration, /avg\(power\(o\.probability_up - o\.actual_up, 2\)\) as brier_score/)
  assert.match(migration, /w\.raw_weight \/ sum\(w\.raw_weight\) over \(\)/)
  assert.match(migration, /w\.raw_weight \/ sum\(w\.raw_weight\) over \(partition by w\.market_regime\)/)
})

test("daily Council P3 pipeline is machine-authorized and runs benchmark -> learning -> calibrated persistence", () => {
  const route = source("app/api/ai-council/daily/route.ts")
  const vercel = JSON.parse(source("vercel.json")) as { crons: Array<{ path: string; schedule: string }> }
  const councilCron = vercel.crons.find((cron) => cron.path === "/api/ai-council/daily")
  const wyckoffCron = vercel.crons.find((cron) => cron.path === "/api/wyckoff/ingest")

  assert.match(route, /isMachineRequestAuthorized/)
  assert.match(route, /process\.env\.AI_COUNCIL_RUN_SECRET/)
  assert.match(route, /syncAiCouncilMarketBenchmark/)
  assert.match(route, /refreshAiCouncilLearningState/)
  assert.match(route, /loadCouncilWeightProfile/)
  assert.match(route, /applyCouncilWeightProfile/)
  assert.match(route, /persistAiCouncilData/)
  assert.equal(wyckoffCron?.schedule, "0 10 * * 1-5")
  assert.equal(councilCron?.schedule, "15 10 * * 1-5")
})

test("Council v2 keeps deterministic evidence hashes and exposes bounded adaptive calibration", () => {
  const data = source("lib/ai-council-data.ts")
  const persistence = source("lib/ai-council-persistence.ts")
  const calibration = source("lib/ai-council-calibration.ts")
  const learning = source("lib/ai-council-learning.ts")
  const performance = source("app/insights/ai-council/performance/page.tsx")
  const dashboard = source("components/insights/ai-council-dashboard.tsx")

  assert.match(data, /createHash\("sha256"\)/)
  assert.match(data, /canonicalize/)
  assert.match(data, /evidenceHash: buildEvidenceHash/)
  assert.match(persistence, /AI_COUNCIL_POLICY_VERSION = "council-policy-v2"/)
  assert.match(persistence, /calibration_version: weightProfile\.calibrationVersion/)
  assert.match(persistence, /ignoreDuplicates: true/)
  assert.match(calibration, /wyckoff: 0\.30/)
  assert.match(calibration, /momentum: 0\.20/)
  assert.match(calibration, /fundamental: 0\.20/)
  assert.match(calibration, /flow: 0\.15/)
  assert.match(calibration, /market: 0\.15/)
  assert.match(learning, /regime-calibrated/)
  assert.match(learning, /overall-calibrated/)
  assert.match(learning, /staticCouncilWeightProfile/)
  assert.match(performance, /Council Performance Lab/)
  assert.match(dashboard, /Historical audit trail/)
  assert.match(dashboard, /Immutable revisions · close-to-close outcomes/)
})
