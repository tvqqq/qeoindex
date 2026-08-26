begin;

-- Secure Vault Helper for KFSP credentials
-- Allows Edge Functions and trusted server service_role to read KFSP username/password from Vault
-- if they are not passed via environment variables.

create or replace function public.qeo_get_kfsp_credentials()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user text;
  v_pass text;
begin
  select s.decrypted_secret into v_user from vault.decrypted_secrets as s where s.name = 'kfsp_username' limit 1;
  select s.decrypted_secret into v_pass from vault.decrypted_secrets as s where s.name = 'kfsp_password' limit 1;

  return jsonb_build_object(
    'has_user', v_user is not null,
    'has_pass', v_pass is not null,
    'username', v_user,
    'password', v_pass
  );
end;
$$;

revoke all on function public.qeo_get_kfsp_credentials() from public, anon, authenticated;
grant execute on function public.qeo_get_kfsp_credentials() to service_role;

commit;
