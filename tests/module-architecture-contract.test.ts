import assert from "node:assert/strict"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import test from "node:test"

const ROOT = path.resolve(import.meta.dirname, "..")
const PRODUCTION_ROOTS = ["app", "components", "modules", "workflows", "lib"]

function filesUnder(relative: string): string[] {
  const absolute = path.join(ROOT, relative)
  if (!existsSync(absolute)) return []
  if (statSync(absolute).isFile()) return [relative.replaceAll("\\", "/")]
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(relative, entry.name)
    if (entry.isDirectory()) return filesUnder(child)
    return /\.(?:ts|tsx|js|mjs)$/.test(entry.name) ? [child.replaceAll("\\", "/")] : []
  })
}

const productionFiles = PRODUCTION_ROOTS.flatMap(filesUnder)

test("active production paths do not preserve accidental legacy or version names", () => {
  const historicalToken = new RegExp("(^|[\\/_.-])(legacy|v2|v3)(?=$|[\\/_.-])", "i")
  assert.deepEqual(productionFiles.filter((file) => historicalToken.test(file)), [])
})

test("root lib is no longer a production implementation surface", () => {
  const rootLib = productionFiles.filter((file) => file.startsWith("lib/") && !file.slice(4).includes("/") && (file.endsWith(".ts") || file.endsWith(".tsx")))
  assert.deepEqual(rootLib, [])
})

test("lower-level domains do not depend on EOD or workflow orchestration", () => {
  const violations: string[] = []
  for (const file of productionFiles.filter((file) => file.startsWith("modules/"))) {
    const domain = file.split("/")[1]
    if (domain === "eod") continue
    const source = readFileSync(path.join(ROOT, file), "utf8")
    if (source.includes('"@/modules/eod') || source.includes("'@/modules/eod")) violations.push(file + " -> eod")
    if (source.includes('"@/workflows') || source.includes("'@/workflows")) violations.push(file + " -> workflows")
  }
  assert.deepEqual(violations, [])
})

test("current domain contracts expose deliberate stable entrypoints", () => {
  for (const file of [
    "modules/eod/index.ts",
    "modules/eod/README.md",
    "modules/market/README.md",
    "modules/market/universe/index.ts",
    "modules/portfolio/README.md",
    "modules/portfolio/watchlist/server.ts",
    "modules/portfolio/watchlist/README.md",
    "modules/wyckoff/README.md",
    "modules/ai-council/README.md",
  ]) assert.equal(existsSync(path.join(ROOT, file)), true, file)
})

test("watchlist route is a thin adapter over the portfolio module", () => {
  const route = readFileSync(path.join(ROOT, "app/api/watchlist/route.ts"), "utf8")
  assert.equal(route.includes("@/modules/portfolio/watchlist/server"), true)
  assert.equal(route.includes(".from("), false)
  assert.equal(route.includes("NextResponse"), false)
  assert.ok(route.split("\n").length <= 20)
})

test("watchlist server boundary is explicitly server-only", () => {
  const server = readFileSync(path.join(ROOT, "modules/portfolio/watchlist/server.ts"), "utf8")
  assert.equal(server.startsWith('import "server-only"'), true)
})

test("market board uses the canonical unversioned component name", () => {
  assert.equal(existsSync(path.join(ROOT, "components/live-market-board.tsx")), true)
  assert.equal(existsSync(path.join(ROOT, "components/live-market-board-v2.tsx")), false)
  const board = readFileSync(path.join(ROOT, "components/live-market-board.tsx"), "utf8")
  assert.equal(board.includes("export function LiveMarketBoard("), true)
  assert.equal(board.includes("LiveMarketBoardV2"), false)
})
