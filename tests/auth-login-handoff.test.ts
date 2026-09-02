import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
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

test("login form prevents repeated submits while Supabase sign-in is in flight", () => {
  const code = source("components/auth/landing-login.tsx")

  assert.match(code, /setIsSubmitting\(true\)/)
  assert.match(code, /disabled=\{isSubmitting \|\| !configured\}/)
  assert.match(code, /isSubmitting \? "Đang xác thực\.\.\." : "Đăng nhập"/)
})

test("auth gate exposes immediate, accessible progress while the market board refreshes", () => {
  const code = source("components/auth/app-auth-gate.tsx")

  assert.match(code, /label: "Đang thiết lập phiên"/)
  assert.match(code, /label: "Đang tải Bảng điện"/)
  assert.match(code, /aria-live="polite"/)
  assert.match(code, /aria-busy="true"/)
})
