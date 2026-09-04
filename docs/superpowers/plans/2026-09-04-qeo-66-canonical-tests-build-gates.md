# QEO-66 Canonical Tests & Build Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace historical/version-coupled test wiring with a manifest-driven current-contract suite, then remove the full verification tax from `pnpm build` only after equivalent CI gates are active.

**Architecture:** Add one machine-readable test contract manifest as the inventory/source of truth, with a validator and suite runner. Canonical EOD contracts are renamed/consolidated around current EOD behavior; tests for still-present legacy capabilities are classified and quarantined rather than deleted early. GitHub Verify becomes the release-verification owner, while Vercel/package artifact build becomes `next build` only.

**Tech Stack:** Node.js built-in test runner, TypeScript 5.7, pnpm 10.28, GitHub Actions, Next.js 16.3, Supabase DB drift/replay workflows.

**Spec:** `docs/superpowers/specs/2026-09-04-qeo-65-67-spec-driven-cleanup-design.md`

## Global Constraints

- Current approved architecture, not filenames/version numbers/issue IDs, determines whether a test is legacy.
- All 97 starting top-level `tests/*.test.ts` files must receive an explicit owner, invariant, bucket, and suite/deletion decision before any test is deleted.
- Active `test:eod-v2` and `test:eod-v3` production scripts must disappear.
- A current invariant in a historical test must be migrated before the historical test is removed.
- Tests for capabilities that QEO-65 has not yet removed (for example old Drive/per-ticker Notion compatibility) are classified as superseded and excluded from current fast suites, but their physical deletion is deferred to the QEO-65 capability-deletion commit.
- DB replay, destructive recovery, and deep drift checks remain outside the fast artifact-build path.
- `pnpm build` may lose `prebuild -> verify:build` only after CI runs the replacement current-contract gates.
- QEO-66 does not perform broad module/file relocation; QEO-67 owns final physical module layout.
- Do not weaken auth/RLS/security, canonical Top Stocks 200, EOD v4 same-session lineage, Daily-only OHLCV/derived Weekly, PARTIAL/retry, AI Council ordering, Signals coverage, Admin telemetry, or portfolio correctness.
- Measure before/after test, verification, TypeScript/lint, and artifact-build time. Do not claim improvement without timing evidence.

---

## File Structure Locked by This Plan

### New files

- `tests/test-contracts.json` — machine-readable classification of every top-level test file.
- `scripts/verify-test-contracts.mjs` — validates that the manifest exactly covers the current test directory and obeys classification rules.
- `scripts/run-test-suite.mjs` — runs a named suite from the manifest with the Node test runner.
- `tests/test-contract-manifest.test.ts` — deterministic regression for manifest completeness and allowed values.
- `tests/eod-orchestrator-contract.test.ts` — canonical EOD dependency/order/current-session orchestration contract.
- `tests/eod-fault-isolation-contract.test.ts` — canonical ticker-local PARTIAL/retry contract.
- `tests/eod-rollout-contract.test.ts` — canonical scheduler/Admin/no-Drive/current rollout contract.
- `tests/eod-data-refresh-contract.test.ts` — canonical same-session Rating/TTAI/market READY contract.
- `tests/eod-telemetry-contract.test.ts` — canonical internal/business phase mapping contract.
- `tests/eod-storage-retention-contract.test.ts` — current Daily-only publish/retention safety contract.
- `tests/legacy-eod-archive-compat.test.ts` — temporary quarantined tests that still prove the old compatibility code behaves as expected until QEO-65 deletes that code; never part of `test:fast`/`test:eod`.
- `tests/build-pipeline-contract.test.ts` — guards `build = next build`, absence of heavy `prebuild`, and CI ownership of release verification.
- `docs/superpowers/evidence/2026-09-04-qeo-66-test-build-baseline.md` — before/after metrics and test classification summary.

### Modified files

- `package.json` — current suite scripts, manifest runner, `verify:pr`, `verify:full`, artifact-build split.
- `.github/workflows/security.yml` — consume current suite scripts rather than historical/issue-specific test lists.
- `.github/workflows/eod-v4.yml` — reduce to the canonical `test:eod` entry point or remove only if repository-required-check inspection proves safe.
- `.github/workflows/db-drift.yml` — use canonical `test:db` contract where it does not replace zero-to-latest replay/generated-type checks.
- `tests/build-impact.test.ts` — retain ignore/build-impact behavior and add package/workflow files required by the new release contract if needed.

### Removed/renamed historical EOD tests after invariant migration

- `tests/qeoindex-eod-v3.test.ts`
- `tests/qeoindex-eod-v3-phase-telemetry.test.ts`
- `tests/qeoindex-eod-v3-build-gate.test.ts`
- `tests/qeoindex-eod-v4-orchestrator.test.ts`
- `tests/qeoindex-eod-v4-fault-isolation.test.ts`
- `tests/qeoindex-eod-v4-rollout.test.ts`
- `tests/qeo-58-eod-data-refresh.test.ts`

Do not delete `tests/wyckoff-v2-notion-io.test.ts`, `tests/wyckoff-v2-notion-staging.test.ts`, or another compatibility test merely because the current spec supersedes the capability. If active source still implements that capability, classify the test as superseded/quarantined and let QEO-65 delete source + matching test in the same reviewed release.

---

### Task 1: Add a Complete Test Contract Manifest and Baseline Guardrail

**Files:**
- Create: `tests/test-contracts.json`
- Create: `scripts/verify-test-contracts.mjs`
- Create: `tests/test-contract-manifest.test.ts`
- Create: `docs/superpowers/evidence/2026-09-04-qeo-66-test-build-baseline.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: top-level files matching `tests/*.test.ts`.
- Produces: `tests/test-contracts.json` entries with `{ path, owner, invariant, bucket, suites, replacement, deleteWith }` and a validator executable through `pnpm test:manifest`.

Allowed manifest values:

```json
{
  "owners": ["auth", "market", "kfsp", "wyckoff", "ai", "signals", "eod", "admin", "portfolio", "research", "ui", "db", "tooling", "notion"],
  "buckets": ["canonical", "rewrite", "superseded", "duplicate", "deep-safety"],
  "suites": ["fast", "eod", "ai", "db", "ui-contracts", "none"]
}
```

Rules:

- Every top-level `tests/*.test.ts` path appears exactly once.
- No manifest path may point to a missing file.
- `canonical` entries have at least one current suite.
- `rewrite` entries require a non-empty `replacement` path.
- `superseded` entries use `suites: ["none"]`; if the matching source still exists, set `deleteWith` to the QEO-65 wave that removes the capability.
- `duplicate` entries require a `replacement` path naming the surviving contract.
- `deep-safety` entries use `db` or `none` and never `fast`.

Required first-pass decisions that must be represented explicitly:

- `tests/qeoindex-eod-v4-orchestrator.test.ts` → `rewrite`, owner `eod`, replacement `tests/eod-orchestrator-contract.test.ts`.
- `tests/qeoindex-eod-v4-fault-isolation.test.ts` → `rewrite`, owner `eod`, replacement `tests/eod-fault-isolation-contract.test.ts`.
- `tests/qeoindex-eod-v4-rollout.test.ts` → `rewrite`, owner `eod`, replacement `tests/eod-rollout-contract.test.ts`.
- `tests/qeo-58-eod-data-refresh.test.ts` → `rewrite`, owner `eod`, replacement `tests/eod-data-refresh-contract.test.ts`.
- `tests/qeoindex-eod-v3.test.ts` → `rewrite`, owner `eod`; current assertions split between orchestrator and storage/retention contracts.
- `tests/qeoindex-eod-v3-phase-telemetry.test.ts` → `rewrite`, owner `eod`, replacement `tests/eod-telemetry-contract.test.ts`.
- `tests/qeoindex-eod-v3-build-gate.test.ts` → `rewrite`, owner `eod`; current assertions migrate to rollout/storage contracts while old Drive/Notion compatibility assertions move to `tests/legacy-eod-archive-compat.test.ts`.
- `tests/db-recovery-rehearsal.test.ts` → `deep-safety`, owner `db`, not `fast`.
- `tests/db-migration-drift.test.ts` and `tests/db-schema-contract.test.ts` → `deep-safety`, owner `db`, suite `db`.
- `tests/wyckoff-v2-notion-io.test.ts` and `tests/wyckoff-v2-notion-staging.test.ts` → inspect current consumers; if they only protect per-ticker operational Notion compatibility still present in source, classify `superseded`, suite `none`, `deleteWith: "QEO-65A"`.
- Auth/RLS/security, current Top Stocks 200, Signals daily coverage, portfolio accounting, current market contracts, current Wyckoff Daily/Weekly contract, and current AI Council persistence/evidence tests remain `canonical` unless inspection proves exact duplicate coverage.

- [ ] **Step 1: Write the failing manifest regression before the manifest exists**

Create `tests/test-contract-manifest.test.ts` with a test that imports or executes the validator and expects zero missing/extra/duplicate test paths. The validator should export `validateTestContracts(rootDir)` returning:

```js
{
  ok: boolean,
  missing: string[],
  extra: string[],
  duplicates: string[],
  invalid: string[]
}
```

The test must assert all four arrays are empty and `ok === true`.

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
node --test tests/test-contract-manifest.test.ts
```

Expected: FAIL because `tests/test-contracts.json` and/or the validator do not exist yet.

- [ ] **Step 3: Implement the validator**

`verify-test-contracts.mjs` must:

1. list only top-level `tests/*.test.ts` files;
2. parse `tests/test-contracts.json`;
3. verify exact path coverage;
4. validate owner/bucket/suite enums;
5. enforce replacement/delete rules above;
6. print one stable error block per category;
7. exit `1` for CLI validation failure and `0` for success.

Use `fileURLToPath`, `readdirSync`, `readFileSync`, and `path.resolve`; do not add an npm dependency.

- [ ] **Step 4: Classify all 97 starting tests**

Read each test file's test names/assertions before assigning its bucket. Do not classify from filename alone. Populate `tests/test-contracts.json` until the validator reports zero missing/extra/duplicate/invalid entries.

The baseline evidence document must record:

```text
starting top-level test files: 97
starting active scripts: test:core + test:eod-v2 + test:eod-v3 + convenience scripts
starting artifact path: pnpm build -> prebuild -> verify:build -> next build
starting EOD mismatch: current EOD v4 tests exist, while test:core invokes test:eod-v3
```

- [ ] **Step 5: Add `test:manifest` only; do not alter current release behavior yet**

Add:

```json
"test:manifest": "node scripts/verify-test-contracts.mjs"
```

Do not remove `prebuild`, `test:core`, `test:eod-v2`, or `test:eod-v3` in this task.

- [ ] **Step 6: Verify GREEN and commit**

Run:

```bash
pnpm test:manifest
node --test tests/test-contract-manifest.test.ts
pnpm test:core
```

Expected: all PASS using the old production wiring plus the new inventory guardrail.

Commit:

```bash
git add tests/test-contracts.json scripts/verify-test-contracts.mjs tests/test-contract-manifest.test.ts docs/superpowers/evidence/2026-09-04-qeo-66-test-build-baseline.md package.json
git commit -m "test(QEO-66): inventory current test contracts"
```

---

### Task 2: Consolidate EOD Tests Around Current Contracts

**Files:**
- Create/rename: `tests/eod-orchestrator-contract.test.ts`
- Create/rename: `tests/eod-fault-isolation-contract.test.ts`
- Create/rename: `tests/eod-rollout-contract.test.ts`
- Create/rename: `tests/eod-data-refresh-contract.test.ts`
- Create/rename: `tests/eod-telemetry-contract.test.ts`
- Create: `tests/eod-storage-retention-contract.test.ts`
- Create: `tests/legacy-eod-archive-compat.test.ts`
- Remove after migration: historical/version-coupled EOD files listed in File Structure
- Modify: `tests/test-contracts.json`

**Interfaces:**
- Consumes: current EOD v4 workflow/source and still-valid assertions from v3/QEO-named tests.
- Produces: current EOD contracts with no `v2`/`v3` script dependency and one explicit quarantined legacy compatibility test file.

- [ ] **Step 1: Move the three already-current EOD v4 files to version-neutral names**

Use `git mv`:

```bash
git mv tests/qeoindex-eod-v4-orchestrator.test.ts tests/eod-orchestrator-contract.test.ts
git mv tests/qeoindex-eod-v4-fault-isolation.test.ts tests/eod-fault-isolation-contract.test.ts
git mv tests/qeoindex-eod-v4-rollout.test.ts tests/eod-rollout-contract.test.ts
git mv tests/qeo-58-eod-data-refresh.test.ts tests/eod-data-refresh-contract.test.ts
git mv tests/qeoindex-eod-v3-phase-telemetry.test.ts tests/eod-telemetry-contract.test.ts
```

Update test titles to describe the invariant, not QEO issue IDs, where the issue ID is merely historical. Preserve QEO identifiers only inside comments when useful for provenance.

- [ ] **Step 2: Migrate still-current assertions from `qeoindex-eod-v3.test.ts`**

Move these current invariants into the appropriate canonical files before deleting the source file:

- Rating freeze → TTAI/Market Close sibling branches → READY join → `eod-orchestrator-contract.test.ts`.
- Deterministic Council → Market Synthesis → LLM ordering → `eod-orchestrator-contract.test.ts`.
- 2 snapshots per ticker / Daily chart-series canonical publish → `eod-storage-retention-contract.test.ts`.
- build-once + run-scoped artifact staging / workflow output not carrying snapshots → `eod-storage-retention-contract.test.ts`.
- seven business phases/internal durable phases → `eod-telemetry-contract.test.ts`.
- raw Daily history is not deleted by retention → `eod-storage-retention-contract.test.ts`.
- QEO-21 terminal/orphan/staging retention SQL invariants → `eod-storage-retention-contract.test.ts`.

Do not copy duplicate assertions already covered identically by the version-neutral EOD files; the manifest should mark the removed duplicate as consolidated.

- [ ] **Step 3: Split current vs legacy assertions from `qeoindex-eod-v3-build-gate.test.ts`**

Move current assertions to canonical contracts:

- historical backfill remains Supabase-first;
- no-trade repair supports max 200;
- recoverable current-session history failures remain visible and historical backfill stays fail-closed;
- one analytical Notion summary is downstream/fail-open;
- Market AI Vault dispatch contract remains current.

Move only the still-present compatibility assertions into `tests/legacy-eod-archive-compat.test.ts`, specifically assertions that the current compatibility wrapper still delegates to the old Drive uploader or exposes old archive APIs. Mark this file `superseded`, suite `none`, `deleteWith: "QEO-65A"`.

Do **not** preserve a test that requires `test:eod-v3`, heavy `prebuild`, or another historical script. Those are the behaviors QEO-66 replaces.

- [ ] **Step 4: Delete historical/version-coupled files only after migrated tests are green**

Delete:

```text
tests/qeoindex-eod-v3.test.ts
tests/qeoindex-eod-v3-build-gate.test.ts
```

The phase telemetry file has already been renamed in Step 1. Version-neutral files replace current v4 names through `git mv`, so there is no loss of assertions.

- [ ] **Step 5: Update the manifest and run canonical files directly**

Run:

```bash
pnpm test:manifest
node --test \
  tests/eod-orchestrator-contract.test.ts \
  tests/eod-fault-isolation-contract.test.ts \
  tests/eod-rollout-contract.test.ts \
  tests/eod-data-refresh-contract.test.ts \
  tests/eod-telemetry-contract.test.ts \
  tests/eod-storage-retention-contract.test.ts
```

Expected: PASS. Do not include `tests/legacy-eod-archive-compat.test.ts` in this command.

- [ ] **Step 6: Commit**

```bash
git add tests
git commit -m "test(QEO-66): consolidate EOD current contracts"
```

---

### Task 3: Add a Manifest-Driven Suite Runner and Current Package Scripts

**Files:**
- Create: `scripts/run-test-suite.mjs`
- Create: `tests/test-suite-runner.test.ts`
- Modify: `package.json`
- Modify: `tests/test-contracts.json`

**Interfaces:**
- Consumes: `tests/test-contracts.json`.
- Produces: `node scripts/run-test-suite.mjs <suite>` and package scripts `test:fast`, `test:eod`, `test:ai`, `test:db`, `test:ui-contracts`, `test:current`.

Runner behavior:

```js
const files = manifest.tests
  .filter((entry) => entry.suites.includes(requestedSuite))
  .map((entry) => entry.path)
  .sort()

const child = spawnSync(process.execPath, ["--test", ...files], {
  cwd: repoRoot,
  stdio: "inherit",
})
process.exit(child.status ?? 1)
```

Reject unknown suite names and reject an empty selected suite.

- [ ] **Step 1: Write RED runner tests**

`tests/test-suite-runner.test.ts` should validate a pure exported `filesForSuite(manifest, suite)` helper:

- returns only exact suite members;
- sorts paths deterministically;
- excludes `suites: ["none"]`;
- throws for unknown suite;
- throws for empty suite.

Run:

```bash
node --test tests/test-suite-runner.test.ts
```

Expected: FAIL before the runner exists.

- [ ] **Step 2: Implement the runner without dependencies**

Use `spawnSync` from `node:child_process`, JSON parsing, and the same allowed suite enum as the manifest validator.

- [ ] **Step 3: Replace historical EOD package scripts with current domain scripts**

Target package script surface:

```json
"test:manifest": "node scripts/verify-test-contracts.mjs",
"test:fast": "node scripts/run-test-suite.mjs fast",
"test:eod": "node scripts/run-test-suite.mjs eod",
"test:ai": "node scripts/run-test-suite.mjs ai",
"test:db": "node scripts/run-test-suite.mjs db",
"test:ui-contracts": "node scripts/run-test-suite.mjs ui-contracts",
"test:current": "pnpm test:manifest && pnpm test:fast && pnpm test:eod && pnpm test:ai && pnpm test:db && pnpm test:ui-contracts"
```

Remove active `test:eod-v2` and `test:eod-v3`.

Keep existing DB operational commands (`db:drift:verify`, `db:types:*`, `db:replay:verify`, `db:recovery:rehearse`, `test:db-drift`, `test:db-recovery`) because they are deep/recovery gates, not ordinary current suites.

Before removing a convenience test script such as `test:council`, `test:wyckoff-ui`, `test:signal-core`, or `test:scanner-core`, run:

```bash
rg 'test:(council|wyckoff-ui|signal-core|scanner-core|intraday|indexes|universe|board-contract|fa|navigation|ui-cache|supabase|build-impact|notion)' .github scripts docs package.json
```

If a script has zero repository consumers and its tests are represented in manifest suites, delete that script. If a current workflow/doc consumes it, migrate that consumer in the same commit before removal.

- [ ] **Step 4: Make `test:core` a temporary alias only if an external consumer still exists**

Preferred state: remove `test:core` and migrate all repository consumers to `test:current`/named suites.

If a non-repository external integration is proven to call `test:core`, temporarily set:

```json
"test:core": "pnpm test:current"
```

and record that compatibility alias in the evidence document with a QEO-67 removal owner. Do not keep the old explicit list or a `test:eod-v3` tail.

- [ ] **Step 5: Verify all current suite entry points**

Run:

```bash
pnpm test:manifest
pnpm test:fast
pnpm test:eod
pnpm test:ai
pnpm test:db
pnpm test:ui-contracts
```

Expected: all PASS; no current suite selects `legacy-eod-archive-compat.test.ts` or another `superseded` entry.

- [ ] **Step 6: Commit**

```bash
git add scripts/run-test-suite.mjs tests/test-suite-runner.test.ts tests/test-contracts.json package.json docs/superpowers/evidence/2026-09-04-qeo-66-test-build-baseline.md
git commit -m "build(QEO-66): add current test suite topology"
```

---

### Task 4: Move Release Verification to GitHub Verify Without Weakening DB Safety

**Files:**
- Modify: `.github/workflows/security.yml`
- Modify: `.github/workflows/eod-v4.yml`
- Modify: `.github/workflows/db-drift.yml`
- Create: `tests/ci-verification-contract.test.ts`
- Modify: `tests/test-contracts.json`

**Interfaces:**
- Consumes: current package suite commands from Task 3.
- Produces: CI that calls stable package entry points rather than historical/issue-specific file lists.

Important limitation discovered during planning: repository ruleset/branch-protection APIs are not readable through the current integration (403). Therefore **do not delete a named workflow solely from assumption that it is not a required check**. Preserve the `EOD v4` workflow name initially as a thin compatibility check unless an authorized repository-admin inspection proves it is safe to remove.

- [ ] **Step 1: Write RED CI contract tests**

`tests/ci-verification-contract.test.ts` must read workflow YAML as text and assert:

- `security.yml` invokes `pnpm test:manifest`, `pnpm test:fast`, `pnpm test:eod`, `pnpm test:ai`, `pnpm test:db`, `pnpm test:ui-contracts`, `pnpm typecheck`, and a production build command;
- `security.yml` no longer hardcodes QEO-58, market-board, auth-login, orderbook, KFSP, canonical-200 file lists individually;
- `eod-v4.yml` invokes `pnpm test:eod` instead of hardcoding individual EOD files;
- `db-drift.yml` still performs migration-ledger verification, local Supabase start, zero replay, generated-type verification, DB contracts, TypeScript, and cleanup.

Run and verify RED before editing workflows.

- [ ] **Step 2: Simplify `security.yml` to current suite entry points**

Replace repeated test-file steps with named package commands. Keep:

- secret scan;
- dependency install/cache;
- current test suites;
- touched lint for now (QEO-67 owns module-aware lint replacement);
- TypeScript;
- production Next build.

Do not add local Supabase replay to this general Verify workflow; `db-drift.yml` remains the deep DB gate.

- [ ] **Step 3: Make `eod-v4.yml` a thin compatibility workflow**

Keep the workflow name `EOD v4` and its path filters for now, but replace the hardcoded node command with:

```yaml
- run: pnpm test:eod
```

This avoids a second independent EOD test inventory while preserving a potentially required check name.

If repository admin later confirms `EOD v4 / contract` is not required, QEO-66 may delete the workflow in a separate tiny commit after `Verify` is confirmed required. Do not combine that administrative uncertainty with the main test cleanup.

- [ ] **Step 4: Keep DB Drift deep gates, replace only duplicate DB test enumeration where safe**

`db-drift.yml` must still run:

```text
verify reviewed migration ledger
start local Supabase
replay migrations from zero
verify generated Database types
DB contract regressions
TypeScript
stop local Supabase
```

It may call `pnpm test:db` for current DB tests **in addition to** tests that specifically validate drift/replay, but do not remove `db:replay:verify` or `db:types:verify`.

- [ ] **Step 5: Run CI contract tests and local equivalents**

```bash
node --test tests/ci-verification-contract.test.ts
pnpm test:current
pnpm typecheck
pnpm lint:touched
pnpm scan:secrets
pnpm exec next build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows tests/ci-verification-contract.test.ts tests/test-contracts.json
git commit -m "ci(QEO-66): route verification through current suites"
```

---

### Task 5: Remove Heavy Verification from the Artifact Build Path

**Files:**
- Create: `tests/build-pipeline-contract.test.ts`
- Modify: `package.json`
- Modify: `.github/workflows/security.yml`
- Modify: `tests/test-contracts.json`
- Modify if required by assertions: `tests/build-impact.test.ts`

**Interfaces:**
- Consumes: CI replacement gates from Task 4.
- Produces: `pnpm build === next build` with no heavy `prebuild`; `verify:pr` and `verify:full` remain explicit developer/CI commands.

- [ ] **Step 1: Write RED build-pipeline regression**

Create `tests/build-pipeline-contract.test.ts` that parses `package.json` and asserts:

```ts
assert.equal(pkg.scripts.build, "next build")
assert.equal("prebuild" in pkg.scripts, false)
assert.match(pkg.scripts["verify:pr"], /test:manifest/)
assert.match(pkg.scripts["verify:pr"], /test:current/)
assert.match(pkg.scripts["verify:pr"], /lint:touched/)
assert.match(pkg.scripts["verify:pr"], /typecheck/)
assert.match(pkg.scripts["verify:pr"], /scan:secrets/)
```

Also assert `verify:full` invokes `verify:pr` plus deep DB verification commands and that no active script mentions `test:eod-v2` or `test:eod-v3`.

Run:

```bash
node --test tests/build-pipeline-contract.test.ts
```

Expected: FAIL because current `prebuild` exists and `verify:pr` does not.

- [ ] **Step 2: Add explicit verification commands before deleting `prebuild`**

Set:

```json
"verify:pr": "pnpm scan:secrets && pnpm test:current && pnpm lint:touched && pnpm typecheck",
"verify:full": "pnpm verify:pr && pnpm db:drift:verify && pnpm db:replay:verify && pnpm db:types:verify && pnpm test:db-drift"
```

`verify:full` is expected to run only where local Supabase/CLI prerequisites are available; GitHub DB Drift remains the authoritative zero-replay CI lane.

- [ ] **Step 3: Remove the artifact `prebuild` hook**

Delete:

```json
"prebuild": "pnpm verify:build"
```

Delete `verify:build` after all repository consumers have migrated to `verify:pr`/`verify:full`.

Keep:

```json
"build": "next build"
```

- [ ] **Step 4: Make GitHub Verify exercise the real artifact command**

After `prebuild` is gone, change the final `security.yml` build step from `pnpm exec next build` to:

```yaml
- name: Production build
  run: pnpm build
```

This proves the exact package artifact command while avoiding duplicated verification.

- [ ] **Step 5: Verify the build split**

Run:

```bash
pnpm verify:pr
pnpm build
node --test tests/build-pipeline-contract.test.ts tests/build-impact.test.ts tests/ci-verification-contract.test.ts
```

Expected:

- `verify:pr` executes security/current tests/lint/typecheck;
- `pnpm build` starts directly at Next build without first printing `test:core`, DB drift, lint, or secret scan;
- all contract tests PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json .github/workflows/security.yml tests/build-pipeline-contract.test.ts tests/build-impact.test.ts tests/ci-verification-contract.test.ts tests/test-contracts.json
git commit -m "build(QEO-66): decouple verification from artifact build"
```

---

### Task 6: Prune Duplicate Script/Test Wiring Without Deleting Still-Live Legacy Guards

**Files:**
- Modify: `package.json`
- Modify: `tests/test-contracts.json`
- Modify/remove: exact duplicate tests proven by the completed manifest
- Keep until QEO-65 source deletion: `tests/legacy-eod-archive-compat.test.ts` and other `superseded` tests whose capability implementation still exists

**Interfaces:**
- Consumes: complete manifest and stable current suite topology.
- Produces: no duplicate package test wiring; every remaining test has one reason to exist.

- [ ] **Step 1: Generate the delete/keep list from manifest decisions**

Run the validator in a reporting mode that prints entries grouped by bucket. Add `--report` to `verify-test-contracts.mjs` if not already present; output must be deterministic and include path, owner, bucket, replacement/deleteWith.

- [ ] **Step 2: Remove only `duplicate` tests whose surviving replacement already passes**

For each `duplicate` entry:

1. run the replacement test directly;
2. run the duplicate directly;
3. confirm its distinct assertions are already present in the replacement;
4. delete the duplicate;
5. remove its manifest entry only after filesystem deletion; the replacement remains classified.

Do not delete `superseded` entries with `deleteWith: "QEO-65A"` in QEO-66.

- [ ] **Step 3: Remove unused convenience scripts after repository-reference proof**

Use the `rg` command from Task 3. Every removed script must have zero remaining repository references and its selected tests must be reachable through a current manifest suite or a deep-safety command.

- [ ] **Step 4: Run the full current suite and quarantined guards separately**

```bash
pnpm test:current
node --test tests/legacy-eod-archive-compat.test.ts
```

The first command proves current behavior; the second proves the still-live compatibility path until QEO-65 removes it.

- [ ] **Step 5: Commit**

```bash
git add package.json tests scripts/verify-test-contracts.mjs
git commit -m "test(QEO-66): remove duplicate test wiring"
```

---

### Task 7: Measure Before/After and Run Release Acceptance

**Files:**
- Modify: `docs/superpowers/evidence/2026-09-04-qeo-66-test-build-baseline.md`
- Modify: Linear QEO-66 evidence/comment after verification

**Interfaces:**
- Consumes: final QEO-66 branch state.
- Produces: measured acceptance evidence and the explicit gate that QEO-65A may begin destructive/source cleanup.

- [ ] **Step 1: Record local timing with the same environment before and after**

Use `/usr/bin/time -p` (or shell `time` where GNU time is unavailable) and record real/user/sys plus command result for:

Before reference commands (from pre-QEO-66 commit):

```bash
pnpm test:core
pnpm verify:build
pnpm exec next build
pnpm build
```

After commands:

```bash
pnpm test:fast
pnpm test:eod
pnpm test:current
pnpm verify:pr
pnpm build
```

If the pre-change branch is no longer checked out locally, use a temporary worktree pinned to the pre-QEO-66 base commit for the before measurement; do not estimate timings.

- [ ] **Step 2: Record structural metrics**

Record:

```text
test file count before / after
test LOC before / after
package test-script count before / after
active eod-v2/eod-v3 scripts: before yes / after no
current manifest coverage: 100%
superseded tests intentionally deferred to QEO-65A: exact file list
```

- [ ] **Step 3: Run full local acceptance**

```bash
pnpm test:manifest
pnpm test:current
pnpm verify:pr
pnpm build
pnpm test:db-drift
pnpm typecheck
```

If local Supabase is available, additionally run:

```bash
pnpm verify:full
```

If it is not available, do not weaken or skip the GitHub DB Drift workflow; the PR cannot be accepted until that workflow is green.

- [ ] **Step 4: Push and require fresh CI evidence**

Required fresh checks for the final head:

- Verify: green;
- DB Drift Reconciliation: green when triggered by `package.json`/DB contract paths;
- EOD v4 compatibility workflow: green if retained;
- no stale-head success may be used as acceptance.

- [ ] **Step 5: Production/build verification after approved merge**

Because `main` is the only deployment-enabled branch and Vercel Git Integration is the deployment owner:

1. merge once after approval;
2. do not run a manual Vercel production deploy;
3. confirm `ignoreCommand`/Git integration behavior;
4. for a runtime/build-config change, verify the Git-triggered production build;
5. capture Vercel build duration and compare with baseline;
6. smoke auth, market board, Signals, Admin, EOD route visibility, Wyckoff/AI read paths, and portfolio pages.

This QEO-66 release changes test/build infrastructure, not DB schema, so it must not run `supabase db push` unless implementation unexpectedly introduces a migration (which would be out of scope and requires a new plan/review).

- [ ] **Step 6: Update Linear and declare the QEO-65A safety gate**

Attach:

- manifest coverage result;
- files rewritten/deleted/deferred;
- before/after timings;
- fresh CI run links;
- Vercel build evidence;
- statement that `pnpm build` is artifact-only and release verification is CI-owned.

QEO-65A may start only when current-contract suites are green and every superseded compatibility test scheduled for QEO-65A has a `deleteWith` owner.

- [ ] **Step 7: Final commit for evidence only if evidence changed on branch**

```bash
git add docs/superpowers/evidence/2026-09-04-qeo-66-test-build-baseline.md
git commit -m "docs(QEO-66): record test and build cleanup evidence"
```

---

## Self-Review Against the Approved Spec

### Spec coverage

- Test classification for all 97 starting tests → Task 1.
- Current EOD contract replacing historical v2/v3 wiring → Task 2.
- Current named test topology → Task 3.
- CI owns release verification → Task 4.
- Artifact build no longer reruns test/DB/lint/secret suite → Task 5.
- Duplicate tests/scripts reduced without early legacy-capability deletion → Task 6.
- Recovery/deep DB safety remains outside fast path → Tasks 3–5.
- Before/after timings and fresh CI/production evidence → Task 7.
- Physical module regrouping is deferred to QEO-67 → Global Constraints.
- Capability-specific legacy test deletion is coupled to QEO-65 source deletion → Tasks 1, 2, 6.

### Placeholder scan

No task depends on `TBD`, `TODO`, “appropriate tests”, or an unnamed replacement. The only conditional branch is repository required-check handling for `eod-v4.yml`; because the current integration cannot read repository protection/rulesets, the safe default is explicitly fixed: retain the workflow name as a thin `pnpm test:eod` wrapper until an authorized admin inspection proves deletion safe.

### Type/interface consistency

- Manifest bucket/suite values are fixed once in Task 1 and reused by validator/runner/tests.
- `validateTestContracts(rootDir)` return shape is fixed in Task 1.
- Suite runner uses the same manifest and suite enum from Task 1.
- `test:current` is the aggregate used by `verify:pr`; `verify:full` adds deep DB checks.
- `legacy-eod-archive-compat.test.ts` is never selected by a current suite and is owned for deletion by QEO-65A.

## Execution Handoff

Plan execution should use an isolated worktree created from current `main` after reading the approved spec. Recommended execution is **Subagent-Driven Development** with one fresh agent per task and review between tasks. Inline execution is also valid using the executing-plans skill with checkpoints after Tasks 2, 5, and 7.
