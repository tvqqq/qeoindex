# QEO-75 Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close residual QEO-75 security gaps by making `market-session` fail closed, adding full-history secret scanning, strengthening project-specific secret detection, and reconciling example/docs configuration.

**Architecture:** Keep the existing shared machine-auth helper as the single Edge authorization primitive. Preserve the canonical `Verify / verify` workflow and add history scanning inside it rather than creating a competing required check. Keep example configuration generic; do not rewrite historical migrations just to hide public identifiers.

**Tech Stack:** Next.js 16, TypeScript 5.7, Node test runner, Supabase Edge Functions/Deno, Bash, GitHub Actions, Gitleaks v3.

**Spec:** `docs/superpowers/specs/2026-09-04-qeo-75-security-hardening-design.md`

## Global Constraints

- Authorization must run before service-role client construction or database/provider access.
- `OPTIONS` remains unauthenticated for CORS preflight.
- Secret tooling must print filenames/metadata only, never credential values.
- Do not rewrite Git history merely to hide public domains/project refs.
- Historical real secrets require rotation/revocation before any fingerprint allowlist.
- Keep required CI check name `Verify / verify` stable.

---

### Task 1: Red tests for Edge authorization and security CI

**Files:**
- Modify: `tests/market-insight-edge-types.test.ts`
- Create: `tests/security-hardening.test.ts`

**Interfaces:**
- Consumes: `supabase/functions/market-session/index.ts`, `.github/workflows/security.yml`, `scripts/scan-secrets.sh`
- Produces: regression contracts that fail on current `main` and define the target behavior.

- [ ] **Step 1: Change the market-session contract test**

Replace the POST-scoped assertion with a global request gate assertion:

```ts
test("market-session requires machine auth before every privileged GET/POST path", () => {
  const marketSession = source("supabase/functions/market-session/index.ts")
  assert.match(marketSession, /MARKET_SYNC_SECRET/)
  assert.match(marketSession, /CRON_SECRET/)
  const authGate = marketSession.indexOf("await isMachineRequestAuthorized(")
  const serviceClient = marketSession.indexOf("createClient(")
  const read = marketSession.indexOf('.from("stock_orderbook_snapshots")')
  assert.ok(authGate >= 0)
  assert.ok(serviceClient > authGate)
  assert.ok(read > authGate)
  assert.doesNotMatch(marketSession.slice(0, authGate), /if \(req\.method === "POST"\)[\s\S]*isMachineRequestAuthorized/)
})
```

- [ ] **Step 2: Add security workflow/scanner contracts**

Create `tests/security-hardening.test.ts` using `readFileSync` and assert:

```ts
assert.match(workflow, /fetch-depth:\s*0/)
assert.match(workflow, /gitleaks\/gitleaks-action@v3/)
assert.match(scanner, /MARKET_SYNC_SECRET/)
assert.match(scanner, /AI_COUNCIL_RUN_SECRET/)
assert.match(scanner, /UPSTASH_REDIS_REST_TOKEN/)
assert.match(scanner, /KFSP_(PASSWORD|SYNC_SECRET)/)
assert.match(scanner, /QSTASH_TOKEN/)
assert.match(scanner, /postgres(?:ql)?:\/\//i)
```

Also assert `.env.example` does not contain concrete production Notion datasource UUIDs or `APP_URL=https://qeoindex.qeoqeo.com`.

- [ ] **Step 3: Add the new test to `tests/test-contracts.json` if manifest enforcement requires explicit registration.**

- [ ] **Step 4: Commit tests only and open a draft PR.**

Expected canonical `Verify` result: FAIL because current production code/workflow/scanner/example do not satisfy the new contracts.

---

### Task 2: Fail-close `market-session`

**Files:**
- Modify: `supabase/functions/market-session/index.ts`

**Interfaces:**
- Consumes: `isMachineRequestAuthorized(request, secrets)`
- Produces: all GET/POST requests require exact bearer token matching `MARKET_SYNC_SECRET` or `CRON_SECRET` before privileged access.

- [ ] **Step 1: Add method validation immediately after OPTIONS.**

```ts
if (req.method !== "GET" && req.method !== "POST") {
  return jsonResponse({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405)
}
```

- [ ] **Step 2: Move machine authorization outside the POST branch and before URL parsing/service client construction.**

```ts
const authorized = await isMachineRequestAuthorized(req, [
  Deno.env.get("MARKET_SYNC_SECRET"),
  Deno.env.get("CRON_SECRET"),
])
if (!authorized) return jsonResponse({ ok: false, error: "UNAUTHORIZED" }, 401)
```

- [ ] **Step 3: Use a small `jsonResponse` helper to keep error responses consistent without changing payload semantics unnecessarily.**

- [ ] **Step 4: Verify the targeted contract test passes in PR CI.**

---

### Task 3: Add current-tree and history-aware secret gates

**Files:**
- Modify: `scripts/scan-secrets.sh`
- Modify: `.github/workflows/security.yml`

**Interfaces:**
- Produces: fast project-aware `pnpm scan:secrets` plus full-history Gitleaks gate.

- [ ] **Step 1: Expand current-tree patterns without printing matches.**

Add sensitive assignment names including:

```text
SUPABASE_SERVICE_ROLE_KEY
UPSTASH_REDIS_REST_TOKEN
KFSP_PASSWORD
KFSP_SYNC_SECRET
MARKET_SYNC_SECRET
MARKET_CACHE_ADMIN_SECRET
AI_COUNCIL_RUN_SECRET
CRON_SECRET
QSTASH_TOKEN
QSTASH_CURRENT_SIGNING_KEY
QSTASH_NEXT_SIGNING_KEY
```

Add credential URL detection for PostgreSQL connection strings with embedded username/password. Keep exclusions limited to the scanner source and clearly empty example assignments.

- [ ] **Step 2: Change checkout to full history.**

```yaml
- name: Check out repository
  uses: actions/checkout@v6
  with:
    fetch-depth: 0
```

- [ ] **Step 3: Add Gitleaks v3 immediately after the tracked-source scanner.**

```yaml
- name: Scan Git history for secrets
  uses: gitleaks/gitleaks-action@v3
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    GITLEAKS_ENABLE_COMMENTS: "false"
    GITLEAKS_ENABLE_UPLOAD_ARTIFACT: "false"
```

- [ ] **Step 4: If Gitleaks identifies historical leaks, do not globally weaken a rule. Classify each finding; rotate/revoke confirmed credentials first and only then add fingerprint-specific allowlisting if retaining shared history is operationally required.**

- [ ] **Step 5: Run PR Verify and inspect only redacted metadata/filenames from failures.**

---

### Task 4: Remove misleading production coupling from example/docs

**Files:**
- Modify: `.env.example`
- Modify: `docs/security.md`

**Interfaces:**
- Produces: generic onboarding template and documentation matching actual enforced behavior.

- [ ] **Step 1: Replace `QeoIndex persistent data source: Notion only` with Supabase-first wording and mark Notion IDs as optional integration configuration.**
- [ ] **Step 2: Blank concrete Notion datasource UUID example values.**
- [ ] **Step 3: Replace production `APP_URL` with `https://example.com` or an empty value.**
- [ ] **Step 4: Document that public project URLs/refs are identifiers, not credentials; authorization/RLS is the security boundary.**
- [ ] **Step 5: Document tracked-tree scan + full-history Gitleaks scan and the historical secret rotation policy.**

---

### Task 5: Verification and rollout evidence

**Files:**
- No source file required unless CI reveals a narrowly scoped fix.

- [ ] **Step 1: Confirm the draft PR test-only revision failed for the intended missing behavior.**
- [ ] **Step 2: Confirm final `Verify / verify` passes on the implementation revision.**
- [ ] **Step 3: Review PR diff for accidental secret values and unrelated refactors.**
- [ ] **Step 4: Merge only after required check succeeds.**
- [ ] **Step 5: Re-read deployed `market-session` and verify authorization appears before service-role client construction without issuing a write-producing probe.**
- [ ] **Step 6: Rerun Supabase Security Advisor. If leaked-password protection is still disabled, keep QEO-75 open or record an explicit manual-setting exception; do not claim it is fixed from source code.**
- [ ] **Step 7: Update QEO-75 with PR, CI, deployed function and advisor evidence, then mark Done only if all accepted blockers are resolved/documented.**
