// QEO-122 live-source validation only. Non-production probe.
// It intentionally fails closed: any inaccessible source, parser mismatch,
// rate-limit response or semantic instability exits non-zero in CI.

import { createHash } from "node:crypto"

import {
  parseVsdcAmendmentHtml,
  parseVsdcCorporateActionHtml,
  type ProbeCorporateActionComponent,
} from "./qeo122-vsdc-corporate-actions.ts"

type Exchange = "HOSE" | "HNX" | "UPCOM"

type ProbeSourceKey =
  | "vhm-2018-stock"
  | "vhm-2019-cash"
  | "vhm-2021-combined"
  | "vhm-2022-cash"
  | "vhm-2026-cash"
  | "vhm-2026-stock"
  | "tdn-2022-hnx-cash"
  | "thn-2022-upcom-cash"
  | "ytc-2024-upcom-rights"
  | "snc-2026-amendment"
  | "snc-2026-original"
  | "robots-vsdc"
  | "robots-legacy-vsd"

type NoticeCase = {
  id: string
  kind: "notice"
  sourceKey: ProbeSourceKey
  sourceEventId: string
  expected: {
    ticker: string
    exchange: Exchange
    recordDate: string
    components: ProbeCorporateActionComponent[]
  }
}

type AmendmentCase = {
  id: string
  kind: "amendment"
  sourceKey: ProbeSourceKey
  sourceEventId: string
  expected: {
    ticker: string
    referencedNoticeNumber: string
    referencedNoticeDate: string
  }
}

export type Qeo122LiveCase = NoticeCase | AmendmentCase

const cash = (cashPerShare: number): ProbeCorporateActionComponent => ({
  actionType: "cash_dividend",
  cashPerShare,
  stockRatio: null,
  rightsRatio: null,
  subscriptionPrice: null,
})

const stock = (stockRatio: string): ProbeCorporateActionComponent => ({
  actionType: "stock_dividend",
  cashPerShare: null,
  stockRatio,
  rightsRatio: null,
  subscriptionPrice: null,
})

const rights = (rightsRatio: string, subscriptionPrice: number): ProbeCorporateActionComponent => ({
  actionType: "rights_issue",
  cashPerShare: null,
  stockRatio: null,
  rightsRatio,
  subscriptionPrice,
})

export const QEO122_LIVE_CASES: Qeo122LiveCase[] = [
  {
    id: "vhm-2018-stock",
    kind: "notice",
    sourceKey: "vhm-2018-stock",
    sourceEventId: "50366",
    expected: { ticker: "VHM", exchange: "HOSE", recordDate: "2018-10-09", components: [stock("1000:250")] },
  },
  {
    id: "vhm-2019-cash",
    kind: "notice",
    sourceKey: "vhm-2019-cash",
    sourceEventId: "57987",
    expected: { ticker: "VHM", exchange: "HOSE", recordDate: "2019-08-09", components: [cash(1000)] },
  },
  {
    id: "vhm-2021-combined",
    kind: "notice",
    sourceKey: "vhm-2021-combined",
    sourceEventId: "144349",
    expected: { ticker: "VHM", exchange: "HOSE", recordDate: "2021-09-16", components: [cash(1500), stock("1000:300")] },
  },
  {
    id: "vhm-2022-cash",
    kind: "notice",
    sourceKey: "vhm-2022-cash",
    sourceEventId: "150909",
    expected: { ticker: "VHM", exchange: "HOSE", recordDate: "2022-06-01", components: [cash(2000)] },
  },
  {
    id: "vhm-2026-cash",
    kind: "notice",
    sourceKey: "vhm-2026-cash",
    sourceEventId: "197086",
    expected: { ticker: "VHM", exchange: "HOSE", recordDate: "2026-06-30", components: [cash(6000)] },
  },
  {
    id: "vhm-2026-stock",
    kind: "notice",
    sourceKey: "vhm-2026-stock",
    sourceEventId: "198392",
    expected: { ticker: "VHM", exchange: "HOSE", recordDate: "2026-08-07", components: [stock("1:1")] },
  },
  {
    id: "tdn-2022-hnx-cash",
    kind: "notice",
    sourceKey: "tdn-2022-hnx-cash",
    sourceEventId: "150529",
    expected: { ticker: "TDN", exchange: "HNX", recordDate: "2022-06-01", components: [cash(1400)] },
  },
  {
    id: "thn-2022-upcom-cash",
    kind: "notice",
    sourceKey: "thn-2022-upcom-cash",
    sourceEventId: "151827",
    expected: { ticker: "THN", exchange: "UPCOM", recordDate: "2022-07-15", components: [cash(866)] },
  },
  {
    id: "ytc-2024-upcom-rights",
    kind: "notice",
    sourceKey: "ytc-2024-upcom-rights",
    sourceEventId: "169561",
    expected: { ticker: "YTC", exchange: "UPCOM", recordDate: "2024-04-16", components: [rights("100:210", 20000)] },
  },
  {
    id: "snc-2026-amendment",
    kind: "amendment",
    sourceKey: "snc-2026-amendment",
    sourceEventId: "199110",
    expected: { ticker: "SNC", referencedNoticeNumber: "1515/TB-CNVSDC", referencedNoticeDate: "2026-08-06" },
  },
]

export const QEO122_AMENDMENT_ORIGINAL = {
  sourceKey: "snc-2026-original" as const,
  sourceEventId: "198978",
  ticker: "SNC",
  sourceUpdatedDate: "2026-08-06",
}

export type ProbeFetchSnapshot = {
  ok: boolean
  status: number
  finalUrl: string
  contentType: string | null
  latencyMs: number
  rawTextHash: string | null
  semanticFingerprint: string | null
  redirectChain?: Array<{ url: string; status: number; location: string | null }>
  sourceUpdatedAt?: string | null
  parsed?: unknown
  error?: string
}

export function evaluateProbePair(first: ProbeFetchSnapshot, second: ProbeFetchSnapshot) {
  return {
    operationalAccessible: first.ok && second.ok && first.status >= 200 && first.status < 300 && second.status >= 200 && second.status < 300,
    rateLimited: first.status === 429 || second.status === 429,
    semanticStable: Boolean(first.semanticFingerprint && first.semanticFingerprint === second.semanticFingerprint),
    rawBodyStable: Boolean(first.rawTextHash && first.rawTextHash === second.rawTextHash),
  }
}

function stableFingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function sortComponents(components: ProbeCorporateActionComponent[]) {
  return [...components].sort((a, b) => a.actionType.localeCompare(b.actionType))
}

function normalizedNoticeForFingerprint(parsed: ReturnType<typeof parseVsdcCorporateActionHtml>) {
  return {
    sourceEventId: parsed.sourceEventId,
    ticker: parsed.ticker,
    isin: parsed.isin,
    exchange: parsed.exchange,
    recordDate: parsed.recordDate,
    components: sortComponents(parsed.components),
  }
}

function normalizedAmendmentForFingerprint(parsed: ReturnType<typeof parseVsdcAmendmentHtml>) {
  return {
    sourceEventId: parsed.sourceEventId,
    ticker: parsed.ticker,
    referencedNoticeNumber: parsed.referencedNoticeNumber,
    referencedNoticeDate: parsed.referencedNoticeDate,
    amendmentType: parsed.amendmentType,
  }
}

function expectedMatches(actual: unknown, expected: unknown) {
  return JSON.stringify(actual) === JSON.stringify(expected)
}

export function validateQeo122SourceUrl(value: string) {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error("QEO-122 probe: disallowed source URL")
  }

  const allowedHostname = parsed.hostname === "vsdc.vn" || parsed.hostname === "www.vsd.vn"
  if (
    parsed.protocol !== "https:"
    || !allowedHostname
    || parsed.port !== ""
    || parsed.username !== ""
    || parsed.password !== ""
  ) {
    throw new Error("QEO-122 probe: disallowed source URL")
  }

  return parsed.href
}

function sourceUrlForKey(key: ProbeSourceKey) {
  switch (key) {
    case "vhm-2018-stock": return "https://vsdc.vn/vi/ad/50366"
    case "vhm-2019-cash": return "https://vsdc.vn/vi/ad/57987"
    case "vhm-2021-combined": return "https://vsdc.vn/vi/ad1/144349"
    case "vhm-2022-cash": return "https://vsdc.vn/vi/ad1/150909"
    case "vhm-2026-cash": return "https://vsdc.vn/vi/ad1/197086"
    case "vhm-2026-stock": return "https://vsdc.vn/vi/ad/198392"
    case "tdn-2022-hnx-cash": return "https://vsdc.vn/vi/ad/150529"
    case "thn-2022-upcom-cash": return "https://vsdc.vn/vi/ad1/151827"
    case "ytc-2024-upcom-rights": return "https://vsdc.vn/vi/ad1/169561"
    case "snc-2026-amendment": return "https://vsdc.vn/vi/ad/199110"
    case "snc-2026-original": return "https://vsdc.vn/vi/ad1/198978"
    case "robots-vsdc": return "https://vsdc.vn/robots.txt"
    case "robots-legacy-vsd": return "https://www.vsd.vn/robots.txt"
  }
}

function requestInit(): RequestInit {
  return {
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; QeoIndex-QEO122-Source-Probe/1.0; +https://github.com/tvqqq/qeoindex)",
      accept: "text/html,application/xhtml+xml,application/json;q=0.8,*/*;q=0.5",
      "accept-language": "vi-VN,vi;q=0.9,en;q=0.5",
    },
  }
}

async function fetchKnownProbeSource(key: ProbeSourceKey) {
  const started = performance.now()
  let response: Response
  let sourceUrl: string

  switch (key) {
    case "vhm-2018-stock":
      sourceUrl = "https://vsdc.vn/vi/ad/50366"
      response = await fetch("https://vsdc.vn/vi/ad/50366", requestInit())
      break
    case "vhm-2019-cash":
      sourceUrl = "https://vsdc.vn/vi/ad/57987"
      response = await fetch("https://vsdc.vn/vi/ad/57987", requestInit())
      break
    case "vhm-2021-combined":
      sourceUrl = "https://vsdc.vn/vi/ad1/144349"
      response = await fetch("https://vsdc.vn/vi/ad1/144349", requestInit())
      break
    case "vhm-2022-cash":
      sourceUrl = "https://vsdc.vn/vi/ad1/150909"
      response = await fetch("https://vsdc.vn/vi/ad1/150909", requestInit())
      break
    case "vhm-2026-cash":
      sourceUrl = "https://vsdc.vn/vi/ad1/197086"
      response = await fetch("https://vsdc.vn/vi/ad1/197086", requestInit())
      break
    case "vhm-2026-stock":
      sourceUrl = "https://vsdc.vn/vi/ad/198392"
      response = await fetch("https://vsdc.vn/vi/ad/198392", requestInit())
      break
    case "tdn-2022-hnx-cash":
      sourceUrl = "https://vsdc.vn/vi/ad/150529"
      response = await fetch("https://vsdc.vn/vi/ad/150529", requestInit())
      break
    case "thn-2022-upcom-cash":
      sourceUrl = "https://vsdc.vn/vi/ad1/151827"
      response = await fetch("https://vsdc.vn/vi/ad1/151827", requestInit())
      break
    case "ytc-2024-upcom-rights":
      sourceUrl = "https://vsdc.vn/vi/ad1/169561"
      response = await fetch("https://vsdc.vn/vi/ad1/169561", requestInit())
      break
    case "snc-2026-amendment":
      sourceUrl = "https://vsdc.vn/vi/ad/199110"
      response = await fetch("https://vsdc.vn/vi/ad/199110", requestInit())
      break
    case "snc-2026-original":
      sourceUrl = "https://vsdc.vn/vi/ad1/198978"
      response = await fetch("https://vsdc.vn/vi/ad1/198978", requestInit())
      break
    case "robots-vsdc":
      sourceUrl = "https://vsdc.vn/robots.txt"
      response = await fetch("https://vsdc.vn/robots.txt", requestInit())
      break
    case "robots-legacy-vsd":
      sourceUrl = "https://www.vsd.vn/robots.txt"
      response = await fetch("https://www.vsd.vn/robots.txt", requestInit())
      break
  }

  const location = response.headers.get("location")
  const body = await response.text()
  return {
    status: response.status,
    finalUrl: sourceUrl,
    contentType: response.headers.get("content-type"),
    latencyMs: Math.round(performance.now() - started),
    body,
    redirectChain: [{ url: sourceUrl, status: response.status, location }],
  }
}

async function probeCase(item: Qeo122LiveCase): Promise<ProbeFetchSnapshot> {
  const sourceUrl = sourceUrlForKey(item.sourceKey)
  try {
    const fetched = await fetchKnownProbeSource(item.sourceKey)
    if (fetched.status < 200 || fetched.status >= 300) {
      return {
        ok: false,
        status: fetched.status,
        finalUrl: fetched.finalUrl,
        contentType: fetched.contentType,
        latencyMs: fetched.latencyMs,
        rawTextHash: stableFingerprint(fetched.body),
        semanticFingerprint: null,
        redirectChain: fetched.redirectChain,
        error: `HTTP ${fetched.status}`,
      }
    }

    if (item.kind === "notice") {
      const parsed = parseVsdcCorporateActionHtml(fetched.body, sourceUrl)
      const normalized = normalizedNoticeForFingerprint(parsed)
      const actualExpected = {
        ticker: parsed.ticker,
        exchange: parsed.exchange,
        recordDate: parsed.recordDate,
        components: sortComponents(parsed.components),
      }
      const expected = { ...item.expected, components: sortComponents(item.expected.components) }
      const errors: string[] = []
      if (parsed.sourceEventId !== item.sourceEventId) errors.push(`sourceEventId ${parsed.sourceEventId} != ${item.sourceEventId}`)
      if (!expectedMatches(actualExpected, expected)) errors.push(`normalized terms mismatch: ${JSON.stringify(actualExpected)}`)
      return {
        ok: errors.length === 0,
        status: fetched.status,
        finalUrl: fetched.finalUrl,
        contentType: fetched.contentType,
        latencyMs: fetched.latencyMs,
        rawTextHash: parsed.rawTextHash,
        semanticFingerprint: stableFingerprint(normalized),
        redirectChain: fetched.redirectChain,
        sourceUpdatedAt: parsed.sourceUpdatedAt,
        parsed: normalized,
        ...(errors.length ? { error: errors.join("; ") } : {}),
      }
    }

    const parsed = parseVsdcAmendmentHtml(fetched.body, sourceUrl)
    const normalized = normalizedAmendmentForFingerprint(parsed)
    const actualExpected = {
      ticker: parsed.ticker,
      referencedNoticeNumber: parsed.referencedNoticeNumber,
      referencedNoticeDate: parsed.referencedNoticeDate,
    }
    const errors: string[] = []
    if (parsed.sourceEventId !== item.sourceEventId) errors.push(`sourceEventId ${parsed.sourceEventId} != ${item.sourceEventId}`)
    if (!expectedMatches(actualExpected, item.expected)) errors.push(`amendment lineage mismatch: ${JSON.stringify(actualExpected)}`)
    return {
      ok: errors.length === 0,
      status: fetched.status,
      finalUrl: fetched.finalUrl,
      contentType: fetched.contentType,
      latencyMs: fetched.latencyMs,
      rawTextHash: parsed.rawTextHash,
      semanticFingerprint: stableFingerprint(normalized),
      redirectChain: fetched.redirectChain,
      sourceUpdatedAt: parsed.sourceUpdatedAt,
      parsed: normalized,
      ...(errors.length ? { error: errors.join("; ") } : {}),
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      finalUrl: sourceUrl,
      contentType: null,
      latencyMs: 0,
      rawTextHash: null,
      semanticFingerprint: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function probeRawPair(sourceKey: ProbeSourceKey) {
  const sourceUrl = sourceUrlForKey(sourceKey)
  const run = async () => {
    try {
      const fetched = await fetchKnownProbeSource(sourceKey)
      return {
        ok: fetched.status >= 200 && fetched.status < 300,
        status: fetched.status,
        finalUrl: fetched.finalUrl,
        contentType: fetched.contentType,
        latencyMs: fetched.latencyMs,
        rawTextHash: stableFingerprint(fetched.body),
        semanticFingerprint: stableFingerprint({
          hasTicker: /\bSNC\b/i.test(fetched.body),
          hasExpectedUpdateDate: /06\/08\/2026/.test(fetched.body),
        }),
        redirectChain: fetched.redirectChain,
        bodyEvidence: {
          hasTicker: /\bSNC\b/i.test(fetched.body),
          hasExpectedUpdateDate: /06\/08\/2026/.test(fetched.body),
        },
      }
    } catch (error) {
      return {
        ok: false,
        status: 0,
        finalUrl: sourceUrl,
        contentType: null,
        latencyMs: 0,
        rawTextHash: null,
        semanticFingerprint: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  const first = await run()
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 300))
  const second = await run()
  return { first, second, pair: evaluateProbePair(first, second) }
}

async function probeRobots(sourceKey: "robots-vsdc" | "robots-legacy-vsd") {
  const sourceUrl = sourceUrlForKey(sourceKey)
  try {
    const fetched = await fetchKnownProbeSource(sourceKey)
    return {
      status: fetched.status,
      finalUrl: fetched.finalUrl,
      contentType: fetched.contentType,
      latencyMs: fetched.latencyMs,
      location: fetched.redirectChain[0]?.location ?? null,
      bodyPreview: fetched.body.slice(0, 4000),
    }
  } catch (error) {
    return {
      status: 0,
      finalUrl: sourceUrl,
      contentType: null,
      latencyMs: 0,
      location: null,
      bodyPreview: "",
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function runQeo122LiveSourceMatrix() {
  const results = []
  for (const item of QEO122_LIVE_CASES) {
    const first = await probeCase(item)
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 300))
    const second = await probeCase(item)
    const pair = evaluateProbePair(first, second)
    results.push({
      id: item.id,
      sourceEventId: item.sourceEventId,
      url: sourceUrlForKey(item.sourceKey),
      first,
      second,
      pair,
    })
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 300))
  }

  const amendmentOriginal = await probeRawPair(QEO122_AMENDMENT_ORIGINAL.sourceKey)
  const robots = {
    vsdc: await probeRobots("robots-vsdc"),
    legacyVsd: await probeRobots("robots-legacy-vsd"),
  }

  const requiredPairsPass = results.every(({ pair }) => pair.operationalAccessible && !pair.rateLimited && pair.semanticStable)
  const amendmentOriginalPass = amendmentOriginal.first.ok
    && amendmentOriginal.second.ok
    && amendmentOriginal.pair.operationalAccessible
    && !amendmentOriginal.pair.rateLimited
    && amendmentOriginal.pair.semanticStable
    && Boolean((amendmentOriginal.first as { bodyEvidence?: { hasTicker?: boolean; hasExpectedUpdateDate?: boolean } }).bodyEvidence?.hasTicker)
    && Boolean((amendmentOriginal.first as { bodyEvidence?: { hasTicker?: boolean; hasExpectedUpdateDate?: boolean } }).bodyEvidence?.hasExpectedUpdateDate)

  const report = {
    generatedAt: new Date().toISOString(),
    source: "VSDC public corporate-action pages",
    fetchPolicy: {
      attemptsPerSource: 2,
      interRequestDelayMs: 300,
      timeoutMs: 20_000,
      followRedirects: false,
      networkTargets: "compile-time literal allowlist",
    },
    results,
    amendmentOriginal: {
      sourceEventId: QEO122_AMENDMENT_ORIGINAL.sourceEventId,
      url: sourceUrlForKey(QEO122_AMENDMENT_ORIGINAL.sourceKey),
      ...amendmentOriginal,
    },
    robots,
    summary: {
      sourceCount: QEO122_LIVE_CASES.length,
      requiredPairsPass,
      amendmentOriginalPass,
      allRequiredLiveGatesPass: requiredPairsPass && amendmentOriginalPass,
      anyRateLimited: results.some(({ pair }) => pair.rateLimited) || amendmentOriginal.pair.rateLimited,
      rawBodyDriftCount: results.filter(({ pair }) => !pair.rawBodyStable).length,
      note: "Raw HTML hash drift is informational only; semantic fingerprints exclude dynamic page tokens and optional sourceUpdatedAt metadata.",
    },
  }

  console.log(JSON.stringify(report, null, 2))
  if (!report.summary.allRequiredLiveGatesPass) process.exitCode = 1
  return report
}

if (process.argv[1]?.endsWith("qeo122-live-source-matrix.ts")) {
  void runQeo122LiveSourceMatrix().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
