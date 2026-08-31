begin;

-- KFSP Insights contract v2 stores provider values without synthetic fallbacks.
alter table public.market_insight_daily
  drop constraint if exists market_insight_daily_risk_score_check;

alter table public.market_insight_daily
  add constraint market_insight_daily_risk_score_check
    check (risk_score is null or risk_score between 0 and 1) not valid,
  alter column market_regime drop not null,
  alter column distribution_window drop not null,
  add column if not exists sentiment_history jsonb not null default '[]'::jsonb
    check (jsonb_typeof(sentiment_history) = 'array'),
  add column if not exists risk_history jsonb not null default '[]'::jsonb
    check (jsonb_typeof(risk_history) = 'array'),
  add column if not exists valuation_history jsonb not null default '[]'::jsonb
    check (jsonb_typeof(valuation_history) = 'array');

alter table public.market_insight_sectors
  alter column average_change_pct drop not null,
  drop constraint if exists market_insight_sectors_effort_pct_check;

alter table public.market_insight_sectors
  add constraint market_insight_sectors_effort_pct_check
    check (effort_pct is null or effort_pct >= -100),
  add column if not exists close_price numeric,
  add column if not exists previous_traded_value numeric
    check (previous_traded_value is null or previous_traded_value >= 0),
  add column if not exists ma10_state text check (ma10_state is null or ma10_state in ('up', 'down')),
  add column if not exists ma20_state text check (ma20_state is null or ma20_state in ('up', 'down')),
  add column if not exists ma50_state text check (ma50_state is null or ma50_state in ('up', 'down')),
  add column if not exists rotation_history jsonb not null default '[]'::jsonb
    check (jsonb_typeof(rotation_history) = 'array');

-- Remove values that were produced by the former local heuristics.
update public.market_insight_daily
set market_regime = null,
    distribution_window = null,
    risk_score = case when risk_score > 1 then risk_score / 100 else risk_score end,
    risk_label = case
      when risk_score is null then null
      when (case when risk_score > 1 then risk_score / 100 else risk_score end) < 0.3 then 'Thấp'
      when (case when risk_score > 1 then risk_score / 100 else risk_score end) <= 0.7 then 'Trung tính'
      else 'Cao'
    end,
    sentiment_label = case
      when sentiment_score is null then null
      when sentiment_score >= 80 then 'Tham lam tột độ'
      when sentiment_score >= 60 then 'Tham lam'
      when sentiment_score >= 40 then 'Trung lập'
      when sentiment_score >= 20 then 'Sợ hãi'
      else 'Sợ hãi tột độ'
    end;

update public.market_insight_sectors
set rs_score = null,
    rotation_state = 'unknown',
    strength_ratio = null,
    momentum_ratio = null,
    average_change_pct = null,
    effort_pct = null,
    result_pct = null,
    effort_result_state = null;

alter table public.market_insight_daily
  validate constraint market_insight_daily_risk_score_check;

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
begin
  -- The existing publisher owns locking, P0 validation and the four-table atomic replace.
  v_result := public.publish_market_insight_snapshot(p_sync_run_id);

  update public.market_insight_daily as target
  set market_regime = null,
      distribution_window = null,
      sentiment_history = coalesce(stage.normalized_payload->'sentiment_history', '[]'::jsonb),
      risk_history = coalesce(stage.normalized_payload->'risk_history', '[]'::jsonb),
      valuation_history = coalesce(stage.normalized_payload->'valuation_history', '[]'::jsonb)
  from public.market_insight_snapshot_staging as stage
  where stage.run_id = p_sync_run_id
    and stage.category = 'daily'
    and target.sync_run_id = p_sync_run_id;

  update public.market_insight_sectors as target
  set close_price = (stage.normalized_payload->>'close_price')::numeric,
      previous_traded_value = (stage.normalized_payload->>'previous_traded_value')::numeric,
      ma10_state = stage.normalized_payload->>'ma10_state',
      ma20_state = stage.normalized_payload->>'ma20_state',
      ma50_state = stage.normalized_payload->>'ma50_state',
      rotation_history = coalesce(stage.normalized_payload->'rotation_history', '[]'::jsonb)
  from public.market_insight_snapshot_staging as stage
  where stage.run_id = p_sync_run_id
    and stage.category = 'sector'
    and target.sync_run_id = p_sync_run_id
    and target.sector_key = stage.normalized_payload->>'sector_key'
    and target.time_window = coalesce(stage.normalized_payload->>'time_window', '1d');

  return v_result || jsonb_build_object('contract_version', 2);
end;
$$;

revoke all on function public.publish_market_insight_snapshot_v2(uuid) from public, anon, authenticated;
grant execute on function public.publish_market_insight_snapshot_v2(uuid) to service_role;

commit;
