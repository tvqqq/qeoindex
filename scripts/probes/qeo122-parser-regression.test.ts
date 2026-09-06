import assert from "node:assert/strict"
import test from "node:test"

import {
  parseVsdcAmendmentHtml,
  parseVsdcCorporateActionHtml,
} from "./qeo122-vsdc-corporate-actions.ts"

test("QEO-122 parses Vietnamese thousands-separated stock ratios without shrinking 1.000 to 1", () => {
  const notice = parseVsdcCorporateActionHtml(`
    <article>
      <div>Cập nhật ngày 02/10/2018 - 16:05:48</div>
      <div>Mã chứng khoán: VHM</div>
      <div>Mã ISIN: VN000000VHM0</div>
      <div>Sàn giao dịch: HOSE</div>
      <div>Ngày đăng ký cuối cùng: 09/10/2018</div>
      <div>Lý do mục đích: Trả cổ tức năm 2018 bằng cổ phiếu</div>
      <div>Tỷ lệ thực hiện: 1.000:250 (Người sở hữu 1.000 cổ phiếu được nhận 250 cổ phiếu mới)</div>
    </article>
  `, "https://vsdc.vn/vi/ad/50366")

  assert.equal(notice.sourceUpdatedAt, "2018-10-02T16:05:48+07:00")
  assert.deepEqual(notice.components, [
    {
      actionType: "stock_dividend",
      cashPerShare: null,
      stockRatio: "1000:250",
      rightsRatio: null,
      subscriptionPrice: null,
    },
  ])
})

test("QEO-122 uses the numeric VSDC event id as stable identity across legacy/current host aliases", () => {
  const html = `
    <article>
      <div>Mã chứng khoán: VHM</div>
      <div>Sàn giao dịch: HOSE</div>
      <div>Ngày đăng ký cuối cùng: 09/10/2018</div>
      <div>Lý do mục đích: Trả cổ tức năm 2018 bằng cổ phiếu</div>
      <div>Tỷ lệ thực hiện: 1.000:250</div>
    </article>
  `
  const current = parseVsdcCorporateActionHtml(html, "https://vsdc.vn/vi/ad/50366")
  const legacy = parseVsdcCorporateActionHtml(html, "https://www.vsd.vn/vi/ad1/50366")
  assert.equal(current.sourceEventId, "50366")
  assert.equal(legacy.sourceEventId, "50366")
})

test("QEO-122 parses explicit VSDC correction lineage instead of guessing amendment identity", () => {
  const amendment = parseVsdcAmendmentHtml(`
    <article>
      <div>SNC: Đính chính thông tin tại thông báo về ngày đăng ký cuối cùng để thực hiện quyền cho người sở hữu chứng khoán</div>
      <div>Cập nhật ngày 18/08/2026 - 15:30:00</div>
      <div>Liên quan đến Thông báo số 1515/TB-CNVSDC ngày 06/8/2026 về ngày đăng ký cuối cùng để thực hiện quyền cho người sở hữu chứng khoán của Công ty cổ phần Xuất nhập khẩu Thủy sản Năm Căn, mã chứng khoán SNC.</div>
      <div>Thông tin đã thông báo: Tỷ lệ thực hiện: 12%/cổ phiếu (01 cổ phiếu nhận được 01 quyền).</div>
      <div>Thông tin điều chỉnh: Chi trả cổ tức bằng tiền năm 2025; Tỷ lệ thực hiện: 12%/cổ phiếu (01 cổ phiếu được nhận 1.200 đồng).</div>
      <div>Các nội dung khác tại Thông báo số 1515/TB-CNVSDC ngày 06/8/2026 không thay đổi.</div>
    </article>
  `, "https://www.vsd.vn/vi/ad/199110")

  assert.equal(amendment.sourceEventId, "199110")
  assert.equal(amendment.ticker, "SNC")
  assert.equal(amendment.sourceUpdatedAt, "2026-08-18T15:30:00+07:00")
  assert.equal(amendment.referencedNoticeNumber, "1515/TB-CNVSDC")
  assert.equal(amendment.referencedNoticeDate, "2026-08-06")
  assert.equal(amendment.amendmentType, "correction")
  assert.match(amendment.rawTextHash, /^[a-f0-9]{64}$/)
})
