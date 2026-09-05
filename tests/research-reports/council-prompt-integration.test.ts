import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  AI_COUNCIL_PROMPT_IDENTITY_VERSION,
  buildAiCouncilPromptIdentityHash,
  resolveAiCouncilPromptIdentityHash,
} from "../../modules/ai-council/prompt-identity.ts"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

const deterministicEvidenceHash = "a".repeat(64)
const rawContextHash = "b".repeat(64)
const researchContextHash = "c".repeat(64)
const marketSynthesisHash = "d".repeat(64)
const reportHashOne = "e".repeat(64)
const reportHashTwo = "f".repeat(64)
const promptVersion = "llm-debate-v4-research-report-evidence"

test("QEO-86 bumps prompt identity contract and Research Report hash changes only the LLM identity", () => {
  assert.equal(AI_COUNCIL_PROMPT_IDENTITY_VERSION, "prompt-identity-v2-report-evidence")

  const first = buildAiCouncilPromptIdentityHash({
    deterministicEvidenceHash,
    rawContextHash,
    researchContextHash,
    reportEvidenceHash: reportHashOne,
    marketSynthesisHash,
    promptVersion,
  })
  const second = buildAiCouncilPromptIdentityHash({
    deterministicEvidenceHash,
    rawContextHash,
    researchContextHash,
    reportEvidenceHash: reportHashTwo,
    marketSynthesisHash,
    promptVersion,
  })

  assert.notEqual(first, second)
  assert.equal(deterministicEvidenceHash, "a".repeat(64))
})

test("QEO-86 resolver includes frozen reportEvidence.contextHash in prompt/cache identity", () => {
  const resolved = resolveAiCouncilPromptIdentityHash({
    evidenceHash: deterministicEvidenceHash,
    llmEvidence: { contextHash: rawContextHash },
    researchContext: {
      contextHash: researchContextHash,
      marketSynthesis: { evidenceHash: marketSynthesisHash },
    },
    reportEvidence: { contextHash: reportHashOne },
  }, promptVersion)

  const expected = buildAiCouncilPromptIdentityHash({
    deterministicEvidenceHash,
    rawContextHash,
    researchContextHash,
    reportEvidenceHash: reportHashOne,
    marketSynthesisHash,
    promptVersion,
  })
  assert.equal(resolved, expected)
})

test("QEO-86 first-class packet exposes Research Reports as a separate advisory evidence layer", () => {
  const packet = source("modules/ai-council/prompt-evidence.ts")
  assert.match(packet, /reportEvidence\?: unknown/)
  assert.match(packet, /stock\.reportEvidence/)
  assert.match(packet, /reportEvidence: stock\.reportEvidence/)
  assert.match(packet, /Research Report/i)
})

test("QEO-86 LLM prompt version and instructions preserve deterministic authority against broker narrative", () => {
  const llm = source("modules/ai-council/llm.ts")
  assert.match(llm, /AI_COUNCIL_LLM_PROMPT_VERSION = "llm-debate-v4-research-report-evidence"/)
  assert.match(llm, /SOURCE OPINION/i)
  assert.match(llm, /Research Report/i)
  assert.match(llm, /contradiction/i)
  assert.match(llm, /deterministic.*final.*authority/i)
  assert.match(llm, /must not.*(?:upgrade|downgrade).*deterministic/i)
})
