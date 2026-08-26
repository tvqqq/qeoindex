-- Allow the trusted QeoIndex server runtime to obtain the dedicated market-close
-- sync secret without duplicating it into Vercel environment configuration.
-- Access is restricted to service_role; browser/authenticated roles cannot execute it.

create or replace function public.qeo_get_market_close_sync_secret()
returns text
language plpgsql
security definer
set search_path = ''
as $$
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

  return v_secret;
end;
$$;

revoke all on function public.qeo_get_market_close_sync_secret() from public, anon, authenticated;
grant execute on function public.qeo_get_market_close_sync_secret() to service_role;
