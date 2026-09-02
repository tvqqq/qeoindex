# QEO-25 Migration Drift Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the manually documented production↔repository migration mapping into a deterministic, fail-closed verifier with reviewed production-ledger evidence and no production mutation.

**Architecture:** Keep reconciliation logic pure and testable in a small Node ESM library. A thin CLI loads repository migrations, pending migrations, a checked-in production-ledger snapshot, and the machine-readable equivalence manifest, then exits non-zero on any unexplained drift. QEO-23 can later call the same package script from CI without changing the model.

**Tech Stack:** Node.js ESM, `node:test`, `node:assert/strict`, filesystem APIs, JSON, pnpm 10.28.0.

**Spec:** `docs/superpowers/specs/2026-09-02-qeo-25-26-db-drift-recovery-design.md`

## Global Constraints

- Production project is `glwhhrmejlonhyorvtzm`; QEO-25 is read-only against production.
- Do not rewrite historical production migration ledger entries.
- Do not blindly rename repository migration history.
- Do not replay SQL merely because repository and production timestamps differ.
- `supabase/pending-migrations/20260902090000_kfsp_rating_storage_refactor.sql` remains quarantined until QEO-26 passes.
- `main` is deployment-enabled; implementation occurs on a feature branch and is reviewed before merge.
- No new active Supabase migration is required by this issue, so the `npx supabase db push` invariant is not triggered.

---

## File Structure

- Create `supabase/migration-equivalence.json` — canonical reviewed mapping from logical migration name to repository/production versions and state.
- Create `docs/db/evidence/production-migration-ledger-2026-09-02.json` — deterministic read-only production ledger snapshot used by the verifier.
- Create `scripts/db/migration-drift-lib.mjs` — pure parsing and reconciliation functions.
- Create `scripts/db/verify-migration-drift.mjs` — CLI wrapper; loads files and sets exit code.
- Create `tests/db-migration-drift.test.ts` — TDD regression matrix.
- Modify `package.json` — add `db:drift:verify` and `test:db-drift` scripts; add the new test to `test:core` only after it is stable.
- Modify `docs/db/2026-09-02-phase-0-deletion-manifest.md` — replace hand-maintained mapping-table authority with a pointer to `supabase/migration-equivalence.json` and record verifier command.
- Modify `docs/HANDOVER.md` — reconcile stale migration filenames/wording to current source state without changing historical behavior descriptions.

---

### Task 1: Define the reconciliation contract with failing tests

**Files:**
- Create: `tests/db-migration-drift.test.ts`
- Create: `scripts/db/migration-drift-lib.mjs`

**Interfaces:**
- Produces: `parseMigrationFilename(filename: string): { version: string; logicalName: string } | null`
- Produces: `reconcileMigrations(input: { activeFiles: string[]; pendingFiles: string[]; productionLedger: Array<{version:string; name:string}>; manifest: { migrations: MigrationMapping[] } }): { ok: boolean; errors: string[]; summary: object }`
- `MigrationMapping` shape: `{ logicalName: string; repositoryVersion: string | null; productionVersion: string | null; state: "EXACT" | "MAPPED" | "QUARANTINED" | "ALLOWED_TRANSIENT"; evidence: string; rationale?: string }`

- [ ] **Step 1: Write filename parser tests**

```ts
import assert from "node:assert/strict"
import test from "node:test"
import { parseMigrationFilename, reconcileMigrations } from "../scripts/db/migration-drift-lib.mjs"

test("parseMigrationFilename extracts version and logical name", () => {
  assert.deepEqual(
    parseMigrationFilename("20260902011529_clean_rebuild_market_snapshot_trigger.sql"),
    { version: "20260902011529", logicalName: "clean_rebuild_market_snapshot_trigger" },
  )
})
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/db-migration-drift.test.ts`

Expected: FAIL because `scripts/db/migration-drift-lib.mjs` does not yet export the parser.

- [ ] **Step 3: Implement the minimal parser**

```js
export function parseMigrationFilename(filename) {
  const match = /^(\d+)_([a-z0-9_]+)\.sql$/i.exec(filename)
  if (!match) return null
  return { version: match[1], logicalName: match[2] }
}
```

- [ ] **Step 4: Add reconciliation behavior tests before implementation**

Add tests that construct in-memory fixtures and assert:

```ts
const mapped = {
  migrations: [{
    logicalName: "clean_rebuild_market_snapshot_trigger",
    repositoryVersion: "20260901214500",
    productionVersion: "20260902011529",
    state: "MAPPED",
    evidence: "schema-contract",
  }],
}

assert.equal(reconcileMigrations({
  activeFiles: ["20260901214500_clean_rebuild_market_snapshot_trigger.sql"],
  pendingFiles: [],
  productionLedger: [{ version: "20260902011529", name: "clean_rebuild_market_snapshot_trigger" }],
  manifest: mapped,
}).ok, true)
```

Also add explicit tests for:

- exact match passes;
- unexplained active repo-only fails;
- unexplained production-only fails;
- duplicate logical manifest entry fails;
- `EXACT` with different versions fails;
- `MAPPED` with wrong logical name/version fails;
- `QUARANTINED` file under active migrations fails;
- quarantined file under pending migrations with no production entry passes;
- manifest entry referencing no active/pending source file fails;
- changed production version fails until manifest is reviewed.

- [ ] **Step 5: Run the expanded test and verify RED**

Run: `node --test tests/db-migration-drift.test.ts`

Expected: parser test PASS; reconciliation tests FAIL because `reconcileMigrations` is not implemented.

- [ ] **Step 6: Implement minimal fail-closed reconciliation**

Implementation rules in `reconcileMigrations`:

```js
// 1. Parse active + pending files into logical-name maps.
// 2. Reject duplicate logical names in either source set.
// 3. Reject duplicate manifest logicalName entries.
// 4. For EXACT: require active source + production row and equal versions.
// 5. For MAPPED: require active source + production row and exact versions from manifest.
// 6. For QUARANTINED: require pending source, forbid active source, require productionVersion === null and no production row.
// 7. For ALLOWED_TRANSIENT: require explicit source/production versions exactly as declared; never wildcard.
// 8. Reject any active source logical name not covered by EXACT/MAPPED/ALLOWED_TRANSIENT unless repositoryVersion === production version and the verifier deliberately synthesizes an implicit exact record.
// 9. Reject any production logical name not accounted for by exact equality or a manifest entry.
// 10. Return deterministic sorted error strings.
```

For YAGNI, permit implicit exact equality for old migrations not listed in the manifest; require explicit manifest entries only when versions differ, a migration is quarantined, or an allowed transient exception exists.

- [ ] **Step 7: Run the unit tests and verify GREEN**

Run: `node --test tests/db-migration-drift.test.ts`

Expected: all QEO-25 unit tests PASS.

- [ ] **Step 8: Commit the library/test cycle**

```bash
git add scripts/db/migration-drift-lib.mjs tests/db-migration-drift.test.ts
git commit -m "test(db): define fail-closed migration reconciliation"
```

---

### Task 2: Check in the reviewed production mapping and ledger evidence

**Files:**
- Create: `supabase/migration-equivalence.json`
- Create: `docs/db/evidence/production-migration-ledger-2026-09-02.json`
- Test: `tests/db-migration-drift.test.ts`

**Interfaces:**
- Consumes: `reconcileMigrations(...)` from Task 1.
- Produces: stable JSON fixtures used by the CLI and future QEO-23 CI.

- [ ] **Step 1: Add a failing repository-fixture test**

Add:

```ts
import { readFileSync, readdirSync } from "node:fs"

const manifest = JSON.parse(readFileSync("supabase/migration-equivalence.json", "utf8"))
const ledger = JSON.parse(readFileSync("docs/db/evidence/production-migration-ledger-2026-09-02.json", "utf8"))
const activeFiles = readdirSync("supabase/migrations").filter((name) => name.endsWith(".sql"))
const pendingFiles = readdirSync("supabase/pending-migrations").filter((name) => name.endsWith(".sql"))

const result = reconcileMigrations({ activeFiles, pendingFiles, productionLedger: ledger.migrations, manifest })
assert.equal(result.ok, true, result.errors.join("\n"))
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/db-migration-drift.test.ts`

Expected: FAIL because the two JSON files do not exist.

- [ ] **Step 3: Capture the production ledger read-only**

Use the Supabase production connector with a read-only query equivalent to:

```sql
select version, name
from supabase_migrations.schema_migrations
order by version;
```

Write the exact returned `version` + `name` pairs to:

```json
{
  "capturedAt": "2026-09-02T<actual-UTC-time>Z",
  "projectRef": "glwhhrmejlonhyorvtzm",
  "migrations": [
    { "version": "<exact value>", "name": "<exact value>" }
  ]
}
```

Do not include migration SQL bodies, secrets, or user data.

- [ ] **Step 4: Create the equivalence manifest from verified Phase-0 mappings**

Start with all known non-exact/current special states, including these reviewed rows:

```json
{
  "schemaVersion": 1,
  "migrations": [
    {"logicalName":"market_universe_top_stocks","repositoryVersion":"20260901090000","productionVersion":"20260901011922","state":"MAPPED","evidence":"ledger-logical-name","rationale":"Supabase-applied production timestamp differs from repository filename"},
    {"logicalName":"market_universe_monthly_cron","repositoryVersion":"20260901091000","productionVersion":"20260901012315","state":"MAPPED","evidence":"ledger-logical-name"},
    {"logicalName":"top100_legacy_clean_slate","repositoryVersion":"20260901100000","productionVersion":"20260901024528","state":"MAPPED","evidence":"ledger-logical-name"},
    {"logicalName":"market_universe_daily_activity_gate","repositoryVersion":"20260901123000","productionVersion":"20260901054004","state":"MAPPED","evidence":"ledger-logical-name"},
    {"logicalName":"eod_archive_checkpoints","repositoryVersion":"20260901130000","productionVersion":"20260901064844","state":"MAPPED","evidence":"ledger-logical-name"},
    {"logicalName":"fix_orderbook_trading_session_windows","repositoryVersion":"20260901152000","productionVersion":"20260901082239","state":"MAPPED","evidence":"ledger-logical-name"},
    {"logicalName":"prune_noncanonical_orderbook_snapshots","repositoryVersion":"20260901162500","productionVersion":"20260901093012","state":"MAPPED","evidence":"ledger-logical-name"},
    {"logicalName":"wyckoff_daily_weekly_storage_cutover","repositoryVersion":"20260901190000","productionVersion":"20260901134640","state":"MAPPED","evidence":"ledger-logical-name"},
    {"logicalName":"clean_rebuild_top_stocks_200","repositoryVersion":"20260901144121","productionVersion":"20260901144121","state":"EXACT","evidence":"filename-ledger-equality"},
    {"logicalName":"kfsp_canonical_rating_candidate_split","repositoryVersion":"20260901221500","productionVersion":"20260901151138","state":"MAPPED","evidence":"ledger-logical-name"},
    {"logicalName":"kfsp_manual_dispatch_rpc","repositoryVersion":"20260901224000","productionVersion":"20260901153403","state":"MAPPED","evidence":"ledger-logical-name"},
    {"logicalName":"fix_kfsp_manual_dispatch_rpc_ambiguity","repositoryVersion":"20260901224500","productionVersion":"20260901153527","state":"MAPPED","evidence":"ledger-logical-name"},
    {"logicalName":"kfsp_manual_recovery_lifecycle","repositoryVersion":"20260902060000","productionVersion":"20260901231054","state":"MAPPED","evidence":"ledger-logical-name"},
    {"logicalName":"clean_rebuild_market_snapshot_trigger","repositoryVersion":"20260902011529","productionVersion":"20260902011529","state":"EXACT","evidence":"function-definition-and-grants"},
    {"logicalName":"restrict_orderbook_prune_trigger_execute","repositoryVersion":"20260902011846","productionVersion":"20260902011846","state":"EXACT","evidence":"function-grants-and-advisor"},
    {"logicalName":"ai_council_authenticated_readonly","repositoryVersion":"20260902084500","productionVersion":"20260902014425","state":"MAPPED","evidence":"ledger-logical-name"},
    {"logicalName":"ai_council_debate_identity_cleanup","repositoryVersion":"20260902084000","productionVersion":"20260902014432","state":"MAPPED","evidence":"ledger-logical-name"},
    {"logicalName":"kfsp_rating_storage_refactor","repositoryVersion":"20260902090000","productionVersion":null,"state":"QUARANTINED","evidence":"qeo-26-gate","rationale":"Destructive SQL remains under supabase/pending-migrations until QEO-26 passes"}
  ]
}
```

Before committing, verify actual source filenames on the implementation branch and adjust only when the repository evidence differs from this reviewed starting set.

- [ ] **Step 5: Run repository-fixture reconciliation**

Run: `node --test tests/db-migration-drift.test.ts`

Expected: PASS with zero unexplained active repo-only or production-only logical migrations.

- [ ] **Step 6: Commit evidence + manifest**

```bash
git add supabase/migration-equivalence.json docs/db/evidence/production-migration-ledger-2026-09-02.json tests/db-migration-drift.test.ts
git commit -m "chore(db): persist production migration equivalence"
```

---

### Task 3: Build the CLI and package interface

**Files:**
- Create: `scripts/db/verify-migration-drift.mjs`
- Modify: `package.json`
- Test: `tests/db-migration-drift.test.ts`

**Interfaces:**
- Consumes: JSON manifest + ledger fixture and `reconcileMigrations`.
- Produces: command `pnpm db:drift:verify` with exit code `0` on clean reconciliation and `1` on drift.

- [ ] **Step 1: Add CLI output test via `spawnSync`**

```ts
import { spawnSync } from "node:child_process"

test("db drift CLI exits zero for reviewed current state", () => {
  const run = spawnSync(process.execPath, ["scripts/db/verify-migration-drift.mjs"], { encoding: "utf8" })
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`)
  assert.match(run.stdout, /migration drift verification: PASS/i)
})
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/db-migration-drift.test.ts`

Expected: FAIL because the CLI does not exist.

- [ ] **Step 3: Implement the thin CLI**

The CLI must:

```js
import { readFileSync, readdirSync } from "node:fs"
import { reconcileMigrations } from "./migration-drift-lib.mjs"

const activeFiles = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql"))
const pendingFiles = readdirSync("supabase/pending-migrations").filter((f) => f.endsWith(".sql"))
const manifest = JSON.parse(readFileSync("supabase/migration-equivalence.json", "utf8"))
const ledger = JSON.parse(readFileSync("docs/db/evidence/production-migration-ledger-2026-09-02.json", "utf8"))
const result = reconcileMigrations({ activeFiles, pendingFiles, productionLedger: ledger.migrations, manifest })

if (!result.ok) {
  console.error("migration drift verification: FAIL")
  for (const error of result.errors) console.error(`- ${error}`)
  process.exitCode = 1
} else {
  console.log("migration drift verification: PASS")
  console.log(JSON.stringify(result.summary, null, 2))
}
```

- [ ] **Step 4: Add package scripts**

Add:

```json
"db:drift:verify": "node scripts/db/verify-migration-drift.mjs",
"test:db-drift": "node --test tests/db-migration-drift.test.ts"
```

Append `tests/db-migration-drift.test.ts` to `test:core` only if total runtime remains acceptable; otherwise rely on `verify:build` invoking `pnpm db:drift:verify` directly after `test:core`.

Preferred `verify:build` contract:

```json
"verify:build": "pnpm test:core && pnpm db:drift:verify && pnpm lint:touched && pnpm scan:secrets"
```

- [ ] **Step 5: Run focused and build-gate verification**

Run:

```bash
pnpm test:db-drift
pnpm db:drift:verify
pnpm verify:build
```

Expected: all commands exit `0`.

- [ ] **Step 6: Commit CLI/package integration**

```bash
git add scripts/db/verify-migration-drift.mjs package.json tests/db-migration-drift.test.ts
git commit -m "feat(db): fail closed on migration drift"
```

---

### Task 4: Reconcile documentation and schema-contract evidence

**Files:**
- Modify: `docs/db/2026-09-02-phase-0-deletion-manifest.md`
- Modify: `docs/HANDOVER.md`
- Create: `docs/db/QEO-25_MIGRATION_RECONCILIATION.md`

**Interfaces:**
- Produces: operator documentation for updating the ledger snapshot and mapping safely.

- [ ] **Step 1: Replace the mapping table as the source of truth**

In the Phase-0 deletion manifest, keep the historical explanation but state:

```md
Canonical machine-readable mapping: `supabase/migration-equivalence.json`.
Verification command: `pnpm db:drift:verify`.
The table below is historical context only and must not be maintained independently.
```

- [ ] **Step 2: Fix stale HANDOVER migration filenames**

Update the `clean_rebuild_top_stocks_200` and `clean_rebuild_market_snapshot_trigger` file references to the filenames that actually exist on current `main`. Preserve the behavioral description; do not alter migration semantics.

- [ ] **Step 3: Add the QEO-25 operator runbook**

Document this exact review flow:

```md
1. Read production ledger with `select version, name from supabase_migrations.schema_migrations order by version;`.
2. Update only `docs/db/evidence/production-migration-ledger-YYYY-MM-DD.json` with returned version/name pairs.
3. Run `pnpm db:drift:verify`.
4. If it fails, classify the delta as exact, mapped, quarantined, or a narrowly justified transient state.
5. Never add a wildcard exception and never replay SQL merely to make the verifier green.
6. For schema-equivalent historical drift, attach object-definition/grant evidence in the issue/PR and update the manifest rationale.
```

Include the verified snapshot-bootstrap contract: function exists; `anon`/`authenticated` execute false; `service_role` execute true.

- [ ] **Step 4: Run verification again**

```bash
pnpm test:db-drift
pnpm db:drift:verify
pnpm verify:build
```

Expected: PASS.

- [ ] **Step 5: Commit docs**

```bash
git add docs/db/2026-09-02-phase-0-deletion-manifest.md docs/db/QEO-25_MIGRATION_RECONCILIATION.md docs/HANDOVER.md
git commit -m "docs(db): document migration reconciliation gate"
```

---

### Task 5: Final QEO-25 verification and PR evidence

**Files:**
- No new implementation files unless verification reveals a defect.

- [ ] **Step 1: Run the focused test suite**

```bash
pnpm test:db-drift
pnpm db:drift:verify
```

Expected: PASS, with zero unexplained active repo-only/production-only migrations.

- [ ] **Step 2: Run project verification**

```bash
pnpm verify:build
pnpm typecheck
```

Expected: exit `0` for both.

- [ ] **Step 3: Inspect branch diff**

Run:

```bash
git diff --check main...HEAD
git diff --stat main...HEAD
```

Expected: no whitespace errors; no file under `supabase/migrations/` added for QEO-25.

- [ ] **Step 4: Create QEO-25 PR and attach evidence**

PR title:

```text
chore(db): fail closed on production migration drift
```

PR body must include:

- `pnpm test:db-drift` result;
- `pnpm db:drift:verify` result;
- `pnpm verify:build` + `pnpm typecheck` result;
- production ledger capture timestamp;
- explicit statement that no production DDL/data mutation occurred;
- explicit statement that `kfsp_rating_storage_refactor` remains quarantined.

- [ ] **Step 5: Update QEO-25 Linear issue only after evidence exists**

Comment with branch, commit(s), PR, ledger snapshot timestamp, test results, and zero unexplained drift. Mark Done only after PR acceptance/merge and the issue acceptance criteria are actually satisfied.
