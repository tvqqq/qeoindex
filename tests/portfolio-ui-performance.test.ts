import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const files = [
  "components/portfolio/portfolio-page.tsx",
  "components/portfolio/portfolio-positions-table.tsx",
  "components/portfolio/portfolio-allocation-chart.tsx",
  "components/portfolio/watchlist-panel.tsx",
  "components/portfolio/portfolio-theme.module.css",
]

test("portfolio workspace keeps dense UI performance guardrails", () => {
  const source = files.map((file) => readFileSync(file, "utf8")).join("\n")
  assert.doesNotMatch(source, /backdrop-(?:blur|filter)/)
  assert.doesNotMatch(source, /transition-all/)
  assert.doesNotMatch(source, /filter:\s*(?:blur|drop-shadow)/)
})

test("portfolio renders the global header without an empty sticky offset", () => {
  const page = readFileSync("components/portfolio/portfolio-page.tsx", "utf8")
  assert.match(page, /<TopNav\s*\/>/)
  assert.match(page, /sticky top-14/)
  assert.ok(page.indexOf("<TopNav />") < page.indexOf("sticky top-14"))
})

test("transaction journal protects the active create and delete flows", () => {
  const dialog = readFileSync("components/portfolio/add-transaction-dialog.tsx", "utf8")
  const history = readFileSync("components/portfolio/portfolio-transaction-history.tsx", "utf8")
  const createRoute = readFileSync("app/api/portfolio/[id]/transactions/route.ts", "utf8")
  const itemRoute = readFileSync("app/api/portfolio/[id]/transactions/[txId]/route.ts", "utf8")

  assert.match(dialog, /method:\s*"POST"/)
  assert.match(createRoute, /export async function POST/)
  assert.match(history, /onDelete/)
  assert.match(history, /Xác nhận xóa/)
  assert.match(itemRoute, /export async function DELETE/)
})

test("portfolio ticker links do not trigger viewport prefetch fan-out", () => {
  const positions = readFileSync("components/portfolio/portfolio-positions-table.tsx", "utf8")
  const watchlist = readFileSync("components/portfolio/watchlist-panel.tsx", "utf8")
  assert.match(positions, /prefetch=\{false\}/)
  assert.match(watchlist, /prefetch=\{false\}/)
})
