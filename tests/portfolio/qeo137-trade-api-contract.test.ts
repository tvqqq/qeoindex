import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

const serverUrl = new URL("../../modules/portfolio/trades/server.ts", import.meta.url)

function serverSource() {
  assert.equal(existsSync(serverUrl), true, "QEO-137 Trade server module must exist")
  return readFileSync(serverUrl, "utf8")
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
