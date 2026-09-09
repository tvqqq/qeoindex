import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const panelPath = path.join(process.cwd(), "components/portfolio/concentration/portfolio-concentration-panel.tsx")
const dashboardPath = path.join(process.cwd(), "components/portfolio/risk-engine/portfolio-risk-dashboard-core.tsx")

test("Tài sản concentration panel exposes deterministic plan status and required metrics", () => {
  assert.equal(fs.existsSync(panelPath), true, "QEO-159 concentration panel must exist")
  const source = fs.readFileSync(panelPath, "utf8")

  for (const copy of [
    "Tập trung danh mục",
    "Tỷ trọng mã lớn nhất",
    "Rủi ro chủ động lớn nhất",
    "Rủi ro ngành lớn nhất",
    "Số vị thế đang mở",
    "Chưa đủ dữ liệu phân ngành",
    "Trong kế hoạch",
    "Cảnh báo",
    "Vượt giới hạn",
    "Chưa xác định",
  ]) {
    assert.match(source, new RegExp(copy))
  }

  assert.match(source, /PortfolioConcentrationReadModel/)
  assert.doesNotMatch(source, /fetch\(/)
  assert.doesNotMatch(source, /\/api\/portfolio\//)
  assert.doesNotMatch(source, /\/\s*accountEquityVnd\s*\*\s*100/)
})

test("risk dashboard renders concentration from the canonical risk response without another fetch", () => {
  const source = fs.readFileSync(dashboardPath, "utf8")
  assert.match(source, /PortfolioConcentrationPanel/)
  assert.match(source, /concentration=\{risk\.concentration\}/)
  assert.doesNotMatch(source, /api\/portfolio\/.*concentration/)
})
