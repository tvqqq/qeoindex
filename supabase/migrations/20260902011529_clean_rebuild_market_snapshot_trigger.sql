begin;

-- A clean rebuild intentionally removes current orderbook snapshots. EOD_READY is
-- fail-closed and requires a fresh same-session snapshot for every canonical stock
-- before MARKET_CLOSE_COLLECT runs, so rebuild orchestration needs an explicit
-- bootstrap step between universe publication and EOD dispatch.
--
-- Reuse the existing canonical orderbook-sync Edge Function that production
-- pg_cron already invokes. Keep the SQL trigger service-role-only; do not weaken
-- EOD_READY or expose another application endpoint.
create or replace function public.qeo_trigger_market_snapshot_bootstrap()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id uuid;
  v_selected_count integer;
  v_request_id bigint;
begin
  select r.id, r.selected_count
  into v_run_id, v_selected_count
  from public.market_universe_runs r
  where r.universe_key = 'vn_top_stocks'
    and r.status = 'published'
    and r.published_at is not null
  order by r.published_at desc
  limit 1;

  if v_run_id is null or coalesce(v_selected_count, 0) < 1 then
    raise exception 'Canonical vn_top_stocks universe is not published';
  end if;

  select net.http_post(
    url := 'https://glwhhrmejlonhyorvtzm.supabase.co/functions/v1/orderbook-sync',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object(
      'action', 'clean_rebuild_bootstrap',
      'source', 'qeo_trigger_market_snapshot_bootstrap',
      'universeRunId', v_run_id
    ),
    timeout_milliseconds := 55000
  )
  into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.qeo_trigger_market_snapshot_bootstrap() from public, anon, authenticated;
grant execute on function public.qeo_trigger_market_snapshot_bootstrap() to service_role;

commit;
