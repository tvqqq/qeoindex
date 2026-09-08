# QEO-140 — Append-only Stop Event ↔ Exit Fill Link Design

Date: 2026-09-08
Status: Approved design
Owner issue: QEO-140
Parent: QEO-136
Base: `main@60739b070dbbdf2625c601fc9e0a3deeb2a428ee`

## Goal

Give each Trade Posting Card auditable evidence connecting a stop-loss event to the actual sell fill(s) that executed that stop, without mutating append-only stop history, fabricating legacy history, or changing canonical AVCO accounting.

## Approved cardinality

- One stop event may link to zero, one, or many sell fills.
- One sell fill may link to at most one stop event.
- A link may only connect rows with the same Trade, portfolio, user and ticker.
- A legacy transaction with `trade_id IS NULL` cannot be linked.
- Only `portfolio_transactions.action = 'sell'` may be linked.

## Architecture

Add an append-only relation table `portfolio_trade_stop_exit_fills` instead of adding a mutable `linked_exit_transaction_id` column to `portfolio_trade_stop_events`.

The stop event remains immutable and may exist before execution. When one or more actual sell fills later exist, explicit link rows are appended. The relation is execution evidence only; `portfolio_transactions` remains the accounting/AVCO source of truth.

## Database contract

### Parent identity constraints

Add composite unique identities required for safe cross-table foreign keys:

- `portfolio_trade_stop_events_identity_key` on `(id, trade_id, portfolio_id, user_id, ticker)`.
- `portfolio_transactions_stop_exit_identity_key` on `(id, trade_id, portfolio_id, user_id, ticker, action)`.

The transaction identity includes `action` so the child relation can enforce `sell` at the database boundary rather than relying only on application validation.

### New relation table

`public.portfolio_trade_stop_exit_fills`:

- `id uuid primary key default gen_random_uuid()`
- `stop_event_id uuid not null`
- `transaction_id uuid not null`
- `trade_id uuid not null`
- `portfolio_id uuid not null`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `ticker text not null`
- `exit_action text not null default 'sell' check (exit_action = 'sell')`
- `created_at timestamptz not null default now()`
- `unique (stop_event_id, transaction_id)`
- `unique (transaction_id)` to enforce one stop event per sell fill
- composite FK to stop-event identity
- composite FK to transaction identity including `exit_action`

Use `ON DELETE RESTRICT` for both evidence parents. Once a relation exists, deleting the linked stop event or transaction must not silently erase audit evidence.

### Permissions / RLS

- RLS enabled.
- revoke all from `anon, authenticated`, then grant only `select, insert` to authenticated.
- `SELECT` policy: `user_id = auth.uid()`.
- `INSERT` policy: `user_id = auth.uid()`.
- no update/delete policy or grant: links are append-only.

### Indexes

Provide explicit child-side indexes covering both composite FKs and a read index for `(user_id, portfolio_id, trade_id, stop_event_id, created_at)`.

## Server/domain contract

Add:

```ts
export async function linkExitFillToStopEvent(
  context: ServerAuthContext,
  portfolioId: string,
  tradeId: string,
  stopEventId: string,
  transactionId: string,
)
```

Behavior:

1. Validate IDs and ownership.
2. Load the canonical Trade.
3. Load the stop event scoped to the same Trade/portfolio/user.
4. Load the transaction scoped to the same portfolio/user.
5. Reject unless `transaction.trade_id === tradeId`.
6. Reject unless `transaction.ticker === trade.ticker`.
7. Reject unless `transaction.action === 'sell'`.
8. If the transaction is already linked to the same stop event, return the existing link (idempotent retry).
9. If the transaction is already linked to another stop event, fail with `EXIT_FILL_ALREADY_LINKED`.
10. Insert the append-only relation row.

Add a list/read helper for a Trade so the canonical context can fetch relation rows in one bounded query.

## HTTP contract

Add route:

`/api/portfolio/[id]/trades/[tradeId]/stops/[stopEventId]/fills`

- `GET`: list linked exit fills/evidence for the stop event.
- `POST`: body `{ "transaction_id": "<uuid>" }`; creates or idempotently returns the link.
- no `PATCH`/`DELETE` endpoint.
- authenticated via `requireApiUser()`.
- `Cache-Control: no-store`.
- explicit mapping for validation/not-found/conflict errors.

## Read-model contract

Enrich Trade Posting Card stop history without changing close-review math:

```ts
export type TradeStopEventReadModel = StopReadRow & {
  linkedExitFills: FillReadRow[]
}
```

`TradeReadModel.stopEvents` becomes `TradeStopEventReadModel[]`.

Each stop event receives only sell fills explicitly linked through `portfolio_trade_stop_exit_fills`. Linked fills are sorted deterministically by `transaction_date`, then `created_at`, then `id`.

Unlinked stop events return `linkedExitFills: []`.

`latestStop`, `closeReview`, `fillHistory`, and AVCO continue to use their existing canonical inputs. Link evidence must never change P&L or position quantity.

## Legacy / migration behavior

- No backfill.
- No automatic matching by ticker/date/price/quantity.
- Existing stop events remain unlinked until explicit evidence is added.
- Existing `portfolio_transactions.trade_id IS NULL` rows remain visible as legacy transactions and cannot be linked to stop events.

## Error semantics

Use explicit domain codes:

- `NOT_FOUND`
- `FILL_NOT_LINKED` when the transaction is not attached to the Trade
- `INVALID_EXIT_FILL_ACTION` when action is not `sell`
- `EXIT_FILL_ALREADY_LINKED` when the sell fill belongs to another stop event

Database uniqueness/FK errors remain a final integrity boundary; application validation provides clearer client errors first.

## Non-goals

- no QEO-141 Active Risk calculations;
- no stop-trigger inference from market price;
- no automatic stop/fill matching;
- no rewrite of `review.ts`, `fill-history.ts`, or `pnl.ts`;
- no UI redesign in this backend slice;
- no mutation of historical stop events.

## Acceptance

1. Schema enforces same Trade/portfolio/user/ticker and sell-only linking.
2. One stop can have multiple exit fills.
3. One sell fill cannot belong to two stop events.
4. Buy/rights/dividend fills cannot be linked.
5. Legacy `trade_id = null` transactions cannot be linked.
6. Stop events remain append-only.
7. Read model exposes deterministic `linkedExitFills[]`.
8. Existing AVCO, close-review and QEO-137/QEO-138 contracts stay green.
9. Zero-state migration replay and generated Database types pass.
10. Production build passes before merge.