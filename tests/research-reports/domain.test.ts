import assert from "node:assert/strict"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import test from "node:test"

import {
  discoverTopiReports,
  normalizeResearchReportCatalogQuery,
  normalizeTopiReportCategory,
  parseTopiReport,
  upsertResearchReports,
  type ResearchReportSourceRecord,
} from "../../modules/research-reports/index.ts"

function qeo80Migration() {
  const directories = ["supabase/migrations", "supabase/pending-migrations"].filter(existsSync)
  const matches = directories.flatMap((directory) =>
    readdirSync(directory)
      .filter((name) => name.endsWith("_qeo80_research_reports.sql"))
      .map((name) => `${directory}/${name}`),
  )
  assert.equal(matches.length, 1, "expected exactly one QEO-80 research reports migration")
  return readFileSync(matches[0], "utf8")
}

const sampleTopiReport = {
  code: "",
  link: "thach-thuc-lien-tiep",
  name: "Thách thức liên tiếp",
  publish_date: "27/08/2026",
  recommended: "TRUNG LẬP",
  reportId: 72734,
  sector: null,
  source_name: "MAS",
  target_price: 0,
  type_report: "Báo cáo ngành",
  upsise_now: 0,
  url: "https://cdn02.wigroup.vn/baocaophantich/25329_MAS_2026-08-27.pdf",
}

test("QEO-80 normalizes TOPI report categories without losing unknown source types", () => {
  assert.equal(normalizeTopiReportCategory("Báo cáo vĩ mô tiền tệ"), "macro")
  assert.equal(normalizeTopiReportCategory("Báo cáo chiến lược"), "strategy")
  assert.equal(normalizeTopiReportCategory("Báo cáo ngành"), "sector")
  assert.equal(normalizeTopiReportCategory("Báo cáo doanh nghiệp"), "other")
  assert.equal(normalizeTopiReportCategory(null), "other")
})

test("QEO-80 parses TOPI metadata into a stable provider report identity", () => {
  const report = parseTopiReport(sampleTopiReport)

  assert.equal(report.provider, "topi")
  assert.equal(report.externalReportId, "72734")
  assert.equal(report.title, "Thách thức liên tiếp")
  assert.equal(report.sourceName, "MAS")
  assert.equal(report.publishDate, "2026-08-27")
  assert.equal(report.originalTypeReport, "Báo cáo ngành")
  assert.equal(report.category, "sector")
  assert.equal(report.recommendation, "TRUNG LẬP")
  assert.equal(report.targetPrice, null, "TOPI target_price=0 means no target rather than a VND 0 target")
  assert.equal(report.code, null)
  assert.equal(report.link, "thach-thuc-lien-tiep")
  assert.equal(report.pdfUrl, sampleTopiReport.url)
  assert.deepEqual(report.sourcePayload, sampleTopiReport)
})

test("QEO-80 TOPI discovery paginates until a known report boundary and sends only server-relevant headers", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const firstNew = { ...sampleTopiReport, reportId: 72736, name: "Newest report" }
  const secondNew = { ...sampleTopiReport, reportId: 72735, name: "Second newest report" }

  const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    const requestBody = JSON.parse(String(init?.body)) as { page: number }
    const list = requestBody.page === 1
      ? [firstNew, secondNew]
      : [sampleTopiReport]
    return new Response(JSON.stringify({ data: { list } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch

  const result = await discoverTopiReports({
    knownExternalReportIds: new Set(["72734"]),
    fetchImpl,
    pageSize: 2,
    maxPages: 5,
  })

  assert.deepEqual(result.reports.map((report) => report.externalReportId), ["72736", "72735"])
  assert.equal(result.pagesFetched, 2)
  assert.equal(result.stoppedAtKnownBoundary, true)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].url, "https://apiclient.topi.vn/api-web/AnalysisReport")
  assert.equal(calls[0].init?.method, "POST")
  const headers = new Headers(calls[0].init?.headers)
  assert.equal(headers.get("accept"), "application/json")
  assert.equal(headers.get("content-type"), "application/json")
  assert.equal(headers.has("user-agent"), false)
  assert.equal(headers.has("sec-ch-ua"), false)
  assert.equal(headers.has("accept-language"), false)

  const firstBody = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>
  assert.deepEqual(firstBody, {
    page: 1,
    limit: 2,
    from_date: "",
    to_date: "",
    type: 0,
    source_name: "",
    sectorId: "",
    platform: "Web",
  })
  const secondBody = JSON.parse(String(calls[1].init?.body)) as Record<string, unknown>
  assert.equal(secondBody.page, 2)
  assert.equal(secondBody.limit, 2)
})

test("QEO-80 upserts by provider plus external report id so metadata refreshes do not duplicate report identity", async () => {
  const calls: Array<{ table: string; rows: unknown[]; options: unknown }> = []
  const client = {
    from(table: string) {
      return {
        async upsert(rows: unknown[], options: unknown) {
          calls.push({ table, rows, options })
          return { error: null }
        },
      }
    },
  }

  const report: ResearchReportSourceRecord = parseTopiReport(sampleTopiReport)
  await upsertResearchReports(client, [report])
  await upsertResearchReports(client, [{ ...report, title: "Thách thức liên tiếp — updated metadata" }])

  assert.equal(calls.length, 2)
  assert.equal(calls[0].table, "market_research_reports")
  assert.deepEqual(calls[0].options, {
    onConflict: "provider,external_report_id",
    ignoreDuplicates: false,
  })
  assert.deepEqual(calls[1].options, calls[0].options)

  const firstRow = calls[0].rows[0] as Record<string, unknown>
  const secondRow = calls[1].rows[0] as Record<string, unknown>
  assert.equal(firstRow.provider, "topi")
  assert.equal(firstRow.external_report_id, "72734")
  assert.equal(secondRow.external_report_id, "72734")
  assert.equal(secondRow.title, "Thách thức liên tiếp — updated metadata")
  assert.equal("content_hash" in secondRow, false, "metadata refresh must preserve the parsed PDF identity")
  assert.equal("analysis_status" in secondRow, false, "metadata refresh must not reset downstream AI state")
})

test("QEO-80 migration creates report evidence tables, idempotency constraints, and authenticated read-only RLS", () => {
  const sql = qeo80Migration()

  for (const table of [
    "market_research_reports",
    "market_research_report_analyses",
    "market_research_report_ticker_mentions",
    "market_research_report_chunks",
  ]) {
    assert.match(sql, new RegExp(`create\\s+table\\s+if\\s+not\\s+exists\\s+public\\.${table}`, "i"), table)
    assert.match(sql, new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, "i"), table)
  }

  assert.match(sql, /unique\s*\(provider,\s*external_report_id\)/i)
  assert.match(sql, /category\s+text\s+not\s+null\s+check\s*\(category\s+in\s*\('macro',\s*'strategy',\s*'sector',\s*'other'\)\)/i)
  assert.match(sql, /target_source\s+text[\s\S]*?'topi_metadata'[\s\S]*?'report_extracted'/i)
  assert.match(sql, /broker recommendation[^']*source opinion/i)
  assert.match(sql, /grant\s+select\s+on\s+table[\s\S]*market_research_reports[\s\S]*to\s+authenticated/i)
  assert.match(sql, /grant\s+all\s+privileges\s+on\s+table[\s\S]*market_research_reports[\s\S]*to\s+service_role/i)
  assert.match(sql, /revoke\s+all[^;]*market_research_reports[^;]*from\s+anon/i)
})

test("QEO-81 pending report schema preserves OCR terminals and route-aware analysis identity", () => {
  const sql = qeo80Migration()

  assert.match(sql, /ingestion_status[\s\S]*?'needs_ocr'/i)
  assert.match(sql, /analysis_status[\s\S]*?'needs_ocr'/i)
  assert.match(sql, /model_route_key\s+text\s+not\s+null/i)
  assert.match(sql, /reasoning_effort\s+text\s+not\s+null/i)
  assert.match(sql, /chunk_version\s+text\s+not\s+null/i)
  assert.match(sql, /unique\s*\(report_id,\s*content_hash,\s*analysis_version,\s*prompt_version,\s*model_route_key\)/i)
  assert.match(sql, /unique\s*\(report_id,\s*content_hash,\s*chunk_version,\s*page_number,\s*chunk_index\)/i)
  assert.match(sql, /create\s+or\s+replace\s+function\s+public\.qeo_publish_research_report_analysis\s*\(/i)
  assert.match(sql, /revoke\s+all\s+on\s+function\s+public\.qeo_publish_research_report_analysis[\s\S]*?from\s+public,\s*anon,\s*authenticated/i)
  assert.match(sql, /grant\s+execute\s+on\s+function\s+public\.qeo_publish_research_report_analysis[\s\S]*?to\s+service_role/i)
})

test("QEO-83 catalog query normalization is URL-stable and bounded", () => {
  assert.deepEqual(normalizeResearchReportCatalogQuery({
    category: "SECTOR",
    q: "  dầu, khí_% (test)  ",
    source: "  PHS  ",
    from: "2026-09-05",
    to: "2026-08-01",
    page: "9999",
  }), {
    category: "sector",
    search: "dầu khí test",
    source: "PHS",
    fromDate: "2026-08-01",
    toDate: "2026-09-05",
    page: 500,
  })

  const invalid = normalizeResearchReportCatalogQuery({
    category: "other",
    from: "2026-02-31",
    to: "not-a-date",
    page: "0",
  })
  assert.equal(invalid.category, null)
  assert.equal(invalid.fromDate, null)
  assert.equal(invalid.toDate, null)
  assert.equal(invalid.page, 1)
})

test("QEO-83 catalog is canonical metadata-only server UI with explicit lifecycle states", () => {
  const service = readFileSync("modules/research-reports/catalog.ts", "utf8")
  const page = readFileSync("app/insights/reports/page.tsx", "utf8")
  const loading = readFileSync("app/insights/reports/loading.tsx", "utf8")
  const nav = readFileSync("components/top-nav.tsx", "utf8")

  assert.match(service, /order\("publish_date", \{ ascending: false \}\)[\s\S]*order\("id", \{ ascending: false \}\)/)
  assert.match(service, /range\(offset, offset \+ RESEARCH_REPORT_CATALOG_PAGE_SIZE - 1\)/)
  assert.doesNotMatch(service, /market_research_report_chunks|market_research_report_ticker_mentions/)
  assert.match(page, /canonical: "\/insights\/reports"/)
  assert.match(page, /getResearchReportCatalog/)
  assert.match(page, /name="q"/)
  assert.match(page, /name="source"/)
  assert.match(page, /name="from"/)
  assert.match(page, /name="to"/)
  assert.match(page, /Vĩ mô tiền tệ/)
  assert.match(page, /Chiến lược/)
  assert.match(page, /Ngành/)
  assert.match(page, /Đang xử lý/)
  assert.match(page, /Chưa phân tích/)
  assert.match(page, /Đọc PDF lỗi/)
  assert.match(page, /href=\{`\/research\/reports\/\$\{item\.id\}`\}/)
  assert.match(nav, /href: "\/insights\/reports"/)
  assert.match(loading, /TopNav/)
  assert.match(loading, /aria-busy="true"/)
})
