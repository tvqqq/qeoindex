import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("login handoff hides stale anonymous children until the server session refresh completes", () => {
  const code = source("components/auth/app-auth-gate.tsx")

  assert.match(code, /"establishing"/)
  assert.match(code, /"loading-board"/)

  const refreshBranch = code.match(/if \(!serverSessionPresent\) \{([\s\S]*?)\n\s*\}/)?.[1]
  assert.ok(refreshBranch, "expected an explicit post-login refresh branch")
  assert.match(refreshBranch, /setStatus\("loading-board"\)/)
  assert.match(refreshBranch, /router\.refresh\(\)/)
  assert.doesNotMatch(
    refreshBranch,
    /setStatus\("authenticated"\)/,
    "the gate must not expose stale server-rendered anonymous children before refresh completes",
  )
})

test("root market board has an immediate route loading state", () => {
  const loadingUrl = new URL("../app/loading.tsx", import.meta.url)
  assert.equal(existsSync(loadingUrl), true, "app/loading.tsx should stream a board loading state during auth refresh")
  if (!existsSync(loadingUrl)) return

  const code = readFileSync(loadingUrl, "utf8")
  assert.match(code, /Đang tải Bảng điện/)
  assert.match(code, /aria-live="polite"/)
})
