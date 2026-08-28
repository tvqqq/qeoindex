-- Portfolio Advanced Features Migration
-- Adds initial_capital to portfolios
-- Adds multi-target prices, multi-stoploss prices, setup_tags, mistake_tags, and fee_rate to portfolio_transactions

begin;

-- 1. Extend portfolios
alter table public.portfolios
  add column if not exists initial_capital numeric(18,2) not null default 0;

-- 2. Extend portfolio_transactions
alter table public.portfolio_transactions
  add column if not exists target_price_1 numeric(15,2),
  add column if not exists target_price_2 numeric(15,2),
  add column if not exists target_price_3 numeric(15,2),
  add column if not exists stop_loss_1 numeric(15,2),
  add column if not exists stop_loss_2 numeric(15,2),
  add column if not exists stop_loss_3 numeric(15,2),
  add column if not exists setup_tags text[] not null default '{}',
  add column if not exists mistake_tags text[] not null default '{}',
  add column if not exists fee_rate numeric(5,2) not null default 0.15;

commit;
