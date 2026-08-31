begin;

-- Contract v1 stored sector Nỗ lực in both average_change_pct and result_pct.
-- The actual provider Kết quả was not retained, so the only truthful repair is
-- null rather than reconstructing it from another field.
alter table public.market_insight_sectors
  alter column average_change_pct drop not null;

update public.market_insight_sectors as sector
set average_change_pct = null,
    result_pct = null
from public.market_insight_sync_runs as run
where run.id = sector.sync_run_id
  and run.contract_version = 1;

-- publish_market_insight_snapshot() deliberately deletes staging rows after the
-- atomic v1 publish. Capture the v2-only payloads before invoking it so the
-- wrapper can persist exact KFSP histories, MA states and RRG history without
-- changing the established locking/P0/replace behavior.
create or replace function public.publish_market_insight_snapshot_v2(
  p_sync_run_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_daily_payload jsonb;
  v_sector_payloads jsonb;
begin
  select stage.normalized_payload
    into v_daily_payload
  from public.market_insight_snapshot_staging as stage
  where stage.run_id = p_sync_run_id
    and stage.category = 'daily'
  limit 1;

  select coalesce(jsonb_agg(stage.normalized_payload), '[]'::jsonb)
    into v_sector_payloads
  from public.market_insight_snapshot_staging as stage
  where stage.run_id = p_sync_run_id
    and stage.category = 'sector';

  -- The existing publisher owns locking, P0 validation, four-table replace,
  -- run completion and staging cleanup.
  v_result := public.publish_market_insight_snapshot(p_sync_run_id);

  update public.market_insight_daily as target
  set market_regime = null,
      distribution_window = null,
      sentiment_history = coalesce(v_daily_payload->'sentiment_history', '[]'::jsonb),
      risk_history = coalesce(v_daily_payload->'risk_history', '[]'::jsonb),
      valuation_history = coalesce(v_daily_payload->'valuation_history', '[]'::jsonb)
  where target.sync_run_id = p_sync_run_id;

  update public.market_insight_sectors as target
  set close_price = (stage.payload->>'close_price')::numeric,
      previous_traded_value = (stage.payload->>'previous_traded_value')::numeric,
      ma10_state = stage.payload->>'ma10_state',
      ma20_state = stage.payload->>'ma20_state',
      ma50_state = stage.payload->>'ma50_state',
      rotation_history = coalesce(stage.payload->'rotation_history', '[]'::jsonb)
  from jsonb_array_elements(v_sector_payloads) as stage(payload)
  where target.sync_run_id = p_sync_run_id
    and target.sector_key = stage.payload->>'sector_key'
    and target.time_window = coalesce(stage.payload->>'time_window', '1d');

  return v_result || jsonb_build_object('contract_version', 2);
end;
$$;

revoke all on function public.publish_market_insight_snapshot_v2(uuid) from public, anon, authenticated;
grant execute on function public.publish_market_insight_snapshot_v2(uuid) to service_role;

commit;
