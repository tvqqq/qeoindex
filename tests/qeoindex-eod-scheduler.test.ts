import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

const migrationUrl = new URL("../supabase/migrations/20260825174500_qeoindex_eod_pipeline_cron.sql", import.meta.url)
const vercelUrl = new URL("../vercel.json", import.meta.url)

test("QeoIndex EOD scheduler uses one 15:15 ICT pg_cron job with Vault-backed machine auth", () => {
  assert.equal(existsSync(migrationUrl), true, "unified QeoIndex EOD cron migration must exist")
  if (!existsSync(migrationUrl)) return
  const sql = readFileSync(migrationUrl, "utf8")

  assert.match(sql, /qeoindex-eod-pipeline-1515-ict/i)
  assert.match(sql, /'15 8 \* \* 1-5'/)
  assert.match(sql, /vault\.decrypted_secrets/i)
  assert.match(sql, /name\s*=\s*'qeoindex_app_url'/i)
  assert.match(sql, /name\s*=\s*'qeoindex_cron_secret'/i)
  assert.match(sql, /\/api\/qeoindex\/eod/)
  assert.match(sql, /Authorization/i)
  assert.match(sql, /Bearer /i)
  assert.match(sql, /net\.http_post/i)
  assert.match(sql, /cron\.unschedule\('qeoindex-eod-pipeline-1515-ict'\)/i)
  assert.match(sql, /raise exception[\s\S]*qeoindex_app_url/i)
  assert.match(sql, /raise exception[\s\S]*qeoindex_cron_secret/i)
  assert.doesNotMatch(sql, /SCANNER_RUN_SECRET/i)
  assert.doesNotMatch(sql, /Bearer\s+[A-Za-z0-9_-]{20,}/)
})

test("Vercel no longer schedules the legacy AI Council EOD workflow after unified cutover", () => {
  const config = JSON.parse(readFileSync(vercelUrl, "utf8")) as { crons?: Array<{ path?: string; schedule?: string }> }
  const crons = config.crons ?? []
  assert.equal(crons.some((cron) => cron.path === "/api/ai-council/eod"), false)
  assert.equal(crons.some((cron) => cron.path === "/api/qeoindex/eod"), false, "QeoIndex EOD is owned by Supabase pg_cron, not Vercel cron")
  assert.equal(crons.some((cron) => cron.path === "/api/signals/daily"), true, "unrelated daily signals cron must be preserved")
})
