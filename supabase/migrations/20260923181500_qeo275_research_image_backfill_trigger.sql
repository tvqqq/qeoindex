begin;

create or replace function public.qeo_trigger_research_report_image_backfill(
  p_max_reports integer default 100,
  p_reason text default 'QEO-275 production legacy summary-image backfill'
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app_url text;
  v_cron_secret text;
  v_request_id bigint;
  v_reason text;
begin
  if p_max_reports is null or p_max_reports < 1 or p_max_reports > 100 then
    raise exception 'p_max_reports must be between 1 and 100';
  end if;

  v_reason := btrim(coalesce(p_reason, ''));
  if length(v_reason) < 8 or length(v_reason) > 240 then
    raise exception 'p_reason must contain 8 to 240 characters';
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
    url := rtrim(v_app_url, '/') || '/api/research-reports/images/backfill',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_cron_secret
    ),
    body := jsonb_build_object(
      'maxReports', p_max_reports,
      'reason', v_reason
    ),
    timeout_milliseconds := 55000
  )
    into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.qeo_trigger_research_report_image_backfill(integer, text)
from public, anon, authenticated;
grant execute on function public.qeo_trigger_research_report_image_backfill(integer, text)
to service_role;

commit;
