import { createHash } from "node:crypto"

export const AI_COUNCIL_PROMPT_IDENTITY_VERSION = "prompt-identity-v1"

export interface AiCouncilPromptIdentityInput {
  deterministicEvidenceHash: string
  rawContextHash: string | null
  researchContextHash: string | null
  promptVersion: string
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  )
}

function sha256(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex")
}

function hashString(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value) ? value : null
}

export function buildAiCouncilPromptIdentityHash(input: AiCouncilPromptIdentityInput) {
  return sha256(input)
}

export function buildAiCouncilPromptCacheKey(promptIdentityHash: string) {
  return `qeo-council-${promptIdentityHash.slice(0, 48)}`
}

export function resolveAiCouncilPromptIdentityHash(
  stock: {
    evidenceHash: string
    llmEvidence?: { contextHash?: unknown }
    researchContext?: { contextHash?: unknown; promptIdentityHash?: unknown }
  },
  promptVersion: string,
) {
  const persistedResearchIdentity = hashString(stock.researchContext?.promptIdentityHash)
  if (persistedResearchIdentity) return persistedResearchIdentity

  return buildAiCouncilPromptIdentityHash({
    deterministicEvidenceHash: stock.evidenceHash,
    rawContextHash: hashString(stock.llmEvidence?.contextHash),
    researchContextHash: hashString(stock.researchContext?.contextHash),
    promptVersion,
  })
}
