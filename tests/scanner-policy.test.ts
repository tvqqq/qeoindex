import test from "node:test"
import assert from "node:assert/strict"
import { scannerHistoryPolicy } from "../lib/scanner-policy.ts"

test("scanner rejects fewer than 60 completed Daily bars", () => {
  assert.throws(() => scannerHistoryPolicy(59), /need >=60/)
})

test("scanner persists 60-199 bars as Incomplete LOW", () => {
  assert.deepEqual(scannerHistoryPolicy(60), { status: "Incomplete", forceLowConfidence: true })
  assert.deepEqual(scannerHistoryPolicy(199), { status: "Incomplete", forceLowConfidence: true })
})

test("scanner marks at least 200 bars Complete", () => {
  assert.deepEqual(scannerHistoryPolicy(200), { status: "Complete", forceLowConfidence: false })
})
