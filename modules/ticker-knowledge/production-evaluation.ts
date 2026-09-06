import {
  evaluateResearchReportQaRetrieval,
  type ResearchReportQaEvaluationCase,
} from "../research-reports/qa/evaluation.ts"

export interface ProductionAcceptanceProbeSummary {
  tested: number
  passed: number
}

export interface TickerKnowledgeProductionAcceptanceInput {
  reportCases: readonly ResearchReportQaEvaluationCase[]
  tickerIsolation: ProductionAcceptanceProbeSummary
  exactVersion: ProductionAcceptanceProbeSummary
  contradictionAuthority: ProductionAcceptanceProbeSummary
}

function perfectProbe(summary: ProductionAcceptanceProbeSummary, label: string) {
  if (!Number.isInteger(summary.tested) || summary.tested <= 0) {
    throw new Error(`QEO-119 ${label} requires at least one production probe`)
  }
  if (!Number.isInteger(summary.passed) || summary.passed < 0 || summary.passed > summary.tested) {
    throw new Error(`QEO-119 ${label} has invalid pass count`)
  }
  return summary.passed === summary.tested
}

export function evaluateTickerKnowledgeProductionAcceptance(
  input: TickerKnowledgeProductionAcceptanceInput,
) {
  const report = evaluateResearchReportQaRetrieval(input.reportCases)
  const lexical = report.byKind.lexical_anchor
  const semantic = report.byKind.semantic_paraphrase

  const gates = {
    canonicalProvenance100Pct:
      report.canonicalResolutionRate === 1,
    canonicalCitation100Pct:
      report.citationValidity.scored === report.totalCases
      && report.citationValidity.passRate === 1,
    lexicalNonRegression:
      lexical.cases > 0
      && lexical.nonRegressive,
    semanticNonRegression:
      semantic.cases > 0
      && semantic.nonRegressive
      && semantic.hybridRecall > 0,
    tickerIsolation100Pct: perfectProbe(input.tickerIsolation, "ticker isolation"),
    exactVersion100Pct: perfectProbe(input.exactVersion, "exact version"),
    contradictionAuthority100Pct: perfectProbe(input.contradictionAuthority, "contradiction authority"),
  }

  return {
    passed: Object.values(gates).every(Boolean),
    gates,
    report,
    probes: {
      tickerIsolation: input.tickerIsolation,
      exactVersion: input.exactVersion,
      contradictionAuthority: input.contradictionAuthority,
    },
  }
}
