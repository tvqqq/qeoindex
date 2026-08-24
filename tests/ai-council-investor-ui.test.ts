import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("AI Council dashboard renders a simple investor report before advanced analysis", () => {
  const dashboard = source("components/insights/ai-council-dashboard.tsx")

  assert.match(dashboard, /AiCouncilInvestorReport/)
  assert.match(dashboard, /Phân tích chuyên sâu/)
  assert.match(dashboard, /Independent specialist opinions/)

  const simpleReportIndex = dashboard.indexOf("<AiCouncilInvestorReport")
  const advancedIndex = dashboard.indexOf("Phân tích chuyên sâu")
  const specialistIndex = dashboard.indexOf("Independent specialist opinions")

  assert.ok(simpleReportIndex >= 0, "simple investor report should render")
  assert.ok(advancedIndex > simpleReportIndex, "advanced disclosure should come after the simple report")
  assert.ok(specialistIndex > advancedIndex, "specialist analysis should live inside the advanced disclosure")
})

test("simple investor component exposes five pillars and four decision questions in Vietnamese", () => {
  let report = ""
  try {
    report = source("components/insights/ai-council-investor-report.tsx")
  } catch {
    // RED until the component is implemented.
  }

  assert.match(report, /Cơ bản/)
  assert.match(report, /Kỹ thuật/)
  assert.match(report, /Dòng tiền/)
  assert.match(report, /Bối cảnh/)
  assert.match(report, /An toàn/)
  assert.match(report, /Vì sao đáng chú ý\?/)
  assert.match(report, /Rủi ro chính/)
  assert.match(report, /Cần xác nhận gì\?/)
  assert.match(report, /Điều gì làm luận điểm sai\?/)
  assert.match(report, /Khuyến nghị/)
  assert.match(report, /Độ tin cậy/)
})

test("advanced disclosure preserves deterministic specialist, debate, risk, levels and audit views", () => {
  const dashboard = source("components/insights/ai-council-dashboard.tsx")

  assert.match(dashboard, /<details/)
  assert.match(dashboard, /Bull Researcher/)
  assert.match(dashboard, /Bear Researcher/)
  assert.match(dashboard, /Minority \/ Risk view/)
  assert.match(dashboard, /Decision levels/)
  assert.match(dashboard, /Historical audit trail/)
})
