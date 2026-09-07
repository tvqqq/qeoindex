import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const serverPath = path.join(process.cwd(), "modules/portfolio/risk-plan/server.ts")
const migrationPath = path.join(process.cwd(), "supabase/migrations/20260907124742_qeo138_risk_plan.sql")

function loadText(filePath: string, label: string) {
  assert.equal(fs.existsSync(filePath), true, `${label} must exist`)
  return fs.readFileSync(filePath, "utf8")
}

test("risk-plan server exposes ownership-scoped immutable history operations", () => {
  const source = loadText(serverPath, "QEO-138 risk-plan server.ts")

  for (const fn of [
    "listRiskProfileAttempts",
    "createRiskProfileAttempt",
    "listDisciplineProfileAttempts",
    "createDisciplineProfileAttempt",
    "listMoneyManagementPlans",
    "getCurrentMoneyManagementPlan",
    "createMoneyManagementPlanVersion",
    "getRiskPlanOverview",
  ]) {
    assert.match(source, new RegExp(`export async function ${fn}\\b`))
  }

  assert.match(source, /\.eq\("portfolio_id", portfolioId\)/)
  assert.match(source, /\.eq\("user_id", context\.user\.id\)/)
  assert.doesNotMatch(source, /from\("portfolio_risk_profile_attempts"\)[\s\S]{0,160}\.update\(/)
  assert.doesNotMatch(source, /from\("portfolio_risk_profile_attempts"\)[\s\S]{0,160}\.delete\(/)
  assert.doesNotMatch(source, /from\("portfolio_discipline_profile_attempts"\)[\s\S]{0,160}\.update\(/)
  assert.doesNotMatch(source, /from\("portfolio_money_management_plans"\)[\s\S]{0,160}\.(?:update|delete)\(/)
})

test("plan version allocation is protected by a transaction-scoped portfolio lock", () => {
  const sql = loadText(migrationPath, "QEO-138 migration")

  assert.match(sql, /create or replace function public\.qeo_create_portfolio_money_management_plan/i)
  assert.match(sql, /language plpgsql/i)
  assert.match(sql, /security invoker/i)
  assert.match(sql, /set search_path = ''/i)
  assert.match(sql, /pg_catalog\.pg_advisory_xact_lock/i)
  assert.match(sql, /coalesce\(max\(version\),\s*0\)\s*\+\s*1/i)
  assert.match(sql, /revoke all on function public\.qeo_create_portfolio_money_management_plan/i)
  assert.match(sql, /grant execute on function public\.qeo_create_portfolio_money_management_plan/i)
})

test("Money Management Plan provenance is mutable only while Trade is planned", async () => {
  const {
    assertMoneyManagementPlanReferenceUnchanged,
  } = await import("../../modules/portfolio/trades/validation.ts")

  const planA = "11111111-1111-4111-8111-111111111111"
  const planB = "22222222-2222-4222-8222-222222222222"

  assert.doesNotThrow(() => assertMoneyManagementPlanReferenceUnchanged(
    { status: "planned", money_management_plan_id: planA },
    { money_management_plan_id: planB },
  ))

  assert.throws(
    () => assertMoneyManagementPlanReferenceUnchanged(
      { status: "open", money_management_plan_id: planA },
      { money_management_plan_id: planB },
    ),
    /frozen after Trade opens/i,
  )

  assert.doesNotThrow(() => assertMoneyManagementPlanReferenceUnchanged(
    { status: "closed", money_management_plan_id: planA },
    {},
  ))
})
