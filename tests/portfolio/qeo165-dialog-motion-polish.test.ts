import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("QEO-165 transaction dialog owns a wide responsive shell and icon-led form hierarchy", () => {
  const dialog = source("components/portfolio/add-transaction-dialog.tsx")

  assert.match(dialog, /sm:max-w-6xl/)
  assert.match(dialog, /max-h-\[94vh\]/)
  assert.match(dialog, /lg:grid-cols-2/)
  assert.match(dialog, /TradeFieldLabel/)
  for (const icon of ["CalendarDays", "WalletCards", "Hash", "Target", "ShieldAlert", "StickyNote"]) {
    assert.match(dialog, new RegExp(`\\b${icon}\\b`), `missing transaction dialog icon ${icon}`)
  }
})

test("QEO-165 Field Manual keeps one readable column until large desktop widths", () => {
  const guidance = source("components/portfolio/portfolio-guidance-dialog.tsx")

  assert.match(guidance, /sm:max-w-6xl/)
  assert.match(guidance, /lg:grid-cols-\[220px_minmax\(0,1fr\)\]/)
  assert.doesNotMatch(guidance, /md:grid-cols-\[210px_minmax\(0,1fr\)\]/)
  assert.match(guidance, /lg:sticky/)
})

test("QEO-165 portfolio motion is centralized, reduced-motion aware, and wired into primary surfaces", () => {
  const motion = source("components/portfolio/revamp/portfolio-motion.tsx")
  const page = source("components/portfolio/portfolio-page.tsx")
  const tactical = source("components/portfolio/revamp/tactical-position-card.tsx")
  const scouting = source("components/portfolio/revamp/scouting-card.tsx")

  assert.match(motion, /from "motion\/react"/)
  assert.match(motion, /LazyMotion/)
  assert.match(motion, /useReducedMotion/)
  assert.match(motion, /PortfolioTabMotion/)
  assert.match(motion, /PortfolioCardMotion/)
  assert.match(page, /<PortfolioTabMotion/)
  assert.match(tactical, /<PortfolioCardMotion/)
  assert.match(scouting, /<PortfolioCardMotion/)
})
