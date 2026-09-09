import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function read(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("QEO-144 has a real desktop and mobile Playwright acceptance harness", () => {
  const pkg = JSON.parse(read("package.json")) as {
    devDependencies?: Record<string, string>
    scripts?: Record<string, string>
  }
  const config = read("playwright.config.ts")
  const authHelper = read("tests/browser/qeo144-auth.ts")

  assert.equal(pkg.devDependencies?.["@playwright/test"] != null, true)
  assert.equal(pkg.scripts?.["test:qeo144:browser"], "playwright test tests/browser/qeo144-portfolio.spec.ts")
  assert.match(config, /name:\s*["']desktop["']/)
  assert.match(config, /name:\s*["']mobile["']/)
  assert.match(config, /trace:\s*["']retain-on-failure["']/)
  assert.match(config, /screenshot:\s*["']only-on-failure["']/)
  assert.match(authHelper, /QEO144_TEST_EMAIL/)
  assert.match(authHelper, /QEO144_TEST_PASSWORD/)
  assert.match(authHelper, /getByLabel\([^)]*email/i)
  assert.match(authHelper, /getByLabel\([^)]*mật khẩu/i)
})
