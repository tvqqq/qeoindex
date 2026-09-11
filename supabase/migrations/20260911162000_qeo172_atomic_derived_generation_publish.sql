begin;

-- QEO-172 follow-up to QEO-147: a derived generation must be replaced,
-- proved and published while one manifest advisory lock is held by one
-- database transaction. The former application sequence crossed several
-- PostgREST transactions, allowing a competing valid generation to replace
-- the rows between application upsert and readback.
create or replace function public.qeo_publish_chart_derived_hourly_generation(
  p_manifest_id uuid,
  p_ticker text,
  p_expected_sha256 text,
  p_expected_range_start timestamptz,
  p_expected_range_end timestamptz,
  p_expected_raw_row_count integer,
  p_expected_format_version smallint,
  p_expected_canonical_content_digest text,
  p_expected_canonical_content_version bigint,
  p_aggregation_version text,
  p_generation_id uuid,
  p_generated_at timestamptz,
  p_bars jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_manifest public.chart_ohlcv_cold_manifests%rowtype;
  v_expected_count integer := 0;
  v_distinct_times integer := 0;
  v_invalid_count integer := 0;
  v_persisted_count integer := 0;
  v_generation_match boolean := false;
  v_metadata_match boolean := false;
  v_bar_mismatch_count integer := 0;
  v_derived_content_digest text;
  v_ready boolean := false;
  v_lock_key bigint;
begin
  if p_manifest_id is null
     or p_ticker is null or p_ticker !~ '^[A-Z0-9]{2,12}$'
     or p_expected_sha256 is null or p_expected_sha256 !~ '^[a-f0-9]{64}$'
     or p_expected_range_start is null or p_expected_range_end is null
     or p_expected_range_end < p_expected_range_start
     or p_expected_raw_row_count is null or p_expected_raw_row_count <= 0
     or p_expected_format_version is null or p_expected_format_version <= 0
     or (p_expected_canonical_content_digest is null) <> (p_expected_canonical_content_version is null)
     or (p_expected_canonical_content_digest is not null and p_expected_canonical_content_digest !~ '^[a-f0-9]{64}$')
     or (p_expected_canonical_content_version is not null and p_expected_canonical_content_version <= 0)
     or p_aggregation_version <> 'vn-session-v1'
     or p_generation_id is null
     or p_generated_at is null
     or p_bars is null
     or jsonb_typeof(p_bars) <> 'array'
     or jsonb_array_length(p_bars) = 0
     or jsonb_array_length(p_bars) > 500 then
    raise exception 'QEO-172 atomic derived publication requires complete bounded generation proof';
  end if;

  select
    count(*)::integer,
    count(distinct x."time")::integer,
    count(*) filter (where
      x."time" is null or x."time" <= 0
      or x.open is null or x.high is null or x.low is null or x.close is null or x.volume is null
      or x.open <= 0 or x.high <= 0 or x.low <= 0 or x.close <= 0 or x.volume < 0
      or x.high < greatest(x.open, x.close, x.low)
      or x.low > least(x.open, x.close, x.high)
    )::integer
  into v_expected_count, v_distinct_times, v_invalid_count
  from jsonb_to_recordset(p_bars) as x(
    "time" bigint,
    open double precision,
    high double precision,
    low double precision,
    close double precision,
    volume double precision
  );

  if v_expected_count <> jsonb_array_length(p_bars)
     or v_distinct_times <> v_expected_count
     or v_invalid_count <> 0 then
    raise exception 'QEO-172 atomic derived publication received invalid or duplicate bars';
  end if;

  -- Acquire the complete lock set in deterministic numeric order before any
  -- mutation. A corrected archive may replace an hour currently attributed to
  -- an older manifest; pre-locking both manifests preserves QEO-149 ordering.
  for v_lock_key in
    with input_times as (
      select to_timestamp(x."time") as bar_time
      from jsonb_to_recordset(p_bars) as x(
        "time" bigint,
        open double precision,
        high double precision,
        low double precision,
        close double precision,
        volume double precision
      )
    ), manifest_ids as (
      select p_manifest_id as manifest_id
      union
      select h.source_manifest_id
      from public.chart_ohlcv_derived_hourly h
      join input_times i on i.bar_time = h.bar_time
      where h.ticker = p_ticker and h.resolution = '1h'
    )
    select distinct public.qeo_chart_derived_hourly_manifest_lock_key(manifest_id)
    from manifest_ids
    where manifest_id is not null
    order by 1
  loop
    perform pg_advisory_xact_lock(v_lock_key);
  end loop;

  -- Reentrant proof for the primary manifest: this same xact lock remains held
  -- through replacement, readback proof, readiness publication and validation.
  perform pg_advisory_xact_lock(public.qeo_chart_derived_hourly_manifest_lock_key(p_manifest_id));

  select * into v_manifest
  from public.chart_ohlcv_cold_manifests
  where id = p_manifest_id
  for update;
  if not found then
    raise exception 'QEO-172 atomic derived publication manifest not found: %', p_manifest_id;
  end if;

  if v_manifest.base_resolution <> '1m'
     or v_manifest.verified_at is null
     or v_manifest.ticker <> p_ticker
     or v_manifest.sha256 <> p_expected_sha256
     or v_manifest.range_start <> p_expected_range_start
     or v_manifest.range_end <> p_expected_range_end
     or v_manifest.row_count <> p_expected_raw_row_count
     or v_manifest.format_version <> p_expected_format_version
     or v_manifest.canonical_content_digest is distinct from p_expected_canonical_content_digest
     or v_manifest.canonical_content_version is distinct from p_expected_canonical_content_version then
    raise exception 'QEO-172 atomic derived publication source proof mismatch: %', p_manifest_id;
  end if;

  delete from public.chart_ohlcv_derived_hourly
  where source_manifest_id = p_manifest_id;

  insert into public.chart_ohlcv_derived_hourly (
    ticker,
    resolution,
    bar_time,
    open,
    high,
    low,
    close,
    volume,
    source_manifest_id,
    source_sha256,
    source_range_start,
    source_range_end,
    source_raw_row_count,
    source_format_version,
    source_canonical_content_digest,
    source_canonical_content_version,
    aggregation_version,
    generation_id,
    generated_at
  )
  select
    p_ticker,
    '1h',
    to_timestamp(x."time"),
    x.open,
    x.high,
    x.low,
    x.close,
    x.volume,
    p_manifest_id,
    p_expected_sha256,
    p_expected_range_start,
    p_expected_range_end,
    p_expected_raw_row_count,
    p_expected_format_version,
    p_expected_canonical_content_digest,
    p_expected_canonical_content_version,
    p_aggregation_version,
    p_generation_id,
    p_generated_at
  from jsonb_to_recordset(p_bars) as x(
    "time" bigint,
    open double precision,
    high double precision,
    low double precision,
    close double precision,
    volume double precision
  )
  on conflict (ticker, resolution, bar_time) do update set
    open = excluded.open,
    high = excluded.high,
    low = excluded.low,
    close = excluded.close,
    volume = excluded.volume,
    source_manifest_id = excluded.source_manifest_id,
    source_sha256 = excluded.source_sha256,
    source_range_start = excluded.source_range_start,
    source_range_end = excluded.source_range_end,
    source_raw_row_count = excluded.source_raw_row_count,
    source_format_version = excluded.source_format_version,
    source_canonical_content_digest = excluded.source_canonical_content_digest,
    source_canonical_content_version = excluded.source_canonical_content_version,
    aggregation_version = excluded.aggregation_version,
    generation_id = excluded.generation_id,
    generated_at = excluded.generated_at;

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
  into v_persisted_count, v_generation_match, v_metadata_match, v_derived_content_digest
  from public.chart_ohlcv_derived_hourly h
  where h.source_manifest_id = p_manifest_id;

  select count(*)::integer
  into v_bar_mismatch_count
  from jsonb_to_recordset(p_bars) as x(
    "time" bigint,
    open double precision,
    high double precision,
    low double precision,
    close double precision,
    volume double precision
  )
  left join public.chart_ohlcv_derived_hourly h
    on h.source_manifest_id = p_manifest_id
   and h.resolution = '1h'
   and h.bar_time = to_timestamp(x."time")
  where h.bar_time is null
     or h.open is distinct from x.open
     or h.high is distinct from x.high
     or h.low is distinct from x.low
     or h.close is distinct from x.close
     or h.volume is distinct from x.volume;

  if v_persisted_count <> v_expected_count
     or not coalesce(v_generation_match, false)
     or not coalesce(v_metadata_match, false)
     or v_bar_mismatch_count <> 0
     or v_derived_content_digest is null
     or v_derived_content_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'QEO-172 atomic derived generation proof mismatch: %', p_manifest_id;
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
    v_expected_count,
    v_derived_content_digest,
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
    raise exception 'QEO-172 atomic derived publication post-validation failed: %', p_manifest_id;
  end if;

  return jsonb_build_object(
    'status', 'ready',
    'manifestId', p_manifest_id,
    'generationId', p_generation_id,
    'derivedRowCount', v_expected_count,
    'derivedContentDigest', v_derived_content_digest
  );
end;
$function$;

revoke all on function public.qeo_publish_chart_derived_hourly_generation(
  uuid, text, text, timestamptz, timestamptz, integer, smallint,
  text, bigint, text, uuid, timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function public.qeo_publish_chart_derived_hourly_generation(
  uuid, text, text, timestamptz, timestamptz, integer, smallint,
  text, bigint, text, uuid, timestamptz, jsonb
) to service_role;

comment on function public.qeo_publish_chart_derived_hourly_generation(
  uuid, text, text, timestamptz, timestamptz, integer, smallint,
  text, bigint, text, uuid, timestamptz, jsonb
) is
  'QEO-172 atomic QEO-147 generation publisher: one manifest lock transaction owns replacement, exact bar/source proof, content digest, readiness publication and post-validation.';

commit;
