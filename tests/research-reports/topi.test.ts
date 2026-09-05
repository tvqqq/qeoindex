import assert from "node:assert/strict"
import test from "node:test"

import { discoverTopiReports, fetchTopiReportsPage } from "../../modules/research-reports/providers/topi.ts"

function report(reportId: number, publishDate: string) {
  return {
    code: "MSN",
    link: `report-${reportId}`,
    name: `Report ${reportId}`,
    publish_date: publishDate,
    recommended: "TRUNG LẬP",
    reportId,
    sector: null,
    source_name: "TEST",
    target_price: 0,
    type_report: "Báo cáo doanh nghiệp",
    url: `https://cdn02.wigroup.vn/report-${reportId}.pdf`,
  }
}

function pageFetch(pages: Record<number, unknown[]>) {
  return (async (_input: URL | RequestInfo, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { page: number }
    return new Response(JSON.stringify({ data: { list: pages[body.page] ?? [] } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch
}

test("QEO-85 TOPI backfill sends bounded provider dates and retries a transient failure", async () => {
  let calls = 0
  const bodies: Array<Record<string, unknown>> = []
  const fetchImpl = (async (_input: URL | RequestInfo, init?: RequestInit) => {
    calls += 1
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    if (calls === 1) return new Response("temporary", { status: 503 })
    return new Response(JSON.stringify({ data: { list: [report(930, "05/09/2026")] } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch

  const rows = await fetchTopiReportsPage({
    page: 1,
    limit: 15,
    fromDate: "2026-08-01",
    toDate: "2026-09-05",
    transientAttempts: 2,
    fetchImpl,
  })

  assert.equal(calls, 2)
  assert.equal(rows[0]?.externalReportId, "930")
  for (const body of bodies) {
    assert.equal(body.from_date, "2026-08-01")
    assert.equal(body.to_date, "2026-09-05")
    assert.equal(body.page, 1)
  }
})

test("QEO-85 discovery does not stop at the first known id when a reordered unseen report follows", async () => {
  const result = await discoverTopiReports({
    knownExternalReportIds: new Set(["900", "899", "898", "897"]),
    recentPublishDateFloor: "2026-08-01",
    pageSize: 3,
    maxPages: 3,
    fetchImpl: pageFetch({
      1: [report(901, "05/09/2026"), report(900, "05/09/2026"), report(902, "04/09/2026")],
      2: [report(899, "01/07/2026"), report(898, "01/07/2026"), report(897, "01/07/2026")],
    }),
  })

  assert.deepEqual(result.reports.map((item) => item.externalReportId), ["901", "900", "902"])
  assert.equal(result.pagesFetched, 2)
  assert.equal(result.stoppedAtKnownBoundary, true)
  assert.equal(result.boundaryReason, "known_old_page")
  assert.equal(result.reachedSafetyLimit, false)
})

test("QEO-85 discovery marks max-pages exhaustion as a safety limit", async () => {
  const result = await discoverTopiReports({
    knownExternalReportIds: new Set<string>(),
    recentPublishDateFloor: "2026-08-01",
    pageSize: 2,
    maxPages: 2,
    fetchImpl: pageFetch({
      1: [report(910, "05/09/2026"), report(909, "05/09/2026")],
      2: [report(908, "04/09/2026"), report(907, "04/09/2026")],
    }),
  })

  assert.equal(result.pagesFetched, 2)
  assert.equal(result.reachedSafetyLimit, true)
  assert.equal(result.boundaryReason, "max_pages")
})

test("QEO-85 discovery stops cleanly on a short page without claiming safety exhaustion", async () => {
  const result = await discoverTopiReports({
    knownExternalReportIds: new Set<string>(),
    recentPublishDateFloor: "2026-08-01",
    pageSize: 3,
    maxPages: 8,
    fetchImpl: pageFetch({
      1: [report(920, "05/09/2026")],
    }),
  })

  assert.equal(result.pagesFetched, 1)
  assert.equal(result.reachedSafetyLimit, false)
  assert.equal(result.boundaryReason, "short_page")
})
