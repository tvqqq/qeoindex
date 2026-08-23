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
  assert.match(migration, /revoke all on function public\.refresh_ai_council_outcomes\(\) from authenticated/)
  assert.match(migration, /grant execute on function public\.refresh_ai_council_outcomes\(\) to service_role/)
})

test("Council outcome refresh uses published future sessions and avoids pretending conditional signals were confirmed", () => {
  const migration = source("supabase/migrations/20260823111530_ai_council_history.sql")

  assert.match(migration, /source = 'kfsp'/)
  assert.match(migration, /is_published = true/)
  assert.match(migration, /row_number\(\) over \(partition by r\.id order by rp\.as_of_date\) as session_no/)
  assert.match(migration, /when r\.signal = 'BUY' then a\.return_5d_pct > 0/)
  assert.match(migration, /when r\.signal in \('SELL', 'REDUCE'\) then a\.return_5d_pct < 0/)
  assert.match(migration, /when r\.signal in \('BUY_ON_CONFIRMATION', 'WAIT'\)/)
  assert.match(migration, /MFE\/MAE are close-to-close/)
})

test("daily Council persistence is machine-authorized and scheduled after Wyckoff ingestion", () => {
  const route = source("app/api/ai-council/daily/route.ts")
  const vercel = JSON.parse(source("vercel.json")) as { crons: Array<{ path: string; schedule: string }> }
  const councilCron = vercel.crons.find((cron) => cron.path === "/api/ai-council/daily")
  const wyckoffCron = vercel.crons.find((cron) => cron.path === "/api/wyckoff/ingest")

  assert.match(route, /isMachineRequestAuthorized/)
  assert.match(route, /process\.env\.AI_COUNCIL_RUN_SECRET/)
  assert.match(route, /getSupabaseServerClient/)
  assert.match(route, /getAiCouncilData\(supabase, \{ includeHistory: false \}\)/)
  assert.match(route, /persistAiCouncilData/)
  assert.equal(wyckoffCron?.schedule, "0 10 * * 1-5")
  assert.equal(councilCron?.schedule, "15 10 * * 1-5")
})

test("Council evidence is deterministically hashed and the UI exposes the historical audit trail", () => {
  const data = source("lib/ai-council-data.ts")
  const persistence = source("lib/ai-council-persistence.ts")
  const dashboard = source("components/insights/ai-council-dashboard.tsx")

  assert.match(data, /createHash\("sha256"\)/)
  assert.match(data, /canonicalize/)
  assert.match(data, /evidenceHash: buildEvidenceHash/)
  assert.match(data, /from\("ai_council_runs"\)/)
  assert.match(data, /from\("ai_council_outcomes"\)/)
  assert.match(persistence, /AI_COUNCIL_POLICY_VERSION = "council-policy-v1"/)
  assert.match(persistence, /ignoreDuplicates: true/)
  assert.match(persistence, /refresh_ai_council_outcomes/)
  assert.match(dashboard, /Historical audit trail/)
  assert.match(dashboard, /Immutable revisions · close-to-close outcomes/)
})
