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

test("QEO-122 parses live VSDC metadata when a label and value render on adjacent lines", () => {
  const notice = parseVsdcCorporateActionHtml(`
    <article>
      <div>Cập nhật ngày 02/10/2018 - 16:05:48</div>
      <div>Mã chứng khoán:</div>
      <div>VHM</div>
      <div>Mã ISIN:</div>
      <div>VN000000VHM0</div>
      <div>Sàn giao dịch:</div>
      <div>HOSE</div>
      <div>Ngày đăng ký cuối cùng:</div>
      <div>09/10/2018</div>
      <div>Lý do mục đích:</div>
      <div>Trả cổ tức năm 2018 bằng cổ phiếu</div>
      <div>Tỷ lệ thực hiện:</div>
      <div>1.000:250 (Người sở hữu 1.000 cổ phiếu được nhận 250 cổ phiếu mới)</div>
    </article>
  `, "https://vsdc.vn/vi/ad/50366")

  assert.equal(notice.ticker, "VHM")
  assert.equal(notice.isin, "VN000000VHM0")
  assert.equal(notice.exchange, "HOSE")
  assert.equal(notice.recordDate, "2018-10-09")
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

test("QEO-122 ignores related-news action wording outside the main VSDC notice body", () => {
  const notice = parseVsdcCorporateActionHtml(`
    <article>
      <div>Cập nhật ngày 21/07/2026 - 16:29:39</div>
      <div>Mã chứng khoán: VHM</div>
      <div>Mã ISIN: VN000000VHM0</div>
      <div>Nơi giao dịch: HOSE</div>
      <div>Ngày đăng ký cuối cùng: 07/08/2026</div>
      <div>Lý do mục đích:</div>
      <div>Chi trả cổ tức năm 2025 bằng cổ phiếu</div>
      <div>Tỷ lệ thực hiện: 1:1 (Người sở hữu 01 cổ phiếu được nhận 01 cổ phiếu mới)</div>
    </article>
    <section>Tin cùng tổ chức</section>
    <li>VHM: Chi trả cổ tức bằng tiền mặt cho các cổ đông công ty từ lợi nhuận sau thuế lũy kế năm 2025</li>
  `, "https://vsdc.vn/vi/ad/198392")

  assert.deepEqual(notice.components, [
    {
      actionType: "stock_dividend",
      cashPerShare: null,
      stockRatio: "1:1",
      rightsRatio: null,
      subscriptionPrice: null,
    },
  ])
})

test("QEO-122 does not let non-action cash wording override an explicit stock-dividend purpose", () => {
  const notice = parseVsdcCorporateActionHtml(`
    <article>
      <div>Mã chứng khoán: VHM</div>
      <div>Mã ISIN: VN000000VHM0</div>
      <div>Sàn giao dịch: HOSE</div>
      <div>Ngày đăng ký cuối cùng: 09/10/2018</div>
      <span>Lý do mục đích: Trả cổ tức năm 2018 bằng cổ phiếu</span>
      <span>Tỷ lệ thực hiện: 1.000:250</span>
      <span>Thuế phát sinh được thanh toán bằng tiền theo quy định.</span>
    </article>
  `, "https://vsdc.vn/vi/ad/50366")

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

test("QEO-122 decodes VSDC numeric HTML entities before parsing source update timestamps", () => {
  const notice = parseVsdcCorporateActionHtml(`
    <article>
      <div>C&#x1EAD;p nh&#x1EAD;t ng&#xE0;y 19/06/2026 - 09:42:40</div>
      <div>Mã chứng khoán: VHM</div>
      <div>Mã ISIN: VN000000VHM0</div>
      <div>Nơi giao dịch: HOSE</div>
      <div>Ngày đăng ký cuối cùng: 30/06/2026</div>
      <div>Lý do mục đích: Chi trả cổ tức bằng tiền mặt</div>
      <div>Tỷ lệ thực hiện: 60%/cổ phiếu (01 cổ phiếu được nhận 6.000 đồng)</div>
    </article>
  `, "https://vsdc.vn/vi/ad1/197086")

  assert.equal(notice.sourceUpdatedAt, "2026-06-19T09:42:40+07:00")
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