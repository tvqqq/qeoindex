begin;

-- QEO-149: object-byte SHA-256 proves the immutable Storage object. This
-- separate identity proves the exact HOT rows that were archived, including
-- correction-relevant provenance and the database-assigned row versions.
create extension if not exists pgcrypto with schema extensions;

create sequence if not exists public.chart_ohlcv_intraday_content_version_seq;

alter table public.chart_ohlcv_intraday
  add column if not exists content_version bigint,
  add column if not exists content_digest text;

alter table public.chart_ohlcv_cold_manifests
  add column if not exists canonical_content_digest text,
  add column if not exists canonical_content_version bigint;

alter table public.chart_ohlcv_intraday
  alter column content_version set default nextval('public.chart_ohlcv_intraday_content_version_seq'::regclass);

create or replace function public.qeo_chart_intraday_row_content_digest(
  p_ticker text,
  p_base_resolution text,
  p_bar_time timestamptz,
  p_open double precision,
  p_high double precision,
  p_low double precision,
  p_close double precision,
  p_volume double precision,
  p_provenance_batch_id uuid,
  p_fetched_at timestamptz,
  p_content_version bigint
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
          'baseResolution', p_base_resolution,
          'barTime', to_char(p_bar_time at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'open', p_open,
          'high', p_high,
          'low', p_low,
          'close', p_close,
          'volume', p_volume,
          'provenanceBatchId', p_provenance_batch_id,
          'fetchedAt', to_char(p_fetched_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'contentVersion', p_content_version
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$function$;

create or replace function public.qeo_chart_intraday_session_lock_key(
  p_ticker text,
  p_bar_time timestamptz
)
returns bigint
language sql
immutable
strict
set search_path = 'pg_catalog', 'public'
as $function$
  select hashtextextended(
    'qeo149-chart-ticker-session:'
      || upper(trim(p_ticker))
      || ':'
      || ((p_bar_time at time zone 'Asia/Ho_Chi_Minh')::date)::text,
    0
  );
$function$;

create or replace function public.qeo_stamp_chart_intraday_content_identity()
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
    if old.ticker is null or old.bar_time is null then
      raise exception 'QEO-149 HOT delete has incomplete ticker/session identity';
    end if;
    perform pg_advisory_xact_lock(public.qeo_chart_intraday_session_lock_key(old.ticker, old.bar_time));
    return old;
  end if;

  if new.ticker is null or new.bar_time is null then
    raise exception 'QEO-149 HOT write has incomplete ticker/session identity';
  end if;

  v_new_key := public.qeo_chart_intraday_session_lock_key(new.ticker, new.bar_time);
  if tg_op = 'UPDATE' and (old.ticker, old.bar_time) is distinct from (new.ticker, new.bar_time) then
    if old.ticker is null or old.bar_time is null then
      raise exception 'QEO-149 HOT update has incomplete old ticker/session identity';
    end if;
    v_old_key := public.qeo_chart_intraday_session_lock_key(old.ticker, old.bar_time);
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

  new.content_version := nextval('public.chart_ohlcv_intraday_content_version_seq'::regclass);
  new.content_digest := public.qeo_chart_intraday_row_content_digest(
    new.ticker,
    new.base_resolution,
    new.bar_time,
    new.open,
    new.high,
    new.low,
    new.close,
    new.volume,
    new.provenance_batch_id,
    new.fetched_at,
    new.content_version
  );
  return new;
end;
$function$;

-- Existing rows are assigned identities before the trigger becomes mandatory.
update public.chart_ohlcv_intraday
set content_version = nextval('public.chart_ohlcv_intraday_content_version_seq'::regclass)
where content_version is null;

update public.chart_ohlcv_intraday h
set content_digest = public.qeo_chart_intraday_row_content_digest(
  h.ticker,
  h.base_resolution,
  h.bar_time,
  h.open,
  h.high,
  h.low,
  h.close,
  h.volume,
  h.provenance_batch_id,
  h.fetched_at,
  h.content_version
)
where h.content_digest is null;

alter table public.chart_ohlcv_intraday
  alter column content_version set not null,
  alter column content_digest set not null;

do $function$
begin
  if not exists (select 1 from pg_constraint where conname = 'chart_ohlcv_intraday_content_version_check') then
    alter table public.chart_ohlcv_intraday
      add constraint chart_ohlcv_intraday_content_version_check check (content_version > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chart_ohlcv_intraday_content_digest_check') then
    alter table public.chart_ohlcv_intraday
      add constraint chart_ohlcv_intraday_content_digest_check check (content_digest ~ '^[a-f0-9]{64}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chart_ohlcv_cold_manifests_canonical_content_digest_check') then
    alter table public.chart_ohlcv_cold_manifests
      add constraint chart_ohlcv_cold_manifests_canonical_content_digest_check
      check (canonical_content_digest is null or canonical_content_digest ~ '^[a-f0-9]{64}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chart_ohlcv_cold_manifests_canonical_content_version_check') then
    alter table public.chart_ohlcv_cold_manifests
      add constraint chart_ohlcv_cold_manifests_canonical_content_version_check
      check (canonical_content_version is null or canonical_content_version > 0);
  end if;
end;
$function$;

drop trigger if exists qeo149_chart_intraday_content_identity on public.chart_ohlcv_intraday;
create trigger qeo149_chart_intraday_content_identity
before insert or update or delete on public.chart_ohlcv_intraday
for each row execute function public.qeo_stamp_chart_intraday_content_identity();

-- A service-role writer may mutate rows, but it cannot disable or replace the
-- trigger. Direct HOT DML therefore participates in the same protocol too.
revoke trigger on table public.chart_ohlcv_intraday from service_role;
grant select, insert, update, delete on table public.chart_ohlcv_intraday to service_role;

revoke all on function public.qeo_chart_intraday_row_content_digest(text, text, timestamptz, double precision, double precision, double precision, double precision, double precision, uuid, timestamptz, bigint) from public, anon, authenticated, service_role;
revoke all on function public.qeo_chart_intraday_session_lock_key(text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.qeo_stamp_chart_intraday_content_identity() from public, anon, authenticated, service_role;

-- The old count-only entry point is intentionally removed. A mixed-version
-- caller now receives a missing-function error and cannot delete anything.
drop function if exists public.qeo_prune_verified_chart_intraday_partition(uuid, text, integer);

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

  -- Read identity without locking so the shared ticker/session lock can be
  -- acquired before the manifest row lock. All later authority checks happen
  -- again after both locks are held.
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

  -- Ordered protocol: ticker/session advisory lock first, manifest lock
  -- second. Every HOT DML trigger takes the same advisory lock.
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
    from public.chart_ohlcv_derived_hourly h
    where h.source_manifest_id = p_manifest_id
      and h.ticker = v_manifest.ticker
      and h.source_sha256 = v_manifest.sha256
  ) then
    raise exception 'QEO-149 derived hourly cache missing for manifest: %', p_manifest_id;
  end if;

  -- Retention is revalidated under the same lock. The date list is produced
  -- by the bounded application proof; SQL confirms five distinct newer dates
  -- still exist for this ticker before destructive authority is granted.
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

  -- A correction, timestamp substitution, provenance change, or insert can
  -- keep the row count unchanged. Digest/version equality is the authority;
  -- any mismatch leaves every HOT row untouched for a later retry.
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

comment on function public.qeo_chart_intraday_session_lock_key(text, timestamptz) is
  'QEO-149 deterministic ticker + Vietnam-session advisory lock key shared by every HOT DML and prune.';
comment on function public.qeo_prune_verified_chart_intraday_partition(uuid, text, integer, text, bigint, text[]) is
  'QEO-149 service-role-only prune; exact canonical HOT content/version and five-session retention proof are checked under the shared writer lock.';

commit;

