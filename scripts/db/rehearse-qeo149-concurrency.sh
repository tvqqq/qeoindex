#!/usr/bin/env bash
set -euo pipefail

PRODUCTION_PROJECT_REF="glwhhrmejlonhyorvtzm"
DB_CONTAINER="${QEO_Q149_DB_CONTAINER:-supabase_db_qeoindex}"
MIGRATION="supabase/migrations/20260909100000_qeo149_correction_safe_prune.sql"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/qeo149-rehearsal.XXXXXX")"
RUN_TAG="qeo149_$$"

phase() {
  printf '\n==> QEO-149 %s\n' "$1"
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM

[[ -f "$MIGRATION" ]] || fail "promoted QEO-149 migration is missing"
[[ "${SUPABASE_PROJECT_REF:-}" != "$PRODUCTION_PROJECT_REF" ]] || fail "production project ref is forbidden"
command -v docker >/dev/null 2>&1 || fail "docker is required"
docker inspect "$DB_CONTAINER" >/dev/null 2>&1 || fail "local Supabase DB container $DB_CONTAINER is not running"

psql_local() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}

psql_scalar() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -Atqc "$1"
}

psql_local_app() {
  local application_name="$1"
  shift
  docker exec -e "PGAPPNAME=$application_name" -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}

wait_pid() {
  local pid="$1"
  local label="$2"
  local log="$3"
  local elapsed=0
  while kill -0 "$pid" 2>/dev/null; do
    if (( elapsed >= 80 )); then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
      cat "$log" >&2 || true
      fail "$label exceeded the 8-second bounded timeout"
    fi
    sleep 0.1
    elapsed=$((elapsed + 1))
  done
  if ! wait "$pid"; then
    cat "$log" >&2 || true
    fail "$label failed"
  fi
}

wait_for_query() {
  local query="$1"
  local label="$2"
  local attempts=0
  while (( attempts < 80 )); do
    if [[ "$(psql_scalar "$query" 2>/dev/null | tr -d '[:space:]')" == "1" ]]; then return 0; fi
    sleep 0.1
    attempts=$((attempts + 1))
  done
  fail "$label was not observed before the bounded timeout"
}

wait_for_advisory_holder() {
  local application_name="$1"
  local label="$2"
  wait_for_query "select case when exists (
    select 1
    from pg_stat_activity a
    join pg_locks l on l.pid = a.pid
    where a.application_name = '$application_name'
      and a.state = 'active'
      and l.locktype = 'advisory'
      and l.granted
  ) then 1 else 0 end" "$label"
}

wait_for_advisory_wait() {
  local application_name="$1"
  local query_fragment="$2"
  local label="$3"
  wait_for_query "select case when exists (
    select 1
    from pg_stat_activity a
    join pg_locks l on l.pid = a.pid
    where a.application_name = '$application_name'
      and a.state = 'active'
      and a.wait_event_type = 'Lock'
      and l.locktype = 'advisory'
      and not l.granted
      and a.query like '%$query_fragment%'
  ) then 1 else 0 end" "$label"
}

phase "preflight the QEO-108 native partition contract"
psql_local -f - <<'SQL'
do $function$
declare
  v_lock_key_definition text;
begin
  if not exists (
    select 1
    from pg_partitioned_table
    where partrelid = 'public.chart_ohlcv_intraday'::regclass
  ) then
    raise exception 'QEO-149 rehearsal: QEO-108 canonical HOT parent is not partitioned';
  end if;
  if to_regprocedure('public.qeo_chart_intraday_session_lock_key(date)') is null then
    raise exception 'QEO-149 rehearsal: QEO-108 date lock-key helper is missing';
  end if;
  if to_regprocedure('public.qeo_ensure_chart_intraday_session_partition_locked(date)') is null then
    raise exception 'QEO-149 rehearsal: QEO-108 locked ensure helper is missing';
  end if;
  if to_regprocedure('public.qeo_ensure_chart_intraday_session_partition(date)') is null then
    raise exception 'QEO-149 rehearsal: QEO-108 public ensure helper is missing';
  end if;
  if to_regprocedure('public.qeo_drop_empty_chart_intraday_session_partition(date)') is null then
    raise exception 'QEO-149 rehearsal: QEO-108 drop helper is missing';
  end if;
  select pg_get_functiondef('public.qeo_chart_intraday_session_lock_key(date)'::regprocedure)
    into v_lock_key_definition;
  if position('qeo108-chart-session:' in v_lock_key_definition) = 0 then
    raise exception 'QEO-149 rehearsal: QEO-108 lock namespace is not canonical';
  end if;
  if not has_function_privilege('service_role', 'public.qeo_ensure_chart_intraday_session_partition(date)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.qeo_drop_empty_chart_intraday_session_partition(date)', 'EXECUTE') then
    raise exception 'QEO-149 rehearsal: QEO-108 service-role lifecycle grants are missing';
  end if;
end;
$function$;
SQL

phase "apply promoted migration in the isolated local database"
psql_local -f - < "$MIGRATION"

phase "seed correction, retention, and manifest fixtures through the writer"
psql_local -f - <<'SQL'
create table public.qeo149_rehearsal_cases (
  case_name text primary key,
  ticker text not null,
  manifest_id uuid not null,
  candidate_date date not null,
  range_start timestamptz not null,
  range_end timestamptz not null,
  expected_sha256 text not null,
  expected_row_count integer not null,
  expected_content_digest text not null,
  expected_content_version bigint not null,
  newer_dates text[] not null
);
grant select on public.qeo149_rehearsal_cases to service_role;

do $function$
declare
  v_candidate_date date := current_date - 40;
  v_newer_dates date[] := array(
    select g::date
    from generate_series(current_date - 39, current_date - 1, interval '1 day') g
    where extract(isodow from g) between 1 and 5
    order by g
    limit 5
  );
  v_cases text[] := array['CORRECTION', 'QUEUED', 'OHLCV', 'TIMESTAMP', 'PROVENANCE', 'FEWER', 'PHANTOM'];
  v_case text;
  i integer;
  v_ticker text;
  v_batch uuid;
  v_rows jsonb;
  v_bar_time timestamptz;
  v_range_start timestamptz;
  v_range_end timestamptz;
  v_manifest_id uuid;
  v_digest text;
  v_version bigint;
  v_sha256 text := repeat('a', 64);
  v_actual_newer text[];
  v_expected_rows bigint;
begin
  if cardinality(v_newer_dates) <> 5 then
    raise exception 'QEO-149 rehearsal fixture could not derive five weekday sessions';
  end if;

  foreach v_case in array v_cases loop
    v_ticker := 'Q149' || lpad(array_position(v_cases, v_case)::text, 2, '0');
    v_batch := gen_random_uuid();
    insert into public.chart_ohlcv_provenance_batches
      (id, provider, ticker, base_resolution, range_start, range_end, row_count, fetched_at, detail)
    values
      (v_batch, 'QEO-149-REHEARSAL', v_ticker, '1m',
       v_candidate_date::timestamp at time zone 'Asia/Ho_Chi_Minh',
       (v_newer_dates[5])::timestamp at time zone 'Asia/Ho_Chi_Minh',
       case when v_case = 'FEWER' then 5 when v_case = 'PHANTOM' then 7 else 6 end,
       now(), jsonb_build_object('workflow', 'QEO-149-REHEARSAL'));

    v_rows := '[]'::jsonb;
    v_bar_time := (v_candidate_date::timestamp + time '09:15') at time zone 'Asia/Ho_Chi_Minh';
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'bar_time', v_bar_time,
      'open', 10.0, 'high', 10.2, 'low', 9.9, 'close', 10.1, 'volume', 1000,
      'provenance_batch_id', v_batch, 'fetched_at', now()
    ));
    v_range_start := v_bar_time;
    v_range_end := v_bar_time;

    if v_case = 'PHANTOM' then
      v_bar_time := v_range_start + interval '2 minutes';
      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'bar_time', v_bar_time,
        'open', 11.0, 'high', 11.2, 'low', 10.9, 'close', 11.1, 'volume', 1100,
        'provenance_batch_id', v_batch, 'fetched_at', now()
      ));
      v_range_end := v_bar_time;
    end if;

    for i in 1..(case when v_case = 'FEWER' then 4 else 5 end) loop
      v_bar_time := (v_newer_dates[i]::timestamp + time '09:15') at time zone 'Asia/Ho_Chi_Minh';
      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'bar_time', v_bar_time,
        'open', 10.0 + i, 'high', 10.2 + i, 'low', 9.9 + i, 'close', 10.1 + i, 'volume', 1000 + i,
        'provenance_batch_id', v_batch, 'fetched_at', now()
      ));
    end loop;

    perform public.qeo_upsert_chart_intraday_bars(v_ticker, v_rows);
    select count(*)::bigint, max(h.content_version),
      encode(digest(string_agg(h.content_digest, '' order by h.bar_time), 'sha256'), 'hex')
    into v_expected_rows, v_version, v_digest
    from public.chart_ohlcv_intraday h
    where h.ticker = v_ticker and h.base_resolution = '1m'
      and h.bar_time between v_range_start and v_range_end;

    insert into public.chart_ohlcv_cold_manifests
      (ticker, base_resolution, range_start, range_end, object_path, archive_format, row_count, sha256,
       provenance_batch_id, verified_at, provenance, canonical_content_digest, canonical_content_version)
    values
      (v_ticker, '1m', v_range_start, v_range_end,
       'qeo149-rehearsal/' || lower(v_ticker) || '.ndjson.gz', 'ndjson.gz', v_expected_rows::integer, v_sha256,
       v_batch, now(), jsonb_build_object('workflow', 'QEO-149-REHEARSAL'), v_digest, v_version)
    returning id into v_manifest_id;

    insert into public.chart_ohlcv_derived_hourly
      (ticker, resolution, bar_time, open, high, low, close, volume, source_manifest_id, source_sha256,
       source_range_start, source_range_end, source_raw_row_count, aggregation_version, generated_at)
    values
      (v_ticker, '1h', v_range_start, 10.0, 10.2, 9.9, 10.1, 1000, v_manifest_id, v_sha256,
       v_range_start, v_range_end, v_expected_rows::integer, 'vn-session-v1', now());

    select array_agg(d::text order by d)
    into v_actual_newer
    from unnest(v_newer_dates) d;
    insert into public.qeo149_rehearsal_cases
      (case_name, ticker, manifest_id, candidate_date, range_start, range_end, expected_sha256,
       expected_row_count, expected_content_digest, expected_content_version, newer_dates)
    values
      (v_case, v_ticker, v_manifest_id, v_candidate_date, v_range_start, v_range_end, v_sha256,
       v_expected_rows::integer, v_digest, v_version, v_actual_newer);
  end loop;
end;
$function$;
SQL

phase "assert privilege boundary, removed legacy RPC, and trigger shape"
psql_local -f - <<'SQL'
do $function$
declare
  v_child regclass;
begin
  if to_regprocedure('public.qeo_prune_verified_chart_intraday_partition(uuid,text,integer)') is not null then
    raise exception 'QEO-149 rehearsal: unsafe three-argument prune still exists';
  end if;
  if not has_function_privilege('service_role', 'public.qeo_upsert_chart_intraday_bars(text,jsonb)', 'EXECUTE') then
    raise exception 'QEO-149 rehearsal: service_role writer grant is missing';
  end if;
  if has_table_privilege('service_role', 'public.chart_ohlcv_intraday', 'INSERT')
     or has_table_privilege('service_role', 'public.chart_ohlcv_intraday', 'UPDATE')
     or has_table_privilege('service_role', 'public.chart_ohlcv_intraday', 'DELETE')
     or has_table_privilege('service_role', 'public.chart_ohlcv_intraday', 'TRUNCATE') then
    raise exception 'QEO-149 rehearsal: service_role can mutate the HOT parent';
  end if;
  if has_table_privilege('service_role', 'public.chart_ohlcv_provenance_batches', 'UPDATE')
     or has_table_privilege('service_role', 'public.chart_ohlcv_provenance_batches', 'DELETE')
     or has_table_privilege('service_role', 'public.chart_ohlcv_provenance_batches', 'TRUNCATE') then
    raise exception 'QEO-149 rehearsal: service_role can mutate provenance batches';
  end if;
  for v_child in
    select c.oid::regclass
    from pg_inherits i join pg_class c on c.oid = i.inhrelid
    where i.inhparent = 'public.chart_ohlcv_intraday'::regclass
  loop
    if has_table_privilege('service_role', v_child::text, 'INSERT')
       or has_table_privilege('service_role', v_child::text, 'UPDATE')
       or has_table_privilege('service_role', v_child::text, 'DELETE')
       or has_table_privilege('service_role', v_child::text, 'TRUNCATE') then
      raise exception 'QEO-149 rehearsal: service_role can mutate child %', v_child;
    end if;
  end loop;
end;
$function$;

set role service_role;
do $function$
declare
  v_child regclass;
begin
  select c.oid::regclass
  into v_child
  from pg_inherits i
  join pg_class c on c.oid = i.inhrelid
  where i.inhparent = 'public.chart_ohlcv_intraday'::regclass
  limit 1;
  if v_child is null then
    raise exception 'QEO-149 rehearsal: QEO-108 child partition is missing';
  end if;

  begin
    insert into public.chart_ohlcv_intraday
      (ticker, base_resolution, bar_time, open, high, low, close, volume, fetched_at)
    values ('Q149DENY', '1m', now(), 1, 1, 1, 1, 1, now());
    raise exception 'QEO-149 rehearsal: direct service_role HOT INSERT unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.chart_ohlcv_intraday set volume = volume where false;
    raise exception 'QEO-149 rehearsal: direct service_role HOT UPDATE unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.chart_ohlcv_intraday where false;
    raise exception 'QEO-149 rehearsal: direct service_role HOT DELETE unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    execute format('update %s set volume = volume where false', v_child);
    raise exception 'QEO-149 rehearsal: direct service_role child UPDATE unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    execute format('delete from %s where false', v_child);
    raise exception 'QEO-149 rehearsal: direct service_role child DELETE unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.chart_ohlcv_provenance_batches set provider = provider where false;
    raise exception 'QEO-149 rehearsal: direct service_role provenance UPDATE unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.chart_ohlcv_provenance_batches where false;
    raise exception 'QEO-149 rehearsal: direct service_role provenance DELETE unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$function$;
reset role;
SQL

phase "assert correction and proof failures defer without deletion"
psql_local -f - <<'SQL'
do $function$
declare
  v_case record;
  v_batch uuid;
  v_result jsonb;
  v_rows bigint;
  v_rows_before bigint;
begin
  -- OHLCV correction and equal-count correction both change the stamped proof.
  for v_case in select * from public.qeo149_rehearsal_cases where case_name in ('CORRECTION', 'OHLCV') loop
    v_result := public.qeo_upsert_chart_intraday_bars(v_case.ticker, jsonb_build_array(jsonb_build_object(
      'bar_time', v_case.range_start, 'open', 12.0, 'high', 12.2, 'low', 11.9, 'close', 12.1, 'volume', 1200,
      'provenance_batch_id', null, 'fetched_at', now()
    )));
    select public.qeo_prune_verified_chart_intraday_partition(
      v_case.manifest_id, v_case.expected_sha256, v_case.expected_row_count,
      v_case.expected_content_digest, v_case.expected_content_version, v_case.newer_dates
    ) into v_result;
    if v_result ->> 'status' <> 'deferred' or v_result ->> 'reason' <> 'content_mismatch' then
      raise exception 'QEO-149 rehearsal: correction case did not defer: %', v_result;
    end if;
    select count(*) into v_rows from public.chart_ohlcv_intraday where ticker = v_case.ticker and bar_time = v_case.range_start;
    if v_rows <> 1 then raise exception 'QEO-149 rehearsal: correction rows were deleted'; end if;
  end loop;

  -- A provenance-only correction is also content-relevant.
  select gen_random_uuid() into v_batch;
  insert into public.chart_ohlcv_provenance_batches (id, provider, ticker, base_resolution, range_start, range_end, row_count)
  select v_batch, 'QEO-149-REHEARSAL-SECOND', ticker, '1m', range_start, range_start, 1
  from public.qeo149_rehearsal_cases where case_name = 'PROVENANCE';
  select * into v_case from public.qeo149_rehearsal_cases where case_name = 'PROVENANCE';
  perform public.qeo_upsert_chart_intraday_bars(v_case.ticker, jsonb_build_array(jsonb_build_object(
    'bar_time', v_case.range_start, 'open', 10.0, 'high', 10.2, 'low', 9.9, 'close', 10.1, 'volume', 1000,
    'provenance_batch_id', v_batch, 'fetched_at', now()
  )));
  select public.qeo_prune_verified_chart_intraday_partition(
    v_case.manifest_id, v_case.expected_sha256, v_case.expected_row_count,
    v_case.expected_content_digest, v_case.expected_content_version, v_case.newer_dates
  ) into v_result;
  if v_result ->> 'status' <> 'deferred' or v_result ->> 'reason' <> 'content_mismatch' then
    raise exception 'QEO-149 rehearsal: provenance correction did not defer: %', v_result;
  end if;

  -- Replacing the archived timestamp leaves the row count unchanged but moves
  -- it outside the exact manifest range; the old proof still cannot authorize
  -- deletion.
  select * into v_case from public.qeo149_rehearsal_cases where case_name = 'TIMESTAMP';
  update public.chart_ohlcv_intraday
  set bar_time = v_case.range_start + interval '1 minute'
  where ticker = v_case.ticker and bar_time = v_case.range_start;
  select public.qeo_prune_verified_chart_intraday_partition(
    v_case.manifest_id, v_case.expected_sha256, v_case.expected_row_count,
    v_case.expected_content_digest, v_case.expected_content_version, v_case.newer_dates
  ) into v_result;
  if v_result ->> 'status' <> 'deferred' or v_result ->> 'reason' <> 'content_mismatch' then
    raise exception 'QEO-149 rehearsal: timestamp substitution did not defer: %', v_result;
  end if;

  -- A phantom row inside a multi-row manifest range changes both count and
  -- digest, so the whole range remains HOT.
  select * into v_case from public.qeo149_rehearsal_cases where case_name = 'PHANTOM';
  insert into public.chart_ohlcv_intraday
    (ticker, base_resolution, bar_time, open, high, low, close, volume, provenance_batch_id, fetched_at)
  values
    (v_case.ticker, '1m', v_case.range_start + interval '1 minute', 11.5, 11.7, 11.4, 11.6, 1150, null, now());
  select public.qeo_prune_verified_chart_intraday_partition(
    v_case.manifest_id, v_case.expected_sha256, v_case.expected_row_count,
    v_case.expected_content_digest, v_case.expected_content_version, v_case.newer_dates
  ) into v_result;
  if v_result ->> 'status' <> 'deferred' or v_result ->> 'reason' <> 'content_mismatch' then
    raise exception 'QEO-149 rehearsal: phantom row did not defer: %', v_result;
  end if;

  -- Missing proof fails closed before any row can be removed.
  select * into v_case from public.qeo149_rehearsal_cases where case_name = 'TIMESTAMP';
  select count(*) into v_rows_before
  from public.chart_ohlcv_intraday
  where ticker = v_case.ticker;
  begin
    perform public.qeo_prune_verified_chart_intraday_partition(
      v_case.manifest_id, null, v_case.expected_row_count, v_case.expected_content_digest,
      v_case.expected_content_version, v_case.newer_dates
    );
    raise exception 'QEO-149 rehearsal: malformed proof unexpectedly succeeded';
  exception when others then
    if sqlerrm not like 'QEO-149 prune requires complete bounded archive and retention proof%' then raise; end if;
  end;
  select count(*) into v_rows
  from public.chart_ohlcv_intraday
  where ticker = v_case.ticker;
  if v_rows <> v_rows_before then
    raise exception 'QEO-149 rehearsal: missing proof changed HOT row count';
  end if;

  v_rows_before := v_rows;
  begin
    perform public.qeo_prune_verified_chart_intraday_partition(
      v_case.manifest_id, v_case.expected_sha256, v_case.expected_row_count,
      v_case.expected_content_digest, v_case.expected_content_version,
      v_case.newer_dates || array['malformed-date']::text[]
    );
    raise exception 'QEO-149 rehearsal: malformed retention proof unexpectedly succeeded';
  exception when others then
    if sqlerrm not like 'QEO-149 prune retention proof contains malformed session date%' then raise; end if;
  end;
  select count(*) into v_rows
  from public.chart_ohlcv_intraday
  where ticker = v_case.ticker;
  if v_rows <> v_rows_before then
    raise exception 'QEO-149 rehearsal: malformed retention proof changed HOT row count';
  end if;
end;
$function$;
SQL

phase "rehearse prune-first writer queue with independent sessions"
CASE="QUEUED"
CASE_TICKER="$(psql_scalar "select ticker from public.qeo149_rehearsal_cases where case_name = '$CASE'")"
CASE_MANIFEST="$(psql_scalar "select manifest_id from public.qeo149_rehearsal_cases where case_name = '$CASE'")"
CASE_DATE="$(psql_scalar "select candidate_date from public.qeo149_rehearsal_cases where case_name = '$CASE'")"
BLOCKER_APP="${RUN_TAG}_manifest_blocker"
PRUNE_APP="${RUN_TAG}_queued_prune"
WRITER_APP="${RUN_TAG}_queued_writer"

(
  psql_local_app "$BLOCKER_APP" -f - <<SQL
begin;
with locked as (
  select id
  from public.chart_ohlcv_cold_manifests
  where id = '$CASE_MANIFEST'
  for update
)
select locked.id, pg_sleep(1.5) from locked;
commit;
SQL
) > "$TMP_DIR/manifest-blocker.log" 2>&1 &
BLOCKER_PID=$!
wait_for_query "select case when exists (
  select 1
  from pg_stat_activity a
  join pg_locks l on l.pid = a.pid
  where a.application_name = '$BLOCKER_APP'
    and a.state = 'active'
    and l.locktype = 'relation'
    and l.mode = 'RowShareLock'
    and l.granted
    and l.relation = 'public.chart_ohlcv_cold_manifests'::regclass
) then 1 else 0 end" "manifest blocker"

(
  psql_local_app "$PRUNE_APP" -f - <<SQL
select public.qeo_prune_verified_chart_intraday_partition(
  c.manifest_id, c.expected_sha256, c.expected_row_count,
  c.expected_content_digest, c.expected_content_version, c.newer_dates
) from public.qeo149_rehearsal_cases c where c.case_name = '$CASE';
SQL
) > "$TMP_DIR/prune-queued.log" 2>&1 &
PRUNE_PID=$!
wait_for_query "select case when exists (
  select 1
  from pg_stat_activity a
  where a.application_name = '$PRUNE_APP'
    and a.state = 'active'
    and a.wait_event_type = 'Lock'
    and a.query like '%qeo_prune_verified_chart_intraday_partition%'
) then 1 else 0 end" "prune waiting on manifest"

(
  psql_local_app "$WRITER_APP" -f - <<SQL
select public.qeo_upsert_chart_intraday_bars('$CASE_TICKER', jsonb_build_array(jsonb_build_object(
  'bar_time', ('$CASE_DATE'::date::timestamp + time '09:15') at time zone 'Asia/Ho_Chi_Minh',
  'open', 13.0, 'high', 13.2, 'low', 12.9, 'close', 13.1, 'volume', 1300,
  'provenance_batch_id', null, 'fetched_at', now()
)));
SQL
) > "$TMP_DIR/writer-queued.log" 2>&1 &
WRITER_PID=$!
wait_for_advisory_wait "$WRITER_APP" "qeo_upsert_chart_intraday_bars" "writer queued behind prune"

wait_pid "$BLOCKER_PID" "manifest blocker" "$TMP_DIR/manifest-blocker.log"
wait_pid "$PRUNE_PID" "queued prune" "$TMP_DIR/prune-queued.log"
wait_pid "$WRITER_PID" "queued writer" "$TMP_DIR/writer-queued.log"
psql_local -f - <<SQL
do \$function\$
begin
  if not exists (select 1 from public.chart_ohlcv_intraday where ticker = '$CASE_TICKER' and bar_time = ('$CASE_DATE'::date::timestamp + time '09:15') at time zone 'Asia/Ho_Chi_Minh' and close = 13.1) then
    raise exception 'QEO-149 rehearsal: writer queued behind prune did not survive';
  end if;
end;
\$function\$;
SQL

phase "rehearse reclaim/writer both orderings and lock timeout rollback"
for ORDER in WRITER_FIRST RECLAIM_FIRST; do
  if [[ "$ORDER" == "WRITER_FIRST" ]]; then
    DATE="$(psql_scalar "select current_date + 1")"
  else
    DATE="$(psql_scalar "select current_date + 2")"
  fi
  LOCK="$(psql_scalar "select public.qeo_chart_intraday_session_lock_key('$DATE'::date)")"
  if [[ "$ORDER" == "WRITER_FIRST" ]]; then
    TICKER="Q149WF"
  else
    TICKER="Q149RF"
  fi
  if [[ "$ORDER" == "WRITER_FIRST" ]]; then
    HOLDER_APP="${RUN_TAG}_reclaim_writer_first_holder"
    RECLAIM_APP="${RUN_TAG}_reclaim_writer_first_reclaim"
    psql_local -f - <<SQL
select public.qeo_ensure_chart_intraday_session_partition('$DATE');
SQL
    (
      psql_local_app "$HOLDER_APP" -f - <<SQL
begin;
select pg_advisory_xact_lock($LOCK);
select public.qeo_upsert_chart_intraday_bars('$TICKER', jsonb_build_array(jsonb_build_object(
  'bar_time', ('$DATE'::date::timestamp + time '10:00') at time zone 'Asia/Ho_Chi_Minh',
  'open', 14.0, 'high', 14.2, 'low', 13.9, 'close', 14.1, 'volume', 1400,
  'provenance_batch_id', null, 'fetched_at', now()
)));
select pg_sleep(1.2);
commit;
SQL
    ) > "$TMP_DIR/$ORDER-holder.log" 2>&1 &
    HOLDER_PID=$!
    wait_for_advisory_holder "$HOLDER_APP" "$ORDER writer holder owns lifecycle lock"
    (
      psql_local_app "$RECLAIM_APP" -f - <<SQL
select public.qeo_drop_empty_chart_intraday_session_partition('$DATE');
SQL
    ) > "$TMP_DIR/$ORDER-reclaim.log" 2>&1 &
    RECLAIM_PID=$!
    wait_for_advisory_wait "$RECLAIM_APP" "qeo_drop_empty_chart_intraday_session_partition" "$ORDER reclaim waits on lifecycle lock"
    wait_pid "$HOLDER_PID" "$ORDER writer holder" "$TMP_DIR/$ORDER-holder.log"
    wait_pid "$RECLAIM_PID" "$ORDER reclaim" "$TMP_DIR/$ORDER-reclaim.log"
    psql_local -f - <<SQL
do \$function\$
begin
  if not exists (select 1 from public.chart_ohlcv_intraday where ticker = '$TICKER' and bar_time = ('$DATE'::date::timestamp + time '10:00') at time zone 'Asia/Ho_Chi_Minh') then
    raise exception 'QEO-149 rehearsal: WRITER_FIRST row did not survive reclaim';
  end if;
end;
\$function\$;
SQL
  else
    # First empty the dedicated date. The writer starts while DROP still owns
    # the lifecycle lock, then must recreate the partition and keep its row.
    HOLDER_APP="${RUN_TAG}_reclaim_first_holder"
    WRITER_APP="${RUN_TAG}_reclaim_first_writer"
    psql_local -f - <<SQL
select public.qeo_ensure_chart_intraday_session_partition('$DATE');
select public.qeo_drop_empty_chart_intraday_session_partition('$DATE');
SQL
    (
      psql_local_app "$HOLDER_APP" -f - <<SQL
begin;
select pg_advisory_xact_lock($LOCK);
select public.qeo_drop_empty_chart_intraday_session_partition('$DATE');
select pg_sleep(1.2);
commit;
SQL
    ) > "$TMP_DIR/$ORDER-holder.log" 2>&1 &
    HOLDER_PID=$!
    wait_for_advisory_holder "$HOLDER_APP" "$ORDER reclaim holder owns lifecycle lock"
    (
      psql_local_app "$WRITER_APP" -f - <<SQL
select public.qeo_upsert_chart_intraday_bars('$TICKER', jsonb_build_array(jsonb_build_object(
  'bar_time', ('$DATE'::date::timestamp + time '10:01') at time zone 'Asia/Ho_Chi_Minh',
  'open', 15.0, 'high', 15.2, 'low', 14.9, 'close', 15.1, 'volume', 1500,
  'provenance_batch_id', null, 'fetched_at', now()
)));
SQL
    ) > "$TMP_DIR/$ORDER-writer.log" 2>&1 &
    WRITER_PID=$!
    wait_for_advisory_wait "$WRITER_APP" "qeo_upsert_chart_intraday_bars" "$ORDER writer waits on lifecycle lock"
    wait_pid "$HOLDER_PID" "$ORDER reclaim holder" "$TMP_DIR/$ORDER-holder.log"
    wait_pid "$WRITER_PID" "$ORDER writer" "$TMP_DIR/$ORDER-writer.log"
    psql_local -f - <<SQL
do \$function\$
begin
  if not exists (select 1 from public.chart_ohlcv_intraday where ticker = '$TICKER' and bar_time = ('$DATE'::date::timestamp + time '10:01') at time zone 'Asia/Ho_Chi_Minh') then
    raise exception 'QEO-149 rehearsal: RECLAIM_FIRST writer row did not survive';
  end if;
end;
\$function\$;
SQL
  fi
done

phase "assert retention, timestamp/phantom proof, and opposite multi-date ordering"
psql_local -f - <<'SQL'
do $function$
declare
  v_case record;
  v_result jsonb;
begin
  select * into v_case from public.qeo149_rehearsal_cases where case_name = 'FEWER';
  select public.qeo_prune_verified_chart_intraday_partition(
    v_case.manifest_id, v_case.expected_sha256, v_case.expected_row_count,
    v_case.expected_content_digest, v_case.expected_content_version, v_case.newer_dates
  ) into v_result;
  if v_result ->> 'status' <> 'deferred' or v_result ->> 'reason' <> 'retention_mismatch' then
    raise exception 'QEO-149 rehearsal: fewer-than-five retention case did not defer: %', v_result;
  end if;
end;
$function$;
SQL

DATE_A="$(psql_scalar "select candidate_date from public.qeo149_rehearsal_cases where case_name = 'CORRECTION'")"
DATE_B="$(psql_scalar "select newer_dates[1] from public.qeo149_rehearsal_cases where case_name = 'CORRECTION'")"
TICKER_A="$(psql_scalar "select ticker from public.qeo149_rehearsal_cases where case_name = 'CORRECTION'")"
TICKER_B="$(psql_scalar "select ticker from public.qeo149_rehearsal_cases where case_name = 'OHLCV'")"
MULTI_LOCK_KEY="$(psql_scalar "select public.qeo_chart_intraday_session_lock_key('$DATE_B'::date)")"
MULTI_LOCK_APP="${RUN_TAG}_multi_date_lock"
MULTI_A_APP="${RUN_TAG}_multi_writer_a"
MULTI_B_APP="${RUN_TAG}_multi_writer_b"
(
  psql_local_app "$MULTI_LOCK_APP" -f - <<SQL
begin;
select pg_advisory_xact_lock($MULTI_LOCK_KEY);
select pg_sleep(1.5);
commit;
SQL
) > "$TMP_DIR/multi-lock.log" 2>&1 &
MULTI_LOCK_PID=$!
wait_for_advisory_holder "$MULTI_LOCK_APP" "multi-date blocker owns newer lifecycle lock"

# The first writer deliberately submits newer then older input; the second
# submits older then newer. Both RPCs must derive and acquire the same dates in
# ascending order. Holding the newer date forces writer A to wait after it has
# acquired the older date, then writer B overlaps and waits on that older date.
(
  psql_local_app "$MULTI_A_APP" -f - <<SQL
select public.qeo_upsert_chart_intraday_bars('$TICKER_A', jsonb_build_array(
  jsonb_build_object('bar_time', ('$DATE_B'::date::timestamp + time '11:00') at time zone 'Asia/Ho_Chi_Minh', 'open', 16, 'high', 16.2, 'low', 15.9, 'close', 16.1, 'volume', 1600, 'provenance_batch_id', null, 'fetched_at', now()),
  jsonb_build_object('bar_time', ('$DATE_A'::date::timestamp + time '11:00') at time zone 'Asia/Ho_Chi_Minh', 'open', 16, 'high', 16.2, 'low', 15.9, 'close', 16.1, 'volume', 1600, 'provenance_batch_id', null, 'fetched_at', now())
));
SQL
) > "$TMP_DIR/multi-a.log" 2>&1 &
MULTI_A=$!
wait_for_advisory_wait "$MULTI_A_APP" "qeo_upsert_chart_intraday_bars" "multi-date writer A waits on newer lifecycle lock"
(
  psql_local_app "$MULTI_B_APP" -f - <<SQL
select public.qeo_upsert_chart_intraday_bars('$TICKER_B', jsonb_build_array(
  jsonb_build_object('bar_time', ('$DATE_A'::date::timestamp + time '11:01') at time zone 'Asia/Ho_Chi_Minh', 'open', 17, 'high', 17.2, 'low', 16.9, 'close', 17.1, 'volume', 1700, 'provenance_batch_id', null, 'fetched_at', now()),
  jsonb_build_object('bar_time', ('$DATE_B'::date::timestamp + time '11:01') at time zone 'Asia/Ho_Chi_Minh', 'open', 17, 'high', 17.2, 'low', 16.9, 'close', 17.1, 'volume', 1700, 'provenance_batch_id', null, 'fetched_at', now())
));
SQL
) > "$TMP_DIR/multi-b.log" 2>&1 &
MULTI_B=$!
wait_for_advisory_wait "$MULTI_B_APP" "qeo_upsert_chart_intraday_bars" "multi-date writer B overlaps and waits on older lifecycle lock"
wait_pid "$MULTI_LOCK_PID" "multi-date blocker" "$TMP_DIR/multi-lock.log"
wait_pid "$MULTI_A" "opposite-order writer A" "$TMP_DIR/multi-a.log"
wait_pid "$MULTI_B" "opposite-order writer B" "$TMP_DIR/multi-b.log"

phase "assert content identity and no partial lock-timeout write"
LOCK_TIMEOUT_TICKER="$(psql_scalar "select ticker from public.qeo149_rehearsal_cases where case_name = 'TIMESTAMP'")"
LOCK_TIMEOUT_DATE="$(psql_scalar "select candidate_date from public.qeo149_rehearsal_cases where case_name = 'TIMESTAMP'")"
LOCK_TIMEOUT_KEY="$(psql_scalar "select public.qeo_chart_intraday_session_lock_key(candidate_date) from public.qeo149_rehearsal_cases where case_name = 'TIMESTAMP'")"
TIMEOUT_HOLDER_APP="${RUN_TAG}_timeout_holder"
TIMEOUT_WRITER_APP="${RUN_TAG}_timeout_writer"
(
  psql_local_app "$TIMEOUT_HOLDER_APP" -f - <<SQL
begin;
with locked as (
  select pg_advisory_xact_lock($LOCK_TIMEOUT_KEY)
)
select pg_sleep(1.2) from locked;
commit;
SQL
) > "$TMP_DIR/timeout-holder.log" 2>&1 &
TIMEOUT_HOLDER=$!
wait_for_advisory_holder "$TIMEOUT_HOLDER_APP" "lock-timeout holder owns lifecycle lock"
(
  psql_local_app "$TIMEOUT_WRITER_APP" -f - <<SQL
begin;
set local statement_timeout = '200ms';
select public.qeo_upsert_chart_intraday_bars('$LOCK_TIMEOUT_TICKER', jsonb_build_array(jsonb_build_object(
  'bar_time', ('$LOCK_TIMEOUT_DATE'::date::timestamp + time '12:00') at time zone 'Asia/Ho_Chi_Minh',
  'open', 18, 'high', 18.2, 'low', 17.9, 'close', 18.1, 'volume', 1800,
  'provenance_batch_id', null, 'fetched_at', now()
)));
commit;
SQL
) > "$TMP_DIR/timeout-writer.log" 2>&1 &
TIMEOUT_WRITER=$!
wait_for_advisory_wait "$TIMEOUT_WRITER_APP" "qeo_upsert_chart_intraday_bars" "lock-timeout writer waits on lifecycle lock"
if wait "$TIMEOUT_WRITER"; then
  cat "$TMP_DIR/timeout-writer.log" >&2 || true
  fail "QEO-149 rehearsal: lock timeout writer unexpectedly succeeded"
fi
wait_pid "$TIMEOUT_HOLDER" "lock-timeout holder" "$TMP_DIR/timeout-holder.log"
psql_local -f - <<SQL
do \$function\$
begin
  if exists (select 1 from public.chart_ohlcv_intraday where ticker = '$LOCK_TIMEOUT_TICKER' and bar_time = ('$LOCK_TIMEOUT_DATE'::date::timestamp + time '12:00') at time zone 'Asia/Ho_Chi_Minh') then
    raise exception 'QEO-149 rehearsal: lock-timeout writer left a partial row';
  end if;
end;
\$function\$;
SQL

printf '\nQEO-149 isolated two-session concurrency rehearsal: PASS\n'
