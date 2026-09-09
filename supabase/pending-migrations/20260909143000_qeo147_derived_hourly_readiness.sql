begin;

-- QEO-147: derived 1h is rebuildable cache only. Legacy rows intentionally
-- remain UNKNOWN until a complete source-matching generation is persisted,
-- read back exactly, and published through the service-role RPC below.
create extension if not exists pgcrypto with schema extensions;

alter table public.chart_ohlcv_derived_hourly
  add column if not exists source_format_version smallint,
  add column if not exists source_canonical_content_digest text,
  add column if not exists source_canonical_content_version bigint,
  add column if not exists generation_id uuid,
  add column if not exists content_digest text;

do $function$
begin
  if not exists (select 1 from pg_constraint where conname = 'chart_ohlcv_derived_hourly_source_format_version_check') then
    alter table public.chart_ohlcv_derived_hourly
      add constraint chart_ohlcv_derived_hourly_source_format_version_check
      check (source_format_version is null or source_format_version > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chart_ohlcv_derived_hourly_source_content_digest_check') then
    alter table public.chart_ohlcv_derived_hourly
      add constraint chart_ohlcv_derived_hourly_source_content_digest_check
      check (source_canonical_content_digest is null or source_canonical_content_digest ~ '^[a-f0-9]{64}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chart_ohlcv_derived_hourly_source_content_version_check') then
    alter table public.chart_ohlcv_derived_hourly
      add constraint chart_ohlcv_derived_hourly_source_content_version_check
      check (source_canonical_content_version is null or source_canonical_content_version > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chart_ohlcv_derived_hourly_content_digest_check') then
    alter table public.chart_ohlcv_derived_hourly
      add constraint chart_ohlcv_derived_hourly_content_digest_check
      check (content_digest is null or content_digest ~ '^[a-f0-9]{64}$');
  end if;
end;
$function$;

create table if not exists public.chart_ohlcv_derived_hourly_readiness (
  source_manifest_id uuid primary key references public.chart_ohlcv_cold_manifests(id) on delete cascade,
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  resolution text not null default '1h' check (resolution = '1h'),
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  source_range_start timestamptz not null,
  source_range_end timestamptz not null,
  source_raw_row_count integer not null check (source_raw_row_count > 0),
  source_format_version smallint not null check (source_format_version > 0),
  source_canonical_content_digest text check (source_canonical_content_digest is null or source_canonical_content_digest ~ '^[a-f0-9]{64}$'),
  source_canonical_content_version bigint check (source_canonical_content_version is null or source_canonical_content_version > 0),
  aggregation_version text not null check (aggregation_version = 'vn-session-v1'),
  generation_id uuid not null,
  derived_row_count integer not null check (derived_row_count > 0),
  derived_content_digest text not null check (derived_content_digest ~ '^[a-f0-9]{64}$'),
  published_at timestamptz not null default now(),
  check (source_range_end >= source_range_start)
);

create index if not exists chart_ohlcv_derived_hourly_readiness_ticker_idx
  on public.chart_ohlcv_derived_hourly_readiness (ticker, published_at desc);

alter table public.chart_ohlcv_derived_hourly_readiness enable row level security;
revoke all privileges on table public.chart_ohlcv_derived_hourly_readiness from public, anon, authenticated;
grant select, insert, update, delete on table public.chart_ohlcv_derived_hourly_readiness to service_role;

create or replace function public.qeo_chart_derived_hourly_row_content_digest(
  p_ticker text,
  p_resolution text,
  p_bar_time timestamptz,
  p_open double precision,
  p_high double precision,
  p_low double precision,
  p_close double precision,
  p_volume double precision,
  p_source_manifest_id uuid,
  p_source_sha256 text,
  p_source_range_start timestamptz,
  p_source_range_end timestamptz,
  p_source_raw_row_count integer,
  p_source_format_version smallint,
  p_source_canonical_content_digest text,
  p_source_canonical_content_version bigint,
  p_aggregation_version text,
  p_generation_id uuid
)
returns text
language sql
immutable
set search_path = 'pg_catalog', 'public', 'extensions'
as $function$
  select encode(
    digest(
      convert_to(
        jsonb_build_object(
          'ticker', p_ticker,
          'resolution', p_resolution,
          'barTime', to_char(p_bar_time at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'open', p_open,
          'high', p_high,
          'low', p_low,
          'close', p_close,
          'volume', p_volume,
          'sourceManifestId', p_source_manifest_id,
          'sourceSha256', p_source_sha256,
          'sourceRangeStart', to_char(p_source_range_start at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'sourceRangeEnd', to_char(p_source_range_end at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'sourceRawRowCount', p_source_raw_row_count,
          'sourceFormatVersion', p_source_format_version,
          'sourceCanonicalContentDigest', p_source_canonical_content_digest,
          'sourceCanonicalContentVersion', p_source_canonical_content_version,
          'aggregationVersion', p_aggregation_version,
          'generationId', p_generation_id
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$function$;

create or replace function public.qeo_stamp_chart_derived_hourly_content_identity()
returns trigger
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'extensions'
as $function$
begin
  if new.generation_id is null or new.source_format_version is null then
    raise exception 'QEO-147 derived write requires generation and source format identity';
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
  return coalesce(new, old);
end;
$function$;

drop trigger if exists qeo147_chart_derived_hourly_content_identity on public.chart_ohlcv_derived_hourly;
create trigger qeo147_chart_derived_hourly_content_identity
before insert or update on public.chart_ohlcv_derived_hourly
for each row execute function public.qeo_stamp_chart_derived_hourly_content_identity();

drop trigger if exists qeo147_chart_derived_hourly_readiness_invalidation on public.chart_ohlcv_derived_hourly;
create trigger qeo147_chart_derived_hourly_readiness_invalidation
after insert or update or delete on public.chart_ohlcv_derived_hourly
for each row execute function public.qeo_invalidate_chart_derived_hourly_readiness();

-- service_role may rebuild cache rows but cannot bypass mutation invalidation.
revoke trigger on table public.chart_ohlcv_derived_hourly from service_role;

revoke all on function public.qeo_chart_derived_hourly_row_content_digest(text, text, timestamptz, double precision, double precision, double precision, double precision, double precision, uuid, text, timestamptz, timestamptz, integer, smallint, text, bigint, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.qeo_stamp_chart_derived_hourly_content_identity() from public, anon, authenticated, service_role;
revoke all on function public.qeo_invalidate_chart_derived_hourly_readiness() from public, anon, authenticated, service_role;

create or replace function public.qeo_validate_chart_derived_hourly_manifests(
  p_manifest_ids uuid[]
)
returns table (
  manifest_id uuid,
  ready boolean,
  reason text
)
language sql
stable
security definer
set search_path = 'pg_catalog', 'public', 'extensions'
as $function$
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
$function$;

revoke all on function public.qeo_validate_chart_derived_hourly_manifests(uuid[]) from public, anon, authenticated;
grant execute on function public.qeo_validate_chart_derived_hourly_manifests(uuid[]) to service_role;

create or replace function public.qeo_publish_chart_derived_hourly_readiness(
  p_manifest_id uuid,
  p_expected_sha256 text,
  p_expected_range_start timestamptz,
  p_expected_range_end timestamptz,
  p_expected_raw_row_count integer,
  p_expected_format_version smallint,
  p_expected_canonical_content_digest text,
  p_expected_canonical_content_version bigint,
  p_aggregation_version text,
  p_generation_id uuid,
  p_expected_derived_row_count integer,
  p_expected_derived_content_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_manifest public.chart_ohlcv_cold_manifests%rowtype;
  v_count integer := 0;
  v_generation_match boolean := false;
  v_metadata_match boolean := false;
  v_digest text;
  v_ready boolean := false;
begin
  if p_manifest_id is null
     or p_expected_raw_row_count is null or p_expected_raw_row_count <= 0
     or p_expected_format_version is null or p_expected_format_version <= 0
     or p_aggregation_version <> 'vn-session-v1'
     or p_generation_id is null
     or p_expected_derived_row_count is null or p_expected_derived_row_count <= 0
     or p_expected_derived_content_digest is null
     or p_expected_derived_content_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'QEO-147 publication requires complete generation proof';
  end if;

  select * into v_manifest
  from public.chart_ohlcv_cold_manifests
  where id = p_manifest_id
  for update;
  if not found then
    raise exception 'QEO-147 publication manifest not found: %', p_manifest_id;
  end if;

  if v_manifest.base_resolution <> '1m'
     or v_manifest.verified_at is null
     or v_manifest.sha256 <> p_expected_sha256
     or v_manifest.range_start <> p_expected_range_start
     or v_manifest.range_end <> p_expected_range_end
     or v_manifest.row_count <> p_expected_raw_row_count
     or v_manifest.format_version <> p_expected_format_version
     or v_manifest.canonical_content_digest is distinct from p_expected_canonical_content_digest
     or v_manifest.canonical_content_version is distinct from p_expected_canonical_content_version then
    raise exception 'QEO-147 publication source proof mismatch: %', p_manifest_id;
  end if;

  select
    count(*)::integer,
    bool_and(h.generation_id = p_generation_id),
    bool_and(
      h.ticker = v_manifest.ticker
      and h.resolution = '1h'
      and h.source_sha256 = v_manifest.sha256
      and h.source_range_start = v_manifest.range_start
      and h.source_range_end = v_manifest.range_end
      and h.source_raw_row_count = v_manifest.row_count
      and h.source_format_version = v_manifest.format_version
      and h.source_canonical_content_digest is not distinct from v_manifest.canonical_content_digest
      and h.source_canonical_content_version is not distinct from v_manifest.canonical_content_version
      and h.aggregation_version = p_aggregation_version
      and h.content_digest is not null
    ),
    encode(
      digest(coalesce(string_agg(h.content_digest, '' order by h.bar_time), ''), 'sha256'),
      'hex'
    )
  into v_count, v_generation_match, v_metadata_match, v_digest
  from public.chart_ohlcv_derived_hourly h
  where h.source_manifest_id = p_manifest_id;

  if v_count <> p_expected_derived_row_count
     or not coalesce(v_generation_match, false)
     or not coalesce(v_metadata_match, false)
     or v_digest <> p_expected_derived_content_digest then
    raise exception 'QEO-147 publication derived proof mismatch: %', p_manifest_id;
  end if;

  insert into public.chart_ohlcv_derived_hourly_readiness (
    source_manifest_id,
    ticker,
    resolution,
    source_sha256,
    source_range_start,
    source_range_end,
    source_raw_row_count,
    source_format_version,
    source_canonical_content_digest,
    source_canonical_content_version,
    aggregation_version,
    generation_id,
    derived_row_count,
    derived_content_digest,
    published_at
  ) values (
    p_manifest_id,
    v_manifest.ticker,
    '1h',
    v_manifest.sha256,
    v_manifest.range_start,
    v_manifest.range_end,
    v_manifest.row_count,
    v_manifest.format_version,
    v_manifest.canonical_content_digest,
    v_manifest.canonical_content_version,
    p_aggregation_version,
    p_generation_id,
    p_expected_derived_row_count,
    p_expected_derived_content_digest,
    now()
  )
  on conflict (source_manifest_id) do update set
    ticker = excluded.ticker,
    resolution = excluded.resolution,
    source_sha256 = excluded.source_sha256,
    source_range_start = excluded.source_range_start,
    source_range_end = excluded.source_range_end,
    source_raw_row_count = excluded.source_raw_row_count,
    source_format_version = excluded.source_format_version,
    source_canonical_content_digest = excluded.source_canonical_content_digest,
    source_canonical_content_version = excluded.source_canonical_content_version,
    aggregation_version = excluded.aggregation_version,
    generation_id = excluded.generation_id,
    derived_row_count = excluded.derived_row_count,
    derived_content_digest = excluded.derived_content_digest,
    published_at = excluded.published_at;

  select coalesce(v.ready, false)
  into v_ready
  from public.qeo_validate_chart_derived_hourly_manifests(array[p_manifest_id]) v
  where v.manifest_id = p_manifest_id;
  if not coalesce(v_ready, false) then
    raise exception 'QEO-147 publication post-validation failed: %', p_manifest_id;
  end if;

  return jsonb_build_object(
    'status', 'ready',
    'manifestId', p_manifest_id,
    'generationId', p_generation_id,
    'derivedRowCount', p_expected_derived_row_count,
    'derivedContentDigest', p_expected_derived_content_digest
  );
end;
$function$;

revoke all on function public.qeo_publish_chart_derived_hourly_readiness(uuid, text, timestamptz, timestamptz, integer, smallint, text, bigint, text, uuid, integer, text) from public, anon, authenticated;
grant execute on function public.qeo_publish_chart_derived_hourly_readiness(uuid, text, timestamptz, timestamptz, integer, smallint, text, bigint, text, uuid, integer, text) to service_role;

-- QEO-149 prune remains correction-safe, but derived authority now requires
-- the same positive complete-generation validator used by routing/recovery.
create or replace function public.qeo_prune_verified_chart_intraday_partition(
  p_manifest_id uuid,
  p_expected_sha256 text,
  p_expected_row_count integer,
  p_expected_content_digest text,
  p_expected_content_version bigint,
  p_expected_newer_sessions text[]
)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_manifest public.chart_ohlcv_cold_manifests%rowtype;
  v_ticker text;
  v_range_start timestamptz;
  v_range_end timestamptz;
  v_candidate_date date;
  v_hot_rows bigint := 0;
  v_hot_version bigint := 0;
  v_hot_digest text;
  v_retention_sessions bigint := 0;
  v_deleted bigint := 0;
begin
  if p_manifest_id is null
     or p_expected_row_count is null
     or p_expected_row_count <= 0
     or p_expected_content_digest is null
     or p_expected_content_digest !~ '^[a-f0-9]{64}$'
     or p_expected_content_version is null
     or p_expected_content_version <= 0
     or coalesce(array_length(p_expected_newer_sessions, 1), 0) < 5 then
    raise exception 'QEO-149 prune requires complete archive and retention proof';
  end if;

  if exists (
    select 1
    from unnest(p_expected_newer_sessions) as s(session_date)
    where s.session_date !~ '^\d{4}-\d{2}-\d{2}$'
  ) then
    raise exception 'QEO-149 prune retention proof contains malformed session date';
  end if;

  select ticker, range_start, range_end
  into v_ticker, v_range_start, v_range_end
  from public.chart_ohlcv_cold_manifests
  where id = p_manifest_id;
  if not found then
    raise exception 'QEO-149 prune manifest not found: %', p_manifest_id;
  end if;

  if (v_range_start at time zone 'Asia/Ho_Chi_Minh')::date
     is distinct from (v_range_end at time zone 'Asia/Ho_Chi_Minh')::date then
    raise exception 'QEO-149 prune requires one Vietnam ticker session per manifest: %', p_manifest_id;
  end if;
  v_candidate_date := (v_range_start at time zone 'Asia/Ho_Chi_Minh')::date;

  perform pg_advisory_xact_lock(public.qeo_chart_intraday_session_lock_key(v_ticker, v_range_start));

  select *
  into v_manifest
  from public.chart_ohlcv_cold_manifests
  where id = p_manifest_id
  for update;
  if not found then
    raise exception 'QEO-149 prune manifest disappeared: %', p_manifest_id;
  end if;

  if v_manifest.base_resolution <> '1m'
     or v_manifest.verified_at is null
     or v_manifest.sha256 <> p_expected_sha256
     or v_manifest.row_count <> p_expected_row_count
     or v_manifest.canonical_content_digest is null
     or v_manifest.canonical_content_digest <> p_expected_content_digest
     or v_manifest.canonical_content_version is null
     or v_manifest.canonical_content_version <> p_expected_content_version then
    raise exception 'QEO-149 prune archive proof mismatch: %', p_manifest_id;
  end if;

  if not exists (
    select 1
    from public.qeo_validate_chart_derived_hourly_manifests(array[p_manifest_id]) v
    where v.manifest_id = p_manifest_id
      and v.ready
  ) then
    raise exception 'QEO-147 derived hourly generation is not ready for manifest: %', p_manifest_id;
  end if;

  select count(distinct s.session_date::date)
  into v_retention_sessions
  from unnest(p_expected_newer_sessions) as s(session_date)
  where extract(isodow from s.session_date::date) between 1 and 5
    and s.session_date::date > v_candidate_date
    and exists (
      select 1
      from public.chart_ohlcv_intraday h
      where h.ticker = v_manifest.ticker
        and h.base_resolution = '1m'
        and (h.bar_time at time zone 'Asia/Ho_Chi_Minh')::date = s.session_date::date
    );
  if v_retention_sessions < 5 then
    return jsonb_build_object(
      'status', 'deferred',
      'reason', 'retention_mismatch',
      'manifestId', p_manifest_id,
      'ticker', v_manifest.ticker,
      'deletedRows', 0,
      'retentionSessions', v_retention_sessions
    );
  end if;

  select count(*)::bigint,
    coalesce(max(h.content_version), 0),
    encode(
      digest(coalesce(string_agg(h.content_digest, '' order by h.bar_time), ''), 'sha256'),
      'hex'
    )
  into v_hot_rows, v_hot_version, v_hot_digest
  from public.chart_ohlcv_intraday h
  where h.ticker = v_manifest.ticker
    and h.base_resolution = '1m'
    and h.bar_time >= v_manifest.range_start
    and h.bar_time <= v_manifest.range_end;

  if v_hot_rows <> p_expected_row_count
     or v_hot_digest <> p_expected_content_digest
     or v_hot_version <> p_expected_content_version then
    return jsonb_build_object(
      'status', 'deferred',
      'reason', 'content_mismatch',
      'manifestId', p_manifest_id,
      'ticker', v_manifest.ticker,
      'deletedRows', 0,
      'expectedRows', p_expected_row_count,
      'foundRows', v_hot_rows,
      'expectedContentDigest', p_expected_content_digest,
      'foundContentDigest', v_hot_digest,
      'expectedContentVersion', p_expected_content_version,
      'foundContentVersion', v_hot_version
    );
  end if;

  delete from public.chart_ohlcv_intraday h
  where h.ticker = v_manifest.ticker
    and h.base_resolution = '1m'
    and h.bar_time >= v_manifest.range_start
    and h.bar_time <= v_manifest.range_end;
  get diagnostics v_deleted = row_count;

  if v_deleted <> p_expected_row_count then
    raise exception 'QEO-149 atomic prune mismatch: manifest %, expected %, deleted %', p_manifest_id, p_expected_row_count, v_deleted;
  end if;

  return jsonb_build_object(
    'status', 'pruned',
    'manifestId', p_manifest_id,
    'ticker', v_manifest.ticker,
    'rangeStart', v_manifest.range_start,
    'rangeEnd', v_manifest.range_end,
    'deletedRows', v_deleted,
    'sha256', v_manifest.sha256,
    'contentDigest', v_manifest.canonical_content_digest,
    'contentVersion', v_manifest.canonical_content_version
  );
end;
$function$;

revoke all on function public.qeo_prune_verified_chart_intraday_partition(uuid, text, integer, text, bigint, text[]) from public, anon, authenticated;
grant execute on function public.qeo_prune_verified_chart_intraday_partition(uuid, text, integer, text, bigint, text[]) to service_role;

comment on table public.chart_ohlcv_derived_hourly_readiness is
  'QEO-147 positive publication proof for one exact verified RAW manifest and one complete deterministic 1h cache generation. Legacy cache rows are UNKNOWN.';
comment on function public.qeo_validate_chart_derived_hourly_manifests(uuid[]) is
  'QEO-147 shared service-role validator. READY requires exact source identity, aggregation version, generation, row count and full persisted content digest.';
comment on function public.qeo_publish_chart_derived_hourly_readiness(uuid, text, timestamptz, timestamptz, integer, smallint, text, bigint, text, uuid, integer, text) is
  'QEO-147 publishes readiness only after current persisted derived rows exactly match the supplied complete-generation proof.';
comment on function public.qeo_prune_verified_chart_intraday_partition(uuid, text, integer, text, bigint, text[]) is
  'QEO-149 correction-safe prune plus QEO-147 complete derived-generation readiness authority.';

commit;
