import assert from "node:assert/strict"
import test from "node:test"

import { isRuntimeBuildRelevant, needsVercelBuild } from "../scripts/build-impact.mjs"

test("documentation and verification-only changes do not require a Vercel runtime build", () => {
  const files = [
    "docs/HANDOVER.md",
    "README.md",
    "AGENTS.md",
    ".github/workflows/security.yml",
    "tests/navigation-prefetch.test.ts",
    "supabase/migrations/202608180001_example.sql",
  ]

  assert.equal(needsVercelBuild(files), false)
  for (const file of files) assert.equal(isRuntimeBuildRelevant(file), false, file)
})

test("runtime, build configuration, and operational script changes still build", () => {
  const files = [
    "app/page.tsx",
    "components/live-market-board-v2.tsx",
    "lib/ui-data-cache.ts",
    "workflows/daily-signal-workflow.ts",
    "scripts/scan-secrets.sh",
    "package.json",
    "pnpm-lock.yaml",
    "next.config.mjs",
    "vercel.json",
    "tsconfig.json",
  ]

  for (const file of files) assert.equal(isRuntimeBuildRelevant(file), true, file)
})

test("mixed commits build when any runtime-relevant file changes", () => {
  assert.equal(needsVercelBuild(["docs/HANDOVER.md", "lib/scanner-data.ts"]), true)
})

test("unknown or empty diffs build conservatively", () => {
  assert.equal(needsVercelBuild([]), true)
})
