import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const migrationSql = readFileSync(new URL("../supabase/migrations/20260818_orderbook_snapshots.sql", import.meta.url), "utf8")

const cronMigrationSql = readFileSync(new URL("../supabase/migrations/20260818194500_pg_cron_orderbook_sync.sql", import.meta.url), "utf8")

test("supabase migration schema defines complete stock orderbook table and RLS", () => {
  assert.match(migrationSql, /CREATE TABLE IF NOT EXISTS public\.stock_orderbook_snapshots/)
  assert.match(migrationSql, /symbol VARCHAR\(10\) PRIMARY KEY/)
  assert.match(migrationSql, /session_date DATE NOT NULL/)
  assert.match(migrationSql, /intraday_1m JSONB NOT NULL/)
  assert.match(migrationSql, /trades JSONB NOT NULL/)
  assert.match(migrationSql, /latest_quote JSONB NOT NULL/)
  assert.match(migrationSql, /foreign_flow JSONB/)
  assert.match(migrationSql, /put_through JSONB/)
  assert.match(migrationSql, /ALTER TABLE public\.stock_orderbook_snapshots ENABLE ROW LEVEL SECURITY/)
  assert.match(migrationSql, /CREATE POLICY "Allow public read access to orderbook snapshots"/)
  assert.match(migrationSql, /CREATE POLICY "Allow service role full access to orderbook snapshots"/)
})

test("supabase pg_cron migration schedules market sync every 5 minutes and 14:50 EOD sync", () => {
  assert.match(cronMigrationSql, /create extension if not exists pg_net/)
  assert.match(cronMigrationSql, /create extension if not exists pg_cron/)
  assert.match(cronMigrationSql, /'sync-universe-5m'/)
  assert.match(cronMigrationSql, /'\*\/5 2-8 \* \* 1-5'/)
  assert.match(cronMigrationSql, /'sync-universe-eod-1450'/)
  assert.match(cronMigrationSql, /'50 7 \* \* 1-5'/)
  assert.match(cronMigrationSql, /orderbook-sync/)
})
