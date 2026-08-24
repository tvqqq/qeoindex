import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("admin API route handlers are protected with requireApiRoot and no-store headers", () => {
  const routes = [
    "app/api/admin/overview/route.ts",
    "app/api/admin/settings/route.ts",
    "app/api/admin/settings/[key]/route.ts",
    "app/api/admin/jobs/route.ts",
    "app/api/admin/jobs/[key]/run/route.ts",
  ]

  for (const routePath of routes) {
    const code = source(routePath)
    assert.match(code, /requireApiRoot/, `${routePath} must invoke requireApiRoot`)
    assert.match(code, /no-store|max-age=0/, `${routePath} must specify private/no-store cache control`)
  }
})

test("admin mutation routes enforce CSRF same-origin checks and validate change reason", () => {
  const setRoute = source("app/api/admin/settings/route.ts")
  const resetRoute = source("app/api/admin/settings/[key]/route.ts")
  const runRoute = source("app/api/admin/jobs/[key]/run/route.ts")

  assert.match(setRoute, /validateAdminMutationRequest/)
  assert.match(resetRoute, /validateAdminMutationRequest/)
  assert.match(runRoute, /validateAdminMutationRequest/)
})

test("admin Server Actions enforce root page context and change reasons", () => {
  const actions = source("app/admin/actions.ts")

  assert.match(actions, /"use server"/)
  assert.match(actions, /getRootPageContext/)
  assert.match(actions, /setAdminSetting/)
  assert.match(actions, /resetAdminSetting/)
  assert.match(actions, /dispatchManualAdminJob/)
})
