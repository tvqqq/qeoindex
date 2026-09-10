import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

const workflowPath = ".github/workflows/qeo171-production-acceptance.yml"
const authHelperPath = "tests/browser/qeo171-auth.ts"
const specPath = "tests/browser/qeo171-stock-chart-production.spec.ts"

function read(path: string): string {
  return readFileSync(path, "utf8")
}

test("QEO-171 has an isolated authenticated production browser acceptance harness", () => {
  assert.equal(existsSync(workflowPath), true, `${workflowPath} must exist`)
  assert.equal(existsSync(authHelperPath), true, `${authHelperPath} must exist`)
  assert.equal(existsSync(specPath), true, `${specPath} must exist`)

  const workflow = read(workflowPath)
  const authHelper = read(authHelperPath)
  const spec = read(specPath)

  assert.match(workflow, /permissions:\s*\n\s*contents:\s*read/)
  assert.match(workflow, /QEO171_BASE_URL:\s*https:\/\/qeoindex\.qeoqeo\.com/)
  assert.match(workflow, /QEO171_SUPABASE_URL:\s*https:\/\/[a-z0-9]+\.supabase\.co/)
  assert.match(workflow, /QEO171_SUPABASE_PUBLISHABLE_KEY:\s*sb_publishable_[A-Za-z0-9_-]+/)
  assert.match(workflow, /QEO171_RUN_ID:\s*\$\{\{\s*github\.run_id\s*\}\}/)
  assert.match(workflow, /playwright install --with-deps chromium/)
  assert.match(workflow, /qeo171-stock-chart-production\.spec\.ts --project=desktop/)
  assert.doesNotMatch(workflow, /QEO171_TEST_PASSWORD|QEO144_TEST_PASSWORD|SUPABASE_SERVICE_ROLE_KEY/)

  assert.match(authHelper, /auth\.signUp/)
  assert.match(authHelper, /auth\.signInWithPassword/)
  assert.match(authHelper, /randomBytes/)
  assert.match(authHelper, /QEO171_PENDING_CONFIRMATION/)
  assert.doesNotMatch(authHelper, /console\.log\([^)]*password/i)

  assert.match(spec, /VIC/)
  assert.match(spec, /VCB/)
  assert.match(spec, /\/api\/user\/chart-drawings/)
  assert.match(spec, /\/api\/market\/ohlcv/)
  assert.match(spec, /Backquote/)
  assert.match(spec, /ArrowDown/)
  assert.match(spec, /ArrowUp/)
  assert.match(spec, /page\.reload\(/)
  assert.match(spec, /finally\s*{/)
  assert.match(spec, /restore/i)
  assert.match(spec, /1D/)
  assert.match(spec, /1h/)
})
