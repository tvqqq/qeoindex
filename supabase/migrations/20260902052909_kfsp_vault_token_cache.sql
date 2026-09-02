begin;

create or replace function public.qeo_get_kfsp_provider_token_cache()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_payload jsonb;
begin
  select s.decrypted_secret
  into v_secret
  from vault.decrypted_secrets s
  where s.name = 'kfsp_provider_token_cache'
  limit 1;

  if v_secret is null or btrim(v_secret) = '' then
    return null;
  end if;

  begin
    v_payload := v_secret::jsonb;
  exception when others then
    raise exception 'KFSP_VAULT_TOKEN_CACHE_INVALID';
  end;

  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'KFSP_VAULT_TOKEN_CACHE_INVALID';
  end if;

  return v_payload;
end;
$$;

create or replace function public.qeo_set_kfsp_provider_token_cache(
  p_access_token text,
  p_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
  v_payload text;
begin
  if p_access_token is null or btrim(p_access_token) = '' or p_expires_at is null then
    raise exception 'KFSP_VAULT_TOKEN_CACHE_INPUT_INVALID';
  end if;

  v_payload := pg_catalog.jsonb_build_object(
    'access_token', p_access_token,
    'expires_at', p_expires_at
  )::text;

  select s.id
  into v_secret_id
  from vault.secrets s
  where s.name = 'kfsp_provider_token_cache'
  limit 1;

  if v_secret_id is null then
    perform vault.create_secret(
      v_payload,
      'kfsp_provider_token_cache',
      'QeoIndex KFSP provider bearer-token cache managed by service-role RPC',
      null
    );
  else
    perform vault.update_secret(
      v_secret_id,
      v_payload,
      'kfsp_provider_token_cache',
      'QeoIndex KFSP provider bearer-token cache managed by service-role RPC',
      null
    );
  end if;
end;
$$;

revoke all on function public.qeo_get_kfsp_provider_token_cache() from public, anon, authenticated;
revoke all on function public.qeo_set_kfsp_provider_token_cache(text, timestamptz) from public, anon, authenticated;
grant execute on function public.qeo_get_kfsp_provider_token_cache() to service_role;
grant execute on function public.qeo_set_kfsp_provider_token_cache(text, timestamptz) to service_role;

do $$
declare
  v_access_token text;
  v_expires_at timestamptz;
begin
  select t.access_token, t.expires_at
  into v_access_token, v_expires_at
  from public.kfsp_provider_tokens t
  where t.provider = 'kfsp'
  limit 1;

  if v_access_token is not null and btrim(v_access_token) <> '' and v_expires_at is not null then
    perform public.qeo_set_kfsp_provider_token_cache(v_access_token, v_expires_at);
  end if;
end;
$$;

commit;
