import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const migrationSql = readFileSync(new URL("../supabase/migrations/20260818_orderbook_snapshots.sql", import.meta.url), "utf8")

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
