import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("QEO-165 presents raw transactions as a Battle Log without inventing Trade outcomes", () => {
  const history = source("components/portfolio/portfolio-transaction-history.tsx")
  const card = source("components/portfolio/revamp/battle-log-card.tsx")
  const page = source("components/portfolio/portfolio-page.tsx")

  assert.match(history, /BattleLogCard/)
  assert.match(history, /Chi tiết giao dịch dạng bảng/)
  assert.match(card, /transaction\.action/)
  assert.match(card, /legacy_migration_status/)
  assert.match(card, /record_origin/)
  assert.match(card, /onDelete/)
  assert.doesNotMatch(card, /\bWIN\b|\bLOSS\b|\bPARTIAL\b|\bCLOSED\b|\bOPEN\b/)

  assert.match(page, /PortfolioSectionShell/)
  assert.match(page, /Battle Log · Nhật ký giao dịch/)
})
