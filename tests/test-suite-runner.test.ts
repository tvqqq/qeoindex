import assert from "node:assert/strict"
import test from "node:test"

import { filesForSuite } from "../scripts/run-test-suite.mjs"

const manifest = {
  entries: [
    { path: "tests/z.test.ts", bucket: "canonical", suites: ["fast"] },
    { path: "tests/a.test.ts", bucket: "canonical", suites: ["fast", "eod"] },
    { path: "tests/db.test.ts", bucket: "canonical", suites: ["db"] },
    { path: "tests/ui.test.ts", bucket: "canonical", suites: ["ui-contracts"] },
    { path: "tests/legacy.test.ts", bucket: "superseded", suites: ["none"] },
    { path: "tests/duplicate.test.ts", bucket: "duplicate", suites: ["none"] },
  ],
}

test("filesForSuite returns exact deterministic suite members", () => {
  assert.deepEqual(filesForSuite(manifest, "fast"), ["tests/a.test.ts", "tests/z.test.ts"])
  assert.deepEqual(filesForSuite(manifest, "eod"), ["tests/a.test.ts"])
})

test("current suite unions all current contract suites exactly once", () => {
  assert.deepEqual(filesForSuite(manifest, "current"), [
    "tests/a.test.ts",
    "tests/db.test.ts",
    "tests/ui.test.ts",
    "tests/z.test.ts",
  ])
})

test("filesForSuite excludes quarantined none entries", () => {
  assert.doesNotMatch(filesForSuite(manifest, "current").join("\n"), /legacy|duplicate/)
})

test("filesForSuite rejects unknown and empty suites", () => {
  assert.throws(() => filesForSuite(manifest, "unknown"), /Unknown test suite/)
  assert.throws(() => filesForSuite({ entries: [] }, "fast"), /resolved to zero tests/)
})
