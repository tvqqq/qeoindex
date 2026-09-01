begin;

create table if not exists public.kfsp_manual_dispatch_runs (
  request_id uuid primary key,
  job_key text not null check (job_key in ('kfsp.rating_daily', 'kfsp.ttai_history')),
  reason text not null check (char_length(reason) between 1 and 500),
  requested_by text not null,
  request_body jsonb not null,
  net_request_id bigint,
  dispatched_at timestamptz not null default now()
);

create index if not exists kfsp_manual_dispatch_runs_dispatched_idx
  on public.kfsp_manual_dispatch_runs(dispatched_at desc, job_key);

alter table public.kfsp_manual_dispatch_runs enable row level security;
revoke all privileges on table public.kfsp_manual_dispatch_runs from anon, authenticated;
grant all privileges on table public.kfsp_manual_dispatch_runs to service_role;

create or replace function public.qeo_dispatch_kfsp_job(
  p_job_key text,
  p_request_id uuid,
  p_reason text,
  p_tickers text[] default null,
  p_force boolean default false
)
returns table (
  request_id uuid,
  job_key text,
  net_request_id bigint,
  dispatched_at timestamptz,
  duplicate boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_url text;
  v_body jsonb;
  v_tickers text[];
  v_net_request_id bigint;
  v_dispatched_at timestamptz;
  v_inserted boolean := false;
begin
  if p_job_key not in ('kfsp.rating_daily', 'kfsp.ttai_history') then
    raise exception 'Unsupported KFSP job key: %', p_job_key;
  end if;
  if p_request_id is null then
    raise exception 'p_request_id is required for idempotent dispatch';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'p_reason is required';
  end if;

  if p_job_key = 'kfsp.ttai_history' then
    select coalesce(array_agg(t order by ord), '{}'::text[])
    into v_tickers
    from (
      select upper(btrim(raw_ticker)) as t, min(ord) as ord
      from unnest(coalesce(p_tickers, '{}'::text[])) with ordinality as x(raw_ticker, ord)
      where upper(btrim(raw_ticker)) ~ '^[A-Z0-9]{2,12}$'
      group by upper(btrim(raw_ticker))
    ) normalized;

    if cardinality(v_tickers) = 0 or cardinality(v_tickers) > 50 then
      raise exception 'TTAI manual dispatch requires 1..50 unique valid tickers';
    end if;

    v_url := 'https://glwhhrmejlonhyorvtzm.supabase.co/functions/v1/kfsp-ttai-history-sync';
    v_body := jsonb_build_object(
      'source', 'manual_recovery_rpc',
      'request_id', p_request_id,
      'reason', btrim(p_reason),
      'tickers', to_jsonb(v_tickers),
      'force', p_force
    );
  else
    if cardinality(coalesce(p_tickers, '{}'::text[])) > 0 then
      raise exception 'Rating manual dispatch does not accept p_tickers';
    end if;

    v_url := 'https://glwhhrmejlonhyorvtzm.supabase.co/functions/v1/kfsp-rating-sync';
    v_body := jsonb_build_object(
      'source', 'manual_recovery_rpc',
      'request_id', p_request_id,
      'reason', btrim(p_reason)
    );
  end if;

  insert into public.kfsp_manual_dispatch_runs (
    request_id, job_key, reason, requested_by, request_body
  ) values (
    p_request_id,
    p_job_key,
    btrim(p_reason),
    coalesce(auth.uid()::text, current_user),
    v_body
  )
  on conflict (request_id) do nothing;

  get diagnostics v_inserted = row_count;

  if not v_inserted then
    return query
    select r.request_id, r.job_key, r.net_request_id, r.dispatched_at, true
    from public.kfsp_manual_dispatch_runs r
    where r.request_id = p_request_id;
    return;
  end if;

  select s.decrypted_secret
  into v_secret
  from vault.decrypted_secrets s
  where s.name = 'kfsp_sync_secret'
  limit 1;

  if nullif(btrim(v_secret), '') is null then
    raise exception 'kfsp_sync_secret is not configured in Supabase Vault';
  end if;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-KFSP-Sync-Secret', v_secret
    ),
    body := v_body,
    timeout_milliseconds := 55000
  ) into v_net_request_id;

  update public.kfsp_manual_dispatch_runs r
  set net_request_id = v_net_request_id
  where r.request_id = p_request_id
  returning r.dispatched_at into v_dispatched_at;

  return query
  select p_request_id, p_job_key, v_net_request_id, v_dispatched_at, false;
end;
$$;

revoke all on function public.qeo_dispatch_kfsp_job(text, uuid, text, text[], boolean) from public, anon, authenticated;
grant execute on function public.qeo_dispatch_kfsp_job(text, uuid, text, text[], boolean) to service_role;

comment on function public.qeo_dispatch_kfsp_job(text, uuid, text, text[], boolean) is
  'One-shot idempotent service-role-only dispatcher for KFSP rating/TTAI recovery jobs. Vault credentials remain server-side and are never returned.';

commit;
