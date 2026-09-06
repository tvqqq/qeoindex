import {
  TICKER_KNOWLEDGE_AUTHORITIES,
  type TickerKnowledgeAuthority,
} from "../ticker-knowledge/domain.ts"
import type { TickerQaResolvedEvidence } from "./canonical.ts"
import { TICKER_QA_LIMITS } from "./types.ts"

export interface TickerQaModelCitation {
  evidenceId: string
  excerpt: string
}

export interface TickerQaModelClaim {
  text: string
  authority: TickerKnowledgeAuthority
  citations: TickerQaModelCitation[]
}

export interface TickerQaModelContradiction {
  leftEvidenceId: string
  rightEvidenceId: string
  explanation: string
}

export interface TickerQaModelOutput {
  status: "answered" | "not_found"
  claims: TickerQaModelClaim[]
  contradictions: TickerQaModelContradiction[]
}

export const TICKER_QA_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "claims", "contradictions"],
  properties: {
    status: { type: "string", enum: ["answered", "not_found"] },
    claims: {
      type: "array",
      maxItems: TICKER_QA_LIMITS.claims,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "authority", "citations"],
        properties: {
          text: { type: "string", minLength: 1, maxLength: TICKER_QA_LIMITS.claimChars },
          authority: { type: "string", enum: TICKER_KNOWLEDGE_AUTHORITIES },
          citations: {
            type: "array",
            maxItems: TICKER_QA_LIMITS.retrievalItems,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["evidenceId", "excerpt"],
              properties: {
                evidenceId: { type: "string", minLength: 1, maxLength: 300 },
                excerpt: { type: "string", minLength: 1, maxLength: TICKER_QA_LIMITS.citationExcerptChars },
              },
            },
          },
        },
      },
    },
    contradictions: {
      type: "array",
      maxItems: TICKER_QA_LIMITS.claims,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["leftEvidenceId", "rightEvidenceId", "explanation"],
        properties: {
          leftEvidenceId: { type: "string", minLength: 1, maxLength: 300 },
          rightEvidenceId: { type: "string", minLength: 1, maxLength: 300 },
          explanation: { type: "string", minLength: 1, maxLength: TICKER_QA_LIMITS.claimChars },
        },
      },
    },
  },
} as const

const AUTHORITY_SET = new Set<TickerKnowledgeAuthority>(TICKER_KNOWLEDGE_AUTHORITIES)

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function normalizeForGrounding(value: string) {
  return normalizeText(value).toLocaleLowerCase("vi-VN")
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function assertExactKeys(value: Record<string, unknown>, keys: readonly string[], label: string) {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} has invalid key set`)
  }
}

function stringValue(value: unknown, label: string, maxLength: number) {
  if (typeof value !== "string") throw new Error(`${label} must be a string`)
  const normalized = normalizeText(value)
  if (!normalized) throw new Error(`${label} must not be empty`)
  if (normalized.length > maxLength) throw new Error(`${label} exceeds maximum length`)
  return normalized
}

function authorityValue(value: unknown): TickerKnowledgeAuthority {
  if (typeof value !== "string" || !AUTHORITY_SET.has(value as TickerKnowledgeAuthority)) {
    throw new Error("Ticker Q&A claim has invalid authority")
  }
  return value as TickerKnowledgeAuthority
}

export function validateTickerQaModelOutput(
  value: unknown,
  evidence: readonly TickerQaResolvedEvidence[],
): TickerQaModelOutput {
  if (!plainObject(value)) throw new Error("Ticker Q&A output must be an object")
  assertExactKeys(value, ["status", "claims", "contradictions"], "Ticker Q&A output")
  if (value.status !== "answered" && value.status !== "not_found") throw new Error("Ticker Q&A output has invalid status")
  if (!Array.isArray(value.claims)) throw new Error("Ticker Q&A claims must be an array")
  if (!Array.isArray(value.contradictions)) throw new Error("Ticker Q&A contradictions must be an array")
  if (value.claims.length > TICKER_QA_LIMITS.claims) throw new Error("Ticker Q&A claim limit exceeded")
  if (value.contradictions.length > TICKER_QA_LIMITS.claims) throw new Error("Ticker Q&A contradiction limit exceeded")

  if (value.status === "not_found") {
    if (value.claims.length !== 0) throw new Error("Ticker Q&A not_found output must contain zero claims")
    if (value.contradictions.length !== 0) throw new Error("Ticker Q&A not_found output must contain zero contradictions")
    return { status: "not_found", claims: [], contradictions: [] }
  }

  if (value.claims.length === 0) throw new Error("Ticker Q&A answered output requires at least one claim")
  const evidenceById = new Map(evidence.map((item) => [item.evidenceId, item]))
  const claims: TickerQaModelClaim[] = []

  for (const [claimIndex, rawClaim] of value.claims.entries()) {
    if (!plainObject(rawClaim)) throw new Error(`Ticker Q&A claim ${claimIndex} must be an object`)
    assertExactKeys(rawClaim, ["text", "authority", "citations"], `Ticker Q&A claim ${claimIndex}`)
    const text = stringValue(rawClaim.text, `Ticker Q&A claim ${claimIndex}`, TICKER_QA_LIMITS.claimChars)
    const authority = authorityValue(rawClaim.authority)
    if (!Array.isArray(rawClaim.citations) || rawClaim.citations.length === 0) {
      throw new Error(`Ticker Q&A claim ${claimIndex} requires at least one citation`)
    }
    if (rawClaim.citations.length > TICKER_QA_LIMITS.retrievalItems) {
      throw new Error(`Ticker Q&A claim ${claimIndex} citation limit exceeded`)
    }

    const citations: TickerQaModelCitation[] = []
    const seen = new Set<string>()
    for (const [citationIndex, rawCitation] of rawClaim.citations.entries()) {
      if (!plainObject(rawCitation)) throw new Error(`Ticker Q&A citation ${claimIndex}.${citationIndex} must be an object`)
      assertExactKeys(rawCitation, ["evidenceId", "excerpt"], `Ticker Q&A citation ${claimIndex}.${citationIndex}`)
      const evidenceId = stringValue(rawCitation.evidenceId, "Ticker Q&A citation evidenceId", 300)
      const excerpt = stringValue(rawCitation.excerpt, "Ticker Q&A citation excerpt", TICKER_QA_LIMITS.citationExcerptChars)
      const source = evidenceById.get(evidenceId)
      if (!source) throw new Error("Ticker Q&A citation references evidence outside the resolved evidence set")
      if (!normalizeForGrounding(source.text).includes(normalizeForGrounding(excerpt))) {
        throw new Error("Ticker Q&A citation excerpt is not grounded in canonical evidence")
      }
      if (authority !== "AI_INFERENCE" && source.item.authority !== authority) {
        throw new Error("Ticker Q&A claim authority does not match cited evidence")
      }
      const key = `${evidenceId}\u0000${normalizeForGrounding(excerpt)}`
      if (seen.has(key)) continue
      seen.add(key)
      citations.push({ evidenceId, excerpt })
    }
    if (!citations.length) throw new Error(`Ticker Q&A claim ${claimIndex} requires at least one citation`)
    claims.push({ text, authority, citations })
  }

  const contradictions: TickerQaModelContradiction[] = []
  for (const [index, raw] of value.contradictions.entries()) {
    if (!plainObject(raw)) throw new Error(`Ticker Q&A contradiction ${index} must be an object`)
    assertExactKeys(raw, ["leftEvidenceId", "rightEvidenceId", "explanation"], `Ticker Q&A contradiction ${index}`)
    const leftEvidenceId = stringValue(raw.leftEvidenceId, "Ticker Q&A contradiction leftEvidenceId", 300)
    const rightEvidenceId = stringValue(raw.rightEvidenceId, "Ticker Q&A contradiction rightEvidenceId", 300)
    const explanation = stringValue(raw.explanation, "Ticker Q&A contradiction explanation", TICKER_QA_LIMITS.claimChars)
    if (leftEvidenceId === rightEvidenceId) throw new Error("Ticker Q&A contradiction requires two distinct evidence IDs")
    if (!evidenceById.has(leftEvidenceId) || !evidenceById.has(rightEvidenceId)) {
      throw new Error("Ticker Q&A contradiction references evidence outside the resolved evidence set")
    }
    contradictions.push({ leftEvidenceId, rightEvidenceId, explanation })
  }

  return { status: "answered", claims, contradictions }
}
