import assert from "node:assert/strict"
import test from "node:test"

import { isRootAdminUserId, parseRootAdminUserIds } from "../lib/auth/root-id.ts"

const ROOT = "aaaaaaaa-1111-4111-8111-111111111111"
const OTHER = "bbbbbbbb-2222-4222-8222-222222222222"

test("root allowlist accepts exact canonical UUID entries", () => {
  assert.deepEqual([...parseRootAdminUserIds(` ${ROOT},${OTHER} `)], [ROOT, OTHER])
  assert.equal(isRootAdminUserId(ROOT, `${ROOT},${OTHER}`), true)
})

test("root allowlist rejects malformed, case-mutated, partial and empty values", () => {
  assert.deepEqual([...parseRootAdminUserIds(`bad,${ROOT.toUpperCase()},${ROOT.slice(0, 12)}`)], [])
  assert.equal(isRootAdminUserId(ROOT, ""), false)
  assert.equal(isRootAdminUserId(ROOT, undefined), false)
  assert.equal(isRootAdminUserId(`${ROOT}x`, ROOT), false)
})
