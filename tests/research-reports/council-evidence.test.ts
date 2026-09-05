import assert from "node:assert/strict"
import test from "node:test"

import {
  COUNCIL_REPORT_MARKET_LIMIT,
  COUNCIL_REPORT_MARKET_LOOKBACK_DAYS,
  COUNCIL_REPORT_MAX_PROMPT_CHARS,
  COUNCIL_REPORT_TICKER_LIMIT,
  COUNCIL_REPORT_TICKER_LOOKBACK_DAYS,
  getRelevantMarketReportEvidence,
  getRelevantReportEvidence,
  selectCouncilReportEvidence,
} from "../../modules/research-reports/council-evidence.ts"

type Row = Record<string, unknown>

type Fixture = {
  reports: Row[]
  analyses: Row[]
  mentions: Row[]
}

class FixtureQuery implements PromiseLike<{ data: Row[]; error: null }> {
  filters: Array<(row: Row) => boolean> = []
  rowLimit: number | null = null
  rows: Row[]

  constructor(rows: Row[]) {
    this.rows = rows
  }

  select(_columns: string) { return this }
  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value)
    return this
  }
  lte(column: string, value: string) {
    this.filters.push((row) => typeof row[column] === "string" && String(row[column]) <= value)
    return this
  }
  gte(column: string, value: string) {
    this.filters.push((row) => typeof row[column] === "string" && String(row[column]) >= value)
    return this
  }
  in(column: string, values: unknown[]) {
    const allowed = new Set(values)
    this.filters.push((row) => allowed.has(row[column]))
    return this
  }
  order(_column: string, _options?: { ascending?: boolean }) { return this }
  limit(value: number) {
    this.rowLimit = value
    return this
  }

  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    let data = this.rows.filter((row) => this.filters.every((filter) => filter(row)))
    if (this.rowLimit != null) data = data.slice(0, this.rowLimit)
    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected)
  }
}

class FixtureClient {
  readonly touchedTables: string[] = []
  fixture: Fixture

  constructor(fixture: Fixture) {
    this.fixture = fixture
  }

  from(table: string) {
    this.touchedTables.push(table)
    if (table === "market_research_reports") return new FixtureQuery(this.fixture.reports)
    if (table === "market_research_report_analyses") return new FixtureQuery(this.fixture.analyses)
    if (table === "market_research_report_ticker_mentions") return new FixtureQuery(this.fixture.mentions)
    throw new Error(`unexpected table ${table}`)
  }
}

const HASH_A = "a".repeat(64)
const RUN_AT = "2026-09-05T07:00:00Z"
const AS_OF = "2026-09-05"

function report(id: string, publishDate: string, category: "macro" | "strategy" | "sector" | "other" = "sector", extras: Row = {}): Row {
  return {
    id,
    provider: "topi",
    source_name: "SSI Research",
    title: `Report ${id}`,
    publish_date: publishDate,
    category,
    created_at: `${publishDate}T01:00:00Z`,
    ...extras,
  }
}

function analysis(id: string, reportId: string, processedAt: string, extras: Row = {}): Row {
  return {
    id,
    report_id: reportId,
    content_hash: HASH_A,
    analysis_version: "report-analysis-v1",
    prompt_version: "report-analysis-prompt-v1",
    model_route_key: "luna-default",
    processed_at: processedAt,
    executive_summary: `Summary ${id}`,
    market_view: null,
    sector_outlook: null,
    catalysts: [],
    risks: [],
    ...extras,
  }
}

function mention(reportId: string, analysisId: string, ticker = "MSN", extras: Row = {}): Row {
  return {
    report_id: reportId,
    analysis_id: analysisId,
    ticker,
    stance: "positive",
    recommendation_text: "BUY",
    target_price: 120,
    target_currency: "VND",
    rationale: "Constructive source opinion",
    evidence: [{ page: 7, snippet: "Source-opinion evidence" }],
    created_at: "2026-09-04T02:00:00Z",
    ...extras,
  }
}

function client(fixture: Fixture) {
  return new FixtureClient(fixture)
}

test("Council ticker report selector is bounded to newest 3 reports within 90 days", async () => {
  assert.equal(COUNCIL_REPORT_TICKER_LIMIT, 3)
  assert.equal(COUNCIL_REPORT_TICKER_LOOKBACK_DAYS, 90)

  const fixture: Fixture = {
    reports: [
      report("r1", "2026-09-04"),
      report("r2", "2026-09-03"),
      report("r3", "2026-09-02"),
      report("r4", "2026-09-01"),
      report("r-old", "2026-05-01"),
    ],
    analyses: [
      analysis("a1", "r1", "2026-09-04T03:00:00Z"),
      analysis("a2", "r2", "2026-09-03T03:00:00Z"),
      analysis("a3", "r3", "2026-09-02T03:00:00Z"),
      analysis("a4", "r4", "2026-09-01T03:00:00Z"),
      analysis("a-old", "r-old", "2026-05-01T03:00:00Z"),
    ],
    mentions: [
      mention("r1", "a1"),
      mention("r2", "a2"),
      mention("r3", "a3"),
      mention("r4", "a4"),
      mention("r-old", "a-old"),
    ],
  }

  const result = await getRelevantReportEvidence(client(fixture) as never, {
    ticker: "MSN",
    asOf: AS_OF,
    runAt: RUN_AT,
  })

  assert.deepEqual(result.map((row) => row.reportId), ["r1", "r2", "r3"])
  assert.ok(result.every((row) => row.roles.includes("ticker")))
})

test("Council selector freezes newest analysis that actually existed at runAt and excludes future rows", async () => {
  const fixture: Fixture = {
    reports: [
      report("r1", "2026-09-01"),
      report("r-future-created", "2026-09-02", "sector", { created_at: "2026-09-06T01:00:00Z" }),
      report("r-future-publish", "2026-09-06"),
      report("r-future-mention", "2026-09-02"),
    ],
    analyses: [
      analysis("a-old", "r1", "2026-09-01T01:00:00Z", { content_hash: "1".repeat(64) }),
      analysis("a-future", "r1", "2026-09-06T01:00:00Z", { content_hash: "2".repeat(64) }),
      analysis("a-created", "r-future-created", "2026-09-02T03:00:00Z"),
      analysis("a-publish", "r-future-publish", "2026-09-04T03:00:00Z"),
      analysis("a-mention", "r-future-mention", "2026-09-02T03:00:00Z"),
    ],
    mentions: [
      mention("r1", "a-old"),
      mention("r1", "a-future"),
      mention("r-future-created", "a-created"),
      mention("r-future-publish", "a-publish"),
      mention("r-future-mention", "a-mention", "MSN", { created_at: "2026-09-06T02:00:00Z" }),
    ],
  }

  const result = await getRelevantReportEvidence(client(fixture) as never, {
    ticker: "MSN",
    asOf: AS_OF,
    runAt: RUN_AT,
  })

  assert.equal(result.length, 1)
  assert.equal(result[0].reportId, "r1")
  assert.equal(result[0].analysisId, "a-old")
  assert.equal(result[0].contentHash, "1".repeat(64))
})

test("market selector prefers macro before strategy and is bounded to 2 reports in 30 days", async () => {
  assert.equal(COUNCIL_REPORT_MARKET_LIMIT, 2)
  assert.equal(COUNCIL_REPORT_MARKET_LOOKBACK_DAYS, 30)

  const fixture: Fixture = {
    reports: [
      report("m2", "2026-08-20", "macro"),
      report("s1", "2026-09-04", "strategy"),
      report("m1", "2026-08-25", "macro"),
      report("s2", "2026-09-03", "strategy"),
      report("m-old", "2026-06-01", "macro"),
    ],
    analyses: [
      analysis("am2", "m2", "2026-08-20T03:00:00Z"),
      analysis("as1", "s1", "2026-09-04T03:00:00Z"),
      analysis("am1", "m1", "2026-08-25T03:00:00Z"),
      analysis("as2", "s2", "2026-09-03T03:00:00Z"),
      analysis("am-old", "m-old", "2026-06-01T03:00:00Z"),
    ],
    mentions: [],
  }

  const result = await getRelevantMarketReportEvidence(client(fixture) as never, {
    ticker: "MSN",
    asOf: AS_OF,
    runAt: RUN_AT,
  })

  assert.deepEqual(result.map((row) => row.reportId), ["m1", "m2"])
  assert.ok(result.every((row) => row.roles.includes("market")))
})

test("combined Council selection dedupes one report-analysis identity and preserves both roles", async () => {
  const fixture: Fixture = {
    reports: [report("r1", "2026-09-04", "macro")],
    analyses: [analysis("a1", "r1", "2026-09-04T03:00:00Z")],
    mentions: [mention("r1", "a1")],
  }

  const result = await selectCouncilReportEvidence(client(fixture) as never, {
    ticker: "MSN",
    asOf: AS_OF,
    runAt: RUN_AT,
  })

  assert.equal(result.reports.length, 1)
  assert.deepEqual(result.reports[0].roles, ["ticker", "market"])
})

test("combined selection is prompt-safe, bounded and never reads raw report chunks", async () => {
  const huge = "X".repeat(8_000)
  const fixture: Fixture = {
    reports: [
      report("r1", "2026-09-04", "macro"),
      report("r2", "2026-09-03", "strategy"),
      report("r3", "2026-09-02", "sector"),
    ],
    analyses: [
      analysis("a1", "r1", "2026-09-04T03:00:00Z", { executive_summary: huge, market_view: huge, catalysts: [huge], risks: [huge] }),
      analysis("a2", "r2", "2026-09-03T03:00:00Z", { executive_summary: huge, sector_outlook: huge }),
      analysis("a3", "r3", "2026-09-02T03:00:00Z", { executive_summary: huge }),
    ],
    mentions: [
      mention("r1", "a1", "MSN", { rationale: huge, evidence: [{ page: 11, snippet: huge }] }),
      mention("r3", "a3", "MSN", { rationale: huge, evidence: [{ page: 5, snippet: huge }] }),
    ],
  }
  const fixtureClient = client(fixture)

  const result = await selectCouncilReportEvidence(fixtureClient as never, {
    ticker: "MSN",
    asOf: AS_OF,
    runAt: RUN_AT,
  })

  assert.ok(result.promptChars <= COUNCIL_REPORT_MAX_PROMPT_CHARS)
  assert.ok(JSON.stringify(result.reports).length <= COUNCIL_REPORT_MAX_PROMPT_CHARS)
  assert.equal(fixtureClient.touchedTables.includes("market_research_report_chunks"), false)
  assert.equal(Object.hasOwn(result.reports[0], "content"), false)
  const tickerEvidence = result.reports.find((row) => row.tickerMention)
  assert.equal(tickerEvidence?.tickerMention?.sourceOpinion, true)
  assert.equal(tickerEvidence?.tickerMention?.ticker, "MSN")
  assert.ok(tickerEvidence?.reportId)
  assert.ok(tickerEvidence?.analysisId)
  assert.ok(tickerEvidence?.contentHash)
  assert.equal(result.truncated, true)
})
