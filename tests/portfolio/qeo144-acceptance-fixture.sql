-- QEO-144 controlled acceptance fixture.
-- LOCAL/PREPROD ONLY. Never run this against a production Supabase project.
-- The dedicated QEO-144 auth user owns every Portfolio/Risk row below.

\set ON_ERROR_STOP on

select set_config('qeo.qeo144_user_id', :'qeo144_user_id', false);

begin;

do $$
declare
  v_user_id uuid := current_setting('qeo.qeo144_user_id')::uuid;
  v_portfolio_id constant uuid := '14400000-0000-0000-0000-000000000001'::uuid;
  v_plan_id constant uuid := '14460000-0000-0000-0000-000000000001'::uuid;
begin
  if not exists (select 1 from auth.users where id = v_user_id) then
    raise exception 'QEO-144 local auth user % does not exist', v_user_id;
  end if;

  -- The auth account is dedicated to this local fixture. Reset only that owner's
  -- portfolios so reruns are deterministic; FK cascades remove owned child rows.
  delete from public.portfolios where user_id = v_user_id;

  insert into public.portfolios (
    id, user_id, name, description, is_default, sort_order, funding_history_status,
    created_at, updated_at
  ) values (
    v_portfolio_id,
    v_user_id,
    'QEO-144 Acceptance',
    'QEO-144 local-only deterministic Portfolio/Risk acceptance fixture',
    true,
    0,
    'known',
    '2026-08-01T00:00:00Z',
    '2026-08-01T00:00:00Z'
  );

  insert into public.portfolio_money_management_plans (
    id, portfolio_id, user_id, version, schema_version,
    default_trade_risk_percent, advanced_risk_override_acknowledged,
    max_active_risk_percent,
    drawdown_reduce_enabled, drawdown_reduce_threshold_percent, risk_reduction_factor,
    drawdown_pause_enabled, drawdown_pause_threshold_percent,
    consecutive_stop_outs_enabled, consecutive_stop_outs_threshold,
    rolling_trade_loss_enabled, rolling_trade_count,
    holiday_rules, execution_rules, scale_rules, diversification_rules,
    risk_capital_policy, notes, created_at
  ) values (
    v_plan_id, v_portfolio_id, v_user_id, 1, 1,
    1.0, false,
    6.0,
    false, null, null,
    false, null,
    false, null,
    false, null,
    '{}'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb,
    jsonb_build_object(
      'enabled', true,
      'concentrationWarningPercent', 20,
      'maxTickerConcentrationPercent', 30,
      'maxSectorRiskPercent', 4,
      'maxConcurrentOpenPositions', 8
    ),
    '{"mode":"disabled"}'::jsonb,
    'QEO-144 acceptance fixture',
    '2026-08-01T00:01:00Z'
  );

  -- Native lifecycle fixtures. All rows deliberately use the saved plan so
  -- browser/read-model acceptance exercises current plan provenance.
  insert into public.portfolio_trades (
    id, portfolio_id, user_id, ticker, mode, status, trade_type, timeframe,
    system_tags, setup_tags, money_management_plan_id,
    planned_entry, initial_stop_loss_exit, initial_account_equity,
    initial_risk_percent, initial_risk_amount, initial_risk_amount_per_share,
    planned_trade_size, planned_position_value, estimated_commission, slippage_allowance,
    opened_at, closed_at, pre_trade_plan, thesis_summary,
    origin, grouping_status, scorecard_eligible, created_at, updated_at
  ) values
    -- planned trade with no fill yet
    ('14401000-0000-0000-0000-000000000001', v_portfolio_id, v_user_id,
      'FPT', 'live', 'planned', 'position', '1D', array['qeo144_fixture'], '{}', v_plan_id,
      100, 94, 100000000, 1, 1000000, 6000, 166, 16600000, 10000, 4000,
      null, null, 'QEO-144 planned no fill', 'fixture planned trade',
      'native', 'native', true, '2026-08-02T01:00:00Z', '2026-08-02T01:00:00Z'),

    -- open trade with initial stop
    ('14401000-0000-0000-0000-000000000002', v_portfolio_id, v_user_id,
      'HPG', 'live', 'open', 'position', '1D', array['qeo144_fixture'], '{}', v_plan_id,
      25, 22, 100000000, 3, 3000000, 3000, 1000, 25000000, 10000, 5000,
      '2026-08-03T02:00:00Z', null, 'QEO-144 open initial stop', 'fixture open trade',
      'native', 'native', true, '2026-08-03T01:00:00Z', '2026-08-03T02:00:00Z'),

    -- one logical Trade with multiple scale-in fills
    ('14401000-0000-0000-0000-000000000003', v_portfolio_id, v_user_id,
      'MWG', 'live', 'open', 'position', '1D', array['qeo144_fixture'], array['scale_in'], v_plan_id,
      50, 45, 100000000, 6, 6000000, 5000, 1200, 60000000, 15000, 5000,
      '2026-08-04T02:00:00Z', null, 'QEO-144 multi scale-in', 'fixture scale-in trade',
      'native', 'native', true, '2026-08-04T01:00:00Z', '2026-08-04T02:00:00Z'),

    -- partially scaled-out trade remains partially_closed
    ('14401000-0000-0000-0000-000000000004', v_portfolio_id, v_user_id,
      'VNM', 'live', 'partially_closed', 'position', '1D', array['qeo144_fixture'], array['scale_out'], v_plan_id,
      60, 55, 100000000, 5, 5000000, 5000, 1000, 60000000, 12000, 5000,
      '2026-08-06T02:00:00Z', null, 'QEO-144 partial scale-out', 'fixture partial trade',
      'native', 'native', true, '2026-08-06T01:00:00Z', '2026-08-08T02:00:00Z'),

    -- closed winner
    ('14401000-0000-0000-0000-000000000005', v_portfolio_id, v_user_id,
      'ACB', 'live', 'closed', 'position', '1D', array['qeo144_fixture'], '{}', v_plan_id,
      20, 18, 100000000, 2, 2000000, 2000, 1000, 20000000, 10000, 5000,
      '2026-08-09T02:00:00Z', '2026-08-12T02:00:00Z', 'QEO-144 closed winner', 'fixture winner',
      'native', 'native', true, '2026-08-09T01:00:00Z', '2026-08-12T02:00:00Z'),

    -- closed loser
    ('14401000-0000-0000-0000-000000000006', v_portfolio_id, v_user_id,
      'SSI', 'live', 'closed', 'position', '1D', array['qeo144_fixture'], '{}', v_plan_id,
      30, 27, 100000000, 3, 3000000, 3000, 1000, 30000000, 10000, 5000,
      '2026-08-10T02:00:00Z', '2026-08-13T02:00:00Z', 'QEO-144 closed loser', 'fixture loser',
      'native', 'native', true, '2026-08-10T01:00:00Z', '2026-08-13T02:00:00Z'),

    -- open trade whose stop is later trailed
    ('14401000-0000-0000-0000-000000000007', v_portfolio_id, v_user_id,
      'MSN', 'live', 'open', 'position', '1D', array['qeo144_fixture'], array['trailing_stop'], v_plan_id,
      70, 65, 100000000, 5, 5000000, 5000, 1000, 70000000, 12000, 5000,
      '2026-08-14T02:00:00Z', null, 'QEO-144 trailed stop', 'fixture trailing-stop trade',
      'native', 'native', true, '2026-08-14T01:00:00Z', '2026-08-16T02:00:00Z'),

    -- open position with deliberately missing stop => Risk Unknown
    ('14401000-0000-0000-0000-000000000008', v_portfolio_id, v_user_id,
      'UNKNOWNSTOP', 'live', 'open', 'position', '1D', array['qeo144_fixture'], array['risk_unknown'], v_plan_id,
      10, null, 100000000, null, null, null, 1000, 10000000, 5000, 2000,
      '2026-08-15T02:00:00Z', null, 'QEO-144 missing stop / Risk Unknown', 'fixture unknown risk',
      'native', 'native', true, '2026-08-15T01:00:00Z', '2026-08-15T02:00:00Z'),

    -- paper-mode open trade proves live/paper isolation
    ('14401000-0000-0000-0000-000000000010', v_portfolio_id, v_user_id,
      'PAPER', 'paper', 'open', 'position', '1D', array['qeo144_fixture'], '{}', v_plan_id,
      40, 35, 100000000, 5, 5000000, 5000, 1000, 40000000, 10000, 5000,
      '2026-08-17T02:00:00Z', null, 'QEO-144 paper isolation', 'fixture paper trade',
      'native', 'native', true, '2026-08-17T01:00:00Z', '2026-08-17T02:00:00Z'),

    -- known structured sector + hard risk threshold breach
    ('14401000-0000-0000-0000-000000000011', v_portfolio_id, v_user_id,
      'VIC', 'live', 'open', 'position', '1D', array['qeo144_fixture'], array['sector_breach'], v_plan_id,
      100, 90, 100000000, 10, 10000000, 10000, 1000, 100000000, 15000, 5000,
      '2026-08-18T02:00:00Z', null, 'QEO-144 configured sector concentration breach', 'fixture sector breach',
      'native', 'native', true, '2026-08-18T01:00:00Z', '2026-08-18T02:00:00Z'),

    -- valid risk evidence but deliberately absent structured sector classification
    ('14401000-0000-0000-0000-000000000012', v_portfolio_id, v_user_id,
      'QEOUNK', 'live', 'open', 'position', '1D', array['qeo144_fixture'], array['unknown_sector'], v_plan_id,
      20, 18, 100000000, 2, 2000000, 2000, 1000, 20000000, 8000, 3000,
      '2026-08-19T02:00:00Z', null, 'QEO-144 unknown sector classification', 'fixture unknown sector',
      'native', 'native', true, '2026-08-19T01:00:00Z', '2026-08-19T02:00:00Z');

  -- Legacy migrated campaign: date-only evidence, mode intentionally unknown,
  -- scorecard-ineligible and no fabricated stop/journal/plan provenance.
  insert into public.portfolio_trades (
    id, portfolio_id, user_id, ticker, mode, status, system_tags, setup_tags,
    money_management_plan_id, opened_at, closed_at,
    origin, grouping_status, scorecard_eligible,
    legacy_opened_on, legacy_closed_on, legacy_source_transaction_count,
    created_at, updated_at
  ) values (
    '14401000-0000-0000-0000-000000000009', v_portfolio_id, v_user_id,
    'LEGACY', 'unknown', 'closed', array['qeo144_fixture'], array['legacy_migrated'],
    null, null, null,
    'legacy_migration', 'deterministic', false,
    '2026-08-01', '2026-08-07', 2,
    '2026-08-21T01:00:00Z', '2026-08-21T01:00:00Z'
  );

  -- Raw fills remain canonical accounting evidence and link to exactly one Trade.
  insert into public.portfolio_transactions (
    id, portfolio_id, user_id, ticker, action, quantity, price, fee,
    transaction_date, note, tags, stop_loss, trade_id,
    record_origin, legacy_migration_status, created_at, updated_at
  ) values
    ('14410000-0000-0000-0000-000000000001', v_portfolio_id, v_user_id, 'HPG', 'buy', 1000, 25, 10, '2026-08-03', 'QEO-144 HPG entry', array['qeo144_fixture'], 22, '14401000-0000-0000-0000-000000000002', 'native', 'not_applicable', '2026-08-03T02:00:00Z', '2026-08-03T02:00:00Z'),
    ('14410000-0000-0000-0000-000000000002', v_portfolio_id, v_user_id, 'MWG', 'buy', 1000, 50, 10, '2026-08-04', 'QEO-144 MWG scale-in 1', array['qeo144_fixture'], 45, '14401000-0000-0000-0000-000000000003', 'native', 'not_applicable', '2026-08-04T02:00:00Z', '2026-08-04T02:00:00Z'),
    ('14410000-0000-0000-0000-000000000003', v_portfolio_id, v_user_id, 'MWG', 'buy', 500, 52, 6, '2026-08-05', 'QEO-144 MWG scale-in 2', array['qeo144_fixture'], 45, '14401000-0000-0000-0000-000000000003', 'native', 'not_applicable', '2026-08-05T02:00:00Z', '2026-08-05T02:00:00Z'),
    ('14410000-0000-0000-0000-000000000004', v_portfolio_id, v_user_id, 'VNM', 'buy', 1000, 60, 12, '2026-08-06', 'QEO-144 VNM entry', array['qeo144_fixture'], 55, '14401000-0000-0000-0000-000000000004', 'native', 'not_applicable', '2026-08-06T02:00:00Z', '2026-08-06T02:00:00Z'),
    ('14410000-0000-0000-0000-000000000005', v_portfolio_id, v_user_id, 'VNM', 'sell', 400, 65, 8, '2026-08-08', 'QEO-144 VNM partial scale-out', array['qeo144_fixture'], 55, '14401000-0000-0000-0000-000000000004', 'native', 'not_applicable', '2026-08-08T02:00:00Z', '2026-08-08T02:00:00Z'),
    ('14410000-0000-0000-0000-000000000006', v_portfolio_id, v_user_id, 'ACB', 'buy', 1000, 20, 10, '2026-08-09', 'QEO-144 ACB winner entry', array['qeo144_fixture'], 18, '14401000-0000-0000-0000-000000000005', 'native', 'not_applicable', '2026-08-09T02:00:00Z', '2026-08-09T02:00:00Z'),
    ('14410000-0000-0000-0000-000000000007', v_portfolio_id, v_user_id, 'ACB', 'sell', 1000, 25, 10, '2026-08-12', 'QEO-144 ACB winner exit', array['qeo144_fixture'], 18, '14401000-0000-0000-0000-000000000005', 'native', 'not_applicable', '2026-08-12T02:00:00Z', '2026-08-12T02:00:00Z'),
    ('14410000-0000-0000-0000-000000000008', v_portfolio_id, v_user_id, 'SSI', 'buy', 1000, 30, 10, '2026-08-10', 'QEO-144 SSI loser entry', array['qeo144_fixture'], 27, '14401000-0000-0000-0000-000000000006', 'native', 'not_applicable', '2026-08-10T02:00:00Z', '2026-08-10T02:00:00Z'),
    ('14410000-0000-0000-0000-000000000009', v_portfolio_id, v_user_id, 'SSI', 'sell', 1000, 25, 10, '2026-08-13', 'QEO-144 SSI loser exit', array['qeo144_fixture'], 27, '14401000-0000-0000-0000-000000000006', 'native', 'not_applicable', '2026-08-13T02:00:00Z', '2026-08-13T02:00:00Z'),
    ('14410000-0000-0000-0000-000000000010', v_portfolio_id, v_user_id, 'MSN', 'buy', 1000, 70, 12, '2026-08-14', 'QEO-144 MSN entry', array['qeo144_fixture'], 65, '14401000-0000-0000-0000-000000000007', 'native', 'not_applicable', '2026-08-14T02:00:00Z', '2026-08-14T02:00:00Z'),
    ('14410000-0000-0000-0000-000000000011', v_portfolio_id, v_user_id, 'UNKNOWNSTOP', 'buy', 1000, 10, 5, '2026-08-15', 'QEO-144 missing stop', array['qeo144_fixture'], null, '14401000-0000-0000-0000-000000000008', 'native', 'not_applicable', '2026-08-15T02:00:00Z', '2026-08-15T02:00:00Z'),
    ('14410000-0000-0000-0000-000000000012', v_portfolio_id, v_user_id, 'PAPER', 'buy', 1000, 40, 10, '2026-08-17', 'QEO-144 paper entry', array['qeo144_fixture'], 35, '14401000-0000-0000-0000-000000000010', 'native', 'not_applicable', '2026-08-17T02:00:00Z', '2026-08-17T02:00:00Z'),
    ('14410000-0000-0000-0000-000000000013', v_portfolio_id, v_user_id, 'VIC', 'buy', 1000, 100, 15, '2026-08-18', 'QEO-144 VIC sector breach', array['qeo144_fixture'], 90, '14401000-0000-0000-0000-000000000011', 'native', 'not_applicable', '2026-08-18T02:00:00Z', '2026-08-18T02:00:00Z'),
    ('14410000-0000-0000-0000-000000000014', v_portfolio_id, v_user_id, 'QEOUNK', 'buy', 1000, 20, 8, '2026-08-19', 'QEO-144 unknown sector entry', array['qeo144_fixture'], 18, '14401000-0000-0000-0000-000000000012', 'native', 'not_applicable', '2026-08-19T02:00:00Z', '2026-08-19T02:00:00Z'),
    ('14410000-0000-0000-0000-000000000015', v_portfolio_id, v_user_id, 'LEGACY', 'buy', 1000, 15, 5, '2026-08-01', 'QEO-144 legacy buy', array['qeo144_fixture'], null, '14401000-0000-0000-0000-000000000009', 'legacy_pre_trade_domain', 'deterministic_grouped', '2026-08-01T02:00:00Z', '2026-08-01T02:00:00Z'),
    ('14410000-0000-0000-0000-000000000016', v_portfolio_id, v_user_id, 'LEGACY', 'sell', 1000, 18, 5, '2026-08-07', 'QEO-144 legacy sell', array['qeo144_fixture'], null, '14401000-0000-0000-0000-000000000009', 'legacy_pre_trade_domain', 'deterministic_grouped', '2026-08-07T02:00:00Z', '2026-08-07T02:00:00Z');

  insert into public.portfolio_trade_stop_events (
    id, trade_id, portfolio_id, user_id, ticker, stop_type, price,
    quantity_covered, signal, reason, effective_at, created_at
  ) values
    ('14420000-0000-0000-0000-000000000001', '14401000-0000-0000-0000-000000000002', v_portfolio_id, v_user_id, 'HPG', 'initial', 22, 1000, 'fixture', 'QEO-144 initial stop', '2026-08-03T02:01:00Z', '2026-08-03T02:01:00Z'),
    ('14420000-0000-0000-0000-000000000002', '14401000-0000-0000-0000-000000000003', v_portfolio_id, v_user_id, 'MWG', 'initial', 45, 1500, 'fixture', 'QEO-144 initial stop', '2026-08-04T02:01:00Z', '2026-08-04T02:01:00Z'),
    ('14420000-0000-0000-0000-000000000003', '14401000-0000-0000-0000-000000000004', v_portfolio_id, v_user_id, 'VNM', 'initial', 55, 1000, 'fixture', 'QEO-144 initial stop', '2026-08-06T02:01:00Z', '2026-08-06T02:01:00Z'),
    ('14420000-0000-0000-0000-000000000004', '14401000-0000-0000-0000-000000000007', v_portfolio_id, v_user_id, 'MSN', 'initial', 65, 1000, 'fixture', 'QEO-144 initial stop before trail', '2026-08-14T02:01:00Z', '2026-08-14T02:01:00Z'),
    ('14420000-0000-0000-0000-000000000005', '14401000-0000-0000-0000-000000000007', v_portfolio_id, v_user_id, 'MSN', 'trailing', 68, 1000, 'fixture', 'QEO-144 trailed stop', '2026-08-16T02:00:00Z', '2026-08-16T02:00:00Z'),
    ('14420000-0000-0000-0000-000000000006', '14401000-0000-0000-0000-000000000010', v_portfolio_id, v_user_id, 'PAPER', 'initial', 35, 1000, 'fixture', 'QEO-144 paper stop', '2026-08-17T02:01:00Z', '2026-08-17T02:01:00Z'),
    ('14420000-0000-0000-0000-000000000007', '14401000-0000-0000-0000-000000000011', v_portfolio_id, v_user_id, 'VIC', 'initial', 90, 1000, 'fixture', 'QEO-144 sector-breach stop', '2026-08-18T02:01:00Z', '2026-08-18T02:01:00Z'),
    ('14420000-0000-0000-0000-000000000008', '14401000-0000-0000-0000-000000000012', v_portfolio_id, v_user_id, 'QEOUNK', 'initial', 18, 1000, 'fixture', 'QEO-144 unknown-sector risk evidence', '2026-08-19T02:01:00Z', '2026-08-19T02:01:00Z');

  -- Auditable planning override. The planned FPT Trade still has no fill.
  insert into public.portfolio_trade_journal_entries (
    id, trade_id, portfolio_id, user_id, ticker, phase, note,
    emotion_tags, behavior_tags, adherence_status, override_reason,
    occurred_at, created_at, updated_at
  ) values (
    '14430000-0000-0000-0000-000000000001',
    '14401000-0000-0000-0000-000000000001',
    v_portfolio_id, v_user_id, 'FPT', 'before',
    'QEO-144 concentration/diversification override acceptance fixture',
    '{}', array['concentration_override'], 'deviated',
    'QEO-144 controlled acceptance override reason',
    '2026-08-02T01:05:00Z', '2026-08-02T01:05:00Z', '2026-08-02T01:05:00Z'
  );

  -- External funding stays separate from portfolio_transactions / trading P&L.
  insert into public.portfolio_external_cash_flows (
    id, portfolio_id, user_id, flow_type, signed_amount_vnd,
    effective_at, note, provenance, created_at
  ) values
    ('14440000-0000-0000-0000-000000000001', v_portfolio_id, v_user_id,
      'deposit', 100000000, '2026-08-05T00:00:00Z', 'QEO-144 acceptance deposit', 'manual', '2026-08-05T00:00:00Z'),
    ('14440000-0000-0000-0000-000000000002', v_portfolio_id, v_user_id,
      'withdrawal', -20000000, '2026-08-20T00:00:00Z', 'QEO-144 acceptance withdrawal', 'manual', '2026-08-20T00:00:00Z');
end;
$$;

-- Structured canonical sector source for the fixture. QEOUNK is intentionally
-- absent so QEO-159 must report UNKNOWN rather than guess a classification.
delete from public.market_universe_runs
where id = '14450000-0000-0000-0000-000000000001'::uuid;

insert into public.market_universe_runs (
  id, universe_key, status, source, source_as_of_date, max_size,
  min_market_cap_billion, min_average_volume_50d,
  candidate_count, selected_count, started_at, published_at, created_at
) values (
  '14450000-0000-0000-0000-000000000001',
  'vn_top_stocks', 'published', 'qeo144_fixture', '2026-08-31', 200,
  1, 1, 11, 11,
  '2026-09-09T00:00:00Z', '2026-09-09T00:00:01Z', '2026-09-09T00:00:00Z'
);

insert into public.market_universe_memberships (
  run_id, universe_key, ticker, rank, company_name, exchange, sector,
  market_cap_billion, average_volume_50d, source_as_of_date,
  logo_path, logo_kind, detail_complete, created_at
) values
  ('14450000-0000-0000-0000-000000000001', 'vn_top_stocks', 'FPT', 1, 'FPT fixture', 'HOSE', 'Công nghệ', 100, 1000000, '2026-08-31', '/brand/stockos-mark.svg', 'generated_fallback', true, '2026-09-09T00:00:00Z'),
  ('14450000-0000-0000-0000-000000000001', 'vn_top_stocks', 'HPG', 2, 'HPG fixture', 'HOSE', 'Vật liệu', 100, 1000000, '2026-08-31', '/brand/stockos-mark.svg', 'generated_fallback', true, '2026-09-09T00:00:00Z'),
  ('14450000-0000-0000-0000-000000000001', 'vn_top_stocks', 'MWG', 3, 'MWG fixture', 'HOSE', 'Bán lẻ', 100, 1000000, '2026-08-31', '/brand/stockos-mark.svg', 'generated_fallback', true, '2026-09-09T00:00:00Z'),
  ('14450000-0000-0000-0000-000000000001', 'vn_top_stocks', 'VNM', 4, 'VNM fixture', 'HOSE', 'Hàng tiêu dùng', 100, 1000000, '2026-08-31', '/brand/stockos-mark.svg', 'generated_fallback', true, '2026-09-09T00:00:00Z'),
  ('14450000-0000-0000-0000-000000000001', 'vn_top_stocks', 'ACB', 5, 'ACB fixture', 'HOSE', 'Ngân hàng', 100, 1000000, '2026-08-31', '/brand/stockos-mark.svg', 'generated_fallback', true, '2026-09-09T00:00:00Z'),
  ('14450000-0000-0000-0000-000000000001', 'vn_top_stocks', 'SSI', 6, 'SSI fixture', 'HOSE', 'Dịch vụ tài chính', 100, 1000000, '2026-08-31', '/brand/stockos-mark.svg', 'generated_fallback', true, '2026-09-09T00:00:00Z'),
  ('14450000-0000-0000-0000-000000000001', 'vn_top_stocks', 'MSN', 7, 'MSN fixture', 'HOSE', 'Hàng tiêu dùng', 100, 1000000, '2026-08-31', '/brand/stockos-mark.svg', 'generated_fallback', true, '2026-09-09T00:00:00Z'),
  ('14450000-0000-0000-0000-000000000001', 'vn_top_stocks', 'UNKNOWNSTOP', 8, 'Unknown-stop fixture', 'TEST', 'Kiểm thử', 100, 1000000, '2026-08-31', '/brand/stockos-mark.svg', 'generated_fallback', true, '2026-09-09T00:00:00Z'),
  ('14450000-0000-0000-0000-000000000001', 'vn_top_stocks', 'LEGACY', 9, 'Legacy fixture', 'TEST', 'Kiểm thử', 100, 1000000, '2026-08-31', '/brand/stockos-mark.svg', 'generated_fallback', true, '2026-09-09T00:00:00Z'),
  ('14450000-0000-0000-0000-000000000001', 'vn_top_stocks', 'PAPER', 10, 'Paper fixture', 'TEST', 'Kiểm thử', 100, 1000000, '2026-08-31', '/brand/stockos-mark.svg', 'generated_fallback', true, '2026-09-09T00:00:00Z'),
  ('14450000-0000-0000-0000-000000000001', 'vn_top_stocks', 'VIC', 11, 'VIC fixture', 'HOSE', 'Bất động sản', 100, 1000000, '2026-08-31', '/brand/stockos-mark.svg', 'generated_fallback', true, '2026-09-09T00:00:00Z');

commit;
