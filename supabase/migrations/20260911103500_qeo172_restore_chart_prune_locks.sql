begin;

-- QEO-172 production acceptance found schema drift caused by the QEO-147
-- readiness migration replacing QEO-149's correction-safe prune body with an
-- older two-argument lifecycle-lock call. Restore the canonical QEO-108/QEO-149
-- Vietnam-date lock namespace while retaining QEO-147 positive readiness as
-- prune authority.
do $function$
begin
  if to_regprocedure('public.qeo_chart_intraday_session_lock_key(date)') is null then
    raise exception 'QEO-172 requires qeo_chart_intraday_session_lock_key(date)';
  end if;
  if to_regprocedure('public.qeo_validate_chart_derived_hourly_manifests(uuid[])') is null then
    raise exception 'QEO-172 requires QEO-147 derived-hourly readiness validator';
  end if;
end;
$function$;

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
  v_initial_ticker text;
  v_initial_range_start timestamptz;
  v_initial_range_end timestamptz;
  v_manifest public.chart_ohlcv_cold_manifests%rowtype;
  v_candidate_date date;
  v_expected_date date;
  v_expected_date_text text;
  v_lock_date date;
  v_lock_dates date[];
  v_newer_dates_seen integer := 0;
  v_hot_rows bigint := 0;
  v_hot_version bigint := 0;
  v_hot_digest text;
  v_retention_sessions bigint := 0;
  v_deleted bigint := 0;
begin
  if p_manifest_id is null
     or p_expected_sha256 is null
     or p_expected_sha256 !~ '^[a-f0-9]{64}$'
     or p_expected_row_count is null
     or p_expected_row_count <= 0
     or p_expected_content_digest is null
     or p_expected_content_digest !~ '^[a-f0-9]{64}$'
     or p_expected_content_version is null
     or p_expected_content_version <= 0
     or p_expected_newer_sessions is null
     or coalesce(array_length(p_expected_newer_sessions, 1), 0) < 5
     or coalesce(array_length(p_expected_newer_sessions, 1), 0) > 32 then
    raise exception 'QEO-172 prune requires complete bounded archive and retention proof';
  end if;

  select ticker, range_start, range_end
  into v_initial_ticker, v_initial_range_start, v_initial_range_end
  from public.chart_ohlcv_cold_manifests
  where id = p_manifest_id;
  if not found then
    raise exception 'QEO-172 prune manifest not found: %', p_manifest_id;
  end if;

  if (v_initial_range_start at time zone 'Asia/Ho_Chi_Minh')::date
     is distinct from (v_initial_range_end at time zone 'Asia/Ho_Chi_Minh')::date then
    raise exception 'QEO-172 prune requires one Vietnam ticker session per manifest: %', p_manifest_id;
  end if;
  v_candidate_date := (v_initial_range_start at time zone 'Asia/Ho_Chi_Minh')::date;
  v_lock_dates := array[v_candidate_date]::date[];

  -- Candidate and proof dates share the exact QEO-108 date lifecycle lock.
  -- Validate the bounded proof before acquiring any advisory lock, dedupe dates,
  -- then lock the complete set in ascending order to match HOT writer ordering.
  for v_expected_date_text in
    select value from unnest(p_expected_newer_sessions) as dates(value)
  loop
    v_expected_date_text := btrim(v_expected_date_text);
    if v_expected_date_text !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'QEO-172 prune retention proof contains malformed session date';
    end if;
    v_expected_date := to_date(v_expected_date_text, 'YYYY-MM-DD');
    if to_char(v_expected_date, 'YYYY-MM-DD') <> v_expected_date_text then
      raise exception 'QEO-172 prune retention proof contains invalid session date';
    end if;
    if v_expected_date <= v_candidate_date then
      raise exception 'QEO-172 prune retention proof contains a non-newer session date';
    end if;
    if not (v_expected_date = any(v_lock_dates)) then
      v_lock_dates := array_append(v_lock_dates, v_expected_date);
      v_newer_dates_seen := v_newer_dates_seen + 1;
    end if;
  end loop;
  if v_newer_dates_seen < 5 then
    raise exception 'QEO-172 prune requires five distinct newer session dates';
  end if;

  for v_lock_date in
    select value from unnest(v_lock_dates) as dates(value) order by value
  loop
    perform pg_advisory_xact_lock(public.qeo_chart_intraday_session_lock_key(v_lock_date));
  end loop;

  -- Re-read under the complete session-lock set. Manifest identity, immutable
  -- object proof and DB-stamped canonical HOT identity must still match exactly.
  select *
  into v_manifest
  from public.chart_ohlcv_cold_manifests
  where id = p_manifest_id
  for update;
  if not found then
    raise exception 'QEO-172 prune manifest disappeared: %', p_manifest_id;
  end if;
  if v_manifest.ticker is distinct from v_initial_ticker
     or v_manifest.range_start is distinct from v_initial_range_start
     or v_manifest.range_end is distinct from v_initial_range_end then
    raise exception 'QEO-172 prune manifest identity changed while locking: %', p_manifest_id;
  end if;
  if (v_manifest.range_start at time zone 'Asia/Ho_Chi_Minh')::date
     is distinct from (v_manifest.range_end at time zone 'Asia/Ho_Chi_Minh')::date then
    raise exception 'QEO-172 prune requires one Vietnam ticker session per manifest: %', p_manifest_id;
  end if;
  if v_manifest.base_resolution <> '1m'
     or v_manifest.verified_at is null
     or v_manifest.sha256 <> p_expected_sha256
     or v_manifest.row_count <> p_expected_row_count
     or v_manifest.canonical_content_digest is null
     or v_manifest.canonical_content_digest <> p_expected_content_digest
     or v_manifest.canonical_content_version is null
     or v_manifest.canonical_content_version <> p_expected_content_version then
    raise exception 'QEO-172 prune archive proof mismatch: %', p_manifest_id;
  end if;

  -- Preserve QEO-147 authority. The validator itself takes the canonical
  -- manifest advisory lock and proves exact generation/source/content identity.
  if not exists (
    select 1
    from public.qeo_validate_chart_derived_hourly_manifests(array[p_manifest_id]) v
    where v.manifest_id = p_manifest_id
      and v.ready
  ) then
    raise exception 'QEO-172 derived hourly generation is not ready for manifest: %', p_manifest_id;
  end if;

  -- Revalidate the five newer ticker sessions after their lifecycle locks are
  -- held, so concurrent archive/prune cannot invalidate retention evidence.
  select count(distinct dates.session_date)
  into v_retention_sessions
  from unnest(v_lock_dates[2:]) as dates(session_date)
  where extract(isodow from dates.session_date) between 1 and 5
    and dates.session_date > v_candidate_date
    and exists (
      select 1
      from public.chart_ohlcv_intraday h
      where h.ticker = v_manifest.ticker
        and h.base_resolution = '1m'
        and (h.bar_time at time zone 'Asia/Ho_Chi_Minh')::date = dates.session_date
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
    raise exception 'QEO-172 atomic prune mismatch: manifest %, expected %, deleted %', p_manifest_id, p_expected_row_count, v_deleted;
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

revoke all on function public.qeo_prune_verified_chart_intraday_partition(uuid, text, integer, text, bigint, text[])
  from public, anon, authenticated;
grant execute on function public.qeo_prune_verified_chart_intraday_partition(uuid, text, integer, text, bigint, text[])
  to service_role;

comment on function public.qeo_prune_verified_chart_intraday_partition(uuid, text, integer, text, bigint, text[]) is
  'QEO-172 corrective QEO-149/QEO-147 prune: locks candidate plus supplied newer Vietnam dates ascending in qeo108-chart-session namespace, validates positive derived readiness, then revalidates exact HOT content/version before deletion.';

commit;
