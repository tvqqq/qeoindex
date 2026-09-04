import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("Verify owns current release suites through stable package entry points", () => {
  const verify = source(".github/workflows/security.yml")
  for (const command of [
    "pnpm test:manifest",
    "pnpm test:fast",
    "pnpm test:eod",
    "pnpm test:ai",
    "pnpm test:db",
    "pnpm test:ui-contracts",
    "pnpm lint:touched",
    "pnpm typecheck",
    "pnpm scan:secrets",
    "pnpm exec next build",
  ]) assert.match(verify, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), command)

  assert.doesNotMatch(
    verify,
    /node --test[^\n]*(qeo-58-eod-data-refresh|market-board-filter-avg50|auth-login-handoff|orderbook-prune-security|kfsp-canonical-universe-sync|canonical-200-ui)/,
  )
})

test("EOD v4 check name remains but delegates inventory to pnpm test:eod", () => {
  const eod = source(".github/workflows/eod-v4.yml")
  assert.match(eod, /name:\s*EOD v4/)
  assert.match(eod, /pnpm test:eod/)
  assert.doesNotMatch(eod, /node --test tests\/qeoindex-eod-v4-/)
})

test("DB Drift retains ledger, zero-replay, generated types, DB tests, TypeScript and cleanup", () => {
  const db = source(".github/workflows/db-drift.yml")
  for (const evidence of [
    "scripts/db/verify-migration-drift.mjs",
    "supabase start",
    "pnpm db:replay:verify",
    "pnpm db:types:verify",
    "pnpm test:db",
    "pnpm typecheck",
    "supabase stop --no-backup",
  ]) assert.match(db, new RegExp(evidence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), evidence)
})
