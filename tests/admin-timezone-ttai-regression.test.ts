import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

const adminTimeUrl = new URL("../lib/admin/time.ts", import.meta.url)
const ttaiNormalizeUrl = new URL("../supabase/functions/kfsp-ttai-history-sync/normalize.ts", import.meta.url)
const ttaiSyncSource = readFileSync(new URL("../supabase/functions/kfsp-ttai-history-sync/index.ts", import.meta.url), "utf8")

const ACE_SENTINEL_PAYLOAD = {
  fourm_point: "N/A",
  canslim_point: 0,
  fourm_option_history_chart: {
    xAxis: { data: ["Q4.20"] },
    series: [{ data: [-99] }],
  },
  canslim_option_history_chart: {
    xAxis: { data: ["Q4.20"] },
    series: [{ data: [0] }],
  },
  data_table_4m: [["Tiêu chí", "Q4.20"], ["ROE", -99]],
  data_table_canslim: [["Tiêu chí", "Q4.20"], ["ROE TTM", 0]],
  fourm_option_chart: { radar: { indicator: [] }, series: [{ data: [[]] }] },
  canslim_option_chart: { radar: { indicator: [] }, series: [{ data: [[]] }] },
}

test("admin timestamps are formatted in Vietnam time independent of runtime timezone", async () => {
  assert.equal(existsSync(adminTimeUrl), true, "lib/admin/time.ts must centralize the admin timezone")
  const { ADMIN_TIME_ZONE, formatAdminDateTime } = await import(adminTimeUrl.href)
  assert.equal(ADMIN_TIME_ZONE, "Asia/Ho_Chi_Minh")
  const formatted = formatAdminDateTime("2026-08-26T01:17:01.000Z")
  assert.match(formatted, /08:17/)
  assert.match(formatted, /26\/08\/2026/)
})

test("admin timestamp surfaces use the single shared Vietnam timezone formatter", () => {
  const timestampSurfaces = [
    "components/admin/admin-overview-dashboard.tsx",
    "components/admin/admin-jobs-table.tsx",
    "components/admin/admin-job-history-table.tsx",
    "components/admin/admin-job-phase-timeline.tsx",
    "components/admin/admin-audit-table.tsx",
  ]

  for (const path of timestampSurfaces) {
    const code = readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
    assert.doesNotMatch(code, /\.toLocale(?:String|TimeString|DateString)\(/, `${path} must not use runtime-local timezone formatting`)
    assert.doesNotMatch(code, /timeZone:\s*["']Asia\/Ho_Chi_Minh["']/, `${path} must not hardcode the timezone outside lib/admin/time.ts`)
  }
})

test("TTAI normalization treats provider score sentinels outside 0-100 as missing", async () => {
  assert.equal(existsSync(ttaiNormalizeUrl), true, "TTAI normalization must live in a testable pure module")
  const { normalizeTtaiHistory } = await import(ttaiNormalizeUrl.href)
  const rows = normalizeTtaiHistory("ACE", ACE_SENTINEL_PAYLOAD, "2026-08-26T01:17:01.000Z")
  assert.equal(rows.length, 1)
  assert.equal(rows[0].fourm_score, null)
  assert.equal(rows[0].canslim_score, 0)
  assert.deepEqual(rows[0].fourm_components, {})
  assert.deepEqual(rows[0].canslim_components, { "ROE TTM": 0 })
})

test("TTAI no-history responses are classified as skipped instead of failed retry loops", async () => {
  assert.equal(existsSync(ttaiNormalizeUrl), true, "TTAI normalization must expose no-history classification")
  const { normalizeTtaiHistory, isTtaiNoHistoryError } = await import(ttaiNormalizeUrl.href)
  let caught: unknown = null
  try {
    normalizeTtaiHistory("ALC", {}, "2026-08-26T01:17:01.000Z")
  } catch (error) {
    caught = error
  }
  assert.equal(isTtaiNoHistoryError(caught), true)
  assert.match(ttaiSyncSource, /skipped \+= 1/)
  assert.match(ttaiSyncSource, /financial_period: candidate\.financialPeriod/)
  assert.match(ttaiSyncSource, /latest_provider_period: null/)
  assert.match(ttaiSyncSource, /processed,\s*failed,\s*skipped/)
  assert.match(ttaiSyncSource, /qeo_current_market_universe/)
  assert.match(ttaiSyncSource, /vn_top_stocks/)
  assert.doesNotMatch(ttaiSyncSource, /is_top100|top100_rank/)
})
