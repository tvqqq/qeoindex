-- Portfolio & WatchList v2 Migration
-- Adds: portfolios table, portfolio_transactions table,
--       extends watchlist_items with note/alerts/tags,
--       supports multi-watchlist per user.

begin;

-- ─────────────────────────────────────────────────────────────
-- 1. Extend watchlist_items (backward-compatible ADD COLUMN)
-- ─────────────────────────────────────────────────────────────

alter table public.watchlist_items
  add column if not exists note text,
  add column if not exists alert_price_above numeric(15,2),
  add column if not exists alert_price_below numeric(15,2),
  add column if not exists tags text[] not null default '{}';

-- ─────────────────────────────────────────────────────────────
-- 2. Remove the "one default per user" unique constraint so
--    users can have multiple watchlists. is_default is kept
--    as a boolean but no longer forced unique at DB level;
--    the application ensures at most one default per user.
-- ─────────────────────────────────────────────────────────────

drop index if exists public.watchlists_one_default_per_user;

-- ─────────────────────────────────────────────────────────────
-- 3. portfolios table
-- ─────────────────────────────────────────────────────────────

create table if not exists public.portfolios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Danh mục 1'
    check (char_length(name) between 1 and 80),
  description text,
  is_default boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists portfolios_user_sort_idx
  on public.portfolios(user_id, sort_order, created_at);

-- ─────────────────────────────────────────────────────────────
-- 4. portfolio_transactions table
-- ─────────────────────────────────────────────────────────────

create table if not exists public.portfolio_transactions (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  -- action types: buy, sell, dividend_cash, dividend_stock, rights
  action text not null check (action in ('buy', 'sell', 'dividend_cash', 'dividend_stock', 'rights')),
  -- quantity in shares (integer for VN market, stored as numeric for dividend_stock ratios)
  quantity numeric(15,4) not null check (quantity > 0),
  -- price in thousands VND (nghìn đồng), 0 allowed for dividend_stock
  price numeric(15,2) not null default 0 check (price >= 0),
  -- fee includes brokerage fee + tax, in thousands VND
  fee numeric(15,2) not null default 0 check (fee >= 0),
  transaction_date date not null,
  note text,
  tags text[] not null default '{}',
  -- optional risk management fields
  target_price numeric(15,2),
  stop_loss numeric(15,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists portfolio_transactions_user_idx
  on public.portfolio_transactions(user_id, portfolio_id, ticker, transaction_date desc);

-- ─────────────────────────────────────────────────────────────
-- 5. updated_at triggers
-- ─────────────────────────────────────────────────────────────

drop trigger if exists qeo_portfolios_updated_at on public.portfolios;
create trigger qeo_portfolios_updated_at
before update on public.portfolios
for each row execute function public.qeo_touch_updated_at();

drop trigger if exists qeo_portfolio_transactions_updated_at on public.portfolio_transactions;
create trigger qeo_portfolio_transactions_updated_at
before update on public.portfolio_transactions
for each row execute function public.qeo_touch_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 6. RLS for new tables
-- ─────────────────────────────────────────────────────────────

alter table public.portfolios enable row level security;
alter table public.portfolio_transactions enable row level security;

-- Revoke anonymous access
revoke all on public.portfolios from anon;
revoke all on public.portfolio_transactions from anon;

-- Grant authenticated users access to their own data
grant select, insert, update, delete on public.portfolios to authenticated;
grant select, insert, update, delete on public.portfolio_transactions to authenticated;

-- portfolios RLS policies
drop policy if exists portfolios_select_own on public.portfolios;
create policy portfolios_select_own on public.portfolios
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists portfolios_insert_own on public.portfolios;
create policy portfolios_insert_own on public.portfolios
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists portfolios_update_own on public.portfolios;
create policy portfolios_update_own on public.portfolios
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists portfolios_delete_own on public.portfolios;
create policy portfolios_delete_own on public.portfolios
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- portfolio_transactions RLS policies
drop policy if exists portfolio_transactions_select_own on public.portfolio_transactions;
create policy portfolio_transactions_select_own on public.portfolio_transactions
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists portfolio_transactions_insert_own on public.portfolio_transactions;
create policy portfolio_transactions_insert_own on public.portfolio_transactions
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists portfolio_transactions_update_own on public.portfolio_transactions;
create policy portfolio_transactions_update_own on public.portfolio_transactions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists portfolio_transactions_delete_own on public.portfolio_transactions;
create policy portfolio_transactions_delete_own on public.portfolio_transactions
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ─────────────────────────────────────────────────────────────
-- 7. Bootstrap: create default portfolio for existing users
-- ─────────────────────────────────────────────────────────────

insert into public.portfolios (user_id, name, is_default, sort_order)
select u.id, 'Danh mục chính', true, 0
from auth.users u
where not exists (
  select 1 from public.portfolios p where p.user_id = u.id
);

-- ─────────────────────────────────────────────────────────────
-- 8. Update bootstrap trigger to also create default portfolio
-- ─────────────────────────────────────────────────────────────

create or replace function public.qeo_bootstrap_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), '')
    )
  )
  on conflict (id) do nothing;

  insert into public.user_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.watchlists (user_id, name, is_default, sort_order)
  values (new.id, 'Theo dõi', true, 0)
  on conflict do nothing;

  insert into public.portfolios (user_id, name, is_default, sort_order)
  values (new.id, 'Danh mục chính', true, 0);

  insert into public.user_features (user_id, feature_key, enabled)
  values
    (new.id, 'market_board', true),
    (new.id, 'research', true),
    (new.id, 'signals', true),
    (new.id, 'finhay_live', true)
  on conflict (user_id, feature_key) do nothing;

  return new;
end;
$$;

revoke all on function public.qeo_bootstrap_auth_user() from public;

commit;
