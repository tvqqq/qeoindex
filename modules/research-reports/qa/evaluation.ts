export type ResearchReportQaEvaluationKind = "lexical_anchor" | "semantic_paraphrase"
export type ResearchReportQaEvaluationJudgement = "pass" | "fail" | "not_scored"

export interface ResearchReportQaEvaluationCase {
  id: string
  kind: ResearchReportQaEvaluationKind
  expectedChunkIds: readonly string[]
  lexicalChunkIds: readonly string[]
  hybridChunkIds: readonly string[]
  qdrantCandidateCount: number
  canonicalHybridCount: number
  lexicalMs: number
  hybridRetrievalMs: number
  hybridHydrationMs: number
  citationValidity: ResearchReportQaEvaluationJudgement
  answerQuality: ResearchReportQaEvaluationJudgement
}

export interface ResearchReportQaRetrievalScore {
  hitRate: number
  recall: number
}

export interface ResearchReportQaKindEvaluation {
  cases: number
  lexicalRecall: number
  hybridRecall: number
  nonRegressive: boolean
}

export interface ResearchReportQaJudgementSummary {
  scored: number
  passed: number
  failed: number
  unscored: number
  passRate: number | null
}

export interface ResearchReportQaRetrievalEvaluation {
  totalCases: number
  overall: {
    lexical: ResearchReportQaRetrievalScore
    hybrid: ResearchReportQaRetrievalScore
    nonRegressive: boolean
  }
  byKind: Record<ResearchReportQaEvaluationKind, ResearchReportQaKindEvaluation>
  canonicalResolutionRate: number
  citationValidity: ResearchReportQaJudgementSummary
  answerQuality: ResearchReportQaJudgementSummary
  latencyMs: {
    lexicalAverage: number
    hybridRetrievalAverage: number
    hybridHydrationAverage: number
    hybridTotalAverage: number
  }
}

function normalizedId(value: string) {
  return value.trim()
}

function normalizedUniqueIds(values: readonly string[], label: string, caseId: string) {
  const result: string[] = []
  const seen = new Set<string>()
  for (const raw of values) {
    const value = normalizedId(raw)
    if (!value) throw new Error(`QEO-116 evaluation ${caseId} has empty ${label}`)
    if (seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}

function nonNegativeFinite(value: number, label: string, caseId: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`QEO-116 evaluation ${caseId} requires non-negative ${label}`)
  }
  return value
}

function nonNegativeInteger(value: number, label: string, caseId: string) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`QEO-116 evaluation ${caseId} requires non-negative integer ${label}`)
  }
  return value
}

function intersectionCount(expected: readonly string[], actual: readonly string[]) {
  const actualSet = new Set(actual)
  let matched = 0
  for (const id of expected) if (actualSet.has(id)) matched += 1
  return matched
}

function caseRecall(expected: readonly string[], actual: readonly string[]) {
  return intersectionCount(expected, actual) / expected.length
}

function average(values: readonly number[]) {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function retrievalScore(cases: readonly NormalizedEvaluationCase[], source: "lexical" | "hybrid"): ResearchReportQaRetrievalScore {
  if (cases.length === 0) return { hitRate: 0, recall: 0 }
  const recalls = cases.map((entry) => caseRecall(
    entry.expectedChunkIds,
    source === "lexical" ? entry.lexicalChunkIds : entry.hybridChunkIds,
  ))
  return {
    hitRate: recalls.filter((value) => value > 0).length / cases.length,
    recall: average(recalls),
  }
}

function judgementSummary(
  cases: readonly NormalizedEvaluationCase[],
  field: "citationValidity" | "answerQuality",
): ResearchReportQaJudgementSummary {
  let passed = 0
  let failed = 0
  let unscored = 0
  for (const entry of cases) {
    const judgement = entry[field]
    if (judgement === "pass") passed += 1
    else if (judgement === "fail") failed += 1
    else unscored += 1
  }
  const scored = passed + failed
  return {
    scored,
    passed,
    failed,
    unscored,
    passRate: scored > 0 ? passed / scored : null,
  }
}

type NormalizedEvaluationCase = Omit<ResearchReportQaEvaluationCase,
  "id" | "expectedChunkIds" | "lexicalChunkIds" | "hybridChunkIds"
> & {
  id: string
  expectedChunkIds: string[]
  lexicalChunkIds: string[]
  hybridChunkIds: string[]
}

function normalizeCases(input: readonly ResearchReportQaEvaluationCase[]): NormalizedEvaluationCase[] {
  if (input.length === 0) throw new Error("QEO-116 evaluation requires benchmark cases")
  const seenIds = new Set<string>()
  const cases: NormalizedEvaluationCase[] = []

  for (const raw of input) {
    const id = normalizedId(raw.id)
    if (!id) throw new Error("QEO-116 evaluation requires non-empty case id")
    if (seenIds.has(id)) throw new Error(`QEO-116 evaluation duplicate case id: ${id}`)
    seenIds.add(id)

    const expectedChunkIds = normalizedUniqueIds(raw.expectedChunkIds, "expectedChunkIds", id)
    if (expectedChunkIds.length === 0) {
      throw new Error(`QEO-116 evaluation ${id} requires expectedChunkIds ground truth`)
    }
    const lexicalChunkIds = normalizedUniqueIds(raw.lexicalChunkIds, "lexicalChunkIds", id)
    const hybridChunkIds = normalizedUniqueIds(raw.hybridChunkIds, "hybridChunkIds", id)
    const qdrantCandidateCount = nonNegativeInteger(raw.qdrantCandidateCount, "qdrantCandidateCount", id)
    const canonicalHybridCount = nonNegativeInteger(raw.canonicalHybridCount, "canonicalHybridCount", id)
    if (canonicalHybridCount > qdrantCandidateCount) {
      throw new Error(`QEO-116 evaluation ${id} canonicalHybridCount exceeds qdrantCandidateCount`)
    }

    cases.push({
      ...raw,
      id,
      expectedChunkIds,
      lexicalChunkIds,
      hybridChunkIds,
      qdrantCandidateCount,
      canonicalHybridCount,
      lexicalMs: nonNegativeFinite(raw.lexicalMs, "lexicalMs", id),
      hybridRetrievalMs: nonNegativeFinite(raw.hybridRetrievalMs, "hybridRetrievalMs", id),
      hybridHydrationMs: nonNegativeFinite(raw.hybridHydrationMs, "hybridHydrationMs", id),
    })
  }

  return cases
}

function kindEvaluation(
  cases: readonly NormalizedEvaluationCase[],
  kind: ResearchReportQaEvaluationKind,
): ResearchReportQaKindEvaluation {
  const selected = cases.filter((entry) => entry.kind === kind)
  const lexicalRecall = retrievalScore(selected, "lexical").recall
  const hybridRecall = retrievalScore(selected, "hybrid").recall
  return {
    cases: selected.length,
    lexicalRecall,
    hybridRecall,
    nonRegressive: hybridRecall >= lexicalRecall,
  }
}

export function evaluateResearchReportQaRetrieval(
  input: readonly ResearchReportQaEvaluationCase[],
): ResearchReportQaRetrievalEvaluation {
  const cases = normalizeCases(input)
  const lexical = retrievalScore(cases, "lexical")
  const hybrid = retrievalScore(cases, "hybrid")
  const candidateCount = cases.reduce((sum, entry) => sum + entry.qdrantCandidateCount, 0)
  const canonicalCount = cases.reduce((sum, entry) => sum + entry.canonicalHybridCount, 0)

  return {
    totalCases: cases.length,
    overall: {
      lexical,
      hybrid,
      nonRegressive: hybrid.recall >= lexical.recall,
    },
    byKind: {
      lexical_anchor: kindEvaluation(cases, "lexical_anchor"),
      semantic_paraphrase: kindEvaluation(cases, "semantic_paraphrase"),
    },
    canonicalResolutionRate: candidateCount > 0 ? canonicalCount / candidateCount : 0,
    citationValidity: judgementSummary(cases, "citationValidity"),
    answerQuality: judgementSummary(cases, "answerQuality"),
    latencyMs: {
      lexicalAverage: average(cases.map((entry) => entry.lexicalMs)),
      hybridRetrievalAverage: average(cases.map((entry) => entry.hybridRetrievalMs)),
      hybridHydrationAverage: average(cases.map((entry) => entry.hybridHydrationMs)),
      hybridTotalAverage: average(cases.map((entry) => entry.hybridRetrievalMs + entry.hybridHydrationMs)),
    },
  }
}
