# QEO-137 — Trade Lifecycle Domain + Supabase Schema Design

Date: 2026-09-07
Status: Approved design, implementation pending
Owner issue: QEO-137
Parent: QEO-136
Source terminology authority: QEO-131 McDowell source contract/glossary

## Goal

Introduce a canonical logical Trade domain for Portfolio & Risk Management without breaking the existing AVCO accounting model. `portfolio_transactions` remains the accounting/fill source of truth, while a new normalized domain stores trade plans, lifecycle state, stop history, journal evidence, and immutable initial risk snapshots.

The design must support later Position Sizing, Portfolio Risk, Scorecard, and AI Advisor work without requiring those layers to reverse-engineer UI state or overload raw transaction rows.

## Non-goals

QEO-137 does not:

- redesign `/portfolio` UI;
- implement Money Management Plan persistence; that belongs to QEO-138;
- implement position-sizing formulas; that belongs to QEO-139;
- implement Active Risk aggregation; that belongs to QEO-141;
- implement Scorecard statistics; that belongs to QEO-142;
- implement legacy grouping heuristics; that belongs to QEO-143;
- add LLM or AI advisor code; that belongs to QEO-145;
- replace AVCO P&L accounting.

## Existing system constraints

Current production data model:

- `portfolios` owns user portfolios and `initial_capital`;
- `portfolio_transactions` stores accounting events/fills including ticker, action, quantity, price, fee, transaction date, notes, setup/mistake tags, target levels, stop levels, and fee rate;
- `modules/portfolio/pnl.ts` calculates positions using AVCO from raw transactions;
- existing `/api/portfolio/[id]/transactions` must continue to work during migration;
- all user portfolio tables use RLS and user ownership fields.

The current transaction row cannot represent one logical Trade with multiple entries, partial exits, evolving stops, and timestamped journal evidence. Therefore `Transaction != Trade` is a hard domain invariant.

## Chosen architecture

Use a normalized Trade domain:

```text
portfolios
   |
   +-- portfolio_trades
   |      +-- portfolio_transactions[]  # existing fills/accounting events
   |      +-- portfolio_trade_stop_events[]
   |      +-- portfolio_trade_journal_entries[]
   |
   +-- Money Management Plan            # QEO-138, not created here
```

This design is preferred over JSONB event blobs because stop/journal events need durable queryability, constraints, RLS ownership, future statistics, and auditability. Full event sourcing is intentionally rejected as unnecessary complexity for the current product.

## Canonical terminology

Schema/domain names should align with QEO-131 where practical:

- `Trade` = one logical trade campaign;
- `Fill` = accounting transaction attached to a Trade;
- `Trade Size` = planned share quantity for the trade;
- `Initial Stop-Loss Exit` = stop snapshot established before entry;
- `Risk Amount` = planned account loss allocated to the trade;
- `Risk Amount per Share` = planned risk difference per share;
- `Active Risk`, `Remaining Risk Budget`, and slippage allowance are QeoIndex/product-derived concepts and must remain distinguishable from book-exact fields.

Historical data must never be invented merely to satisfy these fields.

## Database design

### 1. `portfolio_trades`

Purpose: one row per logical Trade campaign.

Required columns:

```text
id uuid primary key
portfolio_id uuid not null
user_id uuid not null
ticker text not null
mode text not null                      # live | paper
status text not null                    # planned | open | partially_closed | closed | cancelled
trade_type text null                    # day | position; nullable for legacy/imported trade records
timeframe text null
system_tags text[] not null default '{}'
setup_tags text[] not null default '{}'
planned_entry numeric null
initial_stop_loss_exit numeric null
initial_account_equity numeric null
initial_risk_percent numeric null
initial_risk_amount numeric null
initial_risk_amount_per_share numeric null
planned_trade_size numeric null
planned_position_value numeric null
estimated_commission numeric null
slippage_allowance numeric null
opened_at timestamptz null
closed_at timestamptz null
pre_trade_plan text null
thesis_summary text null
final_review text null
lesson_learned text null
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

Constraints:

- ticker follows existing `^[A-Z0-9]{2,12}$` contract;
- `mode in ('live','paper')`;
- `status in ('planned','open','partially_closed','closed','cancelled')`;
- optional numeric money/price/quantity fields must be non-negative; price/risk-per-share values must be positive when present where zero has no semantic meaning;
- `initial_risk_percent` must be between 0 and 100 when present;
- `opened_at` is required for `open`, `partially_closed`, and `closed` states;
- `closed_at` is required only for `closed` and must be null for `planned/open/partially_closed`;
- cancelled trades may remain without `opened_at` or `closed_at` because cancellation means the planned trade was never opened;
- one unique identity tuple `(id, portfolio_id, user_id, ticker)` must exist to support ownership-safe composite FKs from fills.

No DB check should attempt to prove historical financial formulas because commission/slippage and trade-size computations belong in deterministic domain logic.

### 2. `portfolio_transactions.trade_id`

Add:

```text
trade_id uuid null
```

Legacy transaction rows remain valid with `trade_id = null`.

Add a composite FK:

```text
(trade_id, portfolio_id, user_id, ticker)
  -> portfolio_trades(id, portfolio_id, user_id, ticker)
```

The FK is nullable because historical rows cannot be grouped safely without deterministic evidence. This prevents cross-user, cross-portfolio, and cross-ticker fill attachment at the database boundary.

Existing action semantics and AVCO calculations stay unchanged.

### 3. `portfolio_trade_stop_events`

Purpose: immutable chronological stop history after the initial stop snapshot.

Required columns:

```text
id uuid primary key
trade_id uuid not null
portfolio_id uuid not null
user_id uuid not null
ticker text not null
stop_type text not null                 # initial | trailing | support | trendline | manual | other
price numeric not null
quantity_covered numeric null
signal text null
reason text null
effective_at timestamptz not null
created_at timestamptz not null default now()
```

Ownership FK:

```text
(trade_id, portfolio_id, user_id, ticker)
  -> portfolio_trades(id, portfolio_id, user_id, ticker)
```

Rules:

- `price > 0`;
- `quantity_covered > 0` when present;
- event rows are append-only at the application contract level;
- the latest effective stop is derived deterministically from ordered events, never stored by overwriting the Trade's initial stop;
- QEO-137 may create an `initial` stop event for a newly opened Trade only when the user/domain operation explicitly supplies that stop; it must not backfill one for legacy rows.

### 4. `portfolio_trade_journal_entries`

Purpose: timestamped journal evidence associated with the logical Trade.

Required columns:

```text
id uuid primary key
trade_id uuid not null
portfolio_id uuid not null
user_id uuid not null
ticker text not null
phase text not null                     # before | during | after
note text not null
emotion_tags text[] not null default '{}'
behavior_tags text[] not null default '{}'
adherence_status text null              # followed | deviated | not_applicable | unknown
override_reason text null
occurred_at timestamptz not null
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

Ownership FK matches the Trade composite identity.

Rules:

- empty notes are rejected;
- tag arrays are bounded in application validation;
- psychology and behavior fields are user-recorded evidence only;
- missing psychology data remains absent/unknown and is never inferred from price action or outcomes.

## Portfolio ownership hardening

Existing portfolio tables should be strengthened with a unique identity on:

```text
portfolios(id, user_id)
```

New `portfolio_trades` should reference:

```text
(portfolio_id, user_id)
  -> portfolios(id, user_id)
```

This complements RLS with relational ownership integrity. It prevents a row from carrying a valid `user_id` and a portfolio owned by another user.

## RLS contract

All new tables:

- enable RLS;
- revoke anonymous access;
- grant authenticated CRUD only as required;
- enforce `user_id = auth.uid()` on select/insert/update/delete;
- keep service-role behavior unchanged;
- preserve the existing user ownership pattern used elsewhere in the repository.

`portfolio_trade_stop_events` is application-append-only even if authenticated DELETE/UPDATE is technically permitted by broad generic grants. Preferred implementation is narrower grants/policies where repository conventions allow it. If migration compatibility makes strict append-only ACLs awkward, application APIs must still expose no stop-event update/delete operation in QEO-137.

## Trade lifecycle

Allowed transitions:

```text
planned -> open
planned -> cancelled
open -> partially_closed
open -> closed
partially_closed -> closed
```

Disallowed transitions include reopening `closed`, reopening `cancelled`, or moving a live/open Trade back to `planned`.

The lifecycle state is controlled by domain code, not by UI-specific logic.

### Snapshot freeze rule

Before a Trade is opened, plan fields may be edited.

When `planned -> open` occurs, the following initial fields become immutable through normal application APIs:

- `initial_stop_loss_exit`;
- `initial_account_equity`;
- `initial_risk_percent`;
- `initial_risk_amount`;
- `initial_risk_amount_per_share`;
- `planned_trade_size`;
- `planned_position_value`;
- `estimated_commission`;
- `slippage_allowance`;
- `planned_entry`.

Later stop changes are separate stop-event rows. Later Money Management Plan edits in QEO-138 must not mutate these snapshots.

Database constraints should enforce structural validity; immutability across state transitions is implemented in domain code and covered by tests. A later DB trigger is optional only if tests show application-only enforcement is insufficient.

## Fill attachment behavior

A transaction may be attached to a Trade only when:

- ownership, portfolio, and ticker match;
- transaction action is compatible with trade accounting (`buy`, `sell`, `rights`, and stock dividend accounting may be associated where meaningful; cash-dividend handling remains accounting-specific and does not create an entry/exit fill); 
- the Trade is not `cancelled`;
- attaching the fill does not rewrite transaction amount/price/date/fee.

QEO-137 will not auto-group legacy transactions. Explicit user/domain actions may attach existing transactions later.

Detach is allowed only when doing so does not silently alter accounting rows; it clears `trade_id` and leaves the accounting transaction untouched.

## Scale-in / scale-out semantics

Multiple fills may belong to one Trade.

Examples:

```text
BUY 1,000 FPT
BUY   500 FPT
SELL  700 FPT
SELL  800 FPT
```

All four fills can belong to one logical Trade. QEO-142 must later score this as one trade outcome, not four raw transactions.

QEO-137 stores the relationship but does not yet calculate Win Ratio or Payoff Ratio.

## Domain/module boundary

Create a focused module:

```text
modules/portfolio/trades/
  types.ts
  validation.ts
  server.ts
  read-model.ts
  README.md
```

Responsibilities:

### `types.ts`

- canonical domain enums/types;
- DTOs for Trade, stop event, journal entry, and read model;
- no Supabase client code.

### `validation.ts`

- payload normalization;
- bounded string/tag validation;
- lifecycle transition validation;
- no database access.

### `server.ts`

Server-only authenticated persistence functions:

```text
createTrade
updatePlannedTrade
transitionTrade
getTrade
listTrades
attachFillToTrade
detachFillFromTrade
addStopEvent
listStopEvents
addJournalEntry
listJournalEntries
```

Functions accept `ServerAuthContext` or an equivalent narrow authenticated context instead of constructing auth independently for every operation.

### `read-model.ts`

Expose a typed deterministic portfolio-trade read boundary for later QEO-141/QEO-142/QEO-145 work.

The read model must not depend on React components or UI text.

## API boundary

Existing:

```text
/api/portfolio/[id]/transactions
```

continues to work. It may accept/return optional `trade_id`, but the accounting payload remains backward-compatible.

New API routes should be thin adapters over `modules/portfolio/trades/server.ts`, for example:

```text
/api/portfolio/[id]/trades
/api/portfolio/[id]/trades/[tradeId]
/api/portfolio/[id]/trades/[tradeId]/fills
/api/portfolio/[id]/trades/[tradeId]/stops
/api/portfolio/[id]/trades/[tradeId]/journal
```

Exact route shape may be refined during implementation as long as route handlers remain thin and domain logic stays under `modules/portfolio/trades/*`.

The UI must not call Supabase directly for this domain.

## AI-ready canonical read boundary

QEO-137 does not call an LLM. It creates the deterministic facts layer that QEO-145 can consume later.

A per-portfolio read result should be able to represent:

```text
portfolio identity
mode
canonical logical trades
fills
initial risk snapshot
latest known stop
stop history
journal evidence/completeness
current Money Management Plan reference/version when QEO-138 exists
data completeness flags
timestamps/provenance
```

Suggested completeness fields:

```text
stopState: known | unknown
initialRiskState: available | partial | unknown
legacyGrouping: grouped | ungrouped | mixed
journalState: available | partial | unavailable
```

`unknown` must remain distinct from numeric zero.

The Money Management Plan reference is nullable in QEO-137. QEO-138 can extend the read model without rewriting the Trade persistence model.

## Migration strategy

Migration is additive and production-safe:

1. add composite portfolio ownership uniqueness required for downstream FKs;
2. create `portfolio_trades` with RLS, constraints, indexes, updated-at trigger;
3. add nullable `trade_id` to `portfolio_transactions`;
4. add the composite FK from transaction to Trade;
5. create stop-event table with RLS and indexes;
6. create journal-entry table with RLS and indexes;
7. update generated Supabase TypeScript types;
8. do not mutate existing transaction rows;
9. do not infer any legacy Trade, initial stop, risk snapshot, psychology, or timestamps.

Rollback safety comes from additive schema. The forward migration must not drop legacy columns or rewrite AVCO history.

## Indexing

Minimum indexes:

```text
portfolio_trades(user_id, portfolio_id, status, created_at desc)
portfolio_trades(user_id, portfolio_id, ticker, created_at desc)
portfolio_transactions(user_id, portfolio_id, trade_id, transaction_date, created_at)
portfolio_trade_stop_events(user_id, trade_id, effective_at, created_at)
portfolio_trade_journal_entries(user_id, trade_id, occurred_at, created_at)
```

Index names should follow existing repository conventions.

## Error handling

Domain APIs return explicit 4xx errors for:

- invalid IDs or ticker;
- cross-portfolio/cross-user/cross-ticker fill attachment;
- illegal lifecycle transition;
- attempting to mutate frozen initial snapshots after open;
- stop/journal payload validation failure;
- missing Trade/transaction.

Unexpected Supabase failures are logged server-side with bounded details and return generic 5xx responses.

No endpoint should silently coerce invalid state into a valid state.

## Testing strategy

Implementation follows TDD.

### Migration/contract tests

Verify:

- exactly one QEO-137 migration exists;
- all three new tables are created;
- `portfolio_transactions.trade_id` is nullable;
- RLS is enabled on every new table;
- ownership composite FKs exist;
- ticker/portfolio/user mismatch is structurally impossible;
- generated types contain the new schema.

### Domain unit tests

Verify:

- lifecycle transition matrix;
- invalid transitions fail;
- snapshot fields become immutable after open;
- unknown stop remains unknown;
- journal validation/tag bounds;
- trade read-model completeness semantics.

### Server/API tests

Verify:

- create planned Trade;
- open Trade with initial snapshot;
- attach multiple fills;
- partial close remains one logical Trade;
- close Trade;
- stop events preserve history;
- journal entries preserve timestamps/phases;
- cross-user/portfolio/ticker attachment is rejected;
- legacy transaction with `trade_id = null` remains readable/editable through the existing transaction API.

### Regression tests

Existing portfolio P&L/AVCO results must remain unchanged for the same transaction fixtures.

Run focused tests first, then repository typecheck/lint/build verification expected by current QeoIndex CI conventions.

## Acceptance criteria

QEO-137 is complete when:

- production-safe additive migration exists;
- new Trade, stop, and journal tables exist with RLS;
- transaction-to-Trade optional relationship is ownership-safe;
- existing accounting/P&L behavior remains compatible;
- one Trade supports multiple fills and partial exits;
- initial risk snapshots cannot be changed through normal APIs after open;
- stop history is append-style and initial stop is never overwritten;
- legacy data remains explicitly ungrouped/unknown where evidence is absent;
- typed server-side read model exists for downstream risk/scorecard/AI work;
- no LLM code and no Money Management Plan table are added prematurely;
- migration, RLS, domain, API, P&L regression, generated-type, typecheck, lint, and build gates pass.

## Implementation order

```text
1. RED migration/schema contract tests
2. Additive Supabase migration
3. Generated database types
4. RED lifecycle/validation tests
5. Domain types + validation
6. RED server/read-model tests
7. Server persistence + read model
8. Thin trade API routes
9. Optional trade_id support in existing transaction routes
10. P&L compatibility regression
11. Full verification
12. Production schema/advisor audit after DDL
```

## Key architectural decisions

- `portfolio_transactions` stays accounting truth; it is not replaced.
- `portfolio_trades` is the canonical logical Trade layer.
- Stop history and journal history are normalized tables, not mutable JSON blobs.
- Initial risk snapshot is frozen at Trade open.
- Legacy records remain ungrouped/unknown unless deterministic evidence exists.
- Composite FKs enforce ownership/ticker integrity in addition to RLS.
- Money Management Plan persistence remains QEO-138 scope.
- AI remains QEO-145 scope and consumes only the deterministic read boundary created here.
