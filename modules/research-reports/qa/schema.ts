import {
  RESEARCH_REPORT_QA_LIMITS,
  type ResearchReportQaEvidence,
} from "./types.ts"

export interface ResearchReportQaModelCitation {
  evidenceId: string
  excerpt: string
}

export interface ResearchReportQaModelClaim {
  text: string
  citations: ResearchReportQaModelCitation[]
}

export interface ResearchReportQaModelOutput {
  status: "answered" | "not_found"
  claims: ResearchReportQaModelClaim[]
}

export const RESEARCH_REPORT_QA_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "claims"],
  properties: {
    status: {
      type: "string",
      enum: ["answered", "not_found"],
    },
    claims: {
      type: "array",
      maxItems: RESEARCH_REPORT_QA_LIMITS.claims,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "citations"],
        properties: {
          text: {
            type: "string",
            minLength: 1,
            maxLength: RESEARCH_REPORT_QA_LIMITS.claimChars,
          },
          citations: {
            type: "array",
            maxItems: RESEARCH_REPORT_QA_LIMITS.retrievalChunks,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["evidenceId", "excerpt"],
              properties: {
                evidenceId: {
                  type: "string",
                  minLength: 1,
                  maxLength: 300,
                },
                excerpt: {
                  type: "string",
                  minLength: 1,
                  maxLength: RESEARCH_REPORT_QA_LIMITS.citationExcerptChars,
                },
              },
            },
          },
        },
      },
    },
  },
} as const

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function normalizeForGrounding(value: string) {
  return normalizeText(value).toLocaleLowerCase("vi-VN")
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function assertExactKeys(
  value: Record<string, unknown>,
  requiredKeys: readonly string[],
  label: string,
) {
  const actual = Object.keys(value).sort()
  const expected = [...requiredKeys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} has invalid key set`)
  }
}

function validatedString(
  value: unknown,
  label: string,
  maxLength: number,
): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`)
  const normalized = normalizeText(value)
  if (!normalized) throw new Error(`${label} must not be empty`)
  if (normalized.length > maxLength) throw new Error(`${label} exceeds maximum length`)
  return normalized
}

export function validateResearchReportQaModelOutput(
  value: unknown,
  evidence: readonly ResearchReportQaEvidence[],
): ResearchReportQaModelOutput {
  if (!isPlainObject(value)) throw new Error("Research report Q&A output must be an object")
  assertExactKeys(value, ["status", "claims"], "Research report Q&A output")

  if (value.status !== "answered" && value.status !== "not_found") {
    throw new Error("Research report Q&A output has invalid status")
  }
  if (!Array.isArray(value.claims)) {
    throw new Error("Research report Q&A claims must be an array")
  }
  if (value.claims.length > RESEARCH_REPORT_QA_LIMITS.claims) {
    throw new Error("Research report Q&A claim limit exceeded")
  }

  if (value.status === "not_found") {
    if (value.claims.length !== 0) {
      throw new Error("Research report Q&A not_found output must contain zero claims")
    }
    return { status: "not_found", claims: [] }
  }

  if (value.claims.length === 0) {
    throw new Error("Research report Q&A answered output requires at least one claim")
  }

  const evidenceById = new Map(evidence.map((row) => [row.evidenceId, row]))
  const claims: ResearchReportQaModelClaim[] = []

  for (const [claimIndex, rawClaim] of value.claims.entries()) {
    if (!isPlainObject(rawClaim)) {
      throw new Error(`Research report Q&A claim ${claimIndex} must be an object`)
    }
    assertExactKeys(rawClaim, ["text", "citations"], `Research report Q&A claim ${claimIndex}`)

    const text = validatedString(
      rawClaim.text,
      `Research report Q&A claim ${claimIndex}`,
      RESEARCH_REPORT_QA_LIMITS.claimChars,
    )
    if (!Array.isArray(rawClaim.citations)) {
      throw new Error(`Research report Q&A claim ${claimIndex} citations must be an array`)
    }
    if (rawClaim.citations.length === 0) {
      throw new Error(`Research report Q&A claim ${claimIndex} requires at least one citation`)
    }
    if (rawClaim.citations.length > RESEARCH_REPORT_QA_LIMITS.retrievalChunks) {
      throw new Error(`Research report Q&A claim ${claimIndex} citation limit exceeded`)
    }

    const seen = new Set<string>()
    const citations: ResearchReportQaModelCitation[] = []

    for (const [citationIndex, rawCitation] of rawClaim.citations.entries()) {
      if (!isPlainObject(rawCitation)) {
        throw new Error(`Research report Q&A citation ${claimIndex}.${citationIndex} must be an object`)
      }
      assertExactKeys(
        rawCitation,
        ["evidenceId", "excerpt"],
        `Research report Q&A citation ${claimIndex}.${citationIndex}`,
      )

      const evidenceId = validatedString(
        rawCitation.evidenceId,
        `Research report Q&A citation ${claimIndex}.${citationIndex} evidenceId`,
        300,
      )
      const excerpt = validatedString(
        rawCitation.excerpt,
        `Research report Q&A citation ${claimIndex}.${citationIndex} excerpt`,
        RESEARCH_REPORT_QA_LIMITS.citationExcerptChars,
      )

      const source = evidenceById.get(evidenceId)
      if (!source) {
        throw new Error(`Research report Q&A citation references evidence outside the retrieved set`)
      }
      if (!normalizeForGrounding(source.content).includes(normalizeForGrounding(excerpt))) {
        throw new Error(`Research report Q&A citation excerpt is not grounded in canonical evidence`)
      }

      const dedupeKey = `${evidenceId}\u0000${normalizeForGrounding(excerpt)}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      citations.push({ evidenceId, excerpt })
    }

    if (citations.length === 0) {
      throw new Error(`Research report Q&A claim ${claimIndex} requires at least one citation`)
    }

    claims.push({ text, citations })
  }

  return { status: "answered", claims }
}
