import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")
const productionLive = fs.readFileSync(
  path.join(ROOT, "modules/ticker-knowledge/production-live.ts"),
  "utf8",
)

test("QEO-119 live benchmark uses manually labeled canonical production cases instead of lexical-derived ground truth", () => {
  assert.match(productionLive, /PRODUCTION_REPORT_BENCHMARK/)
  assert.doesNotMatch(productionLive, /lexicalExpected\s*=\s*lexicalProbe\.lexical/)
  assert.doesNotMatch(productionLive, /semanticExpected\s*=\s*semanticProbe\.lexical/)
  assert.match(productionLive, /expectedChunkIds/)
})
