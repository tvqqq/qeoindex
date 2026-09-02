\set ON_ERROR_STOP on

-- QEO-26 representative destructive operations.
-- This file is reachable only through the localhost-guarded rehearsal harness.
alter table public.portfolio_transactions
  drop column if exists target_price;

drop table if exists public.qeo_recovery_table_fixture cascade;
