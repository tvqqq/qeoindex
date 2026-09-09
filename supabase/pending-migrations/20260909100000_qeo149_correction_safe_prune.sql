begin;

-- QEO-149: the object-byte SHA-256 proves the immutable Storage object. This
-- separate identity proves the exact HOT rows that were archived, including
-- correction-relevant provenance and database-assigned row versions.
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

-- QEO-108 defines the canonical date lifecycle key. Repeating the definition
-- here keeps this pending migration self-describing while preserving the
-- exact qeo108-chart-session:<date> namespace.
create or replace function public.qeo_chart_intraday_session_lock_key(p_trading_date date)
returns bigint
language sql
immutable
strict
set search_path = 'pg_catalog', 'public'
as $function$
  select hashtextextended('qeo108-chart-session:' || p_trading_date::text, 0)
$function$;

-- QEO-108's public ensure takes this lock before calling the internal helper.
-- QEO-149 replaces the helper so newly-created children expose SELECT only;
-- the writer below runs as its definer and is the sole service-role mutation
-- path.
create or replace function public.qeo_ensure_chart_intraday_session_partition_locked(p_trading_date date)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $function$
declare
  v_name text;
  v_from timestamptz;
  v_to timestamptz;
  v_child regclass;
begin
  if p_trading_date is null or p_trading_date < date '2000-01-01' or p_trading_date > current_date + 7 then
    raise exception 'QEO-149 invalid intraday partition date: %', p_trading_date;
  end if;
  if not exists (
    select 1 from pg_partitioned_table
    where partrelid = 'public.chart_ohlcv_intraday'::regclass
  ) then
    return jsonb_build_object('status', 'legacy_unpartitioned', 'tradingDate', p_trading_date);
  end if;

  v_name := 'chart_ohlcv_intraday_' || to_char(p_trading_date, 'YYYYMMDD');
  v_child := to_regclass('public.' || v_name);
  if v_child is not null then
    if not exists (
      select 1 from pg_inherits
      where inhparent = 'public.chart_ohlcv_intraday'::regclass and inhrelid = v_child
    ) then
      raise exception 'QEO-149 partition name collision: %', v_name;
    end if;
    -- Repair the privilege boundary for children created before QEO-149.
    execute format('revoke insert, update, delete, truncate on table public.%I from service_role', v_name);
    execute format('grant select on table public.%I to service_role', v_name);
    return jsonb_build_object('status', 'exists', 'tradingDate', p_trading_date, 'partition', v_name);
  end if;

  v_from := p_trading_date::timestamp at time zone 'Asia/Ho_Chi_Minh';
  v_to := (p_trading_date + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh';
  execute format(
    'create table public.%I partition of public.chart_ohlcv_intraday for values from (%L) to (%L)',
    v_name, v_from, v_to
  );
  execute format('alter table public.%I enable row level security', v_name);
  execute format('revoke all on table public.%I from public, anon, authenticated, service_role', v_name);
  execute format('grant select on table public.%I to service_role', v_name);
  return jsonb_build_object('status', 'created', 'tradingDate', p_trading_date, 'partition', v_name);
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

-- Content identity is stamped only for rows that exist after INSERT/UPDATE.
-- DELETE has no replacement row to stamp and, importantly, takes no advisory
-- lock: all service-role deletes are routed through the locked RPC below.
create or replace function public.qeo_stamp_chart_intraday_content_identity()
returns trigger
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'extensions'
as $function$
begin
  if new.ticker is null or new.bar_time is null then
    raise exception 'QEO-149 HOT write has incomplete ticker/session identity';
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

drop trigger if exists qeo149_chart_intraday_content_identity on public.chart_ohlcv_intraday;
create trigger qeo149_chart_intraday_content_identity
before insert or update on public.chart_ohlcv_intraday
for each row execute function public.qeo_stamp_chart_intraday_content_identity();

-- The old count-only entry point is intentionally removed. A mixed-version
-- caller receives a missing-function error and cannot delete anything.
drop function if exists public.qeo_prune_verified_chart_intraday_partition(uuid, text, integer);

-- One transaction owns validation, ascending date locks, partition ensure, and
-- set-based upsert. The JSON payload is deliberately bounded to the existing
-- 500-row application chunks.
create or replace function public.qeo_upsert_chart_intraday_bars(
  p_ticker text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_ticker text;
  v_row jsonb;
  v_bar_time timestamptz;
  v_fetched_at timestamptz;
  v_open double precision;
  v_high double precision;
  v_low double precision;
  v_close double precision;
  v_volume double precision;
  v_provenance_batch_id uuid;
  v_date date;
  v_expected_rows integer;
  v_written_rows bigint;
begin
  v_ticker := upper(btrim(p_ticker));
  if v_ticker is null or v_ticker !~ '^[A-Z0-9]{2,12}$' then
    raise exception 'QEO-149 writer requires a valid ticker';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'QEO-149 writer requires a JSON array payload';
  end if;
  v_expected_rows := jsonb_array_length(p_rows);
  if v_expected_rows <= 0 or v_expected_rows > 500 then
    raise exception 'QEO-149 writer payload must contain between 1 and 500 rows';
  end if;

  -- Validate every field before any lifecycle lock, partition DDL, or DML.
  -- JSON numbers are required so textual NaN/Infinity values cannot pass a
  -- cast into PostgreSQL floating-point columns.
  for v_row in select value from jsonb_array_elements(p_rows) as rows(value) loop
    if jsonb_typeof(v_row) <> 'object' then
      raise exception 'QEO-149 writer row must be an object';
    end if;
    if not (v_row ? 'bar_time')
       or not (v_row ? 'open')
       or not (v_row ? 'high')
       or not (v_row ? 'low')
       or not (v_row ? 'close')
       or not (v_row ? 'volume')
       or not (v_row ? 'provenance_batch_id')
       or not (v_row ? 'fetched_at') then
      raise exception 'QEO-149 writer row is missing a required field';
    end if;
    if jsonb_typeof(v_row -> 'bar_time') <> 'string'
       or jsonb_typeof(v_row -> 'fetched_at') <> 'string' then
      raise exception 'QEO-149 writer timestamps must be strings';
    end if;
    if jsonb_typeof(v_row -> 'open') <> 'number'
       or jsonb_typeof(v_row -> 'high') <> 'number'
       or jsonb_typeof(v_row -> 'low') <> 'number'
       or jsonb_typeof(v_row -> 'close') <> 'number'
       or jsonb_typeof(v_row -> 'volume') <> 'number' then
      raise exception 'QEO-149 writer OHLCV fields must be JSON numbers';
    end if;
    if jsonb_typeof(v_row -> 'provenance_batch_id') not in ('null', 'string') then
      raise exception 'QEO-149 writer provenance_batch_id must be a UUID or null';
    end if;
    if (v_row ? 'base_resolution') and coalesce(v_row ->> 'base_resolution', '') <> '1m' then
      raise exception 'QEO-149 writer accepts base_resolution 1m only';
    end if;
    if (v_row ? 'ticker') and upper(btrim(v_row ->> 'ticker')) <> v_ticker then
      raise exception 'QEO-149 writer row ticker does not match the RPC ticker';
    end if;

    begin
      v_bar_time := (v_row ->> 'bar_time')::timestamptz;
      v_fetched_at := (v_row ->> 'fetched_at')::timestamptz;
      v_open := (v_row ->> 'open')::double precision;
      v_high := (v_row ->> 'high')::double precision;
      v_low := (v_row ->> 'low')::double precision;
      v_close := (v_row ->> 'close')::double precision;
      v_volume := (v_row ->> 'volume')::double precision;
      v_provenance_batch_id := case when jsonb_typeof(v_row -> 'provenance_batch_id') = 'null' then null else (v_row ->> 'provenance_batch_id')::uuid end;
    exception when others then
      raise exception 'QEO-149 writer row contains malformed timestamp, number, or UUID';
    end;

    if v_bar_time is null or v_fetched_at is null or date_trunc('minute', v_bar_time) <> v_bar_time then
      raise exception 'QEO-149 writer requires non-null minute-aligned bar_time and fetched_at';
    end if;
    if v_open is null or v_high is null or v_low is null or v_close is null or v_volume is null
       or v_open::text = 'NaN' or v_high::text = 'NaN' or v_low::text = 'NaN' or v_close::text = 'NaN' or v_volume::text = 'NaN'
       or v_open in ('Infinity'::double precision, '-Infinity'::double precision)
       or v_high in ('Infinity'::double precision, '-Infinity'::double precision)
       or v_low in ('Infinity'::double precision, '-Infinity'::double precision)
       or v_close in ('Infinity'::double precision, '-Infinity'::double precision)
       or v_volume in ('Infinity'::double precision, '-Infinity'::double precision) then
      raise exception 'QEO-149 writer requires finite OHLCV values';
    end if;
    if v_open <= 0 or v_high <= 0 or v_low <= 0 or v_close <= 0 or v_volume < 0
       or v_high < greatest(v_open, v_close, v_low)
       or v_low > least(v_open, v_close, v_high) then
      raise exception 'QEO-149 writer OHLCV violates canonical constraints';
    end if;
  end loop;

  if exists (
    select 1
    from (
      select (rows.value ->> 'bar_time')::timestamptz as bar_time
      from jsonb_array_elements(p_rows) as rows(value)
    ) duplicate_rows
    group by bar_time
    having count(*) > 1
  ) then
    raise exception 'QEO-149 writer rejects duplicate bar_time values';
  end if;

  -- Every distinct Vietnam date is locked in ascending order before any
  -- partition ensure or HOT mutation. This is the only advisory-lock order.
  for v_date in
    select distinct ((rows.value ->> 'bar_time')::timestamptz at time zone 'Asia/Ho_Chi_Minh')::date
    from jsonb_array_elements(p_rows) as rows(value)
    order by 1
  loop
    perform pg_advisory_xact_lock(public.qeo_chart_intraday_session_lock_key(v_date));
  end loop;

  for v_date in
    select distinct ((rows.value ->> 'bar_time')::timestamptz at time zone 'Asia/Ho_Chi_Minh')::date
    from jsonb_array_elements(p_rows) as rows(value)
    order by 1
  loop
    perform public.qeo_ensure_chart_intraday_session_partition_locked(v_date);
  end loop;

  insert into public.chart_ohlcv_intraday(
    ticker, base_resolution, bar_time, open, high, low, close, volume,
    provenance_batch_id, fetched_at
  )
  select v_ticker, '1m', rows.bar_time, rows.open, rows.high, rows.low, rows.close, rows.volume,
    rows.provenance_batch_id, rows.fetched_at
  from jsonb_to_recordset(p_rows) as rows(
    bar_time timestamptz,
    open double precision,
    high double precision,
    low double precision,
    close double precision,
    volume double precision,
    provenance_batch_id uuid,
    fetched_at timestamptz
  )
  on conflict (ticker, base_resolution, bar_time) do update
  set open = excluded.open,
      high = excluded.high,
      low = excluded.low,
      close = excluded.close,
      volume = excluded.volume,
      provenance_batch_id = excluded.provenance_batch_id,
      fetched_at = excluded.fetched_at;
  get diagnostics v_written_rows = row_count;

  if v_written_rows <> v_expected_rows then
    raise exception 'QEO-149 writer row accounting mismatch: expected %, written %', v_expected_rows, v_written_rows;
  end if;

  return jsonb_build_object(
    'status', 'upserted',
    'ticker', v_ticker,
    'rowCount', v_written_rows
  );
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
    raise exception 'QEO-149 prune requires complete bounded archive and retention proof';
  end if;

  select ticker, range_start, range_end
  into v_initial_ticker, v_initial_range_start, v_initial_range_end
  from public.chart_ohlcv_cold_manifests
  where id = p_manifest_id;
  if not found then
    raise exception 'QEO-149 prune manifest not found: %', p_manifest_id;
  end if;

  if (v_initial_range_start at time zone 'Asia/Ho_Chi_Minh')::date
     is distinct from (v_initial_range_end at time zone 'Asia/Ho_Chi_Minh')::date then
    raise exception 'QEO-149 prune requires one Vietnam ticker session per manifest: %', p_manifest_id;
  end if;
  v_candidate_date := (v_initial_range_start at time zone 'Asia/Ho_Chi_Minh')::date;
  v_lock_dates := array[v_candidate_date]::date[];

  -- The candidate and every supplied proof date participate in one bounded,
  -- ascending lock set. Duplicates do not inflate the five-session proof.
  for v_expected_date_text in
    select value from unnest(p_expected_newer_sessions) as dates(value)
  loop
    v_expected_date_text := btrim(v_expected_date_text);
    if v_expected_date_text !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'QEO-149 prune retention proof contains malformed session date';
    end if;
    v_expected_date := to_date(v_expected_date_text, 'YYYY-MM-DD');
    if to_char(v_expected_date, 'YYYY-MM-DD') <> v_expected_date_text then
      raise exception 'QEO-149 prune retention proof contains invalid session date';
    end if;
    if v_expected_date <= v_candidate_date then
      raise exception 'QEO-149 prune retention proof contains a non-newer session date';
    end if;
    if not (v_expected_date = any(v_lock_dates)) then
      v_lock_dates := array_append(v_lock_dates, v_expected_date);
      v_newer_dates_seen := v_newer_dates_seen + 1;
    end if;
  end loop;
  if v_newer_dates_seen < 5 then
    raise exception 'QEO-149 prune requires five distinct newer session dates';
  end if;

  for v_lock_date in
    select value from unnest(v_lock_dates) as dates(value) order by value
  loop
    perform pg_advisory_xact_lock(public.qeo_chart_intraday_session_lock_key(v_lock_date));
  end loop;

  -- All authority checks happen after the complete lifecycle lock set and the
  -- manifest row lock. A changed manifest identity aborts without deletion.
  select *
  into v_manifest
  from public.chart_ohlcv_cold_manifests
  where id = p_manifest_id
  for update;
  if not found then
    raise exception 'QEO-149 prune manifest disappeared: %', p_manifest_id;
  end if;
  if v_manifest.ticker is distinct from v_initial_ticker
     or v_manifest.range_start is distinct from v_initial_range_start
     or v_manifest.range_end is distinct from v_initial_range_end then
    raise exception 'QEO-149 prune manifest identity changed while locking: %', p_manifest_id;
  end if;
  if (v_manifest.range_start at time zone 'Asia/Ho_Chi_Minh')::date
     is distinct from (v_manifest.range_end at time zone 'Asia/Ho_Chi_Minh')::date then
    raise exception 'QEO-149 prune requires one Vietnam ticker session per manifest: %', p_manifest_id;
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

  -- Revalidate actual HOT evidence after all candidate/proof date locks. A
  -- concurrent reclaim therefore cannot remove one of the five sessions after
  -- it was counted but before this prune decides.
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

  -- Equal row counts are insufficient: changed OHLCV, timestamps, inserts, or
  -- provenance/fetched_at corrections all change the DB-stamped proof.
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

-- Direct HOT mutations are denied after the writer and prune functions exist.
-- Revoke every existing child explicitly because child-table grants are not
-- implied by the canonical parent grant.
revoke all privileges on table public.chart_ohlcv_intraday from service_role;
grant select on table public.chart_ohlcv_intraday to service_role;
do $function$
declare
  v_relation regclass;
begin
  for v_relation in
    select c.oid::regclass
    from pg_inherits i
    join pg_class c on c.oid = i.inhrelid
    where i.inhparent = 'public.chart_ohlcv_intraday'::regclass
  loop
    execute format('revoke all privileges on table %s from service_role', v_relation);
    execute format('grant select on table %s to service_role', v_relation);
  end loop;
  if to_regclass('public.chart_ohlcv_intraday_qeo108_legacy') is not null then
    revoke all privileges on table public.chart_ohlcv_intraday_qeo108_legacy from service_role;
    grant select on table public.chart_ohlcv_intraday_qeo108_legacy to service_role;
  end if;
end;
$function$;
revoke trigger on table public.chart_ohlcv_intraday from service_role;

-- Provenance is correction-relevant through ON DELETE SET NULL. Service-role
-- may append/read provider evidence but cannot delete/update/truncate a batch
-- and thereby cause an unlocked HOT FK rewrite.
revoke all privileges on table public.chart_ohlcv_provenance_batches from service_role;
grant select, insert on table public.chart_ohlcv_provenance_batches to service_role;

revoke all on function public.qeo_chart_intraday_row_content_digest(text, text, timestamptz, double precision, double precision, double precision, double precision, double precision, uuid, timestamptz, bigint) from public, anon, authenticated, service_role;
revoke all on function public.qeo_chart_intraday_session_lock_key(date) from public, anon, authenticated, service_role;
revoke all on function public.qeo_ensure_chart_intraday_session_partition_locked(date) from public, anon, authenticated, service_role;
revoke all on function public.qeo_stamp_chart_intraday_content_identity() from public, anon, authenticated, service_role;
revoke all on function public.qeo_upsert_chart_intraday_bars(text, jsonb) from public, anon, authenticated;
grant execute on function public.qeo_upsert_chart_intraday_bars(text, jsonb) to service_role;

revoke all on function public.qeo_prune_verified_chart_intraday_partition(uuid, text, integer, text, bigint, text[]) from public, anon, authenticated;
grant execute on function public.qeo_prune_verified_chart_intraday_partition(uuid, text, integer, text, bigint, text[]) to service_role;

comment on function public.qeo_chart_intraday_session_lock_key(date) is
  'QEO-108/QEO-149 deterministic Vietnam-date lifecycle advisory lock key; namespace is qeo108-chart-session:<date>.';
comment on function public.qeo_upsert_chart_intraday_bars(text, jsonb) is
  'QEO-149 service-role-only validated bulk HOT writer; locks all Vietnam dates ascending before ensure or DML.';
comment on function public.qeo_prune_verified_chart_intraday_partition(uuid, text, integer, text, bigint, text[]) is
  'QEO-149 service-role-only prune; locks candidate plus supplied newer Vietnam dates ascending, then checks exact canonical HOT content/version and retention proof.';

commit;
