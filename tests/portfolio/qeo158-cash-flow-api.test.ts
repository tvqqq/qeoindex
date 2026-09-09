import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

const cashFlowRouteUrl = new URL(
  "../../app/api/portfolio/[id]/cash-flows/route.ts",
  import.meta.url,
)
const portfolioRouteUrl = new URL(
  "../../app/api/portfolio/[id]/route.ts",
  import.meta.url,
)

test("QEO-158 cash-flow API is owner-scoped, append-only and validates funding semantics", () => {
  assert.equal(existsSync(cashFlowRouteUrl), true, "cash-flow API route must exist")
  const source = readFileSync(cashFlowRouteUrl, "utf8")

  assert.match(source, /requireApiUser/)
  assert.match(source, /Cache-Control[^\n]*no-store/)
  assert.match(source, /flow_type/)
  assert.match(source, /deposit/)
  assert.match(source, /withdrawal/)
  assert.match(source, /capital_adjustment/)
  assert.match(source, /signed_amount_vnd/)
  assert.match(source, /effective_at/)
  assert.match(source, /provenance/)
  assert.match(source, /note/)

  assert.match(source, /flowType\s*===\s*"deposit"[\s\S]{0,260}amount\s*>\s*0/)
  assert.match(source, /flowType\s*===\s*"withdrawal"[\s\S]{0,260}amount\s*<\s*0/)
  assert.match(source, /amount\s*===\s*0/)
  assert.match(source, /24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/)
  assert.match(source, /note[^\n]{0,120}(500|1000)/)

  assert.match(source, /from\("portfolio_external_cash_flows"\)/)
  assert.match(source, /\.eq\("portfolio_id",\s*portfolioId\)/)
  assert.match(source, /\.eq\("user_id",\s*auth\.context\.user\.id\)/)
  assert.match(source, /\.order\("effective_at",\s*\{\s*ascending:\s*true\s*\}\)/)
  assert.match(source, /\.order\("id",\s*\{\s*ascending:\s*true\s*\}\)/)
  assert.match(source, /user_id:\s*auth\.context\.user\.id/)
  assert.doesNotMatch(source, /console\.(log|info|debug)[^\n]*(note|body)/i)
})

test("QEO-158 opening capital cannot be silently rewritten after portfolio activity", () => {
  const source = readFileSync(portfolioRouteUrl, "utf8")

  assert.match(source, /body\?\.initial_capital\s*!==\s*undefined/)
  assert.match(source, /from\("portfolio_transactions"\)/)
  assert.match(source, /from\("portfolio_external_cash_flows"\)/)
  assert.match(source, /count:\s*"exact"/)
  assert.match(source, /head:\s*true/)
  assert.match(source, /409/)
  assert.match(source, /(Dòng vốn ngoài|external funding|cash.?flow)/i)
})
