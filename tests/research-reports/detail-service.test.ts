import assert from "node:assert/strict"
import test from "node:test"

import { findResearchReportPdfSource } from "../../modules/research-reports/detail/repository.ts"
import { getResearchReportDetail } from "../../modules/research-reports/detail/service.ts"

const REPORT_ID = "11111111-1111-4111-8111-111111111111"
const ANALYSIS_ID = "22222222-2222-4222-8222-222222222222"
const OTHER_ANALYSIS_ID = "33333333-3333-4333-8333-333333333333"
const CURRENT_HASH = "a".repeat(64)
const OLD_HASH = "b".repeat(64)

type Row = Record<string, unknown>
type QueryLog = {
  table: string
  columns: string | null
  filters: Record<string, unknown>
  orders: string[]
  limit: number | null
}

type Fixture = {
  report?: Row | null
  analyses?: Row[]
  mentions?: Row[]
}

class FakeDetailClient {
  readonly queries: QueryLog[] = []
  private readonly fixture: Required<Fixture>

  constructor(fixture: Fixture = {}) {
    this.fixture = {
      report: fixture.report === undefined ? baseReport() : fixture.report,
      analyses: fixture.analyses ?? [baseAnalysis()],
      mentions: fixture.mentions ?? [baseMention()],
    }
  }

  from(table: string): any {
    const log: QueryLog = {
      table,
      columns: null,
      filters: {},
      orders: [],
      limit: null,
    }
    this.queries.push(log)

    const query: any = {
      select: (columns: string) => {
        log.columns = columns
        return query
      },
      eq: (column: string, value: unknown) => {
        log.filters[column] = value
        return query
      },
      order: (column: string, options?: { ascending?: boolean }) => {
        log.orders.push(`${column}:${options?.ascending === false ? "desc" : "asc"}`)
        return query
      },
      limit: (value: number) => {
        log.limit = value
        return query
      },
      maybeSingle: async () => ({ data: this.rowsFor(log)[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => (
        Promise.resolve({ data: this.rowsFor(log), error: null }).then(resolve, reject)
      ),
    }

    return query
  }

  query(table: string) {
    const value = this.queries.find((entry) => entry.table === table)
    assert.ok(value, `expected query for ${table}`)
    return value
  }

  private rowsFor(log: QueryLog): Row[] {
    let rows: Row[]
    switch (log.table) {
      case "market_research_reports":
        rows = this.fixture.report ? [{ ...this.fixture.report }] : []
        break
      case "market_research_report_analyses":
        rows = this.fixture.analyses.map((row) => ({ ...row }))
        break
      case "market_research_report_ticker_mentions":
        rows = this.fixture.mentions.map((row) => ({ ...row }))
        break
      default:
        throw new Error(`unexpected table ${log.table}`)
    }

    rows = rows.filter((row) => (
      Object.entries(log.filters).every(([key, value]) => row[key] === value)
    ))

    if (log.orders.length > 0) {
      rows.sort((left, right) => {
        for (const order of log.orders) {
          const [column, direction] = order.split(":")
          const a = String(left[column] ?? "")
          const b = String(right[column] ?? "")
          if (a === b) continue
          const comparison = a < b ? -1 : 1
          return direction === "desc" ? -comparison : comparison
        }
        return 0
      })
    }

    return log.limit === null ? rows : rows.slice(0, log.limit)
  }
}

function baseReport(overrides: Row = {}): Row {
  return {
    id: REPORT_ID,
    title: "Vietnam Strategy",
    source_name: "Broker A",
    publish_date: "2026-09-05",
    category: "strategy",
    sector_name: null,
    link: "https://broker.example/report/1",
    pdf_url: "https://cdn.example.com/private.pdf",
    source_payload: { secretProviderField: "must-not-leak" },
    content_hash: CURRENT_HASH,
    parsed_page_count: 18,
    ingestion_status: "parsed",
    analysis_status: "ready",
    ...overrides,
  }
}

function baseAnalysis(overrides: Row = {}): Row {
  return {
    id: ANALYSIS_ID,
    report_id: REPORT_ID,
    content_hash: CURRENT_HASH,
    executive_summary: "Summary",
    key_points: ["Point one"],
    market_view: "Constructive",
    sector_outlook: null,
    catalysts: ["Liquidity"],
    risks: ["FX"],
    confidence: { score: 80, flags: [] },
    model_requested: "gpt-5.6-luna",
    model_actual: "gpt-5.6-luna",
    processed_at: "2026-09-05T01:00:00Z",
    created_at: "2026-09-05T01:00:00Z",
    ...overrides,
  }
}

function baseMention(overrides: Row = {}): Row {
  return {
    analysis_id: ANALYSIS_ID,
    ticker: "MSN",
    stance: "positive",
    recommendation_text: "BUY",
    target_price: 110_000,
    target_currency: "VND",
    rationale: "Earnings recovery",
    evidence: [{ page: 7, snippet: "Target price 110,000 VND" }],
    ...overrides,
  }
}

test("selects only the latest analysis matching the report current content hash", async () => {
  const client = new FakeDetailClient({
    analyses: [
      baseAnalysis({
        id: OTHER_ANALYSIS_ID,
        content_hash: OLD_HASH,
        executive_summary: "Stale summary",
        processed_at: "2026-09-05T03:00:00Z",
        created_at: "2026-09-05T03:00:00Z",
      }),
      baseAnalysis(),
    ],
  })

  const result = await getResearchReportDetail(client, REPORT_ID)
  assert.equal(result.status, "found")
  assert.equal(result.status === "found" ? result.report.analysis?.analysisId : null, ANALYSIS_ID)
  assert.equal(result.status === "found" ? result.report.analysis?.executiveSummary : null, "Summary")

  const query = client.query("market_research_report_analyses")
  assert.equal(query.filters.report_id, REPORT_ID)
  assert.equal(query.filters.content_hash, CURRENT_HASH)
  assert.deepEqual(query.orders, ["processed_at:desc", "created_at:desc", "id:desc"])
  assert.equal(query.limit, 1)
})

test("browser view-model never contains raw PDF URL or provider payload", async () => {
  const client = new FakeDetailClient()
  const result = await getResearchReportDetail(client, REPORT_ID)
  assert.equal(result.status, "found")
  const serialized = JSON.stringify(result)
  assert.doesNotMatch(serialized, /pdf_url|private\.pdf|source_payload|secretProviderField/i)

  const query = client.query("market_research_reports")
  assert.doesNotMatch(query.columns ?? "", /pdf_url|source_payload/i)
})

test("server-only PDF source lookup reads only id title and stored pdf_url", async () => {
  const client = new FakeDetailClient()
  const source = await findResearchReportPdfSource(client, REPORT_ID)

  assert.deepEqual(source, {
    id: REPORT_ID,
    title: "Vietnam Strategy",
    pdfUrl: "https://cdn.example.com/private.pdf",
  })
  const query = client.query("market_research_reports")
  assert.equal(query.columns, "id,title,pdf_url")
  assert.equal(query.filters.id, REPORT_ID)
})

test("server-only PDF source lookup returns null for a missing report", async () => {
  const client = new FakeDetailClient({ report: null })
  assert.equal(await findResearchReportPdfSource(client, REPORT_ID), null)
})

test("ticker mentions are filtered to the selected current analysis", async () => {
  const client = new FakeDetailClient({
    mentions: [
      baseMention(),
      baseMention({ analysis_id: OTHER_ANALYSIS_ID, ticker: "FPT" }),
    ],
  })

  const result = await getResearchReportDetail(client, REPORT_ID)
  assert.equal(result.status, "found")
  assert.deepEqual(
    result.status === "found" ? result.report.analysis?.tickerMentions.map((item) => item.ticker) : [],
    ["MSN"],
  )
  assert.equal(client.query("market_research_report_ticker_mentions").filters.analysis_id, ANALYSIS_ID)
})

test("invalid and out-of-range ticker evidence pages are dropped", async () => {
  const client = new FakeDetailClient({
    report: baseReport({ parsed_page_count: 10 }),
    mentions: [baseMention({
      evidence: [
        { page: 0, snippet: "bad zero" },
        { page: 11, snippet: "bad high" },
        { page: 7, snippet: "  grounded evidence  " },
        { page: 8, snippet: "   " },
      ],
    })],
  })

  const result = await getResearchReportDetail(client, REPORT_ID)
  assert.equal(result.status, "found")
  assert.deepEqual(result.status === "found" ? result.report.analysis?.tickerMentions[0]?.evidence : null, [
    { page: 7, snippet: "grounded evidence" },
  ])
})

test("source link is exposed only when stored metadata is HTTPS", async () => {
  const safe = await getResearchReportDetail(
    new FakeDetailClient({ report: baseReport({ link: "https://broker.example/report" }) }),
    REPORT_ID,
  )
  const unsafe = await getResearchReportDetail(
    new FakeDetailClient({ report: baseReport({ link: "javascript:alert(1)" }) }),
    REPORT_ID,
  )

  assert.equal(safe.status === "found" ? safe.report.originalSourceLink : null, "https://broker.example/report")
  assert.equal(unsafe.status === "found" ? unsafe.report.originalSourceLink : null, null)
})

test("invalid UUID fails closed before any database query", async () => {
  const client = new FakeDetailClient()
  const result = await getResearchReportDetail(client, "not-a-uuid")
  assert.deepEqual(result, { status: "invalid_id" })
  assert.equal(client.queries.length, 0)
})

test("missing report resolves to not_found", async () => {
  const result = await getResearchReportDetail(new FakeDetailClient({ report: null }), REPORT_ID)
  assert.deepEqual(result, { status: "not_found" })
})

test("analysis lifecycle maps independently and does not query analysis when not ready", async () => {
  for (const [databaseStatus, expected] of [
    ["pending", "pending"],
    ["processing", "pending"],
    ["needs_ocr", "needs_ocr"],
    ["unsupported", "unsupported"],
    ["failed", "failed"],
  ] as const) {
    const client = new FakeDetailClient({ report: baseReport({ analysis_status: databaseStatus }) })
    const result = await getResearchReportDetail(client, REPORT_ID)
    assert.equal(result.status, "found")
    assert.equal(result.status === "found" ? result.report.analysisStatus : null, expected)
    assert.equal(result.status === "found" ? result.report.analysis : null, null)
    assert.equal(client.queries.some((query) => query.table === "market_research_report_analyses"), false)
  }
})

test("ready report with no exact-hash analysis fails closed as pending instead of showing stale data", async () => {
  const client = new FakeDetailClient({
    analyses: [baseAnalysis({ id: OTHER_ANALYSIS_ID, content_hash: OLD_HASH })],
    mentions: [],
  })

  const result = await getResearchReportDetail(client, REPORT_ID)
  assert.equal(result.status, "found")
  assert.equal(result.status === "found" ? result.report.analysisStatus : null, "pending")
  assert.equal(result.status === "found" ? result.report.analysis : null, null)
})

test("analysis metadata uses actual model when present and requested model as fallback", async () => {
  const actual = await getResearchReportDetail(new FakeDetailClient(), REPORT_ID)
  const fallback = await getResearchReportDetail(new FakeDetailClient({
    analyses: [baseAnalysis({ model_actual: null, model_requested: "gpt-5.6-terra" })],
  }), REPORT_ID)

  assert.equal(actual.status === "found" ? actual.report.analysis?.model : null, "gpt-5.6-luna")
  assert.equal(fallback.status === "found" ? fallback.report.analysis?.model : null, "gpt-5.6-terra")
})
