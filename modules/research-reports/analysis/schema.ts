import type {
  ParsedReportPage,
  ResearchReportEvidenceRef,
  ResearchReportTickerStance,
  StructuredResearchReportAnalysis,
  StructuredResearchReportTickerMention,
} from "../types.ts"

const STANCES = new Set<ResearchReportTickerStance>(["positive", "negative", "neutral", "mixed"])
const TICKER_RE = /^[A-Z0-9]{2,12}$/
const MAX_EVIDENCE_SNIPPET_CHARS = 240

export const RESEARCH_REPORT_ANALYSIS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "executiveSummary",
    "keyPoints",
    "marketView",
    "sectorOutlook",
    "catalysts",
    "risks",
    "tickerMentions",
    "confidence",
  ],
  properties: {
    executiveSummary: { type: "string", minLength: 1, maxLength: 5000 },
    keyPoints: {
      type: "array",
      maxItems: 16,
      items: { type: "string", minLength: 1, maxLength: 1000 },
    },
    marketView: { type: ["string", "null"], maxLength: 3000 },
    sectorOutlook: { type: ["string", "null"], maxLength: 3000 },
    catalysts: {
      type: "array",
      maxItems: 16,
      items: { type: "string", minLength: 1, maxLength: 1000 },
    },
    risks: {
      type: "array",
      maxItems: 16,
      items: { type: "string", minLength: 1, maxLength: 1000 },
    },
    tickerMentions: {
      type: "array",
      maxItems: 64,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "ticker",
          "stance",
          "recommendationText",
          "targetPrice",
          "targetCurrency",
          "rationale",
          "evidence",
        ],
        properties: {
          ticker: { type: "string", pattern: "^[A-Z0-9]{2,12}$" },
          stance: { type: "string", enum: ["positive", "negative", "neutral", "mixed"] },
          recommendationText: { type: ["string", "null"], maxLength: 1000 },
          targetPrice: { type: ["number", "null"], exclusiveMinimum: 0 },
          targetCurrency: { type: ["string", "null"], maxLength: 16 },
          rationale: { type: "string", minLength: 1, maxLength: 2000 },
          evidence: {
            type: "array",
            minItems: 1,
            maxItems: 12,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["page", "snippet"],
              properties: {
                page: { type: "integer", minimum: 1 },
                snippet: { type: "string", minLength: 1, maxLength: MAX_EVIDENCE_SNIPPET_CHARS },
              },
            },
          },
        },
      },
    },
    confidence: {
      type: "object",
      additionalProperties: false,
      required: ["score", "flags"],
      properties: {
        score: { type: "number", minimum: 0, maximum: 100 },
        flags: {
          type: "array",
          maxItems: 16,
          items: { type: "string", minLength: 1, maxLength: 500 },
        },
      },
    },
  },
} as const

function fail(path: string, message: string): never {
  throw new Error(`Invalid research report analysis at ${path}: ${message}`)
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "expected object")
  }
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string) {
  const allowedSet = new Set(allowed)
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) fail(path, `unknown field ${key}`)
  }
  for (const key of allowed) {
    if (!(key in value)) fail(path, `missing field ${key}`)
  }
}

function stringValue(value: unknown, path: string, maxLength: number): string {
  if (typeof value !== "string") fail(path, "expected string")
  const trimmed = value.trim()
  if (!trimmed) fail(path, "must not be empty")
  if (trimmed.length > maxLength) fail(path, `must be <= ${maxLength} chars`)
  return trimmed
}

function nullableString(value: unknown, path: string, maxLength: number): string | null {
  if (value === null) return null
  return stringValue(value, path, maxLength)
}

function stringArray(value: unknown, path: string, maxItems: number, itemMaxLength: number): string[] {
  if (!Array.isArray(value)) fail(path, "expected array")
  if (value.length > maxItems) fail(path, `must contain <= ${maxItems} items`)
  return value.map((item, index) => stringValue(item, `${path}[${index}]`, itemMaxLength))
}

function normalizeGroundingText(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US")
}

function evidenceRefs(value: unknown, pagesByNumber: ReadonlyMap<number, string>, path: string): ResearchReportEvidenceRef[] {
  if (!Array.isArray(value) || value.length === 0) fail(path, "evidence must contain at least one citation")
  if (value.length > 12) fail(path, "evidence must contain <= 12 citations")

  return value.map((item, index) => {
    const itemPath = `${path}[${index}]`
    const raw = record(item, itemPath)
    exactKeys(raw, ["page", "snippet"], itemPath)

    if (!Number.isInteger(raw.page) || Number(raw.page) < 1) fail(`${itemPath}.page`, "page must be an integer >= 1")
    const page = Number(raw.page)
    const pageText = pagesByNumber.get(page)
    if (pageText === undefined) fail(`${itemPath}.page`, `page ${page} does not exist in the supplied document`)

    const snippet = stringValue(raw.snippet, `${itemPath}.snippet`, MAX_EVIDENCE_SNIPPET_CHARS)
    const normalizedSnippet = normalizeGroundingText(snippet)
    const normalizedPage = normalizeGroundingText(pageText)
    if (!normalizedPage.includes(normalizedSnippet)) {
      fail(`${itemPath}.snippet`, `snippet is not grounded in cited page ${page}`)
    }

    return { page, snippet }
  })
}

function tickerMention(
  value: unknown,
  pagesByNumber: ReadonlyMap<number, string>,
  path: string,
): StructuredResearchReportTickerMention {
  const raw = record(value, path)
  exactKeys(raw, [
    "ticker",
    "stance",
    "recommendationText",
    "targetPrice",
    "targetCurrency",
    "rationale",
    "evidence",
  ], path)

  const ticker = stringValue(raw.ticker, `${path}.ticker`, 12).toUpperCase()
  if (!TICKER_RE.test(ticker)) fail(`${path}.ticker`, "ticker must match ^[A-Z0-9]{2,12}$")

  if (typeof raw.stance !== "string" || !STANCES.has(raw.stance as ResearchReportTickerStance)) {
    fail(`${path}.stance`, "unknown stance")
  }
  const stance = raw.stance as ResearchReportTickerStance

  let targetPrice: number | null = null
  if (raw.targetPrice !== null) {
    if (typeof raw.targetPrice !== "number" || !Number.isFinite(raw.targetPrice) || raw.targetPrice <= 0) {
      fail(`${path}.targetPrice`, "targetPrice must be a positive number or null")
    }
    targetPrice = raw.targetPrice
  }

  const targetCurrency = nullableString(raw.targetCurrency, `${path}.targetCurrency`, 16)
  if (targetPrice === null && targetCurrency !== null) {
    fail(`${path}.targetCurrency`, "targetCurrency must be null when targetPrice is null")
  }
  if (targetPrice !== null && targetCurrency === null) {
    fail(`${path}.targetCurrency`, "targetCurrency is required when targetPrice is present")
  }

  return {
    ticker,
    stance,
    recommendationText: nullableString(raw.recommendationText, `${path}.recommendationText`, 1000),
    targetPrice,
    targetCurrency,
    rationale: stringValue(raw.rationale, `${path}.rationale`, 2000),
    evidence: evidenceRefs(raw.evidence, pagesByNumber, `${path}.evidence`),
  }
}

export function validateResearchReportAnalysis(
  value: unknown,
  pages: readonly ParsedReportPage[],
): StructuredResearchReportAnalysis {
  if (pages.length === 0) fail("pages", "at least one parsed page is required for grounded validation")

  const pagesByNumber = new Map<number, string>()
  for (const page of pages) {
    if (!Number.isInteger(page.pageNumber) || page.pageNumber < 1) fail("pages", "page numbers must be positive integers")
    if (pagesByNumber.has(page.pageNumber)) fail("pages", `duplicate page number ${page.pageNumber}`)
    pagesByNumber.set(page.pageNumber, page.text)
  }

  const raw = record(value, "root")
  exactKeys(raw, [
    "executiveSummary",
    "keyPoints",
    "marketView",
    "sectorOutlook",
    "catalysts",
    "risks",
    "tickerMentions",
    "confidence",
  ], "root")

  if (!Array.isArray(raw.tickerMentions)) fail("root.tickerMentions", "expected array")
  if (raw.tickerMentions.length > 64) fail("root.tickerMentions", "must contain <= 64 items")

  const confidenceRaw = record(raw.confidence, "root.confidence")
  exactKeys(confidenceRaw, ["score", "flags"], "root.confidence")
  if (
    typeof confidenceRaw.score !== "number"
    || !Number.isFinite(confidenceRaw.score)
    || confidenceRaw.score < 0
    || confidenceRaw.score > 100
  ) {
    fail("root.confidence.score", "score must be between 0 and 100")
  }

  return {
    executiveSummary: stringValue(raw.executiveSummary, "root.executiveSummary", 5000),
    keyPoints: stringArray(raw.keyPoints, "root.keyPoints", 16, 1000),
    marketView: nullableString(raw.marketView, "root.marketView", 3000),
    sectorOutlook: nullableString(raw.sectorOutlook, "root.sectorOutlook", 3000),
    catalysts: stringArray(raw.catalysts, "root.catalysts", 16, 1000),
    risks: stringArray(raw.risks, "root.risks", 16, 1000),
    tickerMentions: raw.tickerMentions.map((item, index) => tickerMention(item, pagesByNumber, `root.tickerMentions[${index}]`)),
    confidence: {
      score: confidenceRaw.score,
      flags: stringArray(confidenceRaw.flags, "root.confidence.flags", 16, 500),
    },
  }
}
