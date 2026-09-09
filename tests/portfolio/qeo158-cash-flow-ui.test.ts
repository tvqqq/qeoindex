import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

const panelUrl = new URL(
  "../../components/portfolio/risk-engine/external-cash-flow-panel.tsx",
  import.meta.url,
)
const hookUrl = new URL(
  "../../components/portfolio/risk-engine/use-external-cash-flows.ts",
  import.meta.url,
)
const riskDashboardUrl = new URL(
  "../../components/portfolio/risk-engine/portfolio-risk-dashboard.tsx",
  import.meta.url,
)
const selectorUrl = new URL(
  "../../components/portfolio/portfolio-selector.tsx",
  import.meta.url,
)
const equityPanelUrl = new URL(
  "../../components/portfolio/performance/equity-drawdown-panel.tsx",
  import.meta.url,
)

test("QEO-158 Tài sản workspace exposes append-only external funding history", () => {
  assert.equal(existsSync(panelUrl), true, "external cash-flow panel must exist")
  assert.equal(existsSync(hookUrl), true, "external cash-flow hook must exist")

  const panel = readFileSync(panelUrl, "utf8")
  const hook = readFileSync(hookUrl, "utf8")
  const dashboard = readFileSync(riskDashboardUrl, "utf8")

  for (const copy of [
    "Dòng vốn ngoài",
    "Nạp vốn",
    "Rút vốn",
    "Điều chỉnh vốn",
    "Legacy · lịch sử vốn chưa đầy đủ",
    "không tính vào Trading P/L",
  ]) {
    assert.match(panel, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"))
  }

  assert.match(hook, /\/cash-flows/)
  assert.match(hook, /method:\s*"POST"/)
  assert.match(hook, /refresh/)
  assert.match(hook, /cache:\s*"no-store"/)
  assert.doesNotMatch(hook, /method:\s*"(PATCH|DELETE)"/)

  assert.match(dashboard, /ExternalCashFlowPanel/)
  assert.match(dashboard, /portfolioId=\{portfolioId\}/)
})

test("QEO-158 opening-capital and performance copy explain supported return semantics", () => {
  const selector = readFileSync(selectorUrl, "utf8")
  const equityPanel = readFileSync(equityPanelUrl, "utf8")

  assert.match(selector, /(Vốn mở đầu|Opening Capital)/i)
  assert.match(selector, /Dòng vốn ngoài/i)

  assert.match(equityPanel, /flow-adjusted/i)
  assert.match(equityPanel, /không phải TWR\/MWR/i)
  assert.match(equityPanel, /không tính[^\n]{0,100}Trading P\/L/i)
  assert.match(equityPanel, /Legacy · lịch sử vốn chưa đầy đủ/i)
})
