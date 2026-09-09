-- QEO-144 real Postgres acceptance assertions.
-- Run only after the local-only fixture has been loaded.
\set ON_ERROR_STOP on

begin;

do $$
declare
  v_user_id uuid;
  v_portfolio_id constant uuid := '14400000-0000-0000-0000-000000000001'::uuid;
  v_plan_id constant uuid := '14460000-0000-0000-0000-000000000001'::uuid;
begin
  select id into v_user_id
  from auth.users
  where email = 'qeo144-acceptance@example.test'
  limit 1;

  if v_user_id is null then
    raise exception 'QEO-144 fixture user missing';
  end if;

  if (select count(*) from public.portfolios where id = v_portfolio_id and user_id = v_user_id) <> 1 then
    raise exception 'QEO-144 fixture portfolio mismatch';
  end if;

  if (select count(*) from public.portfolio_trades where portfolio_id = v_portfolio_id and user_id = v_user_id) <> 12 then
    raise exception 'QEO-144 expected 12 Trades';
  end if;

  if (select count(*) from public.portfolio_transactions where portfolio_id = v_portfolio_id and user_id = v_user_id) <> 16 then
    raise exception 'QEO-144 expected 16 raw fills';
  end if;

  if not exists (
    select 1 from public.portfolio_trades
    where id = '14401000-0000-0000-0000-000000000001'::uuid
      and ticker = 'FPT' and status = 'planned'
  ) or exists (
    select 1 from public.portfolio_transactions
    where trade_id = '14401000-0000-0000-0000-000000000001'::uuid
  ) then
    raise exception 'QEO-144 planned-no-fill scenario mismatch';
  end if;

  if (select count(*) from public.portfolio_transactions where trade_id = '14401000-0000-0000-0000-000000000003'::uuid) <> 2 then
    raise exception 'QEO-144 scale-in must keep two fills under one Trade';
  end if;

  if not exists (
    select 1 from public.portfolio_trades
    where id = '14401000-0000-0000-0000-000000000004'::uuid
      and status = 'partially_closed'
  ) or (select count(*) from public.portfolio_transactions where trade_id = '14401000-0000-0000-0000-000000000004'::uuid) <> 2 then
    raise exception 'QEO-144 partial scale-out scenario mismatch';
  end if;

  if not exists (
    select 1 from public.portfolio_trades
    where id = '14401000-0000-0000-0000-000000000005'::uuid
      and ticker = 'ACB' and status = 'closed'
  ) or not exists (
    select 1 from public.portfolio_trades
    where id = '14401000-0000-0000-0000-000000000006'::uuid
      and ticker = 'SSI' and status = 'closed'
  ) then
    raise exception 'QEO-144 closed winner/loser scenarios missing';
  end if;

  if (select count(*) from public.portfolio_trade_stop_events where trade_id = '14401000-0000-0000-0000-000000000007'::uuid) <> 2
     or not exists (
       select 1 from public.portfolio_trade_stop_events
       where trade_id = '14401000-0000-0000-0000-000000000007'::uuid
         and stop_type = 'trailing' and price = 68
     ) then
    raise exception 'QEO-144 trailing-stop history mismatch';
  end if;

  if exists (
    select 1 from public.portfolio_trade_stop_events
    where trade_id = '14401000-0000-0000-0000-000000000008'::uuid
  ) or not exists (
    select 1 from public.portfolio_trades
    where id = '14401000-0000-0000-0000-000000000008'::uuid
      and ticker = 'UNKNOWNSTOP' and initial_stop_loss_exit is null
  ) then
    raise exception 'QEO-144 Risk Unknown scenario must remain stop-less';
  end if;

  if (select count(*) from public.portfolio_trades where portfolio_id = v_portfolio_id and mode = 'paper') <> 1
     or (select count(*) from public.portfolio_trades where portfolio_id = v_portfolio_id and mode = 'live') < 1 then
    raise exception 'QEO-144 live/paper isolation evidence missing';
  end if;

  if not exists (
    select 1 from public.portfolio_trades
    where id = '14401000-0000-0000-0000-000000000009'::uuid
      and origin = 'legacy_migration'
      and mode = 'unknown'
      and scorecard_eligible = false
      and legacy_source_transaction_count = 2
  ) then
    raise exception 'QEO-144 legacy migration provenance mismatch';
  end if;

  if (select count(*) from public.portfolio_external_cash_flows where portfolio_id = v_portfolio_id) <> 2
     or (select coalesce(sum(signed_amount_vnd), 0) from public.portfolio_external_cash_flows where portfolio_id = v_portfolio_id) <> 80000000 then
    raise exception 'QEO-144 external cash-flow ledger mismatch';
  end if;

  if not exists (
    select 1 from public.portfolio_money_management_plans
    where id = v_plan_id
      and portfolio_id = v_portfolio_id
      and (diversification_rules->>'maxTickerConcentrationPercent')::numeric = 30
      and (diversification_rules->>'maxSectorRiskPercent')::numeric = 4
      and (diversification_rules->>'maxConcurrentOpenPositions')::integer = 8
  ) then
    raise exception 'QEO-144 configured concentration rules missing';
  end if;

  if not exists (
    select 1 from public.portfolio_trade_journal_entries
    where trade_id = '14401000-0000-0000-0000-000000000001'::uuid
      and adherence_status = 'deviated'
      and override_reason = 'QEO-144 controlled acceptance override reason'
      and 'concentration_override' = any(behavior_tags)
  ) then
    raise exception 'QEO-144 auditable override evidence missing';
  end if;

  if not exists (
    select 1 from public.market_universe_memberships
    where run_id = '14450000-0000-0000-0000-000000000001'::uuid
      and ticker = 'VIC' and sector is not null
  ) then
    raise exception 'QEO-144 known structured sector evidence missing';
  end if;

  if exists (
    select 1 from public.market_universe_memberships
    where run_id = '14450000-0000-0000-0000-000000000001'::uuid
      and ticker = 'QEOUNK'
  ) then
    raise exception 'QEO-144 QEOUNK must remain unclassified';
  end if;
end;
$$;

rollback;
