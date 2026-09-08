# QEO-140 Stop Event ↔ Exit Fill Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add append-only, database-enforced links from Trade stop events to the actual sell fill(s) that executed them and expose that evidence in the canonical Trade read model.

**Architecture:** Introduce `portfolio_trade_stop_exit_fills` as an append-only relation table. Composite foreign keys enforce same Trade/portfolio/user/ticker and sell-only linkage; server APIs validate clear domain errors; the Trade read model enriches stop events with explicit `linkedExitFills[]` while AVCO, fill history and close review remain unchanged.

**Tech Stack:** PostgreSQL/Supabase migrations + RLS, TypeScript, Next.js Route Handlers, Node test runner, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-08-qeo-140-stop-exit-fill-link-design.md`

## Global Constraints

- `portfolio_transactions` remains the canonical AVCO/accounting source of truth.
- Stop events and stop/fill links are append-only.
- One stop event may link to N sell fills; one sell fill may link to at most one stop event.
- No backfill or inferred legacy matching.
- `trade_id IS NULL` legacy transactions cannot be linked.
- No QEO-141 Active Risk work.
- Do not modify `modules/portfolio/pnl.ts`, `modules/portfolio/trades/review.ts`, or `modules/portfolio/trades/fill-history.ts`.

---

## File Structure

- Create `supabase/migrations/20260908064000_qeo140_stop_exit_fill_links.sql` — relational integrity, grants/RLS and indexes.
- Modify `tests/portfolio/qeo137-trade-domain-schema.test.ts` — schema RED/GREEN contract.
- Modify `modules/portfolio/trades/server.ts` — owned stop loader, link/list server operations, context relation query.
- Modify `tests/portfolio/qeo137-trade-api-contract.test.ts` — server/API boundary contract.
- Create `app/api/portfolio/[id]/trades/[tradeId]/stops/[stopEventId]/fills/route.ts` — authenticated GET/POST adapter.
- Modify `modules/portfolio/trades/read-model.ts` — deterministic stop enrichment only.
- Modify `tests/portfolio/qeo137-trade-read-model.test.ts` — one-to-many linkage and deterministic ordering.
- Modify `.github/workflows/qeo137-preprod.yml` only if a new standalone test file is created and not already included.
- Regenerate `modules/shared/supabase/database.types.ts` from zero-state schema.

---

### Task 1: Database integrity for append-only stop-exit links

**Files:**
- Create: `supabase/migrations/20260908064000_qeo140_stop_exit_fill_links.sql`
- Test: `tests/portfolio/qeo137-trade-domain-schema.test.ts`

**Interfaces:**
- Produces table `portfolio_trade_stop_exit_fills` and composite identities consumed by server code.
- No application interface changes yet.

- [ ] **Step 1: Write the failing schema contract**

Add assertions requiring:

```ts
assert.match(source, /create table public\.portfolio_trade_stop_exit_fills/)
assert.match(source, /unique \(transaction_id\)/)
assert.match(source, /check \(exit_action = 'sell'\)/)
assert.match(source, /portfolio_trade_stop_events_identity_key/)
assert.match(source, /portfolio_transactions_stop_exit_identity_key/)
assert.match(source, /foreign key \(stop_event_id, trade_id, portfolio_id, user_id, ticker\)/)
assert.match(source, /foreign key \(transaction_id, trade_id, portfolio_id, user_id, ticker, exit_action\)/)
assert.match(source, /grant select, insert on public\.portfolio_trade_stop_exit_fills to authenticated/)
assert.doesNotMatch(source, /grant .*update|grant .*delete/)
```

- [ ] **Step 2: Run RED**

Run:

```bash
node --test tests/portfolio/qeo137-trade-domain-schema.test.ts
```

Expected: FAIL because the QEO-140 migration/table does not exist.

- [ ] **Step 3: Add the migration**

Create the migration with this relational shape:

```sql
begin;

alter table public.portfolio_trade_stop_events
  add constraint portfolio_trade_stop_events_identity_key
  unique (id, trade_id, portfolio_id, user_id, ticker);

alter table public.portfolio_transactions
  add constraint portfolio_transactions_stop_exit_identity_key
  unique (id, trade_id, portfolio_id, user_id, ticker, action);

create table public.portfolio_trade_stop_exit_fills (
  id uuid primary key default gen_random_uuid(),
  stop_event_id uuid not null,
  transaction_id uuid not null,
  trade_id uuid not null,
  portfolio_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  exit_action text not null default 'sell' check (exit_action = 'sell'),
  created_at timestamptz not null default now(),
  unique (stop_event_id, transaction_id),
  unique (transaction_id),
  foreign key (stop_event_id, trade_id, portfolio_id, user_id, ticker)
    references public.portfolio_trade_stop_events(id, trade_id, portfolio_id, user_id, ticker)
    on delete restrict,
  foreign key (transaction_id, trade_id, portfolio_id, user_id, ticker, exit_action)
    references public.portfolio_transactions(id, trade_id, portfolio_id, user_id, ticker, action)
    on delete restrict
);

create index portfolio_trade_stop_exit_fills_stop_fk_idx
  on public.portfolio_trade_stop_exit_fills(stop_event_id, trade_id, portfolio_id, user_id, ticker);
create index portfolio_trade_stop_exit_fills_tx_fk_idx
  on public.portfolio_trade_stop_exit_fills(transaction_id, trade_id, portfolio_id, user_id, ticker, exit_action);
create index portfolio_trade_stop_exit_fills_trade_read_idx
  on public.portfolio_trade_stop_exit_fills(user_id, portfolio_id, trade_id, stop_event_id, created_at);

alter table public.portfolio_trade_stop_exit_fills enable row level security;
revoke all on public.portfolio_trade_stop_exit_fills from anon, authenticated;
grant select, insert on public.portfolio_trade_stop_exit_fills to authenticated;

create policy portfolio_trade_stop_exit_fills_select_own
  on public.portfolio_trade_stop_exit_fills for select to authenticated
  using (user_id = (select auth.uid()));
create policy portfolio_trade_stop_exit_fills_insert_own
  on public.portfolio_trade_stop_exit_fills for insert to authenticated
  with check (user_id = (select auth.uid()));

commit;
```

- [ ] **Step 4: Run schema GREEN**

Run the same Node test. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260908064000_qeo140_stop_exit_fill_links.sql tests/portfolio/qeo137-trade-domain-schema.test.ts
git commit -m "feat(QEO-140): add append-only stop exit fill relation"
```

---

### Task 2: Server domain link contract

**Files:**
- Modify: `modules/portfolio/trades/server.ts`
- Test: `tests/portfolio/qeo137-trade-api-contract.test.ts`

**Interfaces:**
- Consumes QEO-140 relation table from Task 1.
- Produces `linkExitFillToStopEvent(...)` and `listStopExitFillLinks(...)`.

- [ ] **Step 1: Write RED contract**

Require the server source to export:

```ts
linkExitFillToStopEvent
listStopExitFillLinks
```

and require explicit checks equivalent to:

```ts
transaction.trade_id !== tradeId
transaction.action !== "sell"
transaction.ticker !== trade.ticker
EXIT_FILL_ALREADY_LINKED
INVALID_EXIT_FILL_ACTION
```

Also assert no update/delete operation targets `portfolio_trade_stop_exit_fills`.

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo137-trade-api-contract.test.ts
```

Expected: FAIL because the server functions are absent.

- [ ] **Step 3: Implement owned stop loading and link/list functions**

Add constants/types:

```ts
const STOP_EXIT_FILL_LINK_SELECT = "id,stop_event_id,transaction_id,trade_id,portfolio_id,user_id,ticker,exit_action,created_at" as const

type StopExitFillLinkRow = {
  id: string
  stop_event_id: string
  transaction_id: string
  trade_id: string
  portfolio_id: string
  user_id: string
  ticker: string
  exit_action: "sell"
  created_at: string
}
```

Implement a scoped stop loader and:

```ts
export async function linkExitFillToStopEvent(
  context: ServerAuthContext,
  portfolioId: string,
  tradeId: string,
  stopEventId: string,
  transactionId: string,
) {
  const trade = await loadOwnedTrade(context, portfolioId, tradeId)
  await loadOwnedStopEvent(context, portfolioId, tradeId, stopEventId)
  const transaction = await loadOwnedFill(context, portfolioId, transactionId)

  if (transaction.trade_id !== tradeId) {
    throw new TradeDomainError("FILL_NOT_LINKED", "Transaction is not attached to this Trade")
  }
  if (transaction.ticker !== trade.ticker) {
    throw new TradeDomainError("TICKER_MISMATCH", "Transaction ticker does not match Trade ticker")
  }
  if (transaction.action !== "sell") {
    throw new TradeDomainError("INVALID_EXIT_FILL_ACTION", "Only sell transactions may be linked to a stop event")
  }

  const existing = await context.supabase
    .from("portfolio_trade_stop_exit_fills")
    .select(STOP_EXIT_FILL_LINK_SELECT)
    .eq("transaction_id", transactionId)
    .eq("portfolio_id", portfolioId)
    .eq("user_id", context.user.id)
    .maybeSingle()
  if (existing.error) dbFailure("load-stop-exit-fill-link", existing.error)
  if (existing.data) {
    if (existing.data.stop_event_id === stopEventId) return existing.data as StopExitFillLinkRow
    throw new TradeDomainError("EXIT_FILL_ALREADY_LINKED", "Transaction is already linked to another stop event")
  }

  const result = await context.supabase
    .from("portfolio_trade_stop_exit_fills")
    .insert({
      stop_event_id: stopEventId,
      transaction_id: transactionId,
      trade_id: tradeId,
      portfolio_id: portfolioId,
      user_id: context.user.id,
      ticker: trade.ticker,
      exit_action: "sell",
    })
    .select(STOP_EXIT_FILL_LINK_SELECT)
    .single()
  if (result.error || !result.data) dbFailure("link-stop-exit-fill", result.error)
  return result.data as StopExitFillLinkRow
}
```

`listStopExitFillLinks()` must scope `trade_id`, `portfolio_id`, `user_id`, optionally `stop_event_id`, and order by `created_at` then `id`.

- [ ] **Step 4: Run GREEN**

Run API contract and existing lifecycle tests. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add modules/portfolio/trades/server.ts tests/portfolio/qeo137-trade-api-contract.test.ts
git commit -m "feat(QEO-140): link sell fills to stop events"
```

---

### Task 3: Thin authenticated HTTP route

**Files:**
- Create: `app/api/portfolio/[id]/trades/[tradeId]/stops/[stopEventId]/fills/route.ts`
- Modify: `tests/portfolio/qeo137-trade-api-contract.test.ts`

**Interfaces:**
- Consumes Task 2 server functions.
- Produces authenticated GET/POST route only.

- [ ] **Step 1: Extend RED route contract**

Add the route path to the existing route list and assert:

```ts
requireApiUser(
Cache-Control ... no-store
linkExitFillToStopEvent(
listStopExitFillLinks(
```

Assert the route does not call `.from("portfolio_` directly.

- [ ] **Step 2: Run RED**

Expected: FAIL because the route file is absent.

- [ ] **Step 3: Implement route**

Use the existing stops route failure pattern. `POST` parses `{ transaction_id }`; invalid/missing UUID-shaped input is delegated to the server validation path. Return 201 for new/idempotent link result and 200 for GET. Map `EXIT_FILL_ALREADY_LINKED` to 409, `NOT_FOUND` to 404, other domain validation to 400.

Do not add PATCH or DELETE.

- [ ] **Step 4: Run GREEN**

Expected: API boundary test PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/portfolio/[id]/trades/[tradeId]/stops/[stopEventId]/fills/route.ts tests/portfolio/qeo137-trade-api-contract.test.ts
git commit -m "feat(QEO-140): expose stop exit fill link route"
```

---

### Task 4: Deterministic Trade read-model enrichment

**Files:**
- Modify: `modules/portfolio/trades/read-model.ts`
- Modify: `modules/portfolio/trades/server.ts`
- Test: `tests/portfolio/qeo137-trade-read-model.test.ts`

**Interfaces:**
- Consumes relation rows plus canonical fills.
- Produces `TradeReadModel.stopEvents[].linkedExitFills`.

- [ ] **Step 1: Write behavioral RED tests**

Create a Trade with two stop events and three sell fills. Link two fills to one stop and one fill to the second stop. Assert:

```ts
assert.deepEqual(model.stopEvents[0].linkedExitFills.map((fill) => fill.id), ["sell-a", "sell-b"])
assert.deepEqual(model.stopEvents[1].linkedExitFills.map((fill) => fill.id), ["sell-c"])
```

Also add a case where an unlinked stop returns `[]`, and a link referencing a fill not present in the Trade input is ignored rather than fabricated.

Capture the existing `closeReview`, `fillHistory` and `fills` outputs before enrichment and assert they remain unchanged.

- [ ] **Step 2: Run RED**

```bash
node --test tests/portfolio/qeo137-trade-read-model.test.ts
```

Expected: FAIL because `linkedExitFills` is absent.

- [ ] **Step 3: Enrich read-model types and assembly**

Add:

```ts
type StopExitFillLinkReadRow = {
  stop_event_id: string
  transaction_id: string
  trade_id: string
  ticker: string
  created_at: string
}

export type TradeStopEventReadModel = StopReadRow & {
  linkedExitFills: FillReadRow[]
}
```

Update `buildTradeReadModel` input with `stopExitFillLinks: StopExitFillLinkReadRow[] = []`.

Build a `Map<string, FillReadRow>` from `groupedFills`; for each chronological stop, select explicit relation rows for that stop and map only matching canonical fills. Sort linked fills by `transaction_date`, then `created_at`, then `id`.

Do not pass relation rows into `deriveTradeFillHistory()` or `deriveTradeCloseReview()`.

- [ ] **Step 4: Extend canonical server context**

In `readPortfolioTradeContext`, query `portfolio_trade_stop_exit_fills` once for the Trade IDs, scoped to portfolio/user, then pass per-Trade relation rows into `buildTradeReadModel`.

- [ ] **Step 5: Run GREEN + regressions**

Run:

```bash
node --test tests/portfolio/qeo137-trade-read-model.test.ts
node --test tests/portfolio-pnl.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add modules/portfolio/trades/read-model.ts modules/portfolio/trades/server.ts tests/portfolio/qeo137-trade-read-model.test.ts
git commit -m "feat(QEO-140): expose linked exit fills in stop history"
```

---

### Task 5: Full verification and generated types

**Files:**
- Regenerate: `modules/shared/supabase/database.types.ts`
- No other production files unless verification exposes a real defect.

**Interfaces:**
- Final release gate only.

- [ ] **Step 1: Run zero-state database verification**

```bash
supabase start
pnpm db:replay:verify
pnpm db:types:verify
```

If `db:types:verify` produces `artifacts/qeo23/database.types.ts`, replace `modules/shared/supabase/database.types.ts` with that exact generated file; do not hand-edit generated types.

- [ ] **Step 2: Run QEO-137/QEO-138 and accounting regressions**

```bash
node --test tests/portfolio/qeo137-trade-domain-schema.test.ts
node --test tests/portfolio/qeo137-trade-domain.test.ts
node --test tests/portfolio/qeo137-trade-read-model.test.ts
node --test tests/portfolio/qeo137-trade-api-contract.test.ts
node --test tests/portfolio-pnl.test.ts
node --test tests/portfolio/qeo138-*.test.ts
```

- [ ] **Step 3: Run application gates**

```bash
pnpm lint:touched
pnpm typecheck
pnpm build
```

Expected: all PASS.

- [ ] **Step 4: Diff audit**

Confirm:

```bash
git diff main...HEAD -- modules/portfolio/pnl.ts modules/portfolio/trades/review.ts modules/portfolio/trades/fill-history.ts
```

Expected: no diff.

Search the migration/server route for update/delete paths against `portfolio_trade_stop_exit_fills`; expected none.

- [ ] **Step 5: Commit generated types if changed**

```bash
git add modules/shared/supabase/database.types.ts
git commit -m "chore(db): regenerate Supabase types for QEO-140"
```

- [ ] **Step 6: PR exact-head CI**

Require QEO-137 Trade Domain, QEO-138 Risk Plan and Verify to complete successfully on the exact final head before merge.

- [ ] **Step 7: Production acceptance after merge**

Verify Vercel production deployment is READY on the merged SHA, canonical alias `qeoindex.qeoqeo.com` points to that deployment, `/portfolio` returns HTTP 200, and no new runtime error cluster appears for portfolio routes. Do not claim authenticated live relation payload evidence without an authenticated QeoIndex session.

---

## Self-review

- Spec coverage: all approved cardinality, DB integrity, append-only behavior, route, read-model, legacy and regression requirements are assigned to tasks.
- Placeholder scan: no TBD/TODO/implicit implementation steps remain.
- Type consistency: `stop_event_id`, `transaction_id`, `trade_id`, `portfolio_id`, `user_id`, `ticker`, `exit_action`, and `created_at` are consistent from schema through server/read-model.
- Scope guard: no planned changes to AVCO, close-review or fill-history engines.