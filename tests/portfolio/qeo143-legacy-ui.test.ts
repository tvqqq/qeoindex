import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const root = new URL("../../", import.meta.url)

function source(path: string) {
  return readFileSync(new URL(path, root), "utf8")
}

test("transaction APIs return QEO-143 migration provenance", () => {
  for (const path of [
    "app/api/portfolio/[id]/transactions/route.ts",
    "app/api/portfolio/[id]/transactions/[txId]/route.ts",
  ]) {
    const text = source(path)
    const select = text.match(/const SELECT_FIELDS\s*=\s*\n?\s*"([^"]+)"/)?.[1] ?? ""
    assert.ok(select.includes("record_origin"), `${path} must select record_origin`)
    assert.ok(select.includes("legacy_migration_status"), `${path} must select legacy_migration_status`)
  }
})

test("RawTransaction exposes optional legacy migration provenance", () => {
  const text = source("modules/portfolio/pnl.ts")
  assert.match(text, /record_origin\?:\s*"native"\s*\|\s*"legacy_pre_trade_domain"/)
  assert.match(
    text,
    /legacy_migration_status\?:\s*"not_applicable"\s*\|\s*"legacy_ungrouped"\s*\|\s*"deterministic_grouped"\s*\|\s*"manually_reviewed"/,
  )
})

test("Nhật ký distinguishes ungrouped and grouped legacy accounting rows", () => {
  const text = source("components/portfolio/portfolio-transaction-history.tsx")
  assert.match(text, /Legacy · chưa nhóm Trade/)
  assert.match(text, /Legacy · đã nhóm/)
  assert.match(
    text,
    /Giao dịch legacy chưa nhóm vẫn được tính P&L nhưng không được đưa vào Scorecard theo Trade\./,
  )
})
