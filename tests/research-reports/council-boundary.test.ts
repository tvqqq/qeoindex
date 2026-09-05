import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("QEO-86 exposes Council Research Report selection through the public research-reports boundary", () => {
  const index = source("modules/research-reports/index.ts")
  const adapter = source("modules/ai-council/report-evidence.ts")

  assert.match(index, /selectCouncilReportEvidence/)
  assert.match(index, /CouncilReportEvidenceItem/)
  assert.match(index, /CouncilReportEvidenceSelection/)
  assert.match(adapter, /from "\.\.\/research-reports\/index\.ts"/)
  assert.doesNotMatch(adapter, /research-reports\/council-evidence/)
})

test("QEO-86 AI Council boundary never invokes report provider, PDF ingestion, or raw chunks", () => {
  const adapter = source("modules/ai-council/report-evidence.ts")
  const preMarket = source("modules/ai-council/pre-market-evidence.ts")

  assert.doesNotMatch(adapter, /providers\/topi|pdf-processing|fetchPdf|market_research_report_chunks/)
  assert.doesNotMatch(preMarket, /providers\/topi|pdf-processing|fetchPdf|market_research_report_chunks/)
})

test("QEO-86 README documents immutable Council evidence and QEO-87 rollout ownership", () => {
  const readme = source("modules/research-reports/README.md")

  assert.match(readme, /QEO-86/)
  assert.match(readme, /point-in-time/i)
  assert.match(readme, /ready.*empty.*unavailable/i)
  assert.match(readme, /raw PDF chunks/i)
  assert.match(readme, /SOURCE OPINION/i)
  assert.match(readme, /historical.*snapshot/i)
  assert.match(readme, /prompt identity/i)
  assert.match(readme, /QEO-87/)
  assert.match(readme, /pending.*quarantined/i)
  assert.match(readme, /generated.*Database types/i)
  assert.doesNotMatch(readme, /AI Council report selection remain separate follow-up responsibilities/)
})
