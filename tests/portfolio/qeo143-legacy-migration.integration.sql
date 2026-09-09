\set ON_ERROR_STOP on

-- QEO-143 local-only deterministic fixture. No production rows are copied.
-- Reset the synthetic owner so this script is repeatable against one local DB.
delete from auth.users
where id = '14314314-3143-4143-8143-143143143143';

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token,
  email_change,
  email_change_token_new
)
values (
  '00000000-0000-0000-0000-000000000000',
  '14314314-3143-4143-8143-143143143143',
  'authenticated',
  'authenticated',
  'qeo143-migration@example.invalid',
  '',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"QEO-143 Migration Fixture"}'::jsonb,
  now(),
  now(),
  '',
  '',
  '',
  ''
);

create temporary table qeo143_fixture_portfolio as
select id as portfolio_id
from public.portfolios
where user_id = '14314314-3143-4143-8143-143143143143'
order by created_at, id
limit 1;

-- Case AAA: provable closed campaign with scale-in / scale-out => exactly one Trade.
-- Case BBB: sell from flat => unresolved.
-- Case CCC: over-sell => unresolved.
-- Case DDD: corporate action inside sequence => unresolved.
-- Case EEE: terminal open campaign => unresolved.
-- Case FFF: two campaign boundaries on one date => unresolved because execution time is absent.
insert into public.portfolio_transactions (
  id,
  portfolio_id,
  user_id,
  ticker,
  action,
  quantity,
  price,
  fee,
  transaction_date,
  created_at,
  record_origin,
  legacy_migration_status
)
select v.id, p.portfolio_id, '14314314-3143-4143-8143-143143143143'::uuid,
       v.ticker, v.action, v.quantity, v.price, v.fee, v.transaction_date, v.created_at,
       'legacy_pre_trade_domain', 'legacy_ungrouped'
from qeo143_fixture_portfolio p
cross join (values
  ('14300000-0000-4000-8000-000000000001'::uuid, 'AAA', 'buy',            100::numeric, 10::numeric, 1::numeric, date '2026-08-01', timestamptz '2026-08-01 01:00:00+00'),
  ('14300000-0000-4000-8000-000000000002'::uuid, 'AAA', 'buy',             50::numeric, 11::numeric, 1::numeric, date '2026-08-02', timestamptz '2026-08-02 01:00:00+00'),
  ('14300000-0000-4000-8000-000000000003'::uuid, 'AAA', 'sell',            80::numeric, 12::numeric, 1::numeric, date '2026-08-03', timestamptz '2026-08-03 01:00:00+00'),
  ('14300000-0000-4000-8000-000000000004'::uuid, 'AAA', 'sell',            70::numeric, 13::numeric, 1::numeric, date '2026-08-04', timestamptz '2026-08-04 01:00:00+00'),

  ('14300000-0000-4000-8000-000000000011'::uuid, 'BBB', 'sell',            10::numeric, 10::numeric, 1::numeric, date '2026-08-01', timestamptz '2026-08-01 02:00:00+00'),

  ('14300000-0000-4000-8000-000000000021'::uuid, 'CCC', 'buy',             50::numeric, 10::numeric, 1::numeric, date '2026-08-01', timestamptz '2026-08-01 03:00:00+00'),
  ('14300000-0000-4000-8000-000000000022'::uuid, 'CCC', 'sell',            60::numeric, 11::numeric, 1::numeric, date '2026-08-02', timestamptz '2026-08-02 03:00:00+00'),

  ('14300000-0000-4000-8000-000000000031'::uuid, 'DDD', 'buy',            100::numeric, 20::numeric, 1::numeric, date '2026-08-01', timestamptz '2026-08-01 04:00:00+00'),
  ('14300000-0000-4000-8000-000000000032'::uuid, 'DDD', 'dividend_stock',  10::numeric,  0::numeric, 0::numeric, date '2026-08-02', timestamptz '2026-08-02 04:00:00+00'),
  ('14300000-0000-4000-8000-000000000033'::uuid, 'DDD', 'sell',           110::numeric, 21::numeric, 1::numeric, date '2026-08-03', timestamptz '2026-08-03 04:00:00+00'),

  ('14300000-0000-4000-8000-000000000041'::uuid, 'EEE', 'buy',            100::numeric, 30::numeric, 1::numeric, date '2026-08-01', timestamptz '2026-08-01 05:00:00+00'),

  ('14300000-0000-4000-8000-000000000051'::uuid, 'FFF', 'buy',            100::numeric, 40::numeric, 1::numeric, date '2026-08-05', timestamptz '2026-08-05 01:00:00+00'),
  ('14300000-0000-4000-8000-000000000052'::uuid, 'FFF', 'sell',           100::numeric, 41::numeric, 1::numeric, date '2026-08-05', timestamptz '2026-08-05 02:00:00+00'),
  ('14300000-0000-4000-8000-000000000053'::uuid, 'FFF', 'buy',             50::numeric, 42::numeric, 1::numeric, date '2026-08-05', timestamptz '2026-08-05 03:00:00+00'),
  ('14300000-0000-4000-8000-000000000054'::uuid, 'FFF', 'sell',            50::numeric, 43::numeric, 1::numeric, date '2026-08-05', timestamptz '2026-08-05 04:00:00+00')
) as v(id, ticker, action, quantity, price, fee, transaction_date, created_at);

create temporary table qeo143_before as
select
  count(*)::bigint as row_count,
  coalesce(sum(quantity) filter (where action = 'buy'), 0)::numeric as buy_qty,
  coalesce(sum(quantity) filter (where action = 'sell'), 0)::numeric as sell_qty,
  coalesce(sum(price * quantity), 0)::numeric as notional,
  coalesce(sum(fee), 0)::numeric as fees
from public.portfolio_transactions
where user_id = '14314314-3143-4143-8143-143143143143';

create temporary table qeo143_first_run as
select * from public.qeo143_backfill_legacy_portfolio_trades();

do $$
declare
  v_portfolio_id uuid;
  v_trade public.portfolio_trades%rowtype;
  v_before record;
  v_after record;
  v_first record;
begin
  select portfolio_id into strict v_portfolio_id from qeo143_fixture_portfolio;
  select * into strict v_first from qeo143_first_run;

  if v_first.rows_grouped <> 4 or v_first.trades_created <> 1 then
    raise exception 'QEO-143 expected 4 grouped rows / 1 Trade, got % / %',
      v_first.rows_grouped, v_first.trades_created;
  end if;

  if (select count(*) from public.portfolio_transactions
      where portfolio_id = v_portfolio_id and ticker = 'AAA' and trade_id is not null) <> 4 then
    raise exception 'QEO-143 AAA campaign was not grouped exactly once';
  end if;

  if (select count(distinct trade_id) from public.portfolio_transactions
      where portfolio_id = v_portfolio_id and ticker = 'AAA') <> 1 then
    raise exception 'QEO-143 AAA fills do not share one logical Trade';
  end if;

  select t.* into strict v_trade
  from public.portfolio_trades t
  where t.portfolio_id = v_portfolio_id and t.ticker = 'AAA';

  if v_trade.origin <> 'legacy_migration'
    or v_trade.grouping_status <> 'deterministic'
    or v_trade.mode <> 'unknown'
    or v_trade.status <> 'closed'
    or v_trade.scorecard_eligible <> false
    or v_trade.opened_at is not null
    or v_trade.closed_at is not null
    or v_trade.legacy_opened_on <> date '2026-08-01'
    or v_trade.legacy_closed_on <> date '2026-08-04'
    or v_trade.legacy_source_transaction_count <> 4
  then
    raise exception 'QEO-143 migrated Trade provenance/lifecycle is incorrect';
  end if;

  if v_trade.money_management_plan_id is not null
    or v_trade.planned_entry is not null
    or v_trade.initial_stop_loss_exit is not null
    or v_trade.initial_account_equity is not null
    or v_trade.initial_risk_percent is not null
    or v_trade.initial_risk_amount is not null
    or v_trade.initial_risk_amount_per_share is not null
    or v_trade.planned_trade_size is not null
    or v_trade.planned_position_value is not null
    or v_trade.estimated_commission is not null
    or v_trade.slippage_allowance is not null
  then
    raise exception 'QEO-143 fabricated risk/plan history';
  end if;

  if exists (
    select 1 from public.portfolio_trade_stop_events s where s.trade_id = v_trade.id
  ) or exists (
    select 1 from public.portfolio_trade_journal_entries j where j.trade_id = v_trade.id
  ) then
    raise exception 'QEO-143 fabricated stop/journal history';
  end if;

  if exists (
    select 1
    from public.portfolio_transactions
    where portfolio_id = v_portfolio_id
      and ticker in ('BBB', 'CCC', 'DDD', 'EEE', 'FFF')
      and trade_id is not null
  ) then
    raise exception 'QEO-143 grouped an ambiguous/open/corporate-action legacy sequence';
  end if;

  if (select count(*) from public.portfolio_transactions
      where portfolio_id = v_portfolio_id and legacy_migration_status = 'legacy_ungrouped') <> 11 then
    raise exception 'QEO-143 unresolved row count is incorrect';
  end if;

  select * into strict v_before from qeo143_before;
  select
    count(*)::bigint as row_count,
    coalesce(sum(quantity) filter (where action = 'buy'), 0)::numeric as buy_qty,
    coalesce(sum(quantity) filter (where action = 'sell'), 0)::numeric as sell_qty,
    coalesce(sum(price * quantity), 0)::numeric as notional,
    coalesce(sum(fee), 0)::numeric as fees
  into strict v_after
  from public.portfolio_transactions
  where user_id = '14314314-3143-4143-8143-143143143143';

  if row(v_before.row_count, v_before.buy_qty, v_before.sell_qty, v_before.notional, v_before.fees)
     is distinct from
     row(v_after.row_count, v_after.buy_qty, v_after.sell_qty, v_after.notional, v_after.fees)
  then
    raise exception 'QEO-143 raw fill reconciliation changed after grouping';
  end if;
end;
$$;

create temporary table qeo143_second_run as
select * from public.qeo143_backfill_legacy_portfolio_trades();

do $$
declare
  v_second record;
  v_portfolio_id uuid;
begin
  select * into strict v_second from qeo143_second_run;
  select portfolio_id into strict v_portfolio_id from qeo143_fixture_portfolio;

  if v_second.rows_grouped <> 0 or v_second.trades_created <> 0 then
    raise exception 'QEO-143 backfill is not idempotent: grouped %, created %',
      v_second.rows_grouped, v_second.trades_created;
  end if;

  if (select count(*) from public.portfolio_trades
      where portfolio_id = v_portfolio_id and origin = 'legacy_migration') <> 1 then
    raise exception 'QEO-143 idempotent rerun duplicated migrated Trades';
  end if;
end;
$$;
