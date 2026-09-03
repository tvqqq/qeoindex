begin;

create or replace function public.qeo_verify_market_ai_dispatch_secret(p_secret text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_expected text;
begin
  if nullif(btrim(coalesce(p_secret, '')), '') is null then
    return false;
  end if;

  select s.decrypted_secret
  into v_expected
  from vault.decrypted_secrets s
  where s.name = 'market_ai_conclusion_secret'
  limit 1;

  if nullif(btrim(coalesce(v_expected, '')), '') is null then
    return false;
  end if;

  return v_expected = p_secret;
end;
$$;

revoke all on function public.qeo_verify_market_ai_dispatch_secret(text) from public, anon, authenticated;
grant execute on function public.qeo_verify_market_ai_dispatch_secret(text) to service_role;

comment on function public.qeo_verify_market_ai_dispatch_secret(text) is
  'Service-role-only verifier for the dedicated Market AI dispatch credential stored in Vault. Returns only a boolean and never exposes the secret.';

create or replace function public.dispatch_market_ai_conclusion(p_mode text, p_session_date date default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_url text;
  v_request bigint;
begin
  if p_mode not in ('latest', 'session') or (p_mode = 'session' and p_session_date is null) then
    raise exception 'invalid market AI dispatch';
  end if;

  select s.decrypted_secret
  into v_secret
  from vault.decrypted_secrets s
  where s.name = 'market_ai_conclusion_secret'
  limit 1;

  select s.decrypted_secret
  into v_url
  from vault.decrypted_secrets s
  where s.name = 'market_ai_supabase_url'
  limit 1;

  if nullif(btrim(coalesce(v_secret, '')), '') is null
     or nullif(btrim(coalesce(v_url, '')), '') is null then
    raise exception 'market AI dispatch is not configured';
  end if;

  select net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/market-ai-conclusion',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-market-ai-secret', v_secret
    ),
    body := jsonb_build_object('mode', p_mode)
      || case
        when p_mode = 'session' then jsonb_build_object('sessionDate', p_session_date)
        else '{}'::jsonb
      end,
    timeout_milliseconds := 5000
  )
  into v_request;

  return v_request;
end;
$$;

revoke all on function public.dispatch_market_ai_conclusion(text,date) from public, anon, authenticated;
grant execute on function public.dispatch_market_ai_conclusion(text,date) to service_role;

comment on function public.dispatch_market_ai_conclusion(text,date) is
  'Dispatches the Market AI Edge Function using dedicated Vault-backed URL and machine credential. No secret value is exposed to callers.';

commit;
