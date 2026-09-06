import assert from "node:assert/strict"
import test from "node:test"

import {
  discoverVsdcCorporateActionEvents,
  parseExactVsdcIssuerSearch,
  parseExactVsdcSecuritySuggestion,
  parseVsdcRightsPage,
  parseVsdcSecurityIdForTicker,
} from "../../modules/market/corporate-actions/providers/vsdc-discovery.ts"

test("QEO-123 VSDC discovery accepts only an exact ticker suggestion", () => {
  const payload = {
    success: 0,
    data: [
      { id: 58095, name: "Cổ phiếu Công ty cổ phần Vinhomes", code: "VHM", content: "VHM: Cổ phiếu Công ty cổ phần Vinhomes" },
      { id: 7774, name: "Trái phiếu NHN102020", code: "VHM11726", content: "VHM11726: Trái phiếu NHN102020" },
    ],
  }

  assert.deepEqual(parseExactVsdcSecuritySuggestion(payload, "VHM"), {
    ticker: "VHM",
    securityName: "Cổ phiếu Công ty cổ phần Vinhomes",
    issuerName: "Công ty cổ phần Vinhomes",
  })
  assert.equal(parseExactVsdcSecuritySuggestion(payload, "VH"), null)
})

test("QEO-123 VSDC issuer search requires the canonical issuer-detail href", () => {
  const payload = {
    success: 0,
    data: [
      { content: "Vinhomes.,JSC: Công ty cổ phần Vinhomes", href: "/vi/id/2549" },
      { content: "Unrelated Vinhomes text", href: "/vi/ad/198392" },
    ],
  }

  assert.deepEqual(parseExactVsdcIssuerSearch(payload, "Công ty cổ phần Vinhomes"), {
    issuerId: "2549",
    href: "/vi/id/2549",
  })
})

test("QEO-123 VSDC issuer page resolves only the exact ticker security link", () => {
  const html = `
    <table>
      <tr><td><a href="/vi/s-detail/6951">VHM</a></td></tr>
      <tr><td><a href="/vi/s-detail/56096">VHM12605</a></td></tr>
    </table>
  `

  assert.equal(parseVsdcSecurityIdForTicker(html, "VHM"), "6951")
  assert.equal(parseVsdcSecurityIdForTicker(html, "VHM1"), null)
})

test("QEO-123 VSDC rights page parses numeric event ids and bounded pagination", () => {
  const html = `
    <table>
      <tr><td><a href="/ad/198392">VHM dividend</a></td></tr>
      <tr><td><a href="/vi/ad1/197086">VHM cash</a></td></tr>
      <tr><td><a href="/ad/198392">duplicate</a></td></tr>
    </table>
    <button onclick="changePage_THQ(1)">1</button>
    <button onclick="changePage_THQ(2)">2</button>
  `

  assert.deepEqual(parseVsdcRightsPage(html), {
    eventIds: ["198392", "197086"],
    maxPage: 2,
  })
})

test("QEO-123 VSDC discovery replays one browser session and walks all rights pages", async () => {
  const calls: Array<{ url: string; method: string; headers: Headers }> = []
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = String(input)
    const method = init.method ?? "GET"
    const headers = new Headers(init.headers)
    calls.push({ url, method, headers })

    if (url === "https://vsdc.vn/vi" && method === "GET") {
      return new Response('<meta name="__VPToken" content="HEADER_TOKEN">', {
        status: 200,
        headers: { "content-type": "text/html", "set-cookie": "__VPToken=COOKIE_TOKEN; Path=/; HttpOnly" },
      })
    }
    if (url.endsWith("/suggestion-search/isustocks")) {
      assert.equal(headers.get("__VPToken"), "HEADER_TOKEN")
      assert.match(headers.get("cookie") ?? "", /__VPToken=COOKIE_TOKEN/)
      assert.equal(headers.get("x-requested-with"), "XMLHttpRequest")
      return Response.json({ success: 0, data: [{ id: 58095, name: "Cổ phiếu Công ty cổ phần Vinhomes", code: "VHM", content: "VHM: Cổ phiếu Công ty cổ phần Vinhomes" }] })
    }
    if (url.endsWith("/search-suggest")) {
      return Response.json({ success: 0, data: [{ content: "Vinhomes.,JSC: Công ty cổ phần Vinhomes", href: "/vi/id/2549" }] })
    }
    if (url === "https://vsdc.vn/vi/id/2549") {
      return new Response('<a href="/vi/s-detail/6951">VHM</a>', { status: 200, headers: { "content-type": "text/html" } })
    }
    if (url === "https://vsdc.vn/vi/s-detail/6951") {
      return new Response('<div>Mã chứng khoán: VHM</div><div>Mã ISIN: VN000000VHM0</div>', { status: 200, headers: { "content-type": "text/html" } })
    }
    if (url.endsWith("/isuisser-thq/search")) {
      const body = JSON.parse(String(init.body ?? "{}")) as { CurrentPage?: number }
      if (body.CurrentPage === 1) {
        return new Response('<a href="/ad/198392">stock</a><a href="/ad/197086">cash</a><button onclick="changePage_THQ(2)">2</button>', { status: 200 })
      }
      if (body.CurrentPage === 2) {
        return new Response('<a href="/ad/144349">combined</a><a href="/ad/50366">historic</a><button onclick="changePage_THQ(2)">2</button>', { status: 200 })
      }
    }
    return new Response("unexpected", { status: 500 })
  }

  const result = await discoverVsdcCorporateActionEvents("VHM", { fetchImpl, requestDelayMs: 0, maxPages: 5 })

  assert.deepEqual(result, {
    ticker: "VHM",
    issuerId: "2549",
    securityId: "6951",
    securityUrl: "https://vsdc.vn/vi/s-detail/6951",
    eventIds: ["198392", "197086", "144349", "50366"],
  })
  assert.equal(calls.filter((call) => call.url.endsWith("/isuisser-thq/search")).length, 2)
})

test("QEO-123 VSDC discovery fails closed on ambiguous duplicate exact ticker rows", () => {
  const payload = {
    success: 0,
    data: [
      { id: 1, name: "Cổ phiếu Công ty A", code: "VHM", content: "VHM: A" },
      { id: 2, name: "Cổ phiếu Công ty B", code: "VHM", content: "VHM: B" },
    ],
  }

  assert.throws(() => parseExactVsdcSecuritySuggestion(payload, "VHM"), /ambiguous/i)
})
