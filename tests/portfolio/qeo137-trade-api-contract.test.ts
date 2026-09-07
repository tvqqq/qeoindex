import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

const serverUrl = new URL("../../modules/portfolio/trades/server.ts", import.meta.url)
const fillLinkUrl = new URL("../../modules/portfolio/trades/fill-link.ts", import.meta.url)
const transactionCollectionUrl = new URL("../../app/api/portfolio/[id]/transactions/route.ts", import.meta.url)
const transactionDetailUrl = new URL("../../app/api/portfolio/[id]/transactions/[txId]/route.ts", import.meta.url)
const pnlUrl = new URL("../../modules/portfolio/pnl.ts", import.meta.url)
const routePaths = [
  "../../app/api/portfolio/[id]/trades/route.ts",
  "../../app/api/portfolio/[id]/trades/[tradeId]/route.ts",
  "../../app/api/portfolio/[id]/trades/[tradeId]/fills/route.ts",
  "../../app/api/portfolio/[id]/trades/[tradeId]/stops/route.ts",
  "../../app/api/portfolio/[id]/trades/[tradeId]/journal/route.ts",
] as const

function serverSource() {
  assert.equal(existsSync(serverUrl), true, "QEO-137 Trade server module must exist")
  return readFileSync(serverUrl, "utf8")
}

function routeSources() {
  return routePaths.map((path) => {
    const url = new URL(path, import.meta.url)
    assert.equal(existsSync(url), true, `${path} must exist`)
    return { path, source: readFileSync(url, "utf8") }
  })
}

test("Trade persistence is server-only and uses the authenticated ServerAuthContext", () => {
  const source = serverSource()

  assert.match(source, /^import "server-only"/m)
  assert.match(source, /import[^\n]*type ServerAuthContext[^\n]*from "@\/modules\/auth\/server"/)
  assert.doesNotMatch(source, /createClient\s*\(/)
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE/)
})

test("Trade server exposes the narrow lifecycle and evidence contract", () => {
  const source = serverSource()

  for (const name of [
    "createTrade",
    "updatePlannedTrade",
    "transitionTrade",
    "getTrade",
    "listTrades",
    "attachFillToTrade",
    "detachFillFromTrade",
    "addStopEvent",
    "listStopEvents",
    "addJournalEntry",
    "listJournalEntries",
    "readPortfolioTradeContext",
  ]) {
    assert.match(source, new RegExp(`export async function ${name}\\b`), name)
  }

  assert.doesNotMatch(source, /export async function (updateStopEvent|deleteStopEvent)\b/)
})

test("every user-owned persistence path scopes portfolio and user identity", () => {
  const source = serverSource()

  const userScopes = source.match(/\.eq\("user_id",\s*context\.user\.id\)/g) ?? []
  const portfolioScopes = source.match(/\.eq\("portfolio_id",\s*portfolioId\)/g) ?? []
  assert.ok(userScopes.length >= 10, "server queries must repeatedly scope user ownership")
  assert.ok(portfolioScopes.length >= 10, "server queries must repeatedly scope portfolio ownership")
})

test("fill attachment validates Trade and accounting row without rewriting accounting values", () => {
  const source = serverSource()

  assert.match(source, /\.from\("portfolio_transactions"\)/)
  assert.match(source, /transaction\.ticker\s*!==\s*trade\.ticker/)
  assert.match(source, /\.update\(\{\s*trade_id:\s*tradeId\s*\}\)/)
  assert.match(source, /\.update\(\{\s*trade_id:\s*null\s*\}\)/)

  const attachBlock = source.match(
    /export async function attachFillToTrade[\s\S]*?export async function detachFillFromTrade/,
  )?.[0] ?? ""
  assert.doesNotMatch(attachBlock, /\.update\(\{[^}]*\b(price|quantity|fee|transaction_date)\b/s)
})

test("server enforces lifecycle transition and frozen initial snapshot invariants", () => {
  const source = serverSource()

  assert.match(source, /assertTradeTransition\(/)
  assert.match(source, /assertFrozenTradeFieldsUnchanged\(/)
  assert.match(source, /normalizeTradeCreateInput\(/)
  assert.match(source, /normalizeStopEventInput\(/)
  assert.match(source, /normalizeJournalEntryInput\(/)
})

test("canonical portfolio Trade context uses deterministic read-model assembly", () => {
  const source = serverSource()

  assert.match(source, /buildTradeReadModel\(/)
  assert.match(source, /trade_id/)
  assert.match(source, /portfolio_trade_stop_events/)
  assert.match(source, /portfolio_trade_journal_entries/)
})

test("Trade HTTP routes are thin authenticated adapters, not direct Supabase owners", () => {
  const routes = routeSources()

  for (const { path, source } of routes) {
    assert.match(source, /requireApiUser\(/, `${path} authenticates`)
    assert.match(source, /Cache-Control.*no-store/s, `${path} disables caching`)
    assert.doesNotMatch(source, /\.from\("portfolio_(trades|transactions|trade_)/, `${path} must not query Supabase directly`)
  }
})

test("Trade routes delegate every lifecycle/evidence operation to the domain server", () => {
  const all = routeSources().map((route) => route.source).join("\n")

  for (const name of [
    "createTrade",
    "updatePlannedTrade",
    "transitionTrade",
    "getTrade",
    "listTrades",
    "attachFillToTrade",
    "detachFillFromTrade",
    "addStopEvent",
    "listStopEvents",
    "addJournalEntry",
    "listJournalEntries",
  ]) {
    assert.match(all, new RegExp(`${name}\\(`), name)
  }
})

test("HTTP boundary maps validation/not-found/conflict errors explicitly", () => {
  const all = routeSources().map((route) => route.source).join("\n")

  assert.match(all, /TradeDomainError/)
  assert.match(all, /NOT_FOUND/)
  assert.match(all, /409/)
  assert.match(all, /400/)
  assert.match(all, /404/)
})

test("transaction read/write contract exposes optional trade_id while preserving legacy payloads", () => {
  const collection = readFileSync(transactionCollectionUrl, "utf8")
  const detail = readFileSync(transactionDetailUrl, "utf8")

  assert.match(collection, /SELECT_FIELDS[\s\S]*trade_id/)
  assert.match(detail, /SELECT_FIELDS[\s\S]*trade_id/)
  assert.match(collection, /validateTradeFillLink\(/)
  assert.match(detail, /validateTradeFillLink\(/)
  assert.match(collection, /body\.trade_id|item\.trade_id/)
  assert.match(detail, /body\.trade_id/)
})

test("transaction linking validates effective ticker/action before storing a Trade FK", () => {
  assert.equal(existsSync(fillLinkUrl), true, "fill-link domain validator must exist")
  const collection = readFileSync(transactionCollectionUrl, "utf8")
  const detail = readFileSync(transactionDetailUrl, "utf8")
  const fillLink = readFileSync(fillLinkUrl, "utf8")

  assert.match(fillLink, /^import "server-only"/m)
  assert.match(fillLink, /export async function validateTradeFillLink\b/)
  assert.match(fillLink, /\.from\("portfolio_trades"\)/)
  assert.match(fillLink, /\.eq\("portfolio_id",\s*portfolioId\)/)
  assert.match(fillLink, /\.eq\("user_id",\s*context\.user\.id\)/)
  assert.match(fillLink, /ticker\s*!==\s*trade\.ticker/)
  assert.match(fillLink, /FILL_ACTIONS\.has\(action\)/)
  assert.match(detail, /existingTransaction/)
  assert.match(detail, /nextTicker/)
  assert.match(detail, /nextAction/)
  assert.match(detail, /validateTradeFillLink\([^)]*nextTicker[^)]*nextAction/s)
  assert.match(collection, /validateTradeFillLink\([^)]*ticker[^)]*action/s)
})

test("AVCO accounting accepts trade_id metadata but never uses it in P&L math", () => {
  const pnl = readFileSync(pnlUrl, "utf8")
  assert.match(pnl, /trade_id\?:\s*string\s*\|\s*null/)

  const engine = pnl.match(/export function computePortfolioPositions[\s\S]*?export function calculatePositionSizing/)?.[0] ?? ""
  assert.ok(engine, "AVCO engine source must be found")
  assert.doesNotMatch(engine, /trade_id/)
})
