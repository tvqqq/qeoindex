begin;

create or replace function public.qeo_trigger_market_universe_monthly()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cron_secret text;
  v_request_id bigint;
begin
  select s.decrypted_secret
  into v_cron_secret
  from vault.decrypted_secrets s
  where s.name = 'qeoindex_cron_secret'
  limit 1;

  if nullif(btrim(v_cron_secret), '') is null then
    raise exception 'qeoindex_cron_secret is not configured in Supabase Vault';
  end if;

  select net.http_post(
    url := 'https://glwhhrmejlonhyorvtzm.supabase.co/functions/v1/market-universe-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_cron_secret
    ),
    body := jsonb_build_object(
      'source', 'supabase_pg_cron',
      'job', 'market.universe_monthly'
    ),
    timeout_milliseconds := 150000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.qeo_trigger_market_universe_monthly() from public, anon, authenticated;
grant execute on function public.qeo_trigger_market_universe_monthly() to service_role;

comment on function public.qeo_trigger_market_universe_monthly() is
  'Triggers canonical VN Top Stocks monthly refresh using the existing Vault scheduler credential.';

do $$
begin
  if exists (select 1 from cron.job where jobname = 'market-universe-monthly-0710-ict') then
    perform cron.unschedule('market-universe-monthly-0710-ict');
  end if;
end $$;

select cron.schedule(
  'market-universe-monthly-0710-ict',
  '10 0 1 * *',
  $cron$
  select public.qeo_trigger_market_universe_monthly();
  $cron$
);

commit;
