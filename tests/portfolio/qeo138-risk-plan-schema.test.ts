import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260907130000_qeo138_risk_plan.sql",
)

test("QEO-138 migration creates immutable per-portfolio profile and plan history", () => {
  assert.equal(
    fs.existsSync(migrationPath),
    true,
    "QEO-138 risk-plan migration must exist before the schema contract can pass",
  )

  const sql = fs.readFileSync(migrationPath, "utf8")

  assert.match(sql, /create table public\.portfolio_risk_profile_attempts/i)
  assert.match(sql, /create table public\.portfolio_discipline_profile_attempts/i)
  assert.match(sql, /create table public\.portfolio_money_management_plans/i)
  assert.match(sql, /alter table public\.portfolio_trades[\s\S]*add column money_management_plan_id uuid/i)

  assert.match(sql, /unique\s*\(portfolio_id,\s*version\)/i)
  assert.match(sql, /unique\s*\(id,\s*portfolio_id,\s*user_id\)/i)

  for (const column of [
    "market_risk_points",
    "active_return_12m_points",
    "win_ratio_points",
    "personal_risk_tolerance_points",
    "experience_points",
    "payoff_ratio_points",
    "punctuality_points",
    "diet_self_control_points",
    "record_keeping_points",
    "office_clutter_points",
    "bills_expenses_points",
    "exercise_routine_points",
  ]) {
    assert.match(
      sql,
      new RegExp(`${column}[^,]*check\\s*\\([^)]*in\\s*\\(5,\\s*10,\\s*15\\)`, "i"),
      `${column} must only accept McDowell 5/10/15 points`,
    )
  }

  assert.match(sql, /total_score[\s\S]*market_risk_points[\s\S]*active_return_12m_points[\s\S]*win_ratio_points[\s\S]*personal_risk_tolerance_points[\s\S]*experience_points[\s\S]*payoff_ratio_points/i)
  assert.match(sql, /total_score[\s\S]*punctuality_points[\s\S]*diet_self_control_points[\s\S]*record_keeping_points[\s\S]*office_clutter_points[\s\S]*bills_expenses_points[\s\S]*exercise_routine_points/i)

  assert.match(sql, /foreign key\s*\(portfolio_id,\s*user_id\)[\s\S]*references public\.portfolios\s*\(id,\s*user_id\)/i)
  assert.match(sql, /risk_profile_attempt_id[\s\S]*portfolio_id[\s\S]*user_id[\s\S]*references public\.portfolio_risk_profile_attempts/i)
  assert.match(sql, /discipline_profile_attempt_id[\s\S]*portfolio_id[\s\S]*user_id[\s\S]*references public\.portfolio_discipline_profile_attempts/i)
  assert.match(sql, /money_management_plan_id[\s\S]*portfolio_id[\s\S]*user_id[\s\S]*references public\.portfolio_money_management_plans/i)

  for (const table of [
    "portfolio_risk_profile_attempts",
    "portfolio_discipline_profile_attempts",
    "portfolio_money_management_plans",
  ]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"))
  }

  assert.match(sql, /revoke all on table public\.portfolio_risk_profile_attempts from anon, authenticated/i)
  assert.match(sql, /revoke all on table public\.portfolio_discipline_profile_attempts from anon, authenticated/i)
  assert.match(sql, /revoke all on table public\.portfolio_money_management_plans from anon, authenticated/i)

  assert.match(sql, /grant select, insert on table public\.portfolio_risk_profile_attempts to authenticated/i)
  assert.match(sql, /grant select, insert on table public\.portfolio_discipline_profile_attempts to authenticated/i)
  assert.match(sql, /grant select, insert on table public\.portfolio_money_management_plans to authenticated/i)

  assert.doesNotMatch(sql, /grant[^;]*update[^;]*portfolio_risk_profile_attempts/i)
  assert.doesNotMatch(sql, /grant[^;]*delete[^;]*portfolio_risk_profile_attempts/i)
  assert.doesNotMatch(sql, /grant[^;]*update[^;]*portfolio_discipline_profile_attempts/i)
  assert.doesNotMatch(sql, /grant[^;]*delete[^;]*portfolio_discipline_profile_attempts/i)
  assert.doesNotMatch(sql, /grant[^;]*update[^;]*portfolio_money_management_plans/i)
  assert.doesNotMatch(sql, /grant[^;]*delete[^;]*portfolio_money_management_plans/i)
})

test("QEO-138 migration does not fabricate legacy profile, plan, or Trade provenance rows", () => {
  assert.equal(fs.existsSync(migrationPath), true)
  const sql = fs.readFileSync(migrationPath, "utf8")
  assert.doesNotMatch(sql, /insert\s+into\s+public\.portfolio_risk_profile_attempts/i)
  assert.doesNotMatch(sql, /insert\s+into\s+public\.portfolio_discipline_profile_attempts/i)
  assert.doesNotMatch(sql, /insert\s+into\s+public\.portfolio_money_management_plans/i)
  assert.doesNotMatch(sql, /update\s+public\.portfolio_trades\s+set\s+money_management_plan_id/i)
})
