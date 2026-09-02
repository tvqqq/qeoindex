\set ON_ERROR_STOP on

-- Representative destructive operations. The compatibility-column fixture is
-- synthetic so this rehearsal stays valid after real legacy columns are removed.
alter table public.portfolio_transactions
  drop column if exists qeo_recovery_legacy_target;

drop table if exists public.qeo_recovery_table_fixture cascade;
