import assert from "node:assert/strict"
import test from "node:test"

import {
  parseVsdcAmendmentHtml,
  parseVsdcCorporateActionHtml,
  vsdcEventUrl,
} from "../../modules/market/corporate-actions/providers/vsdc.ts"

test("QEO-123 production VSDC parser preserves grouped stock ratios and exact provenance", () => {
  const notice = parseVsdcCorporateActionHtml(`
    <article>
      <div>Cập nhật ngày 02/10/2018 - 16:05:48</div>
      <div>Mã chứng khoán:</div><div>VHM</div>
      <div>Mã ISIN:</div><div>VN000000VHM0</div>
      <div>Sàn giao dịch:</div><div>HOSE</div>
      <div>Ngày đăng ký cuối cùng:</div><div>09/10/2018</div>
      <div>Lý do mục đích:</div><div>Trả cổ tức năm 2018 bằng cổ phiếu</div>
      <div>Tỷ lệ thực hiện:</div><div>1.000:250</div>
    </article>
  `, "https://vsdc.vn/vi/ad/50366")

  assert.equal(notice.source, "vsdc")
  assert.equal(notice.sourceEventId, "50366")
  assert.equal(notice.ticker, "VHM")
  assert.equal(notice.isin, "VN000000VHM0")
  assert.equal(notice.exchange, "HOSE")
  assert.equal(notice.recordDate, "2018-10-09")
  assert.equal(notice.sourceUpdatedAt, "2018-10-02T16:05:48+07:00")
  assert.match(notice.rawEvidenceHash, /^[a-f0-9]{64}$/)
  assert.deepEqual(notice.components, [{
    actionType: "stock_dividend",
    cashPerShare: null,
    stockRatio: "1000:250",
    rightsRatio: null,
    subscriptionPrice: null,
  }])
})

test("QEO-123 production VSDC parser preserves one notice with cash plus stock components", () => {
  const notice = parseVsdcCorporateActionHtml(`
    <article>
      <div>Mã chứng khoán: VHM</div>
      <div>Mã ISIN: VN000000VHM0</div>
      <div>Nơi giao dịch: HOSE</div>
      <div>Ngày đăng ký cuối cùng: 16/09/2021</div>
      <div>Lý do mục đích:</div>
      <div>1. Chi trả cổ tức bằng tiền năm 2020</div>
      <div>Tỷ lệ thực hiện: 15%/cổ phiếu (01 cổ phiếu được nhận 1.500 đồng)</div>
      <div>2. Chi trả cổ tức năm 2020 bằng cổ phiếu</div>
      <div>Tỷ lệ thực hiện: 1.000:300</div>
    </article>
  `, "https://vsdc.vn/vi/ad1/144349")

  assert.deepEqual(notice.components, [
    {
      actionType: "cash_dividend",
      cashPerShare: 1500,
      stockRatio: null,
      rightsRatio: null,
      subscriptionPrice: null,
    },
    {
      actionType: "stock_dividend",
      cashPerShare: null,
      stockRatio: "1000:300",
      rightsRatio: null,
      subscriptionPrice: null,
    },
  ])
})

test("QEO-123 production VSDC parser handles rights, bonus issues and stock splits distinctly", () => {
  const rights = parseVsdcCorporateActionHtml(`
    <article>
      <div>Mã chứng khoán: YTC</div><div>Nơi giao dịch: UPCOM</div>
      <div>Ngày đăng ký cuối cùng: 16/04/2024</div>
      <div>Lý do mục đích: Thực hiện quyền mua cổ phiếu</div>
      <div>Tỷ lệ thực hiện: 100:210</div><div>Giá phát hành: 20.000 đồng/cổ phiếu</div>
    </article>
  `, "https://vsdc.vn/vi/ad1/169561")
  assert.deepEqual(rights.components, [{
    actionType: "rights_issue",
    cashPerShare: null,
    stockRatio: null,
    rightsRatio: "100:210",
    subscriptionPrice: 20000,
  }])

  const bonus = parseVsdcCorporateActionHtml(`
    <article><div>Mã chứng khoán: AAA</div><div>Nơi giao dịch: HOSE</div>
    <div>Ngày đăng ký cuối cùng: 10/01/2026</div><div>Lý do mục đích: Phát hành cổ phiếu thưởng</div>
    <div>Tỷ lệ thực hiện: 100:10</div></article>
  `, "https://vsdc.vn/vi/ad/100001")
  assert.equal(bonus.components[0]?.actionType, "bonus_issue")

  const split = parseVsdcCorporateActionHtml(`
    <article><div>Mã chứng khoán: BBB</div><div>Nơi giao dịch: HNX</div>
    <div>Ngày đăng ký cuối cùng: 12/01/2026</div><div>Lý do mục đích: Tách cổ phiếu</div>
    <div>Tỷ lệ thực hiện: 1:2</div></article>
  `, "https://vsdc.vn/vi/ad/100002")
  assert.equal(split.components[0]?.actionType, "stock_split")
})

test("QEO-123 parser decodes entities exactly once and ignores related-news contamination", () => {
  const notice = parseVsdcCorporateActionHtml(`
    <article>
      <div>C&#x1EAD;p nh&#x1EAD;t ng&#xE0;y 21/07/2026 - 16:29:39</div>
      <div>Mã chứng khoán: VHM</div><div>Mã ISIN: &amp;lt;encoded&amp;gt;</div>
      <div>Nơi giao dịch: HOSE</div><div>Ngày đăng ký cuối cùng: 07/08/2026</div>
      <div>Lý do mục đích: Chi trả cổ tức năm 2025 bằng cổ phiếu</div>
      <div>Tỷ lệ thực hiện: 1:1</div>
    </article>
    <section>Tin cùng tổ chức</section><div>VHM: Chi trả cổ tức bằng tiền 6.000 đồng</div>
  `, "https://vsdc.vn/vi/ad/198392")

  assert.equal(notice.isin, "&lt;encoded&gt;")
  assert.equal(notice.sourceUpdatedAt, "2026-07-21T16:29:39+07:00")
  assert.deepEqual(notice.components, [{
    actionType: "stock_dividend",
    cashPerShare: null,
    stockRatio: "1:1",
    rightsRatio: null,
    subscriptionPrice: null,
  }])
})

test("QEO-123 amendment parser retains explicit notice lineage without guessing source event mapping", () => {
  const amendment = parseVsdcAmendmentHtml(`
    <article>
      <div>SNC: Đính chính thông tin tại thông báo về ngày đăng ký cuối cùng để thực hiện quyền cho người sở hữu chứng khoán</div>
      <div>Cập nhật ngày 11/08/2026 - 11:10:33</div>
      <div>Liên quan đến Thông báo số 1515/TB-CNVSDC ngày 06/8/2026 về ngày đăng ký cuối cùng để thực hiện quyền cho người sở hữu chứng khoán của Công ty, mã chứng khoán SNC.</div>
    </article>
  `, "https://vsdc.vn/vi/ad/199110")

  assert.equal(amendment.sourceEventId, "199110")
  assert.equal(amendment.ticker, "SNC")
  assert.equal(amendment.referencedNoticeNumber, "1515/TB-CNVSDC")
  assert.equal(amendment.referencedNoticeDate, "2026-08-06")
  assert.equal(amendment.amendmentType, "correction")
  assert.equal(amendment.referencedSourceEventId, null)
})

test("QEO-123 runtime event URLs are compile-time current-host only and reject arbitrary input", () => {
  assert.equal(vsdcEventUrl("50366", "ad"), "https://vsdc.vn/vi/ad/50366")
  assert.equal(vsdcEventUrl("144349", "ad1"), "https://vsdc.vn/vi/ad1/144349")
  assert.throws(() => vsdcEventUrl("../evil", "ad"), /invalid VSDC event id/i)
})
