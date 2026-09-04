begin;

-- QEO-77: protect every active privileged orderbook-sync caller with the same
-- Vault-backed machine credential already used by the canonical EOD runtime.
-- Never persist the decrypted value in migration history or scheduler metadata.
do $$
declare
  v_secret text;
begin
  select s.decrypted_secret
    into v_secret
  from vault.decrypted_secrets as s
  where s.name = 'kfsp_sync_secret'
  limit 1;

  if nullif(btrim(coalesce(v_secret, '')), '') is null then
    raise exception 'MARKET_CLOSE_SYNC_SECRET_NOT_CONFIGURED';
  end if;
end
$$;

-- Keep only the QEO-64 active intraday scheduler ownership. The standalone
-- 14:45/14:50 EOD jobs remain retired; final market-close collection is owned
-- by qeoindex-eod-pipeline-1515-ict.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'sync-universe-5m') then
    perform cron.unschedule('sync-universe-5m');
  end if;
  if exists (select 1 from cron.job where jobname = 'sync-universe-5m-afternoon') then
    perform cron.unschedule('sync-universe-5m-afternoon');
  end if;
end
$$;

select cron.schedule(
  'sync-universe-5m',
  '*/5 2-4 * * 1-5',
  $cron$
  select net.http_post(
    url := 'https://glwhhrmejlonhyorvtzm.supabase.co/functions/v1/orderbook-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || public.qeo_get_market_close_sync_secret()
    ),
    body := '{"source": "supabase_pg_cron", "session": "morning"}'::jsonb,
    timeout_milliseconds := 25000
  )
  where (now() at time zone 'Asia/Ho_Chi_Minh')::time between time '09:00' and time '11:30';
  $cron$
);

select cron.schedule(
  'sync-universe-5m-afternoon',
  '*/5 6-7 * * 1-5',
  $cron$
  select net.http_post(
    url := 'https://glwhhrmejlonhyorvtzm.supabase.co/functions/v1/orderbook-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || public.qeo_get_market_close_sync_secret()
    ),
    body := '{"source": "supabase_pg_cron", "session": "afternoon"}'::jsonb,
    timeout_milliseconds := 25000
  )
  where (now() at time zone 'Asia/Ho_Chi_Minh')::time between time '13:00' and time '14:40';
  $cron$
);

-- Clean-rebuild bootstrap is a service-role-only recovery path and must obey
-- the same Edge authorization boundary as the recurring schedulers.
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
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || public.qeo_get_market_close_sync_secret()
    ),
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
