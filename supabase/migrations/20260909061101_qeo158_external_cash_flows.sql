-- QEO-158 — explicit external funding ledger for Portfolio/Risk.
-- Trading/corporate-action accounting remains in portfolio_transactions.
-- Existing portfolios are marked legacy_unrecorded; no funding rows are fabricated.

begin;

alter table public.portfolios
  add column if not exists funding_history_status text;

-- Only rows that predate the migration have NULL here. This remains safe if the
-- SQL is replayed after new portfolios (which default to known) have been created.
update public.portfolios
set funding_history_status = 'legacy_unrecorded'
where funding_history_status is null;

alter table public.portfolios
  alter column funding_history_status set default 'known';
alter table public.portfolios
  alter column funding_history_status set not null;

alter table public.portfolios
  drop constraint if exists portfolios_funding_history_status_check;
alter table public.portfolios
  add constraint portfolios_funding_history_status_check
  check (funding_history_status in ('known', 'legacy_unrecorded'));

create table if not exists public.portfolio_external_cash_flows (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  flow_type text not null
    check (flow_type in ('deposit', 'withdrawal', 'capital_adjustment')),
  signed_amount_vnd numeric(20,2) not null,
  effective_at timestamptz not null,
  note text check (note is null or length(note) <= 500),
  provenance text not null default 'manual'
    check (provenance in ('manual', 'imported', 'portfolio_settings_adjustment')),
  created_at timestamptz not null default now(),

  foreign key (portfolio_id, user_id)
    references public.portfolios(id, user_id) on delete cascade,

  constraint portfolio_external_cash_flows_amount_check check (
    (flow_type = 'deposit' and signed_amount_vnd > 0)
    or (flow_type = 'withdrawal' and signed_amount_vnd < 0)
    or (flow_type = 'capital_adjustment' and signed_amount_vnd <> 0)
  )
);

create index if not exists portfolio_external_cash_flows_timeline_idx
  on public.portfolio_external_cash_flows(portfolio_id, effective_at, id);

create index if not exists portfolio_external_cash_flows_owner_idx
  on public.portfolio_external_cash_flows(user_id, portfolio_id);

alter table public.portfolio_external_cash_flows enable row level security;

revoke all on public.portfolio_external_cash_flows from anon;
revoke all on public.portfolio_external_cash_flows from authenticated;
grant select, insert on public.portfolio_external_cash_flows to authenticated;

-- Application semantics are append-only. Corrections are compensating rows.
drop policy if exists portfolio_external_cash_flows_select_own
  on public.portfolio_external_cash_flows;
create policy portfolio_external_cash_flows_select_own
  on public.portfolio_external_cash_flows
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists portfolio_external_cash_flows_insert_own
  on public.portfolio_external_cash_flows;
create policy portfolio_external_cash_flows_insert_own
  on public.portfolio_external_cash_flows
  for insert to authenticated
  with check (user_id = (select auth.uid()));

commit;
