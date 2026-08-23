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

test("P4 persists advisory LLM debates without granting signal authority", () => {
  const migration = source("supabase/migrations/20260823115556_ai_council_llm_debates.sql")

  assert.match(migration, /create table if not exists public\.ai_council_llm_debates/)
  assert.match(migration, /run_id uuid not null unique references public\.ai_council_runs/)
  assert.match(migration, /final_authority text not null default 'deterministic'/)
  assert.match(migration, /llm_advisory_only boolean not null default true/)
  assert.match(migration, /no hidden chain-of-thought is persisted/i)
  assert.match(migration, /grant select on table public\.ai_council_llm_debates to authenticated/)
  assert.doesNotMatch(migration, /grant (?:insert|update|delete)[^;]*ai_council_llm_debates[^;]*to authenticated/i)
})

test("P4 event selector caps spend and escalates only material deterministic events", () => {
  const llm = source("lib/ai-council-llm.ts")

  for (const reason of ["explicit_watchlist", "signal_changed", "high_disagreement", "breakout_watch", "risk_conflict"]) {
    assert.match(llm, new RegExp(`"${reason}"`))
  }
  assert.match(llm, /DEFAULT_MAX_TICKERS = 3/)
  assert.match(llm, /HARD_MAX_TICKERS = 6/)
  assert.match(llm, /AI_COUNCIL_LLM_MAX_TICKERS/)
  assert.match(llm, /stock\.signal === "BUY_ON_CONFIRMATION"/)
  assert.match(llm, /previousSignal && previousSignal !== stock\.signal/)
  assert.match(llm, /stock\.riskStatus === "veto"/)
})

test("P4.1 routes roles to Luna/Terra/Sol with bounded fallback and reasoning effort", () => {
  const llm = source("lib/ai-council-llm.ts")
  const env = source(".env.example")

  assert.match(llm, /DEFAULT_BULL_MODEL = "gpt-5\.6-luna"/)
  assert.match(llm, /DEFAULT_BEAR_MODEL = "gpt-5\.6-luna"/)
  assert.match(llm, /DEFAULT_RISK_MODEL = "gpt-5\.6-terra"/)
  assert.match(llm, /DEFAULT_CHAIR_MODEL = "gpt-5\.6-terra"/)
  assert.match(llm, /DEFAULT_ESCALATION_MODEL = "gpt-5\.6-sol"/)
  assert.match(llm, /DEFAULT_FALLBACK_MODEL = "gpt-5-mini"/)
  assert.match(llm, /AI_COUNCIL_LLM_BULL_EFFORT", "low"/)
  assert.match(llm, /AI_COUNCIL_LLM_RISK_EFFORT", "medium"/)
  assert.match(llm, /AI_COUNCIL_LLM_ESCALATION_EFFORT", "high"/)
  assert.match(env, /AI_COUNCIL_LLM_BULL_MODEL=gpt-5\.6-luna/)
  assert.match(env, /AI_COUNCIL_LLM_RISK_MODEL=gpt-5\.6-terra/)
  assert.match(env, /AI_COUNCIL_LLM_ESCALATION_MODEL=gpt-5\.6-sol/)
})

test("P4.1 uses Responses Structured Outputs, stable prompt-cache keys, and token telemetry", () => {
  const llm = source("lib/ai-council-llm.ts")
  const migration = source("supabase/migrations/20260823195500_ai_council_llm_router_telemetry.sql")

  assert.match(llm, /https:\/\/api\.openai\.com\/v1\/responses/)
  assert.match(llm, /type: "json_schema"/)
  assert.match(llm, /strict: true/)
  assert.match(llm, /prompt_cache_key: params\.cacheKey/)
  assert.match(llm, /input_tokens_details/)
  assert.match(llm, /cached_tokens/)
  assert.match(llm, /reasoning_tokens/)
  assert.match(llm, /store: false/)
  assert.match(llm, /tools: \[\]/)
  assert.match(llm, /OPENAI_API_KEY is not configured/)
  assert.match(llm, /deterministic QeoIndex policy remains the final decision authority/i)
  assert.match(llm, /Do not reveal chain-of-thought/i)
  assert.match(migration, /cached_input_tokens integer/)
  assert.match(migration, /estimated_cost_usd numeric/)
  assert.match(migration, /model_route jsonb/)
  assert.match(migration, /escalated boolean/)
  assert.match(migration, /fallback_used boolean/)
})

test("P4.1 severe-conflict gate reserves Sol escalation for compound disagreement", () => {
  const llm = source("lib/ai-council-llm.ts")

  assert.match(llm, /reasons\.has\("signal_changed"\) && reasons\.has\("risk_conflict"\)/)
  assert.match(llm, /selection\.stock\.consensus <= 55/)
  assert.match(llm, /bull\.confidence >= 65 && bear\.confidence >= 65/)
  assert.match(llm, /risk\?\.stance === "veto" && selection\.stock\.councilScore >= 60/)
  assert.match(llm, /chair_escalation/)
  assert.match(llm, /Sol is reserved for severe-conflict Chair escalation/)
})

test("P4 debate cron is isolated after deterministic Council and exposes an authenticated audit page", () => {
  const route = source("app/api/ai-council/debate-daily/route.ts")
  const page = source("app/insights/ai-council/debates/page.tsx")
  const councilPage = source("app/insights/ai-council/page.tsx")
  const vercel = JSON.parse(source("vercel.json")) as { crons: Array<{ path: string; schedule: string }> }
  const debateCron = vercel.crons.find((cron) => cron.path === "/api/ai-council/debate-daily")

  assert.match(route, /isMachineRequestAuthorized/)
  assert.match(route, /runSelectedAiCouncilLlmDebates/)
  assert.match(route, /finalAuthority: "deterministic"/)
  assert.equal(debateCron?.schedule, "25 10 * * 1-5")
  assert.match(page, /getServerAuthContext/)
  assert.match(page, /LLM Debate Lab/)
  assert.match(page, /Luna Bull\/Bear/)
  assert.match(page, /Sol severe-conflict escalation/)
  assert.match(councilPage, /\/insights\/ai-council\/debates/)
})
