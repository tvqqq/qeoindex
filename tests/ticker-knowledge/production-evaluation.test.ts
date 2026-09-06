import assert from "node:assert/strict"
import test from "node:test"

import { evaluateTickerKnowledgeProductionAcceptance } from "../../modules/ticker-knowledge/production-evaluation.ts"

test("QEO-119 production benchmark requires perfect canonical provenance/citations and non-regressive retrieval", () => {
  const evaluation = evaluateTickerKnowledgeProductionAcceptance({
    reportCases: [
      {
        id: "bsr-exact-target",
        kind: "lexical_anchor",
        expectedChunkIds: ["chunk-bsr"],
        lexicalChunkIds: ["chunk-bsr"],
        hybridChunkIds: ["chunk-bsr"],
        qdrantCandidateCount: 1,
        canonicalHybridCount: 1,
        lexicalMs: 3,
        hybridRetrievalMs: 7,
        hybridHydrationMs: 2,
        citationValidity: "pass",
        answerQuality: "not_scored",
      },
      {
        id: "bsr-semantic-valuation",
        kind: "semantic_paraphrase",
        expectedChunkIds: ["chunk-bsr"],
        lexicalChunkIds: [],
        hybridChunkIds: ["chunk-bsr"],
        qdrantCandidateCount: 1,
        canonicalHybridCount: 1,
        lexicalMs: 2,
        hybridRetrievalMs: 6,
        hybridHydrationMs: 2,
        citationValidity: "pass",
        answerQuality: "not_scored",
      },
    ],
    tickerIsolation: { tested: 3, passed: 3 },
    exactVersion: { tested: 2, passed: 2 },
    contradictionAuthority: { tested: 1, passed: 1 },
    temporalValidity: { tested: 2, passed: 2 },
    historicalAnalog: { tested: 2, passed: 2 },
  })

  assert.equal(evaluation.passed, true)
  assert.equal(evaluation.gates.canonicalProvenance100Pct, true)
  assert.equal(evaluation.gates.canonicalCitation100Pct, true)
  assert.equal(evaluation.gates.lexicalNonRegression, true)
  assert.equal(evaluation.gates.semanticNonRegression, true)
  assert.equal(evaluation.gates.tickerIsolation100Pct, true)
  assert.equal(evaluation.gates.exactVersion100Pct, true)
  assert.equal(evaluation.gates.contradictionAuthority100Pct, true)
  assert.equal(evaluation.gates.temporalValidity100Pct, true)
  assert.equal(evaluation.gates.historicalAnalog100Pct, true)
})

test("QEO-119 production benchmark fails closed on partial Qdrant hydration or ticker leakage", () => {
  const evaluation = evaluateTickerKnowledgeProductionAcceptance({
    reportCases: [
      {
        id: "gas-exact-target",
        kind: "lexical_anchor",
        expectedChunkIds: ["chunk-gas"],
        lexicalChunkIds: ["chunk-gas"],
        hybridChunkIds: ["chunk-gas"],
        qdrantCandidateCount: 2,
        canonicalHybridCount: 1,
        lexicalMs: 2,
        hybridRetrievalMs: 5,
        hybridHydrationMs: 2,
        citationValidity: "pass",
        answerQuality: "not_scored",
      },
      {
        id: "gas-semantic",
        kind: "semantic_paraphrase",
        expectedChunkIds: ["chunk-gas"],
        lexicalChunkIds: ["chunk-gas"],
        hybridChunkIds: [],
        qdrantCandidateCount: 1,
        canonicalHybridCount: 1,
        lexicalMs: 2,
        hybridRetrievalMs: 5,
        hybridHydrationMs: 2,
        citationValidity: "fail",
        answerQuality: "not_scored",
      },
    ],
    tickerIsolation: { tested: 2, passed: 1 },
    exactVersion: { tested: 1, passed: 1 },
    contradictionAuthority: { tested: 1, passed: 1 },
    temporalValidity: { tested: 1, passed: 0 },
    historicalAnalog: { tested: 1, passed: 0 },
  })

  assert.equal(evaluation.passed, false)
  assert.equal(evaluation.gates.canonicalProvenance100Pct, false)
  assert.equal(evaluation.gates.canonicalCitation100Pct, false)
  assert.equal(evaluation.gates.semanticNonRegression, false)
  assert.equal(evaluation.gates.tickerIsolation100Pct, false)
  assert.equal(evaluation.gates.temporalValidity100Pct, false)
  assert.equal(evaluation.gates.historicalAnalog100Pct, false)
})
