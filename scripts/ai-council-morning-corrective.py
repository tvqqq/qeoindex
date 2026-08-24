from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected exactly one match, found {count}\n--- OLD ---\n{old[:500]}")
    file.write_text(text.replace(old, new, 1))

# Legacy P4.3 regression should validate the wrapper owns raw hydration, not demand an implementation detail in the route.
replace_once(
    "tests/ai-council-persistence.test.ts",
    '''  const migration = source("supabase/migrations/20260823214500_ai_council_llm_evidence_fidelity.sql")
  const route = source("app/api/ai-council/debate-daily/route.ts")
''',
    '''  const migration = source("supabase/migrations/20260823214500_ai_council_llm_evidence_fidelity.sql")
  const preMarket = source("lib/ai-council-pre-market-evidence.ts")
  const route = source("app/api/ai-council/debate-daily/route.ts")
''',
)
replace_once(
    "tests/ai-council-persistence.test.ts",
    '''  assert.match(route, /enrichCouncilStocksWithLlmEvidence/)
  assert.match(route, /stocks: debateStocks/)
''',
    '''  assert.match(preMarket, /enrichCouncilStocksWithLlmEvidence/)
  assert.match(route, /enrichCouncilStocksForDebate/)
  assert.match(route, /stocks: debateStocks/)
''',
)

# Aggregate volume can forbid participant attribution without itself containing positive institutional attribution language.
replace_once(
    "lib/insights-metric-semantics.ts",
    '        "Do not equate high liquidity solely with buying or institutional accumulation.",\n',
    '        "Do not equate high liquidity solely with buying or infer the identity/class of market participants.",\n',
)
replace_once(
    "lib/insights-metric-semantics.ts",
    '      forbiddenInferences: ["Do not treat baseline average as institutional intention."],\n',
    '      forbiddenInferences: ["Do not treat baseline average as evidence of any participant class intent."],\n',
)

# A frozen research row may outlive a prompt-version bump. Recompute current identity and reuse persisted value only when it matches.
replace_once(
    "lib/ai-council-prompt-identity.ts",
    '''  const persistedResearchIdentity = hashString(stock.researchContext?.promptIdentityHash)
  if (persistedResearchIdentity) return persistedResearchIdentity

  return buildAiCouncilPromptIdentityHash({
    deterministicEvidenceHash: stock.evidenceHash,
    rawContextHash: hashString(stock.llmEvidence?.contextHash),
    researchContextHash: hashString(stock.researchContext?.contextHash),
    promptVersion,
  })
''',
    '''  const computedIdentity = buildAiCouncilPromptIdentityHash({
    deterministicEvidenceHash: stock.evidenceHash,
    rawContextHash: hashString(stock.llmEvidence?.contextHash),
    researchContextHash: hashString(stock.researchContext?.contextHash),
    promptVersion,
  })
  const persistedResearchIdentity = hashString(stock.researchContext?.promptIdentityHash)

  // Reuse the frozen audit identity only when it was created for the same prompt version.
  // Failed/partial runs may be retried after a prompt bump while retaining immutable source contexts.
  return persistedResearchIdentity === computedIdentity ? persistedResearchIdentity : computedIdentity
''',
)

# Historical rows must not be mislabeled as Packet V2 if they predate semantic grounding.
replace_once(
    "lib/ai-council-debate-data.ts",
    '''  const firstClassContext = row.prompt_version === "llm-debate-v3-first-class-context"
  const promptIdentityHash = firstClassContext
''',
    '''  const firstClassContext = row.prompt_version === "llm-debate-v3-first-class-context"
  const semanticPacket = firstClassContext || row.prompt_version === "llm-debate-v2-semantic-grounding"
  const promptIdentityHash = firstClassContext
''',
)
replace_once(
    "lib/ai-council-debate-data.ts",
    '''      packetVersion: AI_COUNCIL_EVIDENCE_PACKET_VERSION,
      semanticGuideVersion: INSIGHTS_METRIC_GUIDE_VERSION,
''',
    '''      packetVersion: semanticPacket ? AI_COUNCIL_EVIDENCE_PACKET_VERSION : "legacy-council-packet",
      semanticGuideVersion: semanticPacket ? INSIGHTS_METRIC_GUIDE_VERSION : "legacy",
''',
)

# Lock the prompt-version mismatch behavior with a focused test.
with Path("tests/ai-council-prompt-evidence.test.ts").open("a") as handle:
    handle.write('''\n\ntest("prompt identity recomputes when immutable research context predates the current prompt version", () => {\n  const rawContextHash = "c".repeat(64)\n  const researchContextHash = "d".repeat(64)\n  const staleIdentity = buildAiCouncilPromptIdentityHash({\n    deterministicEvidenceHash: mockStock.evidenceHash,\n    rawContextHash,\n    researchContextHash,\n    promptVersion: "llm-debate-v2-semantic-grounding",\n  })\n  const currentIdentity = buildAiCouncilPromptIdentityHash({\n    deterministicEvidenceHash: mockStock.evidenceHash,\n    rawContextHash,\n    researchContextHash,\n    promptVersion: "llm-debate-v3-first-class-context",\n  })\n\n  assert.notEqual(staleIdentity, currentIdentity)\n  assert.equal(\n    resolveAiCouncilPromptIdentityHash({\n      evidenceHash: mockStock.evidenceHash,\n      llmEvidence: { contextHash: rawContextHash },\n      researchContext: { contextHash: researchContextHash, promptIdentityHash: staleIdentity },\n    }, "llm-debate-v3-first-class-context"),\n    currentIdentity,\n  )\n})\n''')

# Clarify the database comment: persisted identity is audit metadata and exact cache identity when prompt versions match.
replace_once(
    "supabase/migrations/20260824094500_ai_council_prompt_identity_comment.sql",
    "  'SHA-256 identity over deterministic evidence hash + raw LLM evidence hash + research context hash + prompt version. From llm-debate-v3-first-class-context onward this identity is the OpenAI prompt-cache routing key and audit identity.';\n",
    "  'SHA-256 identity over deterministic evidence hash + raw LLM evidence hash + research context hash + prompt version. From llm-debate-v3-first-class-context onward runtime uses this identity for OpenAI prompt-cache routing when the prompt version matches; retries after a prompt bump recompute from the immutable component hashes.';\n",
)

print("AI Council morning corrective patch applied")
