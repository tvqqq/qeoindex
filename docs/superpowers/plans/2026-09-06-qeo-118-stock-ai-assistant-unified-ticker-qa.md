# QEO-118 Grounded Unified Ticker Q&A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fake client-only Quick AI Assistant on `/insights/[ticker]` with an authenticated, bounded, provenance-resolved ticker Q&A service backed by the shared Unified Ticker Context Builder.

**Architecture:** Keep the existing `/insights/[ticker]` workstation and `StockAiSidebar`. A new server-only `modules/ticker-qa/` service loads mandatory canonical thesis + latest deterministic Council state, calls `buildTickerContext(..., consumer: "STOCK_QA")`, resolves selected items back to exact canonical sources, then sends only resolved bounded evidence to the answer model. Qdrant remains derived retrieval only; the client receives validated claims/citations and never falls back to the existing keyword/setTimeout financial-answer generator.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.7, Supabase PostgreSQL, Notion research read model, Qdrant `ticker_knowledge`, Node test runner, existing server-side OpenAI Q&A conventions.

**Spec:** `docs/superpowers/specs/2026-09-06-qeo-118-stock-ai-assistant-unified-ticker-qa-design.md`

## Global Constraints

- Existing UI surface is `/insights/[ticker]`; do not create a new `/research/[ticker]` or `/research/[ticker]/ask` Q&A page.
- API is exactly `POST /api/insights/[ticker]/chat`, Node runtime, `force-dynamic`, `Cache-Control: no-store`.
- API authorization is `requireApiFeature("research")`.
- Rollout flag is exactly `TICKER_QA_ENABLED`; disabled means typed `feature_disabled`, never fake local financial responses.
- Route ticker is authoritative and normalized against `^[A-Z0-9]{2,12}$`; request body cannot override ticker.
- Question max 2,000 chars; history max 6 turns; each history turn max 1,200 chars.
- Use shared QEO-115 policy via `consumer: "STOCK_QA"`; max context 18,000 chars / max 12 retrieval results.
- CURRENT_THESIS mandatory source is `getCachedResearchTickerData(ticker)` and must require `connection.notionLive === true`; do not depend on Qdrant for mandatory thesis context.
- Latest deterministic Council mandatory source is canonical PostgreSQL `ai_council_runs` for the requested ticker.
- Qdrant payload text is never sufficient citation evidence; every retrieved item must resolve to exact canonical provenance before model use.
- V1 canonical resolvers: Notion Thesis, Research Report exact provenance/chunk/page, AI Council exact run/outcome provenance.
- Unsupported source types are excluded from the model evidence packet.
- Broker/report conclusions remain `SOURCE_OPINION`; deterministic Council remains `DETERMINISTIC_SIGNAL`; contradictory evidence is surfaced, not averaged.
- Chat history is ephemeral; do not persist raw questions/history/prompts/hidden reasoning to Postgres, Notion, or Qdrant.
- Telemetry is aggregate only and must exclude raw question/history/evidence/prompt text.
- Strict RED/GREEN TDD for every production behavior change.
- QEO-118 may land on the QEO-109 integration branch while blocked, but production enablement must not bypass QEO-115 Verify.

---

### Task 1: Ticker Q&A public contracts, validation, and manifest ownership

**Files:**
- Create: `modules/ticker-qa/types.ts`
- Create: `modules/ticker-qa/service.ts`
- Create: `tests/ticker-qa.test.ts`
- Modify: `tests/test-contracts.json`

**Interfaces:**
- Consumes: existing `TickerKnowledgeAuthority` and `TickerKnowledgeItem` types from `modules/ticker-knowledge`.
- Produces: `TICKER_QA_LIMITS`, `TickerQaTurn`, `TickerQaRequest`, `TickerQaCitation`, `TickerQaResult`, `TickerQaError`, `TickerQaServiceDependencies`, `answerTickerQuestion()`.

- [ ] **Step 1: Write the failing validation tests**

Create `tests/ticker-qa.test.ts` with tests that import `answerTickerQuestion` and assert rejection of invalid ticker, empty/oversized question, more than six history turns, invalid roles, and history turns over 1,200 chars. Also assert route/body ticker cannot be supplied through the service request shape.

```ts
await assert.rejects(
  () => answerTickerQuestion(fakeClient, { ticker: "MSN!", question: "thesis?" }, deps),
  (error: unknown) => error instanceof TickerQaError && error.code === "invalid_request",
)
```

- [ ] **Step 2: Register the new canonical test file**

Add `tests/ticker-qa.test.ts` to `tests/test-contracts.json` with:

```json
{
  "path": "tests/ticker-qa.test.ts",
  "owner": "research",
  "invariant": "Preserve grounded ticker Q&A isolation, provenance, bounded-context and degraded-state contracts.",
  "bucket": "canonical",
  "suites": ["ai", "ui-contracts"]
}
```

- [ ] **Step 3: Run RED**

Run:

```bash
node --test tests/ticker-qa.test.ts
```

Expected: FAIL because `modules/ticker-qa/service.ts` / exported contracts do not exist.

- [ ] **Step 4: Implement minimal public contracts and validation**

`modules/ticker-qa/types.ts` defines fixed limits and result contracts. `service.ts` normalizes whitespace, validates ticker/question/history, and throws typed `TickerQaError("invalid_request", 400, ...)` before invoking dependencies.

- [ ] **Step 5: Run GREEN + manifest verification**

```bash
node --test tests/ticker-qa.test.ts
pnpm test:manifest
```

Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add modules/ticker-qa/types.ts modules/ticker-qa/service.ts tests/ticker-qa.test.ts tests/test-contracts.json
git commit -m "test(QEO-118): lock ticker QA request contracts"
```

---

### Task 2: Mandatory canonical CURRENT_THESIS + deterministic Council state

**Files:**
- Create: `modules/ticker-qa/mandatory.ts`
- Modify: `modules/ticker-qa/service.ts`
- Modify: `tests/ticker-qa.test.ts`

**Interfaces:**
- Consumes: `getCachedResearchTickerData(ticker)`, Supabase client, `TickerKnowledgeItem`.
- Produces: `loadTickerQaMandatoryContext(client, ticker)` returning bounded mandatory items plus limitations.

- [ ] **Step 1: Write RED tests for mandatory sources**

Tests must assert:

```ts
assert.equal(thesisItem.authority, "CANONICAL_THESIS")
assert.equal(thesisItem.ticker, "MSN")
assert.equal(councilItem.authority, "DETERMINISTIC_SIGNAL")
assert.equal(councilItem.provenance.runId, "run-123")
```

and:
- no thesis item when `connection.notionLive !== true`;
- thesis identity carries exact Notion page ID and updated/source version;
- latest Council query is ticker-scoped and ordered newest first;
- no invented Council item when no canonical run exists.

- [ ] **Step 2: Run RED**

```bash
node --test tests/ticker-qa.test.ts
```

Expected: FAIL because mandatory loader is absent.

- [ ] **Step 3: Implement `mandatory.ts`**

Use dependency injection for the Notion ticker read in tests, but production default calls `getCachedResearchTickerData(ticker)`. Build CURRENT_THESIS text only from canonical thesis fields needed for Q&A (base case, what changed, biases, support/resistance, confirmation/invalidation, confidence, updated). Query `ai_council_runs` with `.eq("ticker", ticker).order("as_of_date", { ascending: false }).order("created_at", { ascending: false }).limit(1).maybeSingle()` and map exact run provenance.

- [ ] **Step 4: Run GREEN**

```bash
node --test tests/ticker-qa.test.ts
```

Expected: PASS for mandatory-context tests.

- [ ] **Step 5: Commit**

```bash
git add modules/ticker-qa/mandatory.ts modules/ticker-qa/service.ts tests/ticker-qa.test.ts
git commit -m "feat(QEO-118): load canonical ticker QA mandatory context"
```

---

### Task 3: Shared Context Builder integration and canonical multi-source resolution

**Files:**
- Create: `modules/ticker-qa/canonical.ts`
- Modify: `modules/ticker-qa/service.ts`
- Modify: `tests/ticker-qa.test.ts`

**Interfaces:**
- Consumes: `buildTickerContext({ index, ticker, query, consumer: "STOCK_QA", mandatory })` and its bounded `items`/`retrievalStatus`.
- Produces: `resolveTickerQaEvidence(client, ticker, items)` returning resolved model evidence, unresolved count, hydration latency and infrastructure status.

- [ ] **Step 1: Write RED tests for builder invocation and leakage defense**

Use a fake builder that records input and intentionally returns one `MSN` item plus one `VCB` item. Assert:

```ts
assert.equal(builderInput.consumer, "STOCK_QA")
assert.equal(builderInput.ticker, "MSN")
assert.equal(result.debugResolvedTickers.includes("VCB"), false)
```

The service must post-filter ticker again before canonical resolution.

- [ ] **Step 2: Write RED exact-provenance resolver tests**

Research Report case must require exact `reportId + analysisId + contentHash + chunkVersion + chunkId/page`; stale hash/version returns unresolved. AI Council case must require exact `runId` and ticker. Notion Thesis case must require exact page ID + source version from the canonical ticker read. Unsupported source types return unresolved and never model-visible.

- [ ] **Step 3: Run RED**

```bash
node --test tests/ticker-qa.test.ts
```

Expected: FAIL because builder orchestration/canonical resolvers are absent.

- [ ] **Step 4: Implement builder orchestration**

In `service.ts`, load mandatory context first, call the injected/default builder with exact ticker and `consumer: "STOCK_QA"`, then retain only items whose normalized ticker equals the route ticker.

- [ ] **Step 5: Implement canonical resolvers**

`canonical.ts` must:
- resolve thesis against the canonical thesis identity/version;
- hydrate Research Report chunks from PostgreSQL exact provenance using the existing exact-version hydration path/RPC where compatible;
- resolve Council items against exact `ai_council_runs` / outcomes rows by run ID + ticker;
- produce bounded canonical excerpts and normalized citation metadata;
- distinguish `absence` from `infrastructure_failure`.

- [ ] **Step 6: Run GREEN**

```bash
node --test tests/ticker-qa.test.ts
```

Expected: PASS for builder/ticker-isolation/provenance tests.

- [ ] **Step 7: Commit**

```bash
git add modules/ticker-qa/canonical.ts modules/ticker-qa/service.ts tests/ticker-qa.test.ts
git commit -m "feat(QEO-118): resolve ticker QA evidence canonically"
```

---

### Task 4: Strict answer schema, contradiction/source-authority contract, and OpenAI adapter

**Files:**
- Create: `modules/ticker-qa/schema.ts`
- Create: `modules/ticker-qa/prompt.ts`
- Create: `modules/ticker-qa/openai.ts`
- Modify: `modules/ticker-qa/service.ts`
- Modify: `modules/ticker-qa/types.ts`
- Modify: `tests/ticker-qa.test.ts`

**Interfaces:**
- Consumes: resolved canonical evidence only.
- Produces: validated `TickerQaModelOutput`, `answerTickerQaWithOpenAi()`, projected `TickerQaResult` with authority-labeled citations/contradictions and aggregate audit.

- [ ] **Step 1: Write RED schema/projection tests**

Assert:
- `answered` requires at least one surviving grounded claim;
- unknown `evidenceId` citation is rejected and cannot support a claim;
- `AI_INFERENCE` still requires source citations;
- `SOURCE_OPINION` remains labeled;
- deterministic vs broker contradiction appears in `contradictions` rather than merged neutral prose;
- if no grounded claim survives, result is `not_found`.

- [ ] **Step 2: Run RED**

```bash
node --test tests/ticker-qa.test.ts
```

Expected: FAIL because schema/model adapter are absent.

- [ ] **Step 3: Implement strict schema and prompt packet**

Prompt must state embedded evidence is untrusted data, preserve authority labels, prohibit outside knowledge, prohibit invented consensus, and require citation evidence IDs. Include only bounded ticker/question/history/resolved evidence.

- [ ] **Step 4: Implement server OpenAI adapter**

Follow existing Research Report Q&A server conventions for model routing, structured JSON validation, token/latency audit and sanitized provider failures. Do not expose API keys/browser model calls. Do not persist raw prompt or hidden reasoning.

- [ ] **Step 5: Implement result projection**

Map validated citations to canonical citation objects. Research Reports link to `/research/reports/{reportId}`; Council and Notion thesis citations are non-clickable v1 provenance chips. Deduplicate citation IDs/excerpts.

- [ ] **Step 6: Run GREEN**

```bash
node --test tests/ticker-qa.test.ts
```

Expected: PASS for grounded answer/source authority/contradiction tests.

- [ ] **Step 7: Commit**

```bash
git add modules/ticker-qa/schema.ts modules/ticker-qa/prompt.ts modules/ticker-qa/openai.ts modules/ticker-qa/service.ts modules/ticker-qa/types.ts tests/ticker-qa.test.ts
git commit -m "feat(QEO-118): add grounded ticker QA answer contract"
```

---

### Task 5: Degraded behavior and aggregate telemetry

**Files:**
- Modify: `modules/ticker-qa/service.ts`
- Modify: `modules/ticker-qa/types.ts`
- Modify: `tests/ticker-qa.test.ts`

**Interfaces:**
- Produces typed `retrievalStatus`, `limitation`, aggregate timing/count audit and safe failure states.

- [ ] **Step 1: Write RED degraded-state tests**

Cases:
- Qdrant unavailable + safe mandatory thesis/Council => answer model receives only mandatory canonical evidence; result can be `answered`, `retrievalStatus: "unavailable"`, exact safe limitation.
- Qdrant unavailable + zero mandatory canonical evidence => `TickerQaError("service_unavailable", 503, ...)` and answer model call count stays zero.
- healthy retrieval + no resolvable evidence => `not_found`, not 503.
- partial canonical hydration drops unresolved items but continues if at least one grounded item remains.

- [ ] **Step 2: Write RED telemetry privacy test**

Serialize recorded metric and assert it contains timings/counts/status/token audit but does **not** contain the literal question, history string, evidence text, prompt, or reasoning text.

- [ ] **Step 3: Run RED**

```bash
node --test tests/ticker-qa.test.ts
```

Expected: FAIL on missing degraded/telemetry behavior.

- [ ] **Step 4: Implement degraded state machine + metrics**

Record context build/retrieval/rerank/hydration/total latency, selected/resolved counts, truncated flag, retrieval status/reason code, token/model/fallback audit and answer status. Keep recorder fail-open so telemetry failure cannot break a grounded answer.

- [ ] **Step 5: Run GREEN**

```bash
node --test tests/ticker-qa.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add modules/ticker-qa/service.ts modules/ticker-qa/types.ts tests/ticker-qa.test.ts
git commit -m "feat(QEO-118): add safe degraded ticker QA telemetry"
```

---

### Task 6: Authenticated `/api/insights/[ticker]/chat` endpoint and rollout flag

**Files:**
- Create: `app/api/insights/[ticker]/chat/route.ts`
- Create: `tests/ticker-qa-api.test.ts`
- Modify: `tests/test-contracts.json`

**Interfaces:**
- Consumes: `answerTickerQuestion`, server Supabase client, server Qdrant factory.
- Produces: authenticated no-store JSON API.

- [ ] **Step 1: Write RED source/runtime API contracts**

Tests require:

```ts
assert.match(route, /requireApiFeature\("research"\)/)
assert.match(route, /TICKER_QA_ENABLED/)
assert.match(route, /Cache-Control.*no-store/s)
assert.match(route, /answerTickerQuestion/)
assert.doesNotMatch(route, /payload\.ticker|body\.ticker/)
```

Also test public error mapping is bounded and does not include raw Qdrant/provider exception messages.

- [ ] **Step 2: Register API test in manifest**

Add `tests/ticker-qa-api.test.ts` as canonical `research`, suites `["ai", "ui-contracts"]`.

- [ ] **Step 3: Run RED**

```bash
node --test tests/ticker-qa-api.test.ts
```

Expected: FAIL because route does not exist.

- [ ] **Step 4: Implement route**

Rules:
- `runtime = "nodejs"`, `dynamic = "force-dynamic"`;
- `requireApiFeature("research")` first;
- if `(process.env.TICKER_QA_ENABLED ?? "").trim().toLowerCase() !== "true"`, return typed `feature_disabled` without calling the model;
- route ticker is decoded/uppercased/validated by service;
- create server Supabase + Qdrant dependencies server-side;
- body includes only question/history;
- return aggregate result/audit and sanitized typed errors with `no-store`.

- [ ] **Step 5: Run GREEN**

```bash
node --test tests/ticker-qa-api.test.ts
pnpm test:manifest
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/insights/[ticker]/chat/route.ts tests/ticker-qa-api.test.ts tests/test-contracts.json
git commit -m "feat(QEO-118): expose authenticated ticker QA API"
```

---

### Task 7: Upgrade existing Quick AI Assistant UI; remove fake local financial answers

**Files:**
- Create: `components/stock-detail/stock-ai-chat-state.ts`
- Modify: `components/stock-detail/stock-ai-sidebar.tsx`
- Modify: `tests/stock-ai-sidebar-ui.test.ts`

**Interfaces:**
- Consumes: `/api/insights/${ticker}/chat` result/citation contracts.
- Produces: bounded ephemeral client history, source chips, authority/degraded/contradiction rendering using the existing Quick AI Assistant card.

- [ ] **Step 1: Write RED UI contracts**

Extend `tests/stock-ai-sidebar-ui.test.ts` to require:
- fetch to `/api/insights/${encodeURIComponent(ticker)}/chat`;
- bounded helper with 6 turns / 1,200 chars;
- citations/source labels rendered beneath AI answers;
- degraded badge when retrieval unavailable;
- preset prompt chips call the same `handleSend()` API path;
- welcome copy says it answers from available QeoIndex evidence;
- no `setTimeout(` keyword answer generator;
- no fabricated hard-coded text such as `58.4%` / `1.35x` in chat-answer logic.

- [ ] **Step 2: Run RED**

```bash
node --test tests/stock-ai-sidebar-ui.test.ts
```

Expected: FAIL because existing sidebar still contains the fake `setTimeout` response path.

- [ ] **Step 3: Implement bounded chat state helper**

`stock-ai-chat-state.ts` exports `boundTickerChatHistory()` that keeps latest six user/assistant turns, normalizes whitespace and truncates each content string to 1,200 chars.

- [ ] **Step 4: Replace fake `handleSend()` with API call**

Keep the existing card layout/preset chips. Append user message, POST question + bounded history, render validated result or typed error, and never fall back to local financial prose. Preserve retry-safe submitting state.

- [ ] **Step 5: Render provenance**

Assistant message carries citations, authority labels, contradictions and retrieval limitation. Render compact chips; report citations are links, Council/Thesis chips are text-only in v1.

- [ ] **Step 6: Run GREEN**

```bash
node --test tests/stock-ai-sidebar-ui.test.ts
```

Expected: PASS with fake answer generator absent.

- [ ] **Step 7: Commit**

```bash
git add components/stock-detail/stock-ai-chat-state.ts components/stock-detail/stock-ai-sidebar.tsx tests/stock-ai-sidebar-ui.test.ts
git commit -m "feat(QEO-118): ground existing stock AI assistant"
```

---

### Task 8: Integration verification, Linear evidence, and rollout guard

**Files:**
- Modify only if verification reveals defects; otherwise no production file changes.

**Interfaces:**
- Verifies all previous tasks and keeps production rollout blocked until QEO-115 Verify.

- [ ] **Step 1: Run focused suites**

```bash
node --test tests/ticker-qa.test.ts tests/ticker-qa-api.test.ts tests/stock-ai-sidebar-ui.test.ts
```

Expected: 0 failures.

- [ ] **Step 2: Run canonical current verification**

```bash
pnpm test:manifest
pnpm test:current
pnpm lint:touched
pnpm typecheck
```

Expected: all exit 0.

- [ ] **Step 3: Verify no fake chat fallback remains**

```bash
grep -nE 'setTimeout\(|58\.4%|1\.35x' components/stock-detail/stock-ai-sidebar.tsx
```

Expected: no matches from Quick AI Assistant answer generation. Any unrelated UI animation timer must be reviewed explicitly rather than mechanically removed.

- [ ] **Step 4: Verify secrets/privacy boundary**

```bash
pnpm scan:secrets
```

Expected: exit 0. Confirm normal ticker-QA telemetry logs do not contain question/history/evidence/prompt text.

- [ ] **Step 5: Check exact-head GitHub Actions evidence**

Fetch workflow runs for the exact PR head. Do not claim CI green or mark QEO-118 Done if `Verify` has not run successfully on that SHA.

- [ ] **Step 6: Update Linear QEO-118**

Record exact head SHA, RED/GREEN commits, focused/local verification output, remaining QEO-115 dependency and rollout state. Keep `TICKER_QA_ENABLED` disabled in production until the dependency/Verify gate is cleared.
