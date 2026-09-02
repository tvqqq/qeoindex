# QEO-26 Destructive Recovery Rehearsal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and execute a repeatable local Supabase backup→destructive-change→restore rehearsal that proves destructive DB refactors can be recovered without touching production.

**Architecture:** Use the repository’s existing local Supabase project (`supabase/config.toml`, local DB port `54322`, Postgres 17) as the disposable environment. A shell harness performs hard environment guards, clean migration replay, synthetic seed, backup validation, destructive DDL, destructive-state assertions, restore, and parity assertions. SQL fixtures stay separate from orchestration so later destructive issues can extend coverage without weakening the safety guard.

**Tech Stack:** Supabase CLI, Docker-backed local Supabase, PostgreSQL 17, `pg_dump`, `pg_restore`/`psql`, Bash with `set -euo pipefail`, Node `node:test` for static safety-contract tests, pnpm 10.28.0.

**Spec:** `docs/superpowers/specs/2026-09-02-qeo-25-26-db-drift-recovery-design.md`

## Global Constraints

- Production project ref `glwhhrmejlonhyorvtzm` is forbidden for destructive rehearsal.
- Destructive rehearsal runs only against local Supabase/Postgres.
- Do not copy production user rows; use synthetic fixture data only.
- Backup must be validated before destructive DDL becomes reachable.
- The test must prove the destructive action happened before attempting restore.
- `supabase/pending-migrations/20260902090000_kfsp_rating_storage_refactor.sql` remains quarantined; QEO-26 proves recovery capability but does not deploy that migration.
- No production Supabase branch/project is required for the baseline gate.
- `main` is deployment-enabled; implementation occurs on a feature branch and is reviewed before merge.

---

## File Structure

- Create `scripts/db/rehearse-destructive-recovery.sh` — single orchestration entrypoint and production guard.
- Create `scripts/db/recovery/seed.sql` — synthetic representative rows.
- Create `scripts/db/recovery/capture-baseline.sql` — deterministic pre-destructive schema/data contract output.
- Create `scripts/db/recovery/destructive.sql` — representative local-only destructive operations.
- Create `scripts/db/recovery/assert-destroyed.sql` — prove the column/table are actually absent.
- Create `scripts/db/recovery/assert-restored.sql` — assert schema/data/grant/RLS/type parity after restore.
- Create `tests/db-recovery-rehearsal.test.ts` — static fail-safe contract tests for the harness and SQL fixture.
- Modify `package.json` — add `db:recovery:rehearse` and `test:db-recovery`.
- Create `docs/db/QEO-26_RECOVERY_REHEARSAL.md` or replace the existing draft only after fetching its current content — reusable runbook and actual rehearsal evidence section.

The harness owns orchestration only; SQL files own database behavior only.

---

### Task 1: Lock the destructive harness safety contract with RED tests

**Files:**
- Create: `tests/db-recovery-rehearsal.test.ts`
- Create: `scripts/db/rehearse-destructive-recovery.sh`

**Interfaces:**
- Produces command: `bash scripts/db/rehearse-destructive-recovery.sh`
- Environment variable: `QEO_RECOVERY_DB_URL`; if omitted, the harness uses only the fixed local URL `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.
- Environment variable: `QEO_RECOVERY_ARTIFACT_DIR`; defaults to `.tmp/qeo-db-recovery`.

- [ ] **Step 1: Write failing safety tests**

Create `tests/db-recovery-rehearsal.test.ts` with assertions like:

```ts
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const harness = readFileSync("scripts/db/rehearse-destructive-recovery.sh", "utf8")

test("recovery harness is fail-fast and forbids production", () => {
  assert.match(harness, /set -euo pipefail/)
  assert.match(harness, /glwhhrmejlonhyorvtzm/)
  assert.match(harness, /127\.0\.0\.1:54322/)
  assert.match(harness, /backup/i)
  assert.match(harness, /assert-destroyed\.sql/)
  assert.match(harness, /assert-restored\.sql/)
})
```

Add a second test that requires the harness to reject any DB URL that does not point to localhost/127.0.0.1.

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/db-recovery-rehearsal.test.ts`

Expected: FAIL because the harness does not exist.

- [ ] **Step 3: Implement only the environment guard and phase logger**

The initial harness must contain:

```bash
#!/usr/bin/env bash
set -euo pipefail

PRODUCTION_PROJECT_REF="glwhhrmejlonhyorvtzm"
LOCAL_DB_URL="${QEO_RECOVERY_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
ARTIFACT_DIR="${QEO_RECOVERY_ARTIFACT_DIR:-.tmp/qeo-db-recovery}"

phase() { printf '\n==> %s\n' "$1"; }
fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }

[[ "$LOCAL_DB_URL" != *"$PRODUCTION_PROJECT_REF"* ]] || fail "production project ref is forbidden"
[[ "$LOCAL_DB_URL" == *"127.0.0.1:54322"* || "$LOCAL_DB_URL" == *"localhost:54322"* ]] \
  || fail "recovery rehearsal must target local Supabase port 54322"
```

Do not add destructive execution yet.

- [ ] **Step 4: Run safety tests and verify GREEN**

Run: `node --test tests/db-recovery-rehearsal.test.ts`

Expected: PASS for the initial guard contract.

- [ ] **Step 5: Commit the safety guard**

```bash
git add scripts/db/rehearse-destructive-recovery.sh tests/db-recovery-rehearsal.test.ts
git commit -m "test(db): lock recovery rehearsal safety guard"
```

---

### Task 2: Add representative synthetic fixture and baseline capture

**Files:**
- Create: `scripts/db/recovery/seed.sql`
- Create: `scripts/db/recovery/capture-baseline.sql`
- Modify: `tests/db-recovery-rehearsal.test.ts`

**Interfaces:**
- `seed.sql` inserts deterministic synthetic rows only.
- `capture-baseline.sql` emits deterministic rows suitable for diffing before/after restore.

- [ ] **Step 1: Add RED tests for fixture coverage**

Assert the seed mentions all mandatory representative classes:

```ts
const seed = readFileSync("scripts/db/recovery/seed.sql", "utf8")
assert.match(seed, /insights_stock_ratings/i)
assert.match(seed, /score_4m/i)
assert.match(seed, /kfsp_score_4m/i)
assert.match(seed, /wyckoff_universe_memberships/i)
```

Also require `capture-baseline.sql` to inspect `information_schema.columns`, `pg_policies`, and `information_schema.table_privileges`.

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/db-recovery-rehearsal.test.ts`

Expected: FAIL because fixture SQL files do not exist.

- [ ] **Step 3: Implement deterministic synthetic seed**

Use existing schema column requirements from current migrations. Before finalizing inserts, inspect the actual table definitions on the implementation branch and provide every required non-null field.

Required semantic fixture values:

```text
Synthetic ticker: QEO
Legacy score_4m = 77.7
Canonical kfsp_score_4m = 77.7
Synthetic legacy membership ticker = QEO
No production UUID/user row is reused.
```

If `wyckoff_universe_memberships` requires a run/effective-date relation, create the minimum synthetic parent row first using deterministic UUIDs reserved for this local rehearsal.

Optional extra coverage, if current schema makes it straightforward without introducing unrelated setup:

- `portfolio_transactions.target_price` + `target_price_1` parity;
- `portfolio_transactions.stop_loss` + `stop_loss_1` parity;
- `market_ai_conclusions.lease_until` + `lease_expires_at` semantics.

- [ ] **Step 4: Implement baseline capture**

`capture-baseline.sql` must output sorted, deterministic contracts for:

```sql
-- Representative row values/counts.
-- Existence/type/nullability/default of score_4m and kfsp_score_4m.
-- Existence of wyckoff_universe_memberships.
-- PK/FK/UNIQUE/CHECK constraints for covered objects.
-- indexes on covered objects.
-- RLS enabled state from pg_class.
-- policies from pg_policies.
-- table privileges for anon/authenticated/service_role where applicable.
-- function/view signatures that reference covered objects when present.
-- custom enum/type names used by covered objects when present.
```

Use stable ordering in every query.

- [ ] **Step 5: Run static tests**

Run: `node --test tests/db-recovery-rehearsal.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit fixture/baseline**

```bash
git add scripts/db/recovery/seed.sql scripts/db/recovery/capture-baseline.sql tests/db-recovery-rehearsal.test.ts
git commit -m "test(db): add synthetic recovery rehearsal fixture"
```

---

### Task 3: Add representative destructive SQL and prove the destroyed state

**Files:**
- Create: `scripts/db/recovery/destructive.sql`
- Create: `scripts/db/recovery/assert-destroyed.sql`
- Modify: `tests/db-recovery-rehearsal.test.ts`

**Interfaces:**
- `destructive.sql` is executed only by the guarded local harness.
- `assert-destroyed.sql` raises an exception unless destructive effects are present.

- [ ] **Step 1: Add RED tests requiring both destructive classes**

```ts
const destructive = readFileSync("scripts/db/recovery/destructive.sql", "utf8")
assert.match(destructive, /alter table public\.insights_stock_ratings\s+drop column/i)
assert.match(destructive, /score_4m/i)
assert.match(destructive, /drop table\s+(if exists\s+)?public\.wyckoff_universe_memberships/i)
```

Require `assert-destroyed.sql` to query both `information_schema.columns` and `to_regclass`/catalog existence.

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/db-recovery-rehearsal.test.ts`

Expected: FAIL because destructive assertion files do not exist.

- [ ] **Step 3: Implement local-only representative destructive SQL**

The SQL should be deliberately small:

```sql
alter table public.insights_stock_ratings
  drop column if exists score_4m;

drop table if exists public.wyckoff_universe_memberships cascade;
```

The use of `cascade` is acceptable only inside the disposable local rehearsal because restore parity subsequently proves dependent object recovery. It must never be promoted into an active production migration by this issue.

- [ ] **Step 4: Implement destructive-state assertions**

Use PL/pgSQL `do $$ ... $$` blocks that raise on false positives:

```sql
-- raise if score_4m still exists
-- raise if to_regclass('public.wyckoff_universe_memberships') is not null
```

- [ ] **Step 5: Run static tests and commit**

```bash
node --test tests/db-recovery-rehearsal.test.ts
git add scripts/db/recovery/destructive.sql scripts/db/recovery/assert-destroyed.sql tests/db-recovery-rehearsal.test.ts
git commit -m "test(db): prove representative destructive state"
```

---

### Task 4: Implement backup validation, destructive execution, restore, and parity

**Files:**
- Modify: `scripts/db/rehearse-destructive-recovery.sh`
- Create: `scripts/db/recovery/assert-restored.sql`
- Modify: `tests/db-recovery-rehearsal.test.ts`

**Interfaces:**
- Produces full rehearsal phases: setup → reset → seed → baseline → backup → validate backup → destroy → assert destroyed → restore → assert restored.

- [ ] **Step 1: Add RED static tests for phase ordering**

Require the harness source to contain these phase markers in this strict order:

```text
local environment validation
clean migration replay
synthetic seed
baseline capture
backup
backup validation
destructive rehearsal
assert destructive state
restore
restored parity
```

Implement the test by comparing `indexOf` positions and asserting each is greater than the previous marker.

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/db-recovery-rehearsal.test.ts`

Expected: FAIL because the full orchestration is not implemented.

- [ ] **Step 3: Implement local Supabase setup/reset**

Use:

```bash
npx supabase start
npx supabase db reset
```

`db reset` must replay only `supabase/migrations`; pending migrations stay excluded by directory placement.

- [ ] **Step 4: Seed and capture baseline**

Use the local DB URL only:

```bash
psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f scripts/db/recovery/seed.sql
psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -X -At -f scripts/db/recovery/capture-baseline.sql > "$ARTIFACT_DIR/baseline.txt"
```

Assert `baseline.txt` is non-empty.

- [ ] **Step 5: Create and validate backup before destructive SQL**

Prefer custom-format backup:

```bash
pg_dump --dbname="$LOCAL_DB_URL" --format=custom --file="$ARTIFACT_DIR/pre-destructive.dump"
test -s "$ARTIFACT_DIR/pre-destructive.dump" || fail "backup artifact is empty"
pg_restore --list "$ARTIFACT_DIR/pre-destructive.dump" > "$ARTIFACT_DIR/backup.list"
test -s "$ARTIFACT_DIR/backup.list" || fail "backup catalog validation failed"
```

Only after both checks pass may the harness execute `destructive.sql`.

- [ ] **Step 6: Execute destructive SQL and prove it happened**

```bash
psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f scripts/db/recovery/destructive.sql
psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f scripts/db/recovery/assert-destroyed.sql
```

- [ ] **Step 7: Restore into the same disposable local database**

Reset the local database to an empty/restorable state without touching production. Use local Postgres commands:

```bash
psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -c "drop schema public cascade; create schema public;"
pg_restore --dbname="$LOCAL_DB_URL" --clean --if-exists --no-owner --no-privileges "$ARTIFACT_DIR/pre-destructive.dump"
```

If restore ordering conflicts with Supabase-managed schemas/roles, switch the backup scope to `--schema=public` and keep role/grant/RLS assertions within public application-owned objects. Do not broaden to hosted production.

- [ ] **Step 8: Implement restored parity assertions**

`assert-restored.sql` must raise unless all mandatory invariants hold:

```text
score_4m exists again with expected type
kfsp_score_4m exists
QEO synthetic row contains 77.7 in both columns
wyckoff_universe_memberships exists again
QEO synthetic membership row is restored
covered constraints/indexes exist
RLS state matches expected baseline
covered grants/policies exist
covered functions/views/types needed by the fixture exist
```

After SQL assertions, recapture:

```bash
psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -X -At -f scripts/db/recovery/capture-baseline.sql > "$ARTIFACT_DIR/restored.txt"
diff -u "$ARTIFACT_DIR/baseline.txt" "$ARTIFACT_DIR/restored.txt"
```

The textual diff is the final broad parity guard; SQL assertions provide clearer failure messages for core invariants.

- [ ] **Step 9: Run static tests and commit orchestration**

```bash
node --test tests/db-recovery-rehearsal.test.ts
git add scripts/db/rehearse-destructive-recovery.sh scripts/db/recovery/assert-restored.sql tests/db-recovery-rehearsal.test.ts
git commit -m "feat(db): rehearse destructive recovery locally"
```

---

### Task 5: Add package scripts and execute the actual rehearsal twice

**Files:**
- Modify: `package.json`
- Modify: `tests/db-recovery-rehearsal.test.ts`

**Interfaces:**
- Produces: `pnpm db:recovery:rehearse` and `pnpm test:db-recovery`.

- [ ] **Step 1: Add package scripts**

```json
"db:recovery:rehearse": "bash scripts/db/rehearse-destructive-recovery.sh",
"test:db-recovery": "node --test tests/db-recovery-rehearsal.test.ts"
```

Do not add the full Docker-backed rehearsal to `verify:build`; it is a release/safety gate, not a lightweight build test. Add only `test:db-recovery` to normal source validation if runtime remains small.

- [ ] **Step 2: Verify local prerequisites explicitly**

Run:

```bash
docker version
npx supabase --version
pg_dump --version
pg_restore --version
psql --version
```

Required: Docker responds; PostgreSQL client major version can read/write the local Postgres 17 database; Supabase CLI can start the local stack.

If PostgreSQL client binaries are unavailable on the host, run equivalent `pg_dump`, `pg_restore`, and `psql` commands inside the local Supabase database container rather than installing unreviewed system packages. Keep the same artifact/parity contract.

- [ ] **Step 3: Run static harness tests**

```bash
pnpm test:db-recovery
```

Expected: PASS.

- [ ] **Step 4: Execute the actual local rehearsal**

```bash
pnpm db:recovery:rehearse
```

Expected terminal phase result:

```text
recovery rehearsal: PASS
```

Expected artifacts under `.tmp/qeo-db-recovery/`:

```text
baseline.txt
pre-destructive.dump
backup.list
restored.txt
```

- [ ] **Step 5: Execute a second clean rehearsal**

Run again:

```bash
pnpm db:recovery:rehearse
```

Expected: PASS again, proving the procedure is repeatable and not dependent on one dirty local state.

- [ ] **Step 6: Commit package integration**

```bash
git add package.json tests/db-recovery-rehearsal.test.ts
git commit -m "chore(db): expose recovery rehearsal gate"
```

---

### Task 6: Write the reusable recovery runbook with actual evidence

**Files:**
- Modify or create after fetch: `docs/db/QEO-26_RECOVERY_REHEARSAL.md`

**Interfaces:**
- Produces operator evidence consumed by QEO-18/QEO-19/QEO-20/QEO-27.

- [ ] **Step 1: Fetch the current runbook first**

If the file already exists from QEO-17, preserve its valid safety rationale and replace any “blocked pending hosted branch” statement with the approved local rehearsal approach only after the actual local test passes.

- [ ] **Step 2: Document prerequisites and forbidden target**

Include:

```md
Production project ref `glwhhrmejlonhyorvtzm` is forbidden.
The default target is local Postgres on `127.0.0.1:54322` from `supabase/config.toml`.
No production rows are copied; fixture data is synthetic.
```

- [ ] **Step 3: Document the exact command and phases**

```bash
pnpm test:db-recovery
pnpm db:recovery:rehearse
```

Document each phase, artifact path, and the requirement that backup validation occurs before destructive SQL.

- [ ] **Step 4: Record actual evidence from both successful runs**

Record:

- date/time;
- Supabase CLI version;
- Docker version;
- local Postgres version;
- migration replay result;
- backup artifact size/checksum (`sha256sum .tmp/qeo-db-recovery/pre-destructive.dump`);
- destructive-state assertion result;
- restore/parity result;
- second-run result.

Do not claim a PASS before these values are observed.

- [ ] **Step 5: Explain downstream usage**

State that QEO-18/QEO-19/QEO-20/QEO-27 must still satisfy their own consumer/parity gates; QEO-26 only proves the recovery mechanism. Moving the quarantined rating migration into active migrations is a separate downstream action.

- [ ] **Step 6: Commit the runbook**

```bash
git add docs/db/QEO-26_RECOVERY_REHEARSAL.md
git commit -m "docs(db): record destructive recovery rehearsal"
```

---

### Task 7: Final QEO-26 verification and PR evidence

**Files:**
- No new implementation files unless verification reveals a defect.

- [ ] **Step 1: Run static and project verification**

```bash
pnpm test:db-recovery
pnpm verify:build
pnpm typecheck
```

Expected: all exit `0`.

- [ ] **Step 2: Run the release safety gate once more from a clean local state**

```bash
npx supabase stop --no-backup || true
pnpm db:recovery:rehearse
```

Expected: PASS from a clean local start.

- [ ] **Step 3: Inspect diff and ensure no production rollout occurred**

```bash
git diff --check main...HEAD
git diff --stat main...HEAD
```

Expected:

- no whitespace errors;
- no destructive SQL moved from `supabase/pending-migrations` into `supabase/migrations`;
- no production credentials/project URL added;
- only local rehearsal tooling/docs/tests/package changes.

- [ ] **Step 4: Create QEO-26 PR**

PR title:

```text
chore(db): prove destructive backup restore recovery
```

PR body must include:

- exact local rehearsal command;
- two successful rehearsal results;
- backup checksum/size evidence;
- restored baseline diff result;
- `pnpm verify:build` + `pnpm typecheck` result;
- explicit statement that production was not targeted or mutated;
- explicit statement that hosted Supabase branch spend was not required.

- [ ] **Step 5: Update QEO-26 Linear issue only after actual rehearsal evidence exists**

Attach branch, commits, PR, tool versions, backup evidence, destructive assertions, restore parity results, and clean rerun. Mark Done only after the acceptance criteria and PR review are complete.
