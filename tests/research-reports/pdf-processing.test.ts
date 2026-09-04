import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"

import {
  fetchResearchReportPdf,
  type ResearchReportPdfPolicy,
} from "../../modules/research-reports/pdf/secure-fetch.ts"

const policy: ResearchReportPdfPolicy = {
  allowedHosts: new Set(["cdn02.wigroup.vn"]),
  maxBytes: 64,
  timeoutMs: 1_000,
  maxRedirects: 2,
}

const publicResolver = async () => ["1.1.1.1"]

test("QEO-81 PDF fetch rejects non-HTTPS, unapproved hosts, and approved hosts resolving privately", async () => {
  let fetchCalls = 0
  const fetchImpl = (async () => {
    fetchCalls += 1
    return new Response("unexpected")
  }) as typeof fetch

  await assert.rejects(
    () => fetchResearchReportPdf("http://cdn02.wigroup.vn/a.pdf", policy, { fetchImpl, resolveHost: publicResolver }),
    /https/i,
  )
  await assert.rejects(
    () => fetchResearchReportPdf("https://evil.example/a.pdf", policy, { fetchImpl, resolveHost: publicResolver }),
    /allowlist/i,
  )
  await assert.rejects(
    () => fetchResearchReportPdf("https://cdn02.wigroup.vn/a.pdf", policy, {
      fetchImpl,
      resolveHost: async () => ["127.0.0.1", "10.0.0.1"],
    }),
    /private|unsafe|public/i,
  )
  assert.equal(fetchCalls, 0)
})

test("QEO-81 PDF fetch revalidates every manual redirect before following it", async () => {
  let fetchCalls = 0
  const fetchImpl = (async () => {
    fetchCalls += 1
    return new Response(null, {
      status: 302,
      headers: { location: "https://evil.example/report.pdf" },
    })
  }) as typeof fetch

  await assert.rejects(
    () => fetchResearchReportPdf("https://cdn02.wigroup.vn/start.pdf", policy, { fetchImpl, resolveHost: publicResolver }),
    /allowlist/i,
  )
  assert.equal(fetchCalls, 1)
})

test("QEO-81 PDF fetch enforces declared and streamed byte limits", async () => {
  const declaredTooLarge = (async () => new Response("%PDF-small", {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-length": "65",
    },
  })) as typeof fetch

  await assert.rejects(
    () => fetchResearchReportPdf("https://cdn02.wigroup.vn/large.pdf", policy, {
      fetchImpl: declaredTooLarge,
      resolveHost: publicResolver,
    }),
    /size|large|bytes/i,
  )

  const streamedTooLarge = (async () => new Response(new Uint8Array(65).fill(65), {
    status: 200,
    headers: { "content-type": "application/pdf" },
  })) as typeof fetch

  await assert.rejects(
    () => fetchResearchReportPdf("https://cdn02.wigroup.vn/stream.pdf", policy, {
      fetchImpl: streamedTooLarge,
      resolveHost: publicResolver,
    }),
    /size|large|bytes/i,
  )
})

test("QEO-81 PDF fetch accepts a valid PDF signature fallback and returns stable SHA-256 identity", async () => {
  const bytes = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF")
  const fetchImpl = (async () => new Response(bytes, {
    status: 200,
    headers: { "content-type": "application/octet-stream" },
  })) as typeof fetch

  const result = await fetchResearchReportPdf("https://cdn02.wigroup.vn/report.pdf", {
    ...policy,
    maxBytes: 1_024,
  }, { fetchImpl, resolveHost: publicResolver })

  assert.equal(result.finalUrl, "https://cdn02.wigroup.vn/report.pdf")
  assert.equal(result.byteLength, bytes.byteLength)
  assert.deepEqual(result.bytes, bytes)
  assert.equal(result.contentType, "application/octet-stream")
  assert.equal(result.contentHash, createHash("sha256").update(bytes).digest("hex"))
})

test("QEO-81 PDF fetch rejects non-PDF content when MIME and signature both disagree", async () => {
  const fetchImpl = (async () => new Response("not a pdf", {
    status: 200,
    headers: { "content-type": "text/plain" },
  })) as typeof fetch

  await assert.rejects(
    () => fetchResearchReportPdf("https://cdn02.wigroup.vn/not-pdf", policy, { fetchImpl, resolveHost: publicResolver }),
    /pdf/i,
  )
})
