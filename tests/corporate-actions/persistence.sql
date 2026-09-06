\set ON_ERROR_STOP on

begin;

-- QEO-123 persistence must be a single PostgreSQL transaction boundary.
do $$
begin
  if to_regprocedure('public.persist_corporate_action_notice(jsonb,jsonb)') is null then
    raise exception 'missing persist_corporate_action_notice(jsonb,jsonb)';
  end if;

  if has_function_privilege('anon', 'public.persist_corporate_action_notice(jsonb,jsonb)', 'execute') then
    raise exception 'anon must not execute corporate-action persistence';
  end if;
  if has_function_privilege('authenticated', 'public.persist_corporate_action_notice(jsonb,jsonb)', 'execute') then
    raise exception 'authenticated must not execute corporate-action persistence';
  end if;
  if not has_function_privilege('service_role', 'public.persist_corporate_action_notice(jsonb,jsonb)', 'execute') then
    raise exception 'service_role must execute corporate-action persistence';
  end if;
end
$$;

-- Multi-component notice: one immutable evidence snapshot, two canonical components.
select public.persist_corporate_action_notice(
  jsonb_build_object(
    'source', 'vsdc',
    'source_event_id', '144349',
    'source_url', 'https://vsdc.vn/vi/ad/144349',
    'ticker', 'VHM',
    'raw_payload', jsonb_build_object('fixture', 'vhm-2021'),
    'raw_evidence_hash', repeat('a', 64),
    'source_updated_at', '2021-09-07T14:27:48+07:00'
  ),
  jsonb_build_array(
    jsonb_build_object(
      'ticker', 'VHM', 'isin', 'VN000000VHM0', 'exchange', 'HOSE',
      'action_type', 'cash_dividend', 'status', 'active',
      'record_date', '2021-09-16', 'ex_date', '2021-09-15', 'ex_date_basis', 'derived',
      'ex_date_derivation_method', 'record_date_previous_verified_trading_session',
      'trading_calendar_version', 'vn-securities-calendar-2018-2026-v1',
      'cash_per_share', 1500,
      'source', 'vsdc', 'source_event_id', '144349', 'lineage_root_source_event_id', '144349',
      'source_component_key', 'component:0', 'source_url', 'https://vsdc.vn/vi/ad/144349',
      'raw_evidence_hash', repeat('a', 64), 'source_updated_at', '2021-09-07T14:27:48+07:00',
      'normalization_version', 'qeo123-v1'
    ),
    jsonb_build_object(
      'ticker', 'VHM', 'isin', 'VN000000VHM0', 'exchange', 'HOSE',
      'action_type', 'stock_dividend', 'status', 'active',
      'record_date', '2021-09-16', 'ex_date', '2021-09-15', 'ex_date_basis', 'derived',
      'ex_date_derivation_method', 'record_date_previous_verified_trading_session',
      'trading_calendar_version', 'vn-securities-calendar-2018-2026-v1',
      'stock_ratio_numerator', 1000, 'stock_ratio_denominator', 300,
      'source', 'vsdc', 'source_event_id', '144349', 'lineage_root_source_event_id', '144349',
      'source_component_key', 'component:1', 'source_url', 'https://vsdc.vn/vi/ad/144349',
      'raw_evidence_hash', repeat('a', 64), 'source_updated_at', '2021-09-07T14:27:48+07:00',
      'normalization_version', 'qeo123-v1'
    )
  )
);

-- Exact replay must be idempotent.
select public.persist_corporate_action_notice(
  jsonb_build_object(
    'source', 'vsdc', 'source_event_id', '144349', 'source_url', 'https://vsdc.vn/vi/ad/144349',
    'ticker', 'VHM', 'raw_payload', jsonb_build_object('fixture', 'vhm-2021'),
    'raw_evidence_hash', repeat('a', 64), 'source_updated_at', '2021-09-07T14:27:48+07:00'
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
      'raw_evidence_hash', repeat('a', 64), 'source_updated_at', '2021-09-07T14:27:48+07:00',
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
      'raw_evidence_hash', repeat('a', 64), 'source_updated_at', '2021-09-07T14:27:48+07:00',
      'normalization_version', 'qeo123-v1'
    )
  )
);

do $$
begin
  if (select count(*) from public.corporate_action_source_evidence where source = 'vsdc' and source_event_id = '144349') <> 1 then
    raise exception 'evidence replay is not idempotent';
  end if;
  if (select count(*) from public.corporate_actions where source = 'vsdc' and lineage_root_source_event_id = '144349') <> 2 then
    raise exception 'multi-component canonical replay is not idempotent';
  end if;
end
$$;

-- Original SNC notice, then a newer correction with its own event ID but the same lineage root.
select public.persist_corporate_action_notice(
  jsonb_build_object(
    'source', 'vsdc', 'source_event_id', '198978', 'source_url', 'https://vsdc.vn/vi/ad/198978',
    'ticker', 'SNC', 'raw_payload', jsonb_build_object('fixture', 'snc-original'),
    'raw_evidence_hash', repeat('b', 64), 'source_updated_at', '2026-08-06T15:06:05+07:00'
  ),
  jsonb_build_array(
    jsonb_build_object(
      'ticker', 'SNC', 'exchange', 'UPCOM', 'action_type', 'cash_dividend', 'status', 'active',
      'record_date', '2026-08-27', 'ex_date_basis', 'unknown', 'cash_per_share', 1000,
      'source', 'vsdc', 'source_event_id', '198978', 'lineage_root_source_event_id', '198978',
      'source_component_key', 'component:0', 'source_url', 'https://vsdc.vn/vi/ad/198978',
      'raw_evidence_hash', repeat('b', 64), 'source_updated_at', '2026-08-06T15:06:05+07:00',
      'normalization_version', 'qeo123-v1'
    )
  )
);

select public.persist_corporate_action_notice(
  jsonb_build_object(
    'source', 'vsdc', 'source_event_id', '199110', 'source_url', 'https://vsdc.vn/vi/ad/199110',
    'ticker', 'SNC', 'raw_payload', jsonb_build_object('fixture', 'snc-correction'),
    'raw_evidence_hash', repeat('c', 64), 'source_updated_at', '2026-08-11T11:10:33+07:00',
    'amendment_type', 'correction', 'referenced_source_event_id', '198978',
    'referenced_notice_number', '1515/TB-CNVSDC', 'referenced_notice_date', '2026-08-06'
  ),
  jsonb_build_array(
    jsonb_build_object(
      'ticker', 'SNC', 'exchange', 'UPCOM', 'action_type', 'cash_dividend', 'status', 'active',
      'record_date', '2026-08-27', 'ex_date_basis', 'unknown', 'cash_per_share', 1200,
      'source', 'vsdc', 'source_event_id', '199110', 'lineage_root_source_event_id', '198978',
      'source_component_key', 'component:0', 'source_url', 'https://vsdc.vn/vi/ad/199110',
      'raw_evidence_hash', repeat('c', 64), 'source_updated_at', '2026-08-11T11:10:33+07:00',
      'normalization_version', 'qeo123-v1'
    )
  )
);

do $$
declare
  v_count integer;
  v_event text;
  v_cash numeric;
begin
  select count(*), max(source_event_id), max(cash_per_share)
    into v_count, v_event, v_cash
    from public.corporate_actions
    where source = 'vsdc' and lineage_root_source_event_id = '198978' and source_component_key = 'component:0';
  if v_count <> 1 or v_event <> '199110' or v_cash <> 1200 then
    raise exception 'newer correction did not update the canonical lineage in place';
  end if;
end
$$;

-- A stale later-fetched event must remain as immutable evidence but must not roll canonical state backward.
select public.persist_corporate_action_notice(
  jsonb_build_object(
    'source', 'vsdc', 'source_event_id', '199111', 'source_url', 'https://vsdc.vn/vi/ad/199111',
    'ticker', 'SNC', 'raw_payload', jsonb_build_object('fixture', 'stale-correction'),
    'raw_evidence_hash', repeat('d', 64), 'source_updated_at', '2026-08-07T10:00:00+07:00',
    'amendment_type', 'correction', 'referenced_source_event_id', '198978'
  ),
  jsonb_build_array(
    jsonb_build_object(
      'ticker', 'SNC', 'exchange', 'UPCOM', 'action_type', 'cash_dividend', 'status', 'active',
      'record_date', '2026-08-27', 'ex_date_basis', 'unknown', 'cash_per_share', 900,
      'source', 'vsdc', 'source_event_id', '199111', 'lineage_root_source_event_id', '198978',
      'source_component_key', 'component:0', 'source_url', 'https://vsdc.vn/vi/ad/199111',
      'raw_evidence_hash', repeat('d', 64), 'source_updated_at', '2026-08-07T10:00:00+07:00',
      'normalization_version', 'qeo123-v1'
    )
  )
);

do $$
begin
  if not exists (
    select 1 from public.corporate_action_source_evidence
    where source = 'vsdc' and source_event_id = '199111' and raw_evidence_hash = repeat('d', 64)
  ) then
    raise exception 'stale source evidence was not retained';
  end if;
  if not exists (
    select 1 from public.corporate_actions
    where source = 'vsdc' and lineage_root_source_event_id = '198978'
      and source_component_key = 'component:0' and source_event_id = '199110' and cash_per_share = 1200
  ) then
    raise exception 'stale correction rolled canonical state backward';
  end if;
end
$$;

-- Any invalid canonical component must rollback the evidence append from the same RPC call.
do $$
begin
  begin
    perform public.persist_corporate_action_notice(
      jsonb_build_object(
        'source', 'vsdc', 'source_event_id', 'atomic-failure', 'source_url', 'https://vsdc.vn/vi/ad/999999',
        'ticker', 'VHM', 'raw_payload', jsonb_build_object('fixture', 'must-rollback'),
        'raw_evidence_hash', repeat('e', 64), 'source_updated_at', '2026-09-06T12:00:00+07:00'
      ),
      jsonb_build_array(
        jsonb_build_object(
          'ticker', 'VHM', 'exchange', 'HOSE', 'action_type', 'cash_dividend', 'status', 'active',
          'record_date', '2026-09-07', 'ex_date_basis', 'unknown',
          'source', 'vsdc', 'source_event_id', 'atomic-failure', 'lineage_root_source_event_id', 'atomic-failure',
          'source_component_key', 'component:0', 'source_url', 'https://vsdc.vn/vi/ad/999999',
          'raw_evidence_hash', repeat('e', 64), 'source_updated_at', '2026-09-06T12:00:00+07:00',
          'normalization_version', 'qeo123-v1'
        )
      )
    );
    raise exception 'invalid action unexpectedly persisted';
  exception
    when check_violation or raise_exception then
      null;
  end;

  if exists (
    select 1 from public.corporate_action_source_evidence
    where source = 'vsdc' and source_event_id = 'atomic-failure'
  ) then
    raise exception 'evidence escaped failed atomic persistence transaction';
  end if;
end
$$;

rollback;
