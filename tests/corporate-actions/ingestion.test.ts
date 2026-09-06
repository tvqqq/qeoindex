import assert from "node:assert/strict"
import test from "node:test"

import { fetchCorporateActionsForTicker } from "../../modules/market/corporate-actions/ingest.ts"

const cashHtml = `
<article>
  <div>Cập nhật ngày 19/06/2026 - 09:42:40</div>
  <div>Mã chứng khoán: VHM</div>
  <div>Mã ISIN: VN000000VHM0</div>
  <div>Nơi giao dịch: HOSE</div>
  <div>Ngày đăng ký cuối cùng: 30/06/2026</div>
  <div>Lý do mục đích: Chi trả cổ tức bằng tiền mặt</div>
  <div>Tỷ lệ thực hiện: 60%/cổ phiếu (01 cổ phiếu được nhận 6.000 đồng)</div>
</article>`

const stockHtml = `
<article>
  <div>Cập nhật ngày 21/07/2026 - 16:29:39</div>
  <div>Mã chứng khoán: VHM</div>
  <div>Mã ISIN: VN000000VHM0</div>
  <div>Nơi giao dịch: HOSE</div>
  <div>Ngày đăng ký cuối cùng: 07/08/2026</div>
  <div>Lý do mục đích: Chi trả cổ tức năm 2025 bằng cổ phiếu</div>
  <div>Tỷ lệ thực hiện: 1:1</div>
</article>`

const meetingHtml = `
<article>
  <div>Mã chứng khoán: VHM</div>
  <div>Mã ISIN: VN000000VHM0</div>
  <div>Nơi giao dịch: HOSE</div>
  <div>Ngày đăng ký cuối cùng: 18/03/2026</div>
  <div>Lý do mục đích: Tham dự Đại hội đồng cổ đông thường niên năm 2026</div>
</article>`

test("QEO-123 end-to-end adapter discovers, parses and derives proven ex-dates while skipping non-adjusting rights", async () => {
  const fetched: string[] = []
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input)
    fetched.push(url)
    const html = url.endsWith("/197086") ? cashHtml : url.endsWith("/198392") ? stockHtml : meetingHtml
    return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })
  }) as typeof fetch

  const result = await fetchCorporateActionsForTicker("vhm", {
    asOf: "2026-09-06",
    fetchImpl,
    discover: async () => ({
      ticker: "VHM",
      issuerId: "1",
      securityId: "6951",
      securityUrl: "https://vsdc.vn/vi/s-detail/6951",
      eventIds: ["197086", "198392", "192580"],
    }),
  })

  assert.deepEqual(fetched, [
    "https://vsdc.vn/vi/ad/197086",
    "https://vsdc.vn/vi/ad/198392",
    "https://vsdc.vn/vi/ad/192580",
  ])
  assert.equal(result.actions.length, 2)
  assert.deepEqual(result.actions.map((row) => [row.sourceEventId, row.exDate, row.exDateBasis]), [
    ["197086", "2026-06-29", "derived"],
    ["198392", "2026-08-06", "derived"],
  ])
  assert.equal(result.skipped.length, 1)
  assert.deepEqual(result.skipped[0], { sourceEventId: "192580", reason: "unsupported_non_adjusting_event" })
})

test("QEO-123 end-to-end adapter fails closed when record-date calendar coverage is unproven", async () => {
  const oldHtml = cashHtml.replace("30/06/2026", "29/12/2017")
  const fetchImpl = (async () => new Response(oldHtml, { status: 200 })) as typeof fetch

  const result = await fetchCorporateActionsForTicker("VHM", {
    asOf: "2026-09-06",
    fetchImpl,
    discover: async () => ({ ticker: "VHM", issuerId: "1", securityId: "6951", securityUrl: "x", eventIds: ["197086"] }),
  })

  assert.equal(result.actions.length, 1)
  assert.equal(result.actions[0]?.exDate, null)
  assert.equal(result.actions[0]?.exDateBasis, "unknown")
})
