# QEO-158 External Cash-Flow Normalization Design

## Status

Approved implementation design derived from Linear QEO-158 and the current Portfolio/Risk architecture.

## Objective

Represent deposits, withdrawals, and explicit capital adjustments separately from trading fills so external funding cannot create fake trading P/L, return, or drawdown while Account Equity and Active Risk use the correct current post-flow equity denominator.

This is deterministic core work. No AI/LLM behavior belongs in QEO-158.

## Current-state audit

- `portfolios.initial_capital` is the only funding field.
- `PATCH /api/portfolio/[id]` can rewrite `initial_capital` after trading activity, which rewrites historical equity implicitly.
- `portfolio_transactions` stores buy/sell/dividend/rights accounting events; it has no deposit/withdrawal action.
- QEO-141 `buildCurrentAccountEquity()` currently uses `initial_capital + realized P/L - remaining open cost basis` and therefore has no explicit external-flow term.
- QEO-142 return, account ledgers, benchmark, and drawdown operate on the same equity series and therefore cannot distinguish funding movements from investment performance.
- Production at design time has one portfolio, `initial_capital = 0`, one legacy buy transaction, and no external-flow ledger. Historical funding therefore cannot be reconstructed safely.

## Core invariants

1. Raw trade/corporate-action rows remain in `portfolio_transactions`; deposits/withdrawals never become pseudo-tickers or pseudo-trades.
2. `initial_capital` remains opening portfolio funding, not current equity.
3. After a portfolio has accounting activity, changing opening capital is not a normal mutable settings operation. Later capital movements are append-only external cash flows.
4. Existing portfolios are not assumed to have complete funding history. Migration marks pre-QEO-158 portfolios `legacy_unrecorded`; no deposit/withdrawal is inferred from purchases, equity differences, or current holdings.
5. Account Equity uses actual signed external flows effective at the snapshot time.
6. Performance calculations remove the direct effect of external flows. They do not claim to be TWR or MWR.
7. Active Risk % uses current post-flow Account Equity; historical Trade risk snapshots remain immutable.
8. Dividends, stock dividends, rights, fees, buys, and sells remain trading/corporate-action accounting events and are not reclassified as external funding.

## Data model

### `portfolios.funding_history_status`

Add a non-null text state:

- `known`: opening capital plus recorded external-flow history is the supported funding source.
- `legacy_unrecorded`: pre-QEO-158 funding history may be incomplete.

New portfolios default to `known`. Existing production portfolios are migrated to `legacy_unrecorded` without inventing flows.

### `portfolio_external_cash_flows`

Append/audit-friendly table:

- `id uuid primary key default gen_random_uuid()`
- `portfolio_id uuid not null references portfolios(id) on delete cascade`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `flow_type text not null` in `deposit | withdrawal | capital_adjustment`
- `signed_amount_vnd numeric(20,2) not null`
  - deposit must be `> 0`
  - withdrawal must be `< 0`
  - capital adjustment may be positive or negative but never zero
- `effective_at timestamptz not null`
- `note text null`, bounded by API validation
- `provenance text not null default 'manual'` in `manual | imported | portfolio_settings_adjustment`
- `created_at timestamptz not null default now()`

Indexes:

- `(portfolio_id, effective_at, id)` for deterministic timeline reads
- `(user_id, portfolio_id)` for owner-scoped reads

RLS is enabled. Authenticated users may read/insert rows only for portfolios they own. Normal application flow is append-only: no PATCH/DELETE cash-flow API is introduced in this issue; corrections are represented by compensating entries.

## Domain model

Add `ExternalCashFlow`:

```ts
type ExternalCashFlowType = "deposit" | "withdrawal" | "capital_adjustment"

type ExternalCashFlow = {
  id: string
  flowType: ExternalCashFlowType
  signedAmountVnd: number
  effectiveAt: string
  effectiveDate: string // Asia/Ho_Chi_Minh YYYY-MM-DD, derived by server adapter
  provenance: "manual" | "imported" | "portfolio_settings_adjustment"
}
```

Pure helpers:

```ts
sumExternalFlowsAt(flows, cutoff): number
flowAdjustedEquity(accountEquityVnd, cumulativeExternalFlowVnd): number
```

`flowAdjustedEquity = Account Equity - cumulative signed external flows`.

This neutralizes the direct jump from a deposit or withdrawal while leaving subsequent trading/valuation changes visible.

## Equity semantics

For a snapshot:

```text
Estimated Cash
= Initial Capital
+ cumulative signed External Cash Flows
+ realized trading P/L
- remaining open cost basis

Account Equity
= Estimated Cash + current market value

Flow-Adjusted Equity
= Account Equity - cumulative signed External Cash Flows
```

`Account Equity` is the real funding-aware denominator used for current Active Risk %. `Flow-Adjusted Equity` is the performance series used for return/drawdown/account benchmark calculations.

Every `EquityPoint` carries:

- actual `equityVnd`;
- `flowAdjustedEquityVnd`;
- `externalFlowVnd` for that point/date;
- `cumulativeExternalFlowVnd`;
- funding completeness state.

## Return definition

QEO-158 does **not** implement Time-Weighted Return or Money-Weighted Return.

Supported account return is explicitly named/described as **flow-adjusted Total P/L %**:

```text
(flow-adjusted current equity - initial capital) / initial capital × 100
```

It is available only when opening capital is positive, valuation data is complete, and funding history is `known`.

UI/tooltips must disclose that this is a simple capital-flow-neutral P/L percentage, not TWR/MWR. Deposited capital can subsequently earn/lose money, but the denominator is still opening capital, so cross-period comparability is limited.

## Drawdown and ledgers

- QEO-141 drawdown state uses `flowAdjustedEquityVnd`, not raw Account Equity.
- QEO-142 account ledgers and benchmark normalization use `flowAdjustedEquityVnd` for return/drawdown math.
- Raw Account Equity remains available for display and Active Risk denominator.
- A withdrawal cannot create a drawdown by itself; a deposit cannot reset the performance peak by itself.
- If funding history is `legacy_unrecorded`, performance return/drawdown completeness is `insufficient` rather than silently claiming exact history.

## API

Create `GET/POST /api/portfolio/[id]/cash-flows`.

### GET

Returns owner-scoped rows ordered by `effective_at ASC, id ASC` plus funding-history status.

### POST

Accepts:

```ts
{
  flow_type: "deposit" | "withdrawal" | "capital_adjustment"
  amount_vnd: number // signed contract: + deposit, - withdrawal; adjustment non-zero
  effective_at: string
  note?: string | null
}
```

Validation rejects zero/non-finite amounts, sign/type mismatches, invalid/future-unreasonable timestamps, and oversized notes. Server writes `user_id` from auth context and `provenance = manual`.

## Opening-capital edit behavior

`PATCH /api/portfolio/[id]` may update `initial_capital` only while the portfolio has no transactions and no external cash flows. Once accounting activity exists, it returns a conflict response instructing the client to record an external cash flow instead.

This prevents future silent history rewrites without retroactively fabricating flows for existing portfolios.

## UI

Preserve the current `/portfolio` theme.

Add a compact external-funding section under the Tài sản/risk workspace:

- current funding-history state (`Đầy đủ` vs `Legacy · chưa ghi nhận đủ`);
- add deposit/withdrawal/capital-adjustment action;
- ordered history showing type, signed amount, effective date, and optional note;
- explicit copy: funding rows affect Account Equity but are excluded from trading P/L and flow-adjusted return/drawdown;
- legacy state explains that historical funding is unknown rather than inferred.

The portfolio settings dialog changes the capital label to opening capital and explains that later movements belong in external funding history.

## Error handling and security

- Fail closed on DB read/write errors; do not silently omit external flows.
- RLS and owner predicates must match the portfolio domain.
- No free-form note is logged in server error telemetry.
- No historical funding reconstruction job runs automatically.

## Migration and production policy

Migration creates the table/column and marks existing portfolios `legacy_unrecorded`. It does not create any flow row.

Production acceptance records pre/post counts and confirms:

- raw transaction quantity/notional/fees unchanged;
- no flow row fabricated for the existing legacy portfolio;
- existing portfolio is explicitly `legacy_unrecorded`;
- migration is replay-safe;
- generated Supabase types and DB drift ledger reconcile.

## Test matrix

At minimum:

1. deposit increases Account Equity but not flow-adjusted return by itself;
2. withdrawal decreases Account Equity but does not create flow-adjusted drawdown by itself;
3. trade/valuation gain after a deposit remains performance gain;
4. Active Risk % denominator changes after a flow while initial Trade risk snapshots do not;
5. dividend cash remains a portfolio transaction/corporate-action cash flow, not external funding;
6. same-day and period-boundary external flows are applied deterministically by effective time/date;
7. legacy funding history produces explicit insufficient performance completeness;
8. opening-capital PATCH is rejected after accounting activity;
9. RLS/owner isolation and API sign validation pass;
10. zero-state replay, generated types, lint, TypeScript, production build, QEO-141/QEO-142 regressions pass.
