import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import test from "node:test"

const validatorUrl = new URL("../scripts/verify-test-contracts.mjs", import.meta.url)
const manifestUrl = new URL("./test-contracts.json", import.meta.url)

test("test contract manifest exactly covers the current top-level test inventory", async () => {
  assert.equal(existsSync(validatorUrl), true, "validator must exist")
  assert.equal(existsSync(manifestUrl), true, "test-contracts manifest must exist")

  const { validateTestContracts } = await import(validatorUrl.href)
  const result = validateTestContracts(new URL("..", import.meta.url))

  assert.equal(result.ok, true)
  assert.deepEqual(result.missing, [])
  assert.deepEqual(result.extra, [])
  assert.deepEqual(result.duplicates, [])
  assert.deepEqual(result.invalid, [])
})
