create or replace function public.qeo_trigger_eod_pipeline_backfill(p_session_date date)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app_url text;
  v_cron_secret text;
  v_request_id bigint;
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if p_session_date is null then
    raise exception 'p_session_date is required';
  end if;

  if p_session_date >= v_today then
    raise exception 'Backfill session date % must be earlier than current Vietnam date %', p_session_date, v_today;
  end if;

  select s.decrypted_secret
  into v_app_url
  from vault.decrypted_secrets s
  where s.name = 'qeoindex_app_url'
  limit 1;

  if nullif(btrim(v_app_url), '') is null then
    raise exception 'qeoindex_app_url is not configured in Supabase Vault';
  end if;

  select s.decrypted_secret
  into v_cron_secret
  from vault.decrypted_secrets s
  where s.name = 'qeoindex_cron_secret'
  limit 1;

  if nullif(btrim(v_cron_secret), '') is null then
    raise exception 'qeoindex_cron_secret is not configured in Supabase Vault';
  end if;

  select net.http_post(
    url := rtrim(v_app_url, '/') || '/api/qeoindex/eod?sessionDate=' || to_char(p_session_date, 'YYYY-MM-DD'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_cron_secret
    ),
    body := jsonb_build_object(
      'source', 'manual_backfill',
      'job', 'qeoindex.eod_pipeline',
      'sessionDate', to_char(p_session_date, 'YYYY-MM-DD')
    ),
    timeout_milliseconds := 55000
  )
  into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.qeo_trigger_eod_pipeline_backfill(date) from public, anon, authenticated;
grant execute on function public.qeo_trigger_eod_pipeline_backfill(date) to service_role;

comment on function public.qeo_trigger_eod_pipeline_backfill(date) is 'Service-role-only historical EOD backfill trigger. Calls the authenticated QeoIndex EOD route with an explicit past Vietnam session date.';
