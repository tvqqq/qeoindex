import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function routeSource() {
  return readFileSync(new URL("../../app/api/research-reports/[id]/chat/route.ts", import.meta.url), "utf8")
}

function publicIndexSource() {
  return readFileSync(new URL("../../modules/research-reports/index.ts", import.meta.url), "utf8")
}

function readmeSource() {
  return readFileSync(new URL("../../modules/research-reports/README.md", import.meta.url), "utf8")
}

test("QEO-82 chat API authenticates before service-role retrieval and exposes POST-only no-store Node route", () => {
  const code = routeSource()

  assert.match(code, /export const runtime = ["']nodejs["']/)
  assert.match(code, /export const dynamic = ["']force-dynamic["']/)
  assert.match(code, /export async function POST\(/)
  assert.doesNotMatch(code, /export async function GET\(/)
  assert.match(code, /Cache-Control["']?\s*:\s*["']no-store/i)

  const authGate = code.indexOf('await requireApiFeature("research")')
  const serverClient = code.indexOf("getSupabaseServerClient()")
  const qaCall = code.indexOf("answerResearchReportQuestion(")
  assert.ok(authGate >= 0, "research auth gate must exist")
  assert.ok(serverClient > authGate, "service-role client must be created only after auth")
  assert.ok(qaCall > serverClient, "Q&A service must run only after trusted client creation")
})

test("QEO-82 chat API validates path/body and fails closed before privileged Q&A work", () => {
  const code = routeSource()
  const authGate = code.indexOf('await requireApiFeature("research")')
  const idRead = code.indexOf("await params")
  const uuidCheck = code.indexOf("UUID_RE.test", idRead)
  const serverClient = code.indexOf("getSupabaseServerClient()")

  assert.ok(authGate >= 0 && idRead > authGate)
  assert.ok(uuidCheck > idRead && serverClient > uuidCheck)
  assert.match(code, /request\.json\(\)\.catch\(\(\) => null\)/)
  assert.match(code, /malformed_json|Invalid JSON|JSON không hợp lệ/i)
  assert.match(code, /status:\s*400/)
  assert.match(code, /if \(!supabase\)[\s\S]{0,260}status:\s*503/)
  assert.match(code, /history:\s*payload\.history\s+as/)
  assert.doesNotMatch(code, /payload\.history\s*===\s*undefined[\s\S]{0,160}:\s*\[\]/)
})

test("QEO-82 chat API maps typed domain errors without leaking provider internals", () => {
  const code = routeSource()

  assert.match(code, /error instanceof ResearchReportQaError/)
  assert.match(code, /error\.httpStatus/)
  assert.match(code, /code:\s*error\.code/)
  assert.match(code, /publicQaErrorMessage\(error\.code\)/)
  assert.doesNotMatch(code, /error:\s*error\.message/)
  assert.match(code, /status:\s*500/)
  assert.doesNotMatch(code, /console\.(?:error|log)\([^\n]*(?:body|question|history|evidence|prompt)/i)
  assert.doesNotMatch(code, /OPENAI_API_KEY|prompt_cache_key|Authorization|raw provider/i)
})

test("QEO-82 public module exports only stable grounded-QA boundary", () => {
  const code = publicIndexSource()

  assert.match(code, /answerResearchReportQuestion/)
  assert.match(code, /ResearchReportQaError/)
  assert.match(code, /ResearchReportQaAudit/)
  assert.match(code, /ResearchReportQaCitation/)
  assert.match(code, /ResearchReportQaResult/)
  assert.match(code, /ResearchReportQaTurn/)
  assert.doesNotMatch(code, /qa\/openai|qa\/prompt|qa\/schema|qa\/retrieval/)
})

test("QEO-82 README documents current-version grounded Q&A and keeps follow-up scope separate", () => {
  const readme = readmeSource()

  assert.match(readme, /current report content hash/i)
  assert.match(readme, /latest successfully published analysis/i)
  assert.match(readme, /service-role lexical RPC/i)
  assert.match(readme, /Page\/chunk citations are projected from canonical retrieved evidence/i)
  assert.match(readme, /request-scoped and bounded/i)
  assert.match(readme, /no persistent chat storage/i)
  assert.match(readme, /vector search/i)
  assert.match(readme, /AI Council/i)
})
