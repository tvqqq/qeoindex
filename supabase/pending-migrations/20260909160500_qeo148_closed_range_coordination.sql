begin;

-- QEO-148: durable coordination for reusable CLOSED 1m provider ranges.
-- This migration is intentionally quarantined in pending-migrations. It must
-- not be promoted/applied to production without the explicit release gate.
create table if not exists public.chart_ohlcv_backfill_ranges (
  id uuid primary key default gen_random_uuid(),
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  source_key text not null check (char_length(source_key) between 1 and 64),
  base_resolution text not null check (base_resolution = '1m'),
  price_basis text not null check (price_basis = 'RAW'),
  range_start timestamptz not null,
  range_end timestamptz not null,
  lease_owner uuid,
  lease_fence bigint not null default 0 check (lease_fence >= 0),
  lease_expires_at timestamptz,
  success_at timestamptz,
  success_provider text,
  success_provenance_batch_id uuid references public.chart_ohlcv_provenance_batches(id) on delete set null,
  success_row_count integer,
  success_content_id text,
  last_failure_at timestamptz,
  last_failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (range_end > range_start),
  check ((lease_owner is null) = (lease_expires_at is null)),
  check (
    success_at is null
    or (
      success_provider is not null
      and success_provenance_batch_id is not null
      and success_row_count is not null and success_row_count > 0
      and success_content_id ~ '^[a-f0-9]{64}$'
    )
  ),
  unique (ticker, source_key, base_resolution, price_basis, range_start, range_end)
);

create index if not exists chart_ohlcv_backfill_ranges_success_lookup_idx
  on public.chart_ohlcv_backfill_ranges
  (ticker, source_key, base_resolution, price_basis, range_start, range_end, id)
  where success_at is not null;

create index if not exists chart_ohlcv_backfill_ranges_active_lease_idx
  on public.chart_ohlcv_backfill_ranges
  (ticker, source_key, base_resolution, price_basis, lease_expires_at)
  where lease_owner is not null;

alter table public.chart_ohlcv_backfill_ranges enable row level security;
revoke all privileges on table public.chart_ohlcv_backfill_ranges from public, anon, authenticated, service_role;

create or replace function public.qeo_chart_intraday_backfill_lock_key(
  p_ticker text,
  p_source_key text
)
returns bigint
language sql
immutable
strict
set search_path = 'pg_catalog', 'public'
as $function$
  select hashtextextended(
    'qeo148-chart-backfill:' || upper(btrim(p_ticker)) || ':' || btrim(p_source_key),
    0
  )
$function$;

-- Server-side gaps-and-islands avoids the PostgREST row cap entirely. Only
-- rows with durable success_at are coverage. Provenance/failure/lease presence
-- alone can never suppress retry.
create or replace function public.qeo_chart_intraday_success_coverage(
  p_ticker text,
  p_source_key text,
  p_range_start timestamptz,
  p_range_end timestamptz
)
returns table(range_start timestamptz, range_end timestamptz)
language sql
stable
security definer
set search_path = 'pg_catalog', 'public'
as $function$
  with ordered as (
    select
      r.range_start,
      r.range_end,
      r.id,
      max(r.range_end) over (
        order by r.range_start, r.range_end, r.id
        rows between unbounded preceding and 1 preceding
      ) as prior_max_end
    from public.chart_ohlcv_backfill_ranges r
    where r.ticker = upper(btrim(p_ticker))
      and r.source_key = btrim(p_source_key)
      and r.base_resolution = '1m'
      and r.price_basis = 'RAW'
      and r.success_at is not null
      and r.range_start < p_range_end
      and r.range_end > p_range_start
  ), grouped as (
    select
      o.*,
      sum(case when o.prior_max_end is null or o.range_start > o.prior_max_end then 1 else 0 end)
        over (order by o.range_start, o.range_end, o.id) as group_id
    from ordered o
  )
  select min(g.range_start), max(g.range_end)
  from grouped g
  group by g.group_id
  order by min(g.range_start), max(g.range_end)
$function$;

create or replace function public.qeo_claim_chart_intraday_range(
  p_ticker text,
  p_source_key text,
  p_range_start timestamptz,
  p_range_end timestamptz,
  p_lease_owner uuid,
  p_revalidate boolean default false,
  p_lease_seconds integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $function$
declare
  v_ticker text := upper(btrim(p_ticker));
  v_source_key text := btrim(p_source_key);
  v_busy_expires_at timestamptz;
  v_id uuid;
  v_fence bigint;
  v_previous_content_id text;
  v_previous_provenance_batch_id uuid;
begin
  if v_ticker !~ '^[A-Z0-9]{2,12}$' or v_source_key is null or char_length(v_source_key) not between 1 and 64 then
    raise exception 'QEO-148 invalid closed-range identity';
  end if;
  if p_range_start is null or p_range_end is null or p_range_end <= p_range_start then
    raise exception 'QEO-148 invalid closed range';
  end if;
  if p_lease_owner is null or p_lease_seconds not between 10 and 300 then
    raise exception 'QEO-148 invalid lease';
  end if;

  -- This transaction-level lock protects claim metadata only. Provider/network
  -- and HOT/COLD persistence run after this RPC transaction has committed.
  perform pg_advisory_xact_lock(public.qeo_chart_intraday_backfill_lock_key(v_ticker, v_source_key));

  if not coalesce(p_revalidate, false) and exists (
    select 1
    from public.qeo_chart_intraday_success_coverage(v_ticker, v_source_key, p_range_start, p_range_end) c
    where c.range_start <= p_range_start and c.range_end >= p_range_end
  ) then
    return jsonb_build_object('status', 'covered');
  end if;

  select r.lease_expires_at
  into v_busy_expires_at
  from public.chart_ohlcv_backfill_ranges r
  where r.ticker = v_ticker
    and r.source_key = v_source_key
    and r.base_resolution = '1m'
    and r.price_basis = 'RAW'
    and r.lease_owner is not null
    and r.lease_expires_at > clock_timestamp()
    and r.range_start < p_range_end
    and r.range_end > p_range_start
  order by r.lease_expires_at desc, r.id
  limit 1;

  if v_busy_expires_at is not null then
    return jsonb_build_object('status', 'busy', 'leaseExpiresAt', v_busy_expires_at);
  end if;

  insert into public.chart_ohlcv_backfill_ranges (
    ticker,
    source_key,
    base_resolution,
    price_basis,
    range_start,
    range_end,
    lease_owner,
    lease_fence,
    lease_expires_at,
    updated_at
  ) values (
    v_ticker,
    v_source_key,
    '1m',
    'RAW',
    p_range_start,
    p_range_end,
    p_lease_owner,
    1,
    clock_timestamp() + make_interval(secs => p_lease_seconds),
    clock_timestamp()
  )
  on conflict (ticker, source_key, base_resolution, price_basis, range_start, range_end)
  do update set
    lease_owner = excluded.lease_owner,
    lease_fence = public.chart_ohlcv_backfill_ranges.lease_fence + 1,
    lease_expires_at = excluded.lease_expires_at,
    updated_at = clock_timestamp()
  returning
    id,
    lease_fence,
    success_content_id,
    success_provenance_batch_id
  into v_id, v_fence, v_previous_content_id, v_previous_provenance_batch_id;

  return jsonb_build_object(
    'status', 'claimed',
    'rangeId', v_id,
    'leaseOwner', p_lease_owner,
    'fence', v_fence,
    'previousContentId', v_previous_content_id,
    'previousProvenanceBatchId', v_previous_provenance_batch_id
  );
end;
$function$;

create or replace function public.qeo_complete_chart_intraday_range(
  p_range_id uuid,
  p_lease_owner uuid,
  p_lease_fence bigint,
  p_provider text,
  p_row_count integer,
  p_provenance_batch_id uuid,
  p_content_id text
)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $function$
declare
  v_updated integer;
begin
  if p_range_id is null or p_lease_owner is null or p_lease_fence <= 0
     or p_provider is null or char_length(btrim(p_provider)) not between 1 and 64
     or p_row_count <= 0 or p_provenance_batch_id is null
     or p_content_id !~ '^[a-f0-9]{64}$' then
    raise exception 'QEO-148 invalid completion evidence';
  end if;

  update public.chart_ohlcv_backfill_ranges
  set success_at = clock_timestamp(),
      success_provider = btrim(p_provider),
      success_row_count = p_row_count,
      success_provenance_batch_id = p_provenance_batch_id,
      success_content_id = p_content_id,
      lease_owner = null,
      lease_expires_at = null,
      last_failure_at = null,
      last_failure_reason = null,
      updated_at = clock_timestamp()
  where id = p_range_id
    and lease_owner = p_lease_owner
    and lease_fence = p_lease_fence
    and lease_expires_at > clock_timestamp();

  get diagnostics v_updated = row_count;
  if v_updated = 1 then
    return jsonb_build_object('status', 'completed');
  end if;
  return jsonb_build_object('status', 'stale');
end;
$function$;

create or replace function public.qeo_abandon_chart_intraday_range(
  p_range_id uuid,
  p_lease_owner uuid,
  p_lease_fence bigint,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $function$
declare
  v_updated integer;
begin
  update public.chart_ohlcv_backfill_ranges
  set lease_owner = null,
      lease_expires_at = null,
      last_failure_at = clock_timestamp(),
      last_failure_reason = left(coalesce(nullif(btrim(p_reason), ''), 'unknown'), 240),
      updated_at = clock_timestamp()
  where id = p_range_id
    and lease_owner = p_lease_owner
    and lease_fence = p_lease_fence;

  get diagnostics v_updated = row_count;
  return jsonb_build_object('status', case when v_updated = 1 then 'abandoned' else 'stale' end);
end;
$function$;

revoke all on function public.qeo_chart_intraday_backfill_lock_key(text, text) from public, anon, authenticated, service_role;
revoke all on function public.qeo_chart_intraday_success_coverage(text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.qeo_claim_chart_intraday_range(text, text, timestamptz, timestamptz, uuid, boolean, integer) from public, anon, authenticated;
revoke all on function public.qeo_complete_chart_intraday_range(uuid, uuid, bigint, text, integer, uuid, text) from public, anon, authenticated;
revoke all on function public.qeo_abandon_chart_intraday_range(uuid, uuid, bigint, text) from public, anon, authenticated;

grant execute on function public.qeo_chart_intraday_success_coverage(text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.qeo_claim_chart_intraday_range(text, text, timestamptz, timestamptz, uuid, boolean, integer) to service_role;
grant execute on function public.qeo_complete_chart_intraday_range(uuid, uuid, bigint, text, integer, uuid, text) to service_role;
grant execute on function public.qeo_abandon_chart_intraday_range(uuid, uuid, bigint, text) to service_role;

commit;
