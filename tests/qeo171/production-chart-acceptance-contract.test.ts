import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

const workflowPath = ".github/workflows/qeo171-production-acceptance.yml"
const specPath = "tests/browser/qeo171-stock-chart-production.spec.ts"

function read(path: string): string {
  return readFileSync(path, "utf8")
}

test("QEO-171 has an isolated authenticated production browser acceptance harness", () => {
  assert.equal(existsSync(workflowPath), true, `${workflowPath} must exist`)
  assert.equal(existsSync(specPath), true, `${specPath} must exist`)

  const workflow = read(workflowPath)
  const spec = read(specPath)

  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /permissions:\s*\n\s*contents:\s*read/)
  assert.match(workflow, /QEO171_BASE_URL:\s*https:\/\/qeoindex\.qeoqeo\.com/)
  assert.match(workflow, /QEO171_TEST_EMAIL:\s*\$\{\{\s*secrets\.QEO171_TEST_EMAIL\s*\}\}/)
  assert.match(workflow, /QEO171_TEST_PASSWORD:\s*\$\{\{\s*secrets\.QEO171_TEST_PASSWORD\s*\}\}/)
  assert.match(workflow, /QEO171_AUTH_AVAILABLE/)
  assert.match(workflow, /QEO171_ACCEPTANCE_EXECUTED=false/)
  assert.match(workflow, /acceptance skipped: encrypted QA credentials are not provisioned/i)
  assert.match(workflow, /playwright install --with-deps chromium/)
  assert.match(workflow, /qeo171-stock-chart-production\.spec\.ts --project=desktop/)
  assert.doesNotMatch(workflow, /SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE_ANON_KEY/)

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
