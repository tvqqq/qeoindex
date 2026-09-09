import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("QEO-165 establishes shared command-center presentation primitives", () => {
  const shell = source("components/portfolio/revamp/portfolio-section-shell.tsx")
  const status = source("components/portfolio/revamp/tactical-status.ts")

  assert.match(shell, /PortfolioSectionShell/)
  assert.match(status, /resolveTacticalPositionState/)
  assert.match(status, /MISSING_STOP/)
  assert.doesNotMatch(status, /rarity|conviction|attack|defense|mạnh|yếu/i)
})

test("QEO-165 composes the command header, battle HUD and canonical risk strip", () => {
  const page = source("components/portfolio/portfolio-page.tsx")
  const hud = source("components/portfolio/revamp/portfolio-battle-hud.tsx")
  const riskCore = source("components/portfolio/risk-engine/portfolio-risk-dashboard-core.tsx")
  const strip = source("components/portfolio/revamp/portfolio-risk-state-strip.tsx")

  assert.match(page, /PortfolioCommandHeader/)
  assert.match(page, /PortfolioBattleHud/)
  assert.match(hud, /Tổng tài sản \(NAV\)/)
  assert.match(hud, /text-(?:3xl|4xl)/)
  assert.match(riskCore, /PortfolioRiskStateStrip/)
  assert.match(riskCore, /Mở bảng rủi ro chi tiết/)
  assert.match(strip, /concentration\.summary\.overallStatus/)
  assert.doesNotMatch(strip, /fetch\s*\(/)
})

test("QEO-165 restores the pre-revamp Vietnamese portfolio header hierarchy", () => {
  const header = source("components/portfolio/revamp/portfolio-command-header.tsx")

  assert.match(header, /Nhật ký đầu tư/)
  assert.match(header, /Quản trị rủi ro/)
  assert.doesNotMatch(header, /Portfolio Command Center/)
  assert.match(header, /bg-gradient-to-r from-\[#0d1017\] via-\[#131724\] to-\[#0d1017\]/)
  assert.match(header, /border-\[#2b2e40\]/)
  assert.match(header, /font-ticker text-2xl font-extrabold tracking-tight text-white sm:text-3xl/)
  assert.match(header, /italic bg-gradient-to-r from-purple-400 via-indigo-300 to-purple-400 bg-clip-text text-transparent/)
  assert.match(header, /\{selector\}/)
  assert.match(header, /\{actions\}/)
})
