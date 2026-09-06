\set ON_ERROR_STOP on

begin;

-- QEO-123 acceptance: adjustment-critical VHM history must survive the canonical
-- persistence boundary exactly, including the two-component 2021 notice.
select public.persist_corporate_action_notice(
  jsonb_build_object(
    'source', 'vsdc', 'source_event_id', '50366', 'source_url', 'https://vsdc.vn/vi/ad/50366',
    'ticker', 'VHM', 'raw_payload', jsonb_build_object('fixture', 'vhm-2018-stock'),
    'raw_evidence_hash', repeat('1', 64), 'source_updated_at', '2018-10-02T16:05:48+07:00'
  ),
  jsonb_build_array(jsonb_build_object(
    'ticker', 'VHM', 'isin', 'VN000000VHM0', 'exchange', 'HOSE',
    'action_type', 'stock_dividend', 'status', 'active', 'record_date', '2018-10-09',
    'ex_date', '2018-10-08', 'ex_date_basis', 'derived',
    'ex_date_derivation_method', 'record_date_previous_verified_trading_session',
    'trading_calendar_version', 'vn-securities-calendar-2018-2026-v1',
    'stock_ratio_numerator', 1000, 'stock_ratio_denominator', 250,
    'source', 'vsdc', 'source_event_id', '50366', 'lineage_root_source_event_id', '50366',
    'source_component_key', 'component:0', 'source_url', 'https://vsdc.vn/vi/ad/50366',
    'raw_evidence_hash', repeat('1', 64), 'source_updated_at', '2018-10-02T16:05:48+07:00',
    'normalization_version', 'qeo123-v1'
  ))
);

select public.persist_corporate_action_notice(
  jsonb_build_object(
    'source', 'vsdc', 'source_event_id', '57987', 'source_url', 'https://vsdc.vn/vi/ad/57987',
    'ticker', 'VHM', 'raw_payload', jsonb_build_object('fixture', 'vhm-2019-cash'),
    'raw_evidence_hash', repeat('2', 64), 'source_updated_at', '2019-08-02T16:20:11+07:00'
  ),
  jsonb_build_array(jsonb_build_object(
    'ticker', 'VHM', 'isin', 'VN000000VHM0', 'exchange', 'HOSE',
    'action_type', 'cash_dividend', 'status', 'active', 'record_date', '2019-08-09',
    'ex_date', '2019-08-08', 'ex_date_basis', 'derived',
    'ex_date_derivation_method', 'record_date_previous_verified_trading_session',
    'trading_calendar_version', 'vn-securities-calendar-2018-2026-v1', 'cash_per_share', 1000,
    'source', 'vsdc', 'source_event_id', '57987', 'lineage_root_source_event_id', '57987',
    'source_component_key', 'component:0', 'source_url', 'https://vsdc.vn/vi/ad/57987',
    'raw_evidence_hash', repeat('2', 64), 'source_updated_at', '2019-08-02T16:20:11+07:00',
    'normalization_version', 'qeo123-v1'
  ))
);

select public.persist_corporate_action_notice(
  jsonb_build_object(
    'source', 'vsdc', 'source_event_id', '144349', 'source_url', 'https://vsdc.vn/vi/ad/144349',
    'ticker', 'VHM', 'raw_payload', jsonb_build_object('fixture', 'vhm-2021-combined'),
    'raw_evidence_hash', repeat('3', 64), 'source_updated_at', '2021-09-07T14:27:48+07:00'
  ),
  jsonb_build_array(
    jsonb_build_object(
      'ticker', 'VHM', 'isin', 'VN000000VHM0', 'exchange', 'HOSE',
      'action_type', 'cash_dividend', 'status', 'active', 'record_date', '2021-09-16',
      'ex_date', '2021-09-15', 'ex_date_basis', 'derived',
      'ex_date_derivation_method', 'record_date_previous_verified_trading_session',
      'trading_calendar_version', 'vn-securities-calendar-2018-2026-v1', 'cash_per_share', 1500,
      'source', 'vsdc', 'source_event_id', '144349', 'lineage_root_source_event_id', '144349',
      'source_component_key', 'component:0', 'source_url', 'https://vsdc.vn/vi/ad/144349',
      'raw_evidence_hash', repeat('3', 64), 'source_updated_at', '2021-09-07T14:27:48+07:00',
      'normalization_version', 'qeo123-v1'
    ),
    jsonb_build_object(
      'ticker', 'VHM', 'isin', 'VN000000VHM0', 'exchange', 'HOSE',
      'action_type', 'stock_dividend', 'status', 'active', 'record_date', '2021-09-16',
      'ex_date', '2021-09-15', 'ex_date_basis', 'derived',
      'ex_date_derivation_method', 'record_date_previous_verified_trading_session',
      'trading_calendar_version', 'vn-securities-calendar-2018-2026-v1',
      'stock_ratio_numerator', 1000, 'stock_ratio_denominator', 300,
      'source', 'vsdc', 'source_event_id', '144349', 'lineage_root_source_event_id', '144349',
      'source_component_key', 'component:1', 'source_url', 'https://vsdc.vn/vi/ad/144349',
      'raw_evidence_hash', repeat('3', 64), 'source_updated_at', '2021-09-07T14:27:48+07:00',
      'normalization_version', 'qeo123-v1'
    )
  )
);

select public.persist_corporate_action_notice(
  jsonb_build_object(
    'source', 'vsdc', 'source_event_id', '150909', 'source_url', 'https://vsdc.vn/vi/ad/150909',
    'ticker', 'VHM', 'raw_payload', jsonb_build_object('fixture', 'vhm-2022-cash'),
    'raw_evidence_hash', repeat('4', 64), 'source_updated_at', '2022-05-20T17:38:42+07:00'
  ),
  jsonb_build_array(jsonb_build_object(
    'ticker', 'VHM', 'isin', 'VN000000VHM0', 'exchange', 'HOSE',
    'action_type', 'cash_dividend', 'status', 'active', 'record_date', '2022-06-01',
    'ex_date', '2022-05-31', 'ex_date_basis', 'derived',
    'ex_date_derivation_method', 'record_date_previous_verified_trading_session',
    'trading_calendar_version', 'vn-securities-calendar-2018-2026-v1', 'cash_per_share', 2000,
    'source', 'vsdc', 'source_event_id', '150909', 'lineage_root_source_event_id', '150909',
    'source_component_key', 'component:0', 'source_url', 'https://vsdc.vn/vi/ad/150909',
    'raw_evidence_hash', repeat('4', 64), 'source_updated_at', '2022-05-20T17:38:42+07:00',
    'normalization_version', 'qeo123-v1'
  ))
);

select public.persist_corporate_action_notice(
  jsonb_build_object(
    'source', 'vsdc', 'source_event_id', '197086', 'source_url', 'https://vsdc.vn/vi/ad/197086',
    'ticker', 'VHM', 'raw_payload', jsonb_build_object('fixture', 'vhm-2026-cash'),
    'raw_evidence_hash', repeat('5', 64), 'source_updated_at', '2026-06-19T09:42:40+07:00'
  ),
  jsonb_build_array(jsonb_build_object(
    'ticker', 'VHM', 'isin', 'VN000000VHM0', 'exchange', 'HOSE',
    'action_type', 'cash_dividend', 'status', 'active', 'record_date', '2026-06-30',
    'ex_date', '2026-06-29', 'ex_date_basis', 'derived',
    'ex_date_derivation_method', 'record_date_previous_verified_trading_session',
    'trading_calendar_version', 'vn-securities-calendar-2018-2026-v1', 'cash_per_share', 6000,
    'source', 'vsdc', 'source_event_id', '197086', 'lineage_root_source_event_id', '197086',
    'source_component_key', 'component:0', 'source_url', 'https://vsdc.vn/vi/ad/197086',
    'raw_evidence_hash', repeat('5', 64), 'source_updated_at', '2026-06-19T09:42:40+07:00',
    'normalization_version', 'qeo123-v1'
  ))
);

select public.persist_corporate_action_notice(
  jsonb_build_object(
    'source', 'vsdc', 'source_event_id', '198392', 'source_url', 'https://vsdc.vn/vi/ad/198392',
    'ticker', 'VHM', 'raw_payload', jsonb_build_object('fixture', 'vhm-2026-stock'),
    'raw_evidence_hash', repeat('6', 64), 'source_updated_at', '2026-07-21T16:29:39+07:00'
  ),
  jsonb_build_array(jsonb_build_object(
    'ticker', 'VHM', 'isin', 'VN000000VHM0', 'exchange', 'HOSE',
    'action_type', 'stock_dividend', 'status', 'active', 'record_date', '2026-08-07',
    'ex_date', '2026-08-06', 'ex_date_basis', 'derived',
    'ex_date_derivation_method', 'record_date_previous_verified_trading_session',
    'trading_calendar_version', 'vn-securities-calendar-2018-2026-v1',
    'stock_ratio_numerator', 1, 'stock_ratio_denominator', 1,
    'source', 'vsdc', 'source_event_id', '198392', 'lineage_root_source_event_id', '198392',
    'source_component_key', 'component:0', 'source_url', 'https://vsdc.vn/vi/ad/198392',
    'raw_evidence_hash', repeat('6', 64), 'source_updated_at', '2026-07-21T16:29:39+07:00',
    'normalization_version', 'qeo123-v1'
  ))
);

do $$
declare
  v_actual jsonb;
  v_expected jsonb := jsonb_build_array(
    jsonb_build_object('source_event_id','50366','component','component:0','type','stock_dividend','record_date','2018-10-09','ex_date','2018-10-08','cash',null,'stock_n',1000,'stock_d',250),
    jsonb_build_object('source_event_id','57987','component','component:0','type','cash_dividend','record_date','2019-08-09','ex_date','2019-08-08','cash',1000,'stock_n',null,'stock_d',null),
    jsonb_build_object('source_event_id','144349','component','component:0','type','cash_dividend','record_date','2021-09-16','ex_date','2021-09-15','cash',1500,'stock_n',null,'stock_d',null),
    jsonb_build_object('source_event_id','144349','component','component:1','type','stock_dividend','record_date','2021-09-16','ex_date','2021-09-15','cash',null,'stock_n',1000,'stock_d',300),
    jsonb_build_object('source_event_id','150909','component','component:0','type','cash_dividend','record_date','2022-06-01','ex_date','2022-05-31','cash',2000,'stock_n',null,'stock_d',null),
    jsonb_build_object('source_event_id','197086','component','component:0','type','cash_dividend','record_date','2026-06-30','ex_date','2026-06-29','cash',6000,'stock_n',null,'stock_d',null),
    jsonb_build_object('source_event_id','198392','component','component:0','type','stock_dividend','record_date','2026-08-07','ex_date','2026-08-06','cash',null,'stock_n',1,'stock_d',1)
  );
begin
  select jsonb_agg(
    jsonb_build_object(
      'source_event_id', source_event_id,
      'component', source_component_key,
      'type', action_type,
      'record_date', record_date::text,
      'ex_date', ex_date::text,
      'cash', cash_per_share,
      'stock_n', stock_ratio_numerator,
      'stock_d', stock_ratio_denominator
    ) order by record_date, source_component_key
  ) into v_actual
  from public.corporate_actions
  where ticker = 'VHM' and source = 'vsdc';

  if v_actual is distinct from v_expected then
    raise exception 'VHM historical canonical round-trip mismatch: actual=% expected=%', v_actual, v_expected;
  end if;

  if (select count(*) from public.corporate_action_source_evidence where ticker = 'VHM' and source = 'vsdc') <> 6 then
    raise exception 'VHM source evidence round-trip expected 6 immutable notices';
  end if;

  if exists (
    select 1 from public.corporate_actions
    where ticker = 'VHM' and source = 'vsdc'
      and (ex_date_basis <> 'derived'
        or ex_date_derivation_method <> 'record_date_previous_verified_trading_session'
        or trading_calendar_version <> 'vn-securities-calendar-2018-2026-v1')
  ) then
    raise exception 'VHM round-trip lost ex-date provenance';
  end if;
end
$$;

rollback;
