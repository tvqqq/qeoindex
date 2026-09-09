import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("QEO-165 respects reduced motion and does not add a second motion library", () => {
  const theme = source("components/portfolio/portfolio-theme.module.css")
  const pkg = JSON.parse(source("package.json")) as { dependencies?: Record<string, string> }

  assert.match(theme, /prefers-reduced-motion:\s*reduce/)
  assert.equal(pkg.dependencies?.motion != null, true)
  assert.equal(pkg.dependencies?.["framer-motion"], undefined)
})

test("QEO-165 command-center surfaces retain responsive and accessible interaction contracts", () => {
  const tactical = source("components/portfolio/revamp/tactical-position-card.tsx")
  const grid = source("components/portfolio/revamp/portfolio-position-grid.tsx")
  const actions = source("components/portfolio/revamp/portfolio-command-actions.tsx")
  const warRoomNav = source("components/portfolio/revamp/war-room-stage-nav.tsx")
  const guidance = source("components/portfolio/portfolio-guidance-dialog.tsx")

  assert.match(tactical, /stateLabel\(state\)/, "tactical state must be textual in addition to color")
  assert.match(tactical, /className="h-10[^\"]*"/, "primary tactical action must retain a comfortable touch target")
  assert.match(grid, /md:grid-cols-2/)
  assert.match(grid, /xl:grid-cols-(?:3|4)/)
  assert.match(actions, /flex flex-wrap/)
  assert.match(warRoomNav, /overflow-x-auto/)
  assert.match(guidance, /w-\[calc\(100vw-1rem\)\]/)
  assert.match(guidance, /max-w-5xl/)
})

test("QEO-165 preprod workflow is the exact-head release gate without a database replay step", () => {
  const workflow = source(".github/workflows/qeo165-preprod.yml")

  assert.match(workflow, /node --test tests\/portfolio\/qeo165-\*\.test\.ts/)
  for (const regression of [
    "tests/portfolio/qeo138-risk-plan-ui.test.ts",
    "tests/portfolio/qeo139-trade-size-ui.test.ts",
    "tests/portfolio/qeo141-risk-ui.test.ts",
    "tests/portfolio/qeo142-performance-ui.test.ts",
    "tests/portfolio/qeo159-concentration-ui.test.ts",
    "tests/portfolio/qeo159-override-audit.test.ts",
  ]) {
    assert.match(workflow, new RegExp(regression.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
  }

  for (const command of [
    "pnpm test:manifest",
    "pnpm test:current",
    "pnpm lint:touched",
    "pnpm typecheck",
    "pnpm build",
  ]) {
    assert.match(workflow, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
  }

  assert.doesNotMatch(workflow, /db:replay|supabase\/setup-cli|Replay migrations from zero/)
})
