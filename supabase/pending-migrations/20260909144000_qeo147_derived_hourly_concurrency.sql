begin;

-- QEO-147 follow-up: readiness validation and every derived-row mutation share
-- one manifest advisory lock. The xact lock closes the publish/prune race while
-- keeping concurrent generations recoverable rather than falsely READY.
-- qeo_publish_chart_derived_hourly_readiness invokes the shared validator from
-- the first QEO-147 migration, so publication inherits this same xact lock.
create or replace function public.qeo_chart_derived_hourly_manifest_lock_key(
  p_manifest_id uuid
)
returns bigint
language sql
immutable
strict
set search_path = 'pg_catalog', 'public'
as $function$
  select hashtextextended('qeo147-derived-manifest:' || p_manifest_id::text, 0);
$function$;

create or replace function public.qeo_stamp_chart_derived_hourly_content_identity()
returns trigger
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_old_key bigint;
  v_new_key bigint;
begin
  if tg_op = 'DELETE' then
    if old.source_manifest_id is null then
      raise exception 'QEO-147 derived delete has incomplete manifest identity';
    end if;
    perform pg_advisory_xact_lock(public.qeo_chart_derived_hourly_manifest_lock_key(old.source_manifest_id));
    return old;
  end if;

  if new.source_manifest_id is null or new.generation_id is null or new.source_format_version is null then
    raise exception 'QEO-147 derived write requires manifest, generation and source format identity';
  end if;

  v_new_key := public.qeo_chart_derived_hourly_manifest_lock_key(new.source_manifest_id);
  if tg_op = 'UPDATE'
     and old.source_manifest_id is not null
     and old.source_manifest_id is distinct from new.source_manifest_id then
    v_old_key := public.qeo_chart_derived_hourly_manifest_lock_key(old.source_manifest_id);
    if v_old_key < v_new_key then
      perform pg_advisory_xact_lock(v_old_key);
      perform pg_advisory_xact_lock(v_new_key);
    else
      perform pg_advisory_xact_lock(v_new_key);
      perform pg_advisory_xact_lock(v_old_key);
    end if;
  else
    perform pg_advisory_xact_lock(v_new_key);
  end if;

  new.content_digest := public.qeo_chart_derived_hourly_row_content_digest(
    new.ticker,
    new.resolution,
    new.bar_time,
    new.open,
    new.high,
    new.low,
    new.close,
    new.volume,
    new.source_manifest_id,
    new.source_sha256,
    new.source_range_start,
    new.source_range_end,
    new.source_raw_row_count,
    new.source_format_version,
    new.source_canonical_content_digest,
    new.source_canonical_content_version,
    new.aggregation_version,
    new.generation_id
  );
  return new;
end;
$function$;

drop trigger if exists qeo147_chart_derived_hourly_content_identity on public.chart_ohlcv_derived_hourly;
create trigger qeo147_chart_derived_hourly_content_identity
before insert or update or delete on public.chart_ohlcv_derived_hourly
for each row execute function public.qeo_stamp_chart_derived_hourly_content_identity();

create or replace function public.qeo_invalidate_chart_derived_hourly_readiness()
returns trigger
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $function$
begin
  if tg_op <> 'INSERT' and old.source_manifest_id is not null then
    delete from public.chart_ohlcv_derived_hourly_readiness
    where source_manifest_id = old.source_manifest_id;
  end if;
  if tg_op <> 'DELETE' and new.source_manifest_id is not null then
    delete from public.chart_ohlcv_derived_hourly_readiness
    where source_manifest_id = new.source_manifest_id;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

create or replace function public.qeo_validate_chart_derived_hourly_manifests(
  p_manifest_ids uuid[]
)
returns table (
  manifest_id uuid,
  ready boolean,
  reason text
)
language plpgsql
volatile
security definer
set search_path = 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_manifest_id uuid;
begin
  -- Stable lock order prevents deadlocks when one request validates several
  -- manifests. Advisory xact locks remain held through the caller transaction,
  -- so prune cannot delete RAW while a competing derived generation mutates.
  for v_manifest_id in
    select distinct q.id
    from unnest(coalesce(p_manifest_ids, array[]::uuid[])) as q(id)
    where q.id is not null
    order by q.id
  loop
    perform pg_advisory_xact_lock(public.qeo_chart_derived_hourly_manifest_lock_key(v_manifest_id));
  end loop;

  return query
  with requested as (
    select distinct id as manifest_id
    from unnest(coalesce(p_manifest_ids, array[]::uuid[])) as q(id)
    where id is not null
  )
  select
    q.manifest_id,
    case
      when m.id is null or m.base_resolution <> '1m' or m.verified_at is null then false
      when r.source_manifest_id is null then false
      when r.ticker <> m.ticker
        or r.source_sha256 <> m.sha256
        or r.source_range_start <> m.range_start
        or r.source_range_end <> m.range_end
        or r.source_raw_row_count <> m.row_count
        or r.source_format_version <> m.format_version
        or r.source_canonical_content_digest is distinct from m.canonical_content_digest
        or r.source_canonical_content_version is distinct from m.canonical_content_version
        or r.aggregation_version <> 'vn-session-v1' then false
      when coalesce(c.derived_row_count, 0) <> r.derived_row_count
        or not coalesce(c.generation_match, false)
        or not coalesce(c.metadata_match, false)
        or c.derived_content_digest is distinct from r.derived_content_digest then false
      else true
    end as ready,
    case
      when m.id is null or m.base_resolution <> '1m' or m.verified_at is null then 'source_missing'
      when r.source_manifest_id is null then 'unknown'
      when r.ticker <> m.ticker
        or r.source_sha256 <> m.sha256
        or r.source_range_start <> m.range_start
        or r.source_range_end <> m.range_end
        or r.source_raw_row_count <> m.row_count
        or r.source_format_version <> m.format_version
        or r.source_canonical_content_digest is distinct from m.canonical_content_digest
        or r.source_canonical_content_version is distinct from m.canonical_content_version then 'source_mismatch'
      when r.aggregation_version <> 'vn-session-v1' then 'stale_version'
      when coalesce(c.derived_row_count, 0) <> r.derived_row_count
        or not coalesce(c.generation_match, false)
        or not coalesce(c.metadata_match, false)
        or c.derived_content_digest is distinct from r.derived_content_digest then 'content_mismatch'
      else 'ready'
    end as reason
  from requested q
  left join public.chart_ohlcv_cold_manifests m on m.id = q.manifest_id
  left join public.chart_ohlcv_derived_hourly_readiness r on r.source_manifest_id = q.manifest_id
  left join lateral (
    select
      count(*)::integer as derived_row_count,
      bool_and(h.generation_id = r.generation_id) as generation_match,
      bool_and(
        h.ticker = m.ticker
        and h.resolution = '1h'
        and h.source_sha256 = m.sha256
        and h.source_range_start = m.range_start
        and h.source_range_end = m.range_end
        and h.source_raw_row_count = m.row_count
        and h.source_format_version = m.format_version
        and h.source_canonical_content_digest is not distinct from m.canonical_content_digest
        and h.source_canonical_content_version is not distinct from m.canonical_content_version
        and h.aggregation_version = r.aggregation_version
        and h.content_digest is not null
      ) as metadata_match,
      encode(
        digest(coalesce(string_agg(h.content_digest, '' order by h.bar_time), ''), 'sha256'),
        'hex'
      ) as derived_content_digest
    from public.chart_ohlcv_derived_hourly h
    where h.source_manifest_id = q.manifest_id
  ) c on true;
end;
$function$;

-- Readiness rows are publication state, not an application-owned table. All
-- mutation goes through SECURITY DEFINER publication/invalidation functions.
revoke all privileges on table public.chart_ohlcv_derived_hourly_readiness from service_role;
revoke all on function public.qeo_chart_derived_hourly_manifest_lock_key(uuid) from public, anon, authenticated, service_role;
revoke all on function public.qeo_stamp_chart_derived_hourly_content_identity() from public, anon, authenticated, service_role;
revoke all on function public.qeo_invalidate_chart_derived_hourly_readiness() from public, anon, authenticated, service_role;
revoke all on function public.qeo_validate_chart_derived_hourly_manifests(uuid[]) from public, anon, authenticated;
grant execute on function public.qeo_validate_chart_derived_hourly_manifests(uuid[]) to service_role;

comment on function public.qeo_chart_derived_hourly_manifest_lock_key(uuid) is
  'QEO-147 deterministic manifest advisory lock shared by derived DML and readiness validation/publication/prune transactions.';
comment on function public.qeo_validate_chart_derived_hourly_manifests(uuid[]) is
  'QEO-147 shared locked validator. READY requires exact source identity, aggregation version, generation, row count and full persisted content digest.';

commit;
