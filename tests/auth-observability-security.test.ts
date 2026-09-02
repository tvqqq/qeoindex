import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const SERVER_AUTH_OBSERVABILITY_URL = new URL("../lib/auth/server-observability.ts", import.meta.url)

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("server auth transport rethrow removes raw credentials and payload", async () => {
  const observability = await import(SERVER_AUTH_OBSERVABILITY_URL.href)
  const sanitize = observability.createSanitizedServerAuthTransportFailure

  assert.equal(typeof sanitize, "function", "QEO-41 must sanitize the error that escapes to the runtime logger")
  if (typeof sanitize !== "function") return

  const raw = Object.assign(
    new Error("Bearer secret-access-token failed for user@example.com after timeout"),
    { name: "TimeoutError", authorization: "Bearer secret-access-token" },
  )
  const safe = sanitize(raw)

  assert.equal(safe.name, "ServerAuthTransportFailureError")
  assert.equal(safe.message, "Server auth transport failure (timeout)")
  assert.equal(safe.category, "timeout")
  assert.equal("cause" in safe, false, "sanitized runtime error must not retain the raw error as cause")

  const serialized = `${safe.name}:${safe.message}:${JSON.stringify(safe)}`
  for (const secret of ["secret-access-token", "user@example.com", "Bearer", "authorization"]) {
    assert.equal(serialized.includes(secret), false, `sanitized runtime error leaked ${secret}`)
  }
})

test("server auth catch reports the raw failure but never rethrows it", () => {
  const code = source("lib/auth/server.ts")

  assert.match(code, /reportServerAuthTransportFailure\(transportError\)/)
  assert.doesNotMatch(code, /throw transportError/)
  assert.match(code, /throw createSanitizedServerAuthTransportFailure\(transportError\)/)
})
