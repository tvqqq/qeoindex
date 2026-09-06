import assert from "node:assert/strict"
import test from "node:test"

import {
  QEO122_LIVE_CASES,
  evaluateProbePair,
  validateQeo122SourceUrl,
} from "./qeo122-live-source-matrix.ts"

test("QEO-122 live matrix covers retained VHM history, HOSE/HNX/UPCOM, rights and an explicit amendment", () => {
  const ids = new Set(QEO122_LIVE_CASES.map((item) => item.sourceEventId))
  for (const required of ["50366", "57987", "144349", "150909", "197086", "198392", "150529", "151827", "169561", "199110"]) {
    assert.ok(ids.has(required), `missing live source event ${required}`)
  }

  const exchanges = new Set(QEO122_LIVE_CASES.flatMap((item) => item.kind === "notice" ? [item.expected.exchange] : []))
  assert.ok(exchanges.has("HOSE"))
  assert.ok(exchanges.has("HNX"))
  assert.ok(exchanges.has("UPCOM"))
  assert.ok(QEO122_LIVE_CASES.some((item) => item.kind === "notice" && item.expected.components.some((component) => component.actionType === "rights_issue")))
  assert.ok(QEO122_LIVE_CASES.some((item) => item.kind === "amendment" && item.expected.referencedNoticeNumber === "1515/TB-CNVSDC"))
})

test("QEO-122 pair evaluation separates semantic stability from harmless raw-body drift", () => {
  const first = {
    ok: true,
    status: 200,
    finalUrl: "https://vsdc.vn/vi/ad/50366",
    contentType: "text/html; charset=utf-8",
    latencyMs: 125,
    rawTextHash: "a".repeat(64),
    semanticFingerprint: "same",
  }
  const second = { ...first, latencyMs: 141, rawTextHash: "b".repeat(64) }
  assert.deepEqual(evaluateProbePair(first, second), {
    operationalAccessible: true,
    rateLimited: false,
    semanticStable: true,
    rawBodyStable: false,
  })

  assert.equal(evaluateProbePair(first, { ...second, ok: false, status: 429 }).rateLimited, true)
})

test("QEO-122 rejects SSRF-capable source and redirect targets before fetch", () => {
  assert.equal(validateQeo122SourceUrl("https://vsdc.vn/vi/ad/50366"), "https://vsdc.vn/vi/ad/50366")
  assert.equal(validateQeo122SourceUrl("https://www.vsd.vn/robots.txt"), "https://www.vsd.vn/robots.txt")

  for (const unsafe of [
    "http://vsdc.vn/vi/ad/50366",
    "https://vsdc.vn.evil.example/vi/ad/50366",
    "https://evil.example/redirect",
    "https://127.0.0.1/internal",
    "https://vsdc.vn:444/vi/ad/50366",
    "https://user:pass@vsdc.vn/vi/ad/50366",
  ]) {
    assert.throws(() => validateQeo122SourceUrl(unsafe), /QEO-122 probe: disallowed source URL/)
  }
})
