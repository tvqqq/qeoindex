# QEO-19 Wyckoff Membership Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every active Wyckoff dependency on `public.wyckoff_universe_memberships` and make the published Top-200 universe the only operational membership source.

**Architecture:** Readers consume `getCanonicalUniverse()`; writers stop maintaining a duplicate membership projection. Publish paths fail closed on canonical ticker/rank parity before snapshots are published. The legacy table is dropped only after compatibility code reaches production and zero-consumer proof is green.

**Tech Stack:** TypeScript, Next.js server runtime, Supabase JS, PostgreSQL migrations, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-02-qeo-19-legacy-cutover-design.md`

## Global Constraints

- Canonical universe key remains `vn_top_stocks`.
- Active Wyckoff timeframes remain exactly `1D` and `1W`; expected snapshot count is `N × 2`.
- Do not write a replacement duplicate membership table.
- Destructive DROP happens only after zero active consumers and production smoke.
- Historical migrations may continue to mention the legacy table.

---

### Task 1: Add RED legacy-consumer regression

**Files:**
- Create: `tests/qeo-19-legacy-cutover.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: active runtime source paths.
- Produces: a deterministic test that rejects legacy runtime references.

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const root = process.cwd()
const source = (path: string) => readFileSync(`${root}/${path}`, "utf8")

const wyckoffRuntime = [
  "modules/wyckoff/unified-data.ts",
  "modules/wyckoff/unified-runner.ts",
  "modules/wyckoff/supabase-publish.ts",
  "modules/wyckoff/notion-ingest.ts",
]

test("QEO-19 active Wyckoff runtime has no legacy membership-table consumer", () => {
  for (const path of wyckoffRuntime) {
    assert.doesNotMatch(source(path), /wyckoff_universe_memberships/)
  }
})
```

- [ ] **Step 2: Add test to `test:core` and run it**

Run: `node --test tests/qeo-19-legacy-cutover.test.ts`

Expected: FAIL because all four active files still contain legacy references.

- [ ] **Step 3: Commit RED state**

```bash
git add tests/qeo-19-legacy-cutover.test.ts package.json
git commit -m "test(QEO-19): forbid legacy runtime consumers"
```

---

### Task 2: Cut the read path to canonical universe

**Files:**
- Modify: `modules/wyckoff/unified-data.ts`
- Test: `tests/qeo-19-legacy-cutover.test.ts`

**Interfaces:**
- Consumes: `getCanonicalUniverse(): Promise<CanonicalUniverseSnapshot>`.
- Produces: `getUnifiedWyckoffData()` stock membership derived from canonical `stocks`.

- [ ] **Step 1: Add a contract assertion to the RED test**

```ts
const unifiedData = source("modules/wyckoff/unified-data.ts")
assert.match(unifiedData, /getCanonicalUniverse/)
assert.doesNotMatch(unifiedData, /effective_date/)
```

- [ ] **Step 2: Run the focused test**

Expected: FAIL because the reader still queries `effective_date` from the legacy table.

- [ ] **Step 3: Implement the canonical read**

Import `getCanonicalUniverse` and replace both legacy queries with:

```ts
const canonical = await getCanonicalUniverse()
const memberships = canonical.stocks.map((stock) => ({
  ticker: stock.ticker,
  rank: stock.rank,
  sector: stock.sector,
}))
if (!memberships.length) return null
```

Keep existing requested-ticker fallback, snapshot reads and chart-series behavior unchanged.

- [ ] **Step 4: Run focused test and existing Wyckoff runtime tests**

Run:

```bash
node --test tests/qeo-19-legacy-cutover.test.ts tests/wyckoff-v2-runtime-data.test.ts tests/wyckoff-universe.test.ts
```

Expected: PASS for the reader assertions; remaining QEO-19 test still fails on writer references.

---

### Task 3: Remove duplicate membership writes from direct runner/publisher

**Files:**
- Modify: `modules/wyckoff/unified-runner.ts`
- Modify: `modules/wyckoff/supabase-publish.ts`
- Test: `tests/qeo-19-legacy-cutover.test.ts`

**Interfaces:**
- Consumes: canonical universe already loaded by each path.
- Produces: unchanged snapshot/chart-series publication with no legacy membership write.

- [ ] **Step 1: Extend RED assertions**

```ts
for (const path of ["modules/wyckoff/unified-runner.ts", "modules/wyckoff/supabase-publish.ts"]) {
  assert.doesNotMatch(source(path), /\.from\("wyckoff_universe_memberships"\)/)
}
```

- [ ] **Step 2: Run focused test and confirm failure**

- [ ] **Step 3: Delete the runner membership upsert**

Remove construction/upsert of `memberships`; keep `canonical.runId` in diagnostics.

- [ ] **Step 4: Delete direct-publisher legacy upsert**

Remove only:

```ts
const membershipRows = ...
await supabase.from("wyckoff_universe_memberships").upsert(...)
```

Keep `assertExactCanonicalMembership(...)`, `selectedCount` check, snapshot writes and publish status updates.

- [ ] **Step 5: Run Wyckoff/EOD tests**

```bash
node --test tests/qeo-19-legacy-cutover.test.ts tests/wyckoff-v2-ingest.test.ts tests/wyckoff-v2-runtime-data.test.ts tests/qeoindex-eod-v3.test.ts
```

---

### Task 4: Fail closed on canonical rank parity in Notion ingest

**Files:**
- Create: `modules/wyckoff/canonical-membership.ts`
- Modify: `modules/wyckoff/supabase-publish.ts`
- Modify: `modules/wyckoff/notion-ingest.ts`
- Test: `tests/qeo-19-legacy-cutover.test.ts`

**Interfaces:**
- Produces:

```ts
export function assertCanonicalWyckoffMembership(
  canonical: Array<{ ticker: string; rank: number }>,
  candidate: Array<{ ticker: string; rank: number | null }>,
): void
```

- [ ] **Step 1: Add RED test for pure parity behavior**

Test exact set/rank succeeds; missing, unexpected and rank mismatch throw.

- [ ] **Step 2: Implement pure parity helper**

Normalize tickers to uppercase, require equal count, require every canonical ticker in candidate, and require candidate rank equals canonical rank. Throw an error beginning `Canonical Wyckoff membership mismatch:`.

- [ ] **Step 3: Reuse helper in direct publisher**

Replace the file-local ticker-only assertion with the shared rank-aware helper.

- [ ] **Step 4: Add canonical validation to Notion ingest**

Import `getCanonicalUniverse` plus the helper. Before writing snapshots:

```ts
const canonical = await getCanonicalUniverse()
assertCanonicalWyckoffMembership(
  canonical.stocks.map(({ ticker, rank }) => ({ ticker, rank })),
  payload.memberships.map(({ ticker, rank }) => ({ ticker, rank })),
)
```

Remove the legacy membership upsert entirely.

- [ ] **Step 5: Run focused + EOD/Notion tests**

```bash
node --test tests/qeo-19-legacy-cutover.test.ts tests/wyckoff-v2-ingest.test.ts tests/wyckoff-v2-notion-io.test.ts tests/qeoindex-eod-v3.test.ts
```

Expected: no active Wyckoff file contains `wyckoff_universe_memberships`.

---

### Task 5: Keep QEO-26 recovery rehearsal valid after the real table is removed

**Files:**
- Modify: `scripts/db/rehearse-destructive-recovery.sh`
- Modify: `tests/db-recovery-rehearsal.test.ts`
- Modify: `docs/db/QEO-26_DESTRUCTIVE_RECOVERY.md`

**Interfaces:**
- Produces: a local-only synthetic table-drop fixture independent of production legacy tables.

- [ ] **Step 1: Write RED assertions**

Require the script to create/use `public.qeo_recovery_table_fixture` and forbid operational dependence on `public.wyckoff_universe_memberships`.

- [ ] **Step 2: Run**

```bash
node --test tests/db-recovery-rehearsal.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Replace legacy-table fixture with synthetic local fixture**

The rehearsal creates a local table, seeds deterministic rows, captures backup, drops it, restores it, verifies row/ACL parity, then removes it during cleanup. Keep the production-project fail-closed guard unchanged.

- [ ] **Step 4: Update recovery runbook and run regression**

```bash
node --test tests/db-recovery-rehearsal.test.ts
```

---

### Task 6: Destructive table drop after production cutover

**Files:**
- Create after compatibility deployment: `supabase/migrations/<timestamp>_drop_legacy_wyckoff_universe_memberships.sql`
- Test: `tests/qeo-19-legacy-cutover.test.ts`

**Interfaces:**
- Consumes: zero active consumer proof and production Wyckoff/EOD smoke.
- Produces: absence of `public.wyckoff_universe_memberships`.

- [ ] **Step 1: Add migration regression**

```ts
assert.match(dropMigration, /drop table if exists public\.wyckoff_universe_memberships/i)
```

- [ ] **Step 2: Create minimal migration**

```sql
begin;

drop table if exists public.wyckoff_universe_memberships;

commit;
```

- [ ] **Step 3: Run drift/replay/core verification**

```bash
pnpm test:core
pnpm test:db-recovery
pnpm db:drift:verify
pnpm typecheck
```

- [ ] **Step 4: Apply only after runtime release is production-ready**

Use the normal Supabase migration deployment path, then verify `to_regclass('public.wyckoff_universe_memberships') is null` and run Wyckoff `N × 2` smoke.
