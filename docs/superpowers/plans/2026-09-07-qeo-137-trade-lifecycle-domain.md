# QEO-137 Trade Lifecycle Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a normalized logical Trade lifecycle domain, additive Supabase schema, ownership-safe fill linking, stop/journal history, and deterministic read model without breaking the existing AVCO transaction accounting path.

**Architecture:** `portfolio_transactions` remains the accounting/fill source of truth. QEO-137 adds `portfolio_trades`, stop events, journal entries, and a narrow `modules/portfolio/trades/*` server/domain boundary. Legacy transactions keep `trade_id = null`; no historical grouping or risk/psychology data is fabricated.

**Tech Stack:** Next.js 16, TypeScript 5.7, Node test runner, Supabase/PostgreSQL 17, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-07-qeo-137-trade-lifecycle-domain-design.md`

## Global Constraints

- Keep `portfolio_transactions` as canonical AVCO accounting/fill source of truth.
- All schema work is additive; no legacy transaction columns are dropped or rewritten.
- `Transaction != Trade` is a hard invariant.
- Legacy rows may remain `trade_id = null`; never auto-group them in QEO-137.
- Never fabricate historical stop, risk snapshot, psychology, timestamps, or trade grouping.
- Initial trade-plan/risk snapshot fields freeze after `planned -> open` through normal domain APIs.
- Current/trailing stops are event history; they never overwrite `initial_stop_loss_exit`.
- Money Management Plan persistence belongs to QEO-138 and is not created here.
- Active Risk aggregation belongs to QEO-141; Scorecard belongs to QEO-142; AI belongs to QEO-145.
- All new user-owned tables require RLS and relational ownership integrity.
- UI must not call Supabase directly for the new Trade domain.
- Existing `/api/portfolio/[id]/transactions` remains backward compatible.

---

## File Structure

### Create

- `supabase/migrations/20260907100000_qeo137_trade_lifecycle_domain.sql` — additive schema, constraints, indexes, RLS.
- `modules/portfolio/trades/types.ts` — canonical domain DTOs/enums.
- `modules/portfolio/trades/validation.ts` — pure validation/lifecycle helpers.
- `modules/portfolio/trades/server.ts` — authenticated persistence functions.
- `modules/portfolio/trades/read-model.ts` — deterministic AI-ready/read-model assembly.
- `modules/portfolio/trades/README.md` — module contract and ownership rules.
- `app/api/portfolio/[id]/trades/route.ts` — list/create thin adapter.
- `app/api/portfolio/[id]/trades/[tradeId]/route.ts` — get/update/transition thin adapter.
- `app/api/portfolio/[id]/trades/[tradeId]/fills/route.ts` — attach/detach fills.
- `app/api/portfolio/[id]/trades/[tradeId]/stops/route.ts` — list/add stop events.
- `app/api/portfolio/[id]/trades/[tradeId]/journal/route.ts` — list/add journal entries.
- `tests/portfolio/qeo137-trade-domain-schema.test.ts` — SQL contract tests.
- `tests/portfolio/qeo137-trade-domain.test.ts` — lifecycle/validation/read-model tests.
- `tests/portfolio/qeo137-trade-api-contract.test.ts` — API/module source contracts and transaction compatibility.
- `.github/workflows/qeo137-preprod.yml` — dedicated RED/GREEN + DB replay/types gate for this nested test set.

### Modify

- `app/api/portfolio/[id]/transactions/route.ts` — optional `trade_id` read/write with validation delegated to Trade server path when supplied.
- `app/api/portfolio/[id]/transactions/[txId]/route.ts` — preserve/validate optional `trade_id` on edits without changing accounting values.
- `modules/portfolio/pnl.ts` — extend `RawTransaction` with optional `trade_id`; do not alter AVCO math.
- `modules/shared/supabase/database.types.ts` — regenerate from the migrated schema after DB migration is accepted.
- `modules/portfolio/README.md` — document Trade submodule and transaction accounting boundary.

---

### Task 1: RED — lock the database contract before migration SQL

**Files:**
- Create: `tests/portfolio/qeo137-trade-domain-schema.test.ts`
- Create: `.github/workflows/qeo137-preprod.yml`

**Interfaces:**
- Consumes: approved QEO-137 spec.
- Produces: executable schema contract that fails while the migration does not exist.

- [ ] **Step 1: Write the failing schema contract**

The test reads the one expected QEO-137 migration and asserts:

```ts
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

const migrationUrl = new URL(
  "../../supabase/migrations/20260907100000_qeo137_trade_lifecycle_domain.sql",
  import.meta.url,
)

test("QEO-137 migration exists", () => {
  assert.equal(existsSync(migrationUrl), true)
})

test("QEO-137 creates normalized Trade tables and nullable fill link", () => {
  const sql = readFileSync(migrationUrl, "utf8")
  assert.match(sql, /create table public\.portfolio_trades/i)
  assert.match(sql, /create table public\.portfolio_trade_stop_events/i)
  assert.match(sql, /create table public\.portfolio_trade_journal_entries/i)
  assert.match(sql, /add column trade_id uuid/i)
})
```

Add contract assertions for:

- `portfolios(id,user_id)` unique ownership identity;
- Trade composite identity `(id, portfolio_id, user_id, ticker)`;
- transaction composite FK to Trade;
- new-table RLS;
- `auth.uid()` ownership policies;
- no update/delete policy for stop events;
- lifecycle/status checks;
- no statement updating/backfilling existing transaction risk fields.

- [ ] **Step 2: Add QEO-137 PR workflow and observe RED**

Workflow commands:

```bash
corepack enable
pnpm install --frozen-lockfile
node --test tests/portfolio/qeo137-trade-domain-schema.test.ts
```

Expected: FAIL because `20260907100000_qeo137_trade_lifecycle_domain.sql` does not exist.

- [ ] **Step 3: Record RED evidence in PR/Linear**

Store the failing workflow run/commit SHA. Do not write migration production code before this RED is observed.

---

### Task 2: GREEN — additive Supabase schema

**Files:**
- Create: `supabase/migrations/20260907100000_qeo137_trade_lifecycle_domain.sql`
- Test: `tests/portfolio/qeo137-trade-domain-schema.test.ts`

**Interfaces:**
- Produces tables `portfolio_trades`, `portfolio_trade_stop_events`, `portfolio_trade_journal_entries` and nullable `portfolio_transactions.trade_id`.

- [ ] **Step 1: Implement minimum SQL needed by the failing contract**

Required structural contract:

```sql
begin;

alter table public.portfolios
  add constraint portfolios_id_user_id_key unique (id, user_id);

create table public.portfolio_trades (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  mode text not null default 'live' check (mode in ('live','paper')),
  status text not null default 'planned'
    check (status in ('planned','open','partially_closed','closed','cancelled')),
  trade_type text check (trade_type is null or trade_type in ('day','position')),
  timeframe text,
  system_tags text[] not null default '{}',
  setup_tags text[] not null default '{}',
  planned_entry numeric(15,2) check (planned_entry is null or planned_entry > 0),
  initial_stop_loss_exit numeric(15,2) check (initial_stop_loss_exit is null or initial_stop_loss_exit > 0),
  initial_account_equity numeric(18,2) check (initial_account_equity is null or initial_account_equity >= 0),
  initial_risk_percent numeric(7,4) check (initial_risk_percent is null or (initial_risk_percent >= 0 and initial_risk_percent <= 100)),
  initial_risk_amount numeric(18,2) check (initial_risk_amount is null or initial_risk_amount >= 0),
  initial_risk_amount_per_share numeric(15,2) check (initial_risk_amount_per_share is null or initial_risk_amount_per_share > 0),
  planned_trade_size numeric(15,4) check (planned_trade_size is null or planned_trade_size > 0),
  planned_position_value numeric(18,2) check (planned_position_value is null or planned_position_value >= 0),
  estimated_commission numeric(18,2) check (estimated_commission is null or estimated_commission >= 0),
  slippage_allowance numeric(18,2) check (slippage_allowance is null or slippage_allowance >= 0),
  opened_at timestamptz,
  closed_at timestamptz,
  pre_trade_plan text,
  thesis_summary text,
  final_review text,
  lesson_learned text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, portfolio_id, user_id, ticker),
  foreign key (portfolio_id, user_id)
    references public.portfolios(id, user_id) on delete cascade,
  check (
    (status = 'planned' and opened_at is null and closed_at is null) or
    (status = 'cancelled' and opened_at is null and closed_at is null) or
    (status in ('open','partially_closed') and opened_at is not null and closed_at is null) or
    (status = 'closed' and opened_at is not null and closed_at is not null and closed_at >= opened_at)
  )
);
```

Then:

- add nullable `portfolio_transactions.trade_id`;
- add ownership-safe composite FK `(trade_id,portfolio_id,user_id,ticker)`;
- create stop/journal tables with the same composite Trade FK;
- add required indexes;
- attach `qeo_touch_updated_at()` to mutable Trade/journal rows;
- enable RLS and grants/policies;
- expose stop events as SELECT + INSERT only for authenticated users; no UPDATE/DELETE API policy.

- [ ] **Step 2: Run dedicated schema test and confirm GREEN**

Expected: schema contract passes.

- [ ] **Step 3: Add DB replay/drift commands to QEO-137 workflow**

Add:

```bash
pnpm db:replay:verify
pnpm db:drift:verify
```

Do not apply production migration until local/CI replay succeeds.

---

### Task 3: RED/GREEN — pure lifecycle and validation domain

**Files:**
- Create: `tests/portfolio/qeo137-trade-domain.test.ts`
- Create: `modules/portfolio/trades/types.ts`
- Create: `modules/portfolio/trades/validation.ts`

**Interfaces:**
- Produces:
  - `TradeMode`, `TradeStatus`, `TradeType`, `TradeStopType`, `TradeJournalPhase`;
  - `canTransitionTrade(from,to): boolean`;
  - `assertTradeTransition(from,to): void`;
  - `normalizeTradeCreateInput(input)`;
  - `normalizePlannedTradePatch(input)`;
  - `normalizeStopEventInput(input)`;
  - `normalizeJournalEntryInput(input)`;
  - `assertFrozenTradeFieldsUnchanged(existing, patch)`.

- [ ] **Step 1: Write lifecycle tests first**

Expected allowed matrix:

```text
planned -> open
planned -> cancelled
open -> partially_closed
open -> closed
partially_closed -> closed
```

Everything else fails.

- [ ] **Step 2: Observe RED**

Run:

```bash
node --test tests/portfolio/qeo137-trade-domain.test.ts
```

Expected: module-not-found / missing exported functions.

- [ ] **Step 3: Implement minimal pure domain code**

Validation requirements:

- uppercase ticker and enforce `^[A-Z0-9]{2,12}$`;
- UUID validation for IDs;
- enum membership;
- numeric fields finite and within schema bounds;
- text bounds (`pre_trade_plan`, thesis/review/lesson <= 10,000; event note <= 5,000; signal/reason/override <= 2,000);
- tags <= 20 items and each <= 50 chars;
- frozen initial fields reject changes once status is not `planned`.

- [ ] **Step 4: Confirm GREEN**

Add workflow invocation for `qeo137-trade-domain.test.ts`.

---

### Task 4: RED/GREEN — deterministic read-model completeness semantics

**Files:**
- Modify: `tests/portfolio/qeo137-trade-domain.test.ts`
- Create: `modules/portfolio/trades/read-model.ts`

**Interfaces:**
- Produces `buildTradeReadModel({ trade, fills, stopEvents, journalEntries })`.

- [ ] **Step 1: Write read-model tests first**

Cases:

- no initial stop + no stop events => `stopState: "unknown"`, never numeric zero;
- initial stop only => latest stop is initial stop;
- later stop event => latest event by `(effective_at, created_at)` wins;
- initial-risk completeness => `available | partial | unknown`;
- journal => `available | unavailable` in QEO-137;
- fills remain grouped under one logical Trade;
- legacy `trade_id = null` is not silently assigned.

- [ ] **Step 2: Observe RED**

Expected missing read-model implementation.

- [ ] **Step 3: Implement minimal pure assembler**

No React, no market-price query, no AI call, no Money Management Plan dependency.

- [ ] **Step 4: Confirm GREEN**

---

### Task 5: RED/GREEN — authenticated persistence module

**Files:**
- Create: `modules/portfolio/trades/server.ts`
- Create: `modules/portfolio/trades/README.md`
- Modify: `modules/portfolio/README.md`
- Create/modify: `tests/portfolio/qeo137-trade-api-contract.test.ts`

**Interfaces:**
- Produces:

```ts
createTrade(context, portfolioId, input)
updatePlannedTrade(context, portfolioId, tradeId, patch)
transitionTrade(context, portfolioId, tradeId, targetStatus, patch?)
getTrade(context, portfolioId, tradeId)
listTrades(context, portfolioId)
attachFillToTrade(context, portfolioId, tradeId, transactionId)
detachFillFromTrade(context, portfolioId, tradeId, transactionId)
addStopEvent(context, portfolioId, tradeId, input)
listStopEvents(context, portfolioId, tradeId)
addJournalEntry(context, portfolioId, tradeId, input)
listJournalEntries(context, portfolioId, tradeId)
readPortfolioTradeContext(context, portfolioId)
```

- [ ] **Step 1: Write source-contract tests before server implementation**

Assert the server module:

- imports `server-only`;
- accepts `ServerAuthContext` rather than creating admin/service clients;
- scopes every query by `user_id` and `portfolio_id`;
- validates ticker/portfolio relationship before fill attachment;
- never updates transaction price/qty/fee/date when attaching;
- never exposes stop update/delete function;
- calls frozen-field validation before non-planned updates.

- [ ] **Step 2: Observe RED**

- [ ] **Step 3: Implement minimum persistence module**

Use explicit select-field strings; avoid `select('*')` for canonical responses.

`transitionTrade` must set timestamps deterministically:

- `open`: `opened_at = provided timestamp ?? now`, `closed_at = null`;
- `partially_closed`: preserve `opened_at`, no close time;
- `closed`: `closed_at = provided timestamp ?? now`;
- `cancelled`: no open/close timestamps.

- [ ] **Step 4: Confirm GREEN**

---

### Task 6: RED/GREEN — thin API routes

**Files:**
- Create the five Trade route files listed above.
- Modify: `tests/portfolio/qeo137-trade-api-contract.test.ts`.

**Interfaces:**
- Routes authenticate with `requireApiUser()` then delegate to `modules/portfolio/trades/server.ts`.

- [ ] **Step 1: Write route-contract tests first**

Assert:

- route files do not call `.from("portfolio_trades")` directly;
- every route calls `requireApiUser()`;
- handlers return `Cache-Control: no-store`;
- malformed UUIDs return 400;
- missing domain objects map to 404;
- invalid transitions/input map to 400/409 instead of generic 500.

- [ ] **Step 2: Observe RED**

- [ ] **Step 3: Add thin adapters only**

Do not duplicate domain validation in React/UI.

- [ ] **Step 4: Confirm GREEN**

---

### Task 7: RED/GREEN — existing transaction API compatibility

**Files:**
- Modify: `app/api/portfolio/[id]/transactions/route.ts`
- Modify: `app/api/portfolio/[id]/transactions/[txId]/route.ts`
- Modify: `modules/portfolio/pnl.ts`
- Modify: `tests/portfolio/qeo137-trade-api-contract.test.ts`
- Existing regression: `tests/portfolio-pnl.test.ts`

**Interfaces:**
- Existing transaction payload remains compatible; `trade_id` is optional/nullable.

- [ ] **Step 1: Add failing compatibility tests**

Assert:

- `RawTransaction` accepts optional `trade_id` but AVCO math does not read it;
- transaction SELECT fields include `trade_id`;
- legacy POST without `trade_id` remains valid;
- supplied `trade_id` is attached only through ownership/ticker-safe domain logic, not arbitrary raw insert;
- transaction edit cannot reassign to another ticker Trade.

- [ ] **Step 2: Observe RED**

- [ ] **Step 3: Implement minimal compatibility changes**

No P&L formula change.

- [ ] **Step 4: Run**

```bash
node --test tests/portfolio/qeo137-trade-api-contract.test.ts tests/portfolio-pnl.test.ts
```

Expected: all GREEN.

---

### Task 8: Apply additive migration, generate types, and prove production-safe schema

**Files:**
- Modify: `modules/shared/supabase/database.types.ts`
- Workflow: `.github/workflows/qeo137-preprod.yml`

**Interfaces:**
- Production Supabase receives the exact committed additive migration after replay/drift gates are green.

- [ ] **Step 1: Verify migration against a disposable/local DB in CI**

Required before production:

```bash
pnpm db:replay:verify
pnpm db:drift:verify
pnpm db:types:verify
```

- [ ] **Step 2: Apply exact committed migration to qeoindex Supabase**

No manual SQL variant. Record production migration version.

- [ ] **Step 3: Run Supabase security/performance advisors**

Review all new notices caused by QEO-137; fix material RLS/index issues before proceeding.

- [ ] **Step 4: Generate canonical TypeScript DB types**

Use the migrated schema and commit the generated `database.types.ts`.

- [ ] **Step 5: Read-only production acceptance**

Verify:

- existing `portfolios` and `portfolio_transactions` row counts unchanged;
- legacy transaction `trade_id` is null unless explicitly set after migration;
- three new tables exist with RLS;
- ownership FKs/indexes exist;
- no historical transaction target/stop/note/tag field was rewritten.

---

### Task 9: Full verification and release gate

**Files:**
- Update PR/Linear evidence only; no new behavior unless a failing test demands it.

- [ ] **Step 1: Run dedicated QEO-137 workflow on final head**

Required:

```bash
node --test tests/portfolio/qeo137-trade-domain-schema.test.ts
node --test tests/portfolio/qeo137-trade-domain.test.ts
node --test tests/portfolio/qeo137-trade-api-contract.test.ts
node --test tests/portfolio-pnl.test.ts
pnpm verify:pr
pnpm db:replay:verify
pnpm db:drift:verify
pnpm db:types:verify
```

- [ ] **Step 2: Inspect PR diff**

Confirm no UI/theme change, no unrelated refactor, no Money Management Plan implementation, no AI code, no legacy grouping.

- [ ] **Step 3: Record final evidence**

Add final head SHA, workflow run IDs, migration version, production row-count checks, and Supabase advisor result to QEO-137.

- [ ] **Step 4: Keep PR draft until all acceptance criteria are green**

Only then use the branch-finishing workflow and mark QEO-137 Done after merge/production acceptance.

---

## Self-Review

- Spec coverage: migration, Trade/fill distinction, multi-fill grouping, stop history, journal history, lifecycle, frozen initial risk snapshot, RLS/ownership, API boundary, legacy compatibility, deterministic read model, AI-ready completeness semantics, and production acceptance are each assigned to explicit tasks.
- Scope guard: Money Management Plan, position sizing, Active Risk, Scorecard, migration grouping heuristics, and AI are explicitly excluded.
- Type consistency: `portfolio_id`, `user_id`, `ticker`, `trade_id` are carried consistently across Trade/fill/event ownership boundaries.
- Unknown semantics: missing stop/risk/journal data remains unknown/unavailable, never zero or synthesized.
- TDD: each behavior task starts with a failing test and requires observed RED before production code.
