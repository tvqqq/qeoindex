import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("QEO-86 debate dashboard hydrates historical Research Reports from immutable snapshots only", () => {
  const data = source("modules/ai-council/debate-data.ts")

  assert.match(data, /ai_council_report_evidence_snapshots/)
  assert.match(data, /run_id,context_version,context_hash,status,context_payload,report_ids,analysis_ids,captured_at/)
  assert.match(data, /reportContextVersion/)
  assert.match(data, /reportContextHash/)
  assert.match(data, /reportStatus/)
  assert.match(data, /reportCount/)
  assert.match(data, /reportCapturedAt/)
  assert.match(data, /relatedReports/)
  assert.doesNotMatch(data, /selectCouncilReportEvidence|getRelevantReportEvidence|getRelevantMarketReportEvidence/)
})

test("QEO-86 debate provenance recognizes prompt identity v2 and frozen report context", () => {
  const data = source("modules/ai-council/debate-data.ts")

  assert.match(data, /llm-debate-v4-research-report-evidence/)
  assert.match(data, /prompt-identity-v2-report-evidence/)
  assert.match(data, /reportEvidence:\s*\{\s*contextHash:/)
  assert.match(data, /AiCouncilDebateDashboardRow/)
  assert.match(data, /reportContextVersion:/)
  assert.match(data, /reportContextHash:/)
  assert.match(data, /relatedReports:/)
})

test("QEO-86 historical related reports hydrate ticker stance from frozen tickerMention", () => {
  const data = source("modules/ai-council/debate-data.ts")

  assert.match(data, /report\.tickerMention/)
  assert.match(data, /tickerMention[\s\S]*stance/)
  assert.doesNotMatch(data, /report\.tickerEvidence/)
})

test("QEO-86 Debate Card renders compact related-report links and source-opinion labeling", () => {
  const page = source("app/insights/ai-council/debates/page.tsx")

  assert.match(page, /Báo cáo liên quan/)
  assert.match(page, /Research Reports/)
  assert.match(page, /Source opinion/i)
  assert.match(page, /row\.relatedReports/)
  assert.match(page, /\/research\/reports\/\$\{report\.reportId\}/)
  assert.match(page, /report\.sourceName/)
  assert.match(page, /report\.publishDate/)
  assert.match(page, /report\.category/)
  assert.match(page, /report\.tickerStance/)
  assert.doesNotMatch(page, /report\.executiveSummary/)
})
