\set ON_ERROR_STOP on

begin;

-- This test intentionally rejects an invalid canonical cash dividend. The evidence
-- append and canonical upsert are one PostgreSQL function call, so the evidence
-- must be rolled back by the function statement's subtransaction on failure.
do $$
declare
  v_rejected boolean := false;
begin
  begin
    perform public.persist_corporate_action_notice(
      jsonb_build_object(
        'source', 'vsdc',
        'source_event_id', 'atomic-failure-strict',
        'source_url', 'https://vsdc.vn/vi/ad/999998',
        'ticker', 'VHM',
        'raw_payload', jsonb_build_object('fixture', 'must-rollback-strict'),
        'raw_evidence_hash', repeat('f', 64),
        'source_updated_at', '2026-09-06T12:01:00+07:00'
      ),
      jsonb_build_array(
        jsonb_build_object(
          'ticker', 'VHM',
          'exchange', 'HOSE',
          'action_type', 'cash_dividend',
          'status', 'active',
          'record_date', '2026-09-07',
          'ex_date_basis', 'unknown',
          'source', 'vsdc',
          'source_event_id', 'atomic-failure-strict',
          'lineage_root_source_event_id', 'atomic-failure-strict',
          'source_component_key', 'component:0',
          'source_url', 'https://vsdc.vn/vi/ad/999998',
          'raw_evidence_hash', repeat('f', 64),
          'source_updated_at', '2026-09-06T12:01:00+07:00',
          'normalization_version', 'qeo123-v1'
        )
      )
    );
  exception
    when check_violation then
      v_rejected := true;
  end;

  if not v_rejected then
    raise exception 'invalid canonical action did not fail with a check violation';
  end if;

  if exists (
    select 1
    from public.corporate_action_source_evidence
    where source = 'vsdc'
      and source_event_id = 'atomic-failure-strict'
  ) then
    raise exception 'failed atomic persistence leaked source evidence';
  end if;
end
$$;

rollback;
