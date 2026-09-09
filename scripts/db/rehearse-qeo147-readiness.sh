#!/usr/bin/env bash
set -euo pipefail

PRODUCTION_PROJECT_REF="glwhhrmejlonhyorvtzm"
DB_CONTAINER="${QEO_Q147_DB_CONTAINER:-supabase_db_qeoindex}"
READINESS_MIGRATION="supabase/pending-migrations/20260909143000_qeo147_derived_hourly_readiness.sql"
CONCURRENCY_MIGRATION="supabase/pending-migrations/20260909144000_qeo147_derived_hourly_concurrency.sql"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/qeo147-rehearsal.XXXXXX")"
WRITER_APP="qeo147-writer-$$"
VALIDATOR_APP="qeo147-validator-$$"

phase() {
  printf '\n==> QEO-147 %s\n' "$1"
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM

[[ -f "$READINESS_MIGRATION" ]] || fail "pending QEO-147 readiness migration is missing"
[[ -f "$CONCURRENCY_MIGRATION" ]] || fail "pending QEO-147 concurrency migration is missing"
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
    if (( elapsed >= 100 )); then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
      cat "$log" >&2 || true
      fail "$label exceeded the bounded timeout"
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
  while (( attempts < 100 )); do
    if [[ "$(psql_scalar "$query" 2>/dev/null | tr -d '[:space:]')" == "1" ]]; then return 0; fi
    sleep 0.1
    attempts=$((attempts + 1))
  done
  fail "$label was not observed before the bounded timeout"
}

phase "preflight the QEO-149 content identity dependency"
psql_local -f - <<'SQL'
do $function$
begin
  if to_regprocedure('public.qeo_prune_verified_chart_intraday_partition(uuid,text,integer,text,bigint,text[])') is null then
    raise exception 'QEO-147 rehearsal: QEO-149 correction-safe prune is missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'chart_ohlcv_cold_manifests'
      and column_name = 'canonical_content_digest'
  ) then
    raise exception 'QEO-147 rehearsal: canonical manifest content identity is missing';
  end if;
end;
$function$;
SQL

phase "seed a legacy partial cache before the additive readiness schema"
psql_local -f - <<'SQL'
drop table if exists public.qeo147_rehearsal_state;
create table public.qeo147_rehearsal_state (
  manifest_id uuid primary key,
  ticker text not null
);

do $function$
declare
  v_manifest_id uuid;
  v_ticker text := 'Q147X';
  v_range_start timestamptz := '2026-08-20T02:00:00Z';
  v_range_end timestamptz := '2026-08-20T03:01:00Z';
begin
  delete from public.chart_ohlcv_derived_hourly where ticker = v_ticker;
  delete from public.chart_ohlcv_cold_manifests where ticker = v_ticker and object_path like 'qeo147-rehearsal/%';

  insert into public.chart_ohlcv_cold_manifests (
    ticker, base_resolution, range_start, range_end, object_path, archive_format,
    row_count, sha256, verified_at, format_version, byte_count,
    canonical_content_digest, canonical_content_version
  ) values (
    v_ticker, '1m', v_range_start, v_range_end,
    'qeo147-rehearsal/legacy-partial.ndjson.gz', 'ndjson.gz',
    4, repeat('1', 64), now(), 1, 512,
    repeat('a', 64), 101
  ) returning id into v_manifest_id;

  insert into public.chart_ohlcv_derived_hourly (
    ticker, resolution, bar_time, open, high, low, close, volume,
    source_manifest_id, source_sha256, source_range_start, source_range_end,
    source_raw_row_count, aggregation_version, generated_at
  ) values (
    v_ticker, '1h', v_range_start, 10.0, 10.2, 9.9, 10.1, 1000,
    v_manifest_id, repeat('1', 64), v_range_start, v_range_end,
    4, 'vn-session-v1', now()
  );

  insert into public.qeo147_rehearsal_state (manifest_id, ticker)
  values (v_manifest_id, v_ticker);
end;
$function$;
SQL

phase "apply QEO-147 pending migrations in the isolated local database"
psql_local -f - < "$READINESS_MIGRATION"
psql_local -f - < "$CONCURRENCY_MIGRATION"

phase "prove legacy partial cache is UNKNOWN and grants fail closed"
psql_local -f - <<'SQL'
do $function$
declare
  v_manifest_id uuid;
  v_ready boolean;
  v_reason text;
begin
  select manifest_id into v_manifest_id from public.qeo147_rehearsal_state limit 1;
  select ready, reason into v_ready, v_reason
  from public.qeo_validate_chart_derived_hourly_manifests(array[v_manifest_id]);
  if coalesce(v_ready, false) or v_reason <> 'unknown' then
    raise exception 'QEO-147 rehearsal: one legacy row falsely proved readiness: ready %, reason %', v_ready, v_reason;
  end if;

  if not has_function_privilege('service_role', 'public.qeo_validate_chart_derived_hourly_manifests(uuid[])', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.qeo_publish_chart_derived_hourly_readiness(uuid,text,timestamptz,timestamptz,integer,smallint,text,bigint,text,uuid,integer,text)', 'EXECUTE') then
    raise exception 'QEO-147 rehearsal: service-role publication/validation grants are missing';
  end if;
  if has_function_privilege('anon', 'public.qeo_validate_chart_derived_hourly_manifests(uuid[])', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.qeo_publish_chart_derived_hourly_readiness(uuid,text,timestamptz,timestamptz,integer,smallint,text,bigint,text,uuid,integer,text)', 'EXECUTE') then
    raise exception 'QEO-147 rehearsal: public execution privilege leaked';
  end if;
  if has_table_privilege('service_role', 'public.chart_ohlcv_derived_hourly_readiness', 'INSERT')
     or has_table_privilege('service_role', 'public.chart_ohlcv_derived_hourly_readiness', 'UPDATE')
     or has_table_privilege('service_role', 'public.chart_ohlcv_derived_hourly_readiness', 'DELETE') then
    raise exception 'QEO-147 rehearsal: service_role can bypass publication state RPCs';
  end if;
end;
$function$;
SQL

phase "fault inject interrupted writes, exact publication, deletion and same-count corruption"
psql_local -f - <<'SQL'
do $function$
declare
  v_manifest public.chart_ohlcv_cold_manifests%rowtype;
  v_generation uuid;
  v_digest text;
  v_result jsonb;
  v_ready boolean;
  v_reason text;
  v_failed_as_expected boolean := false;
begin
  select m.* into v_manifest
  from public.chart_ohlcv_cold_manifests m
  join public.qeo147_rehearsal_state s on s.manifest_id = m.id
  limit 1;

  delete from public.chart_ohlcv_derived_hourly where source_manifest_id = v_manifest.id;
  v_generation := gen_random_uuid();
  insert into public.chart_ohlcv_derived_hourly (
    ticker, resolution, bar_time, open, high, low, close, volume,
    source_manifest_id, source_sha256, source_range_start, source_range_end,
    source_raw_row_count, source_format_version, source_canonical_content_digest,
    source_canonical_content_version, aggregation_version, generation_id, generated_at
  ) values (
    v_manifest.ticker, '1h', v_manifest.range_start, 10.0, 10.2, 9.9, 10.1, 1000,
    v_manifest.id, v_manifest.sha256, v_manifest.range_start, v_manifest.range_end,
    v_manifest.row_count, v_manifest.format_version, v_manifest.canonical_content_digest,
    v_manifest.canonical_content_version, 'vn-session-v1', v_generation, now()
  );
  select encode(digest(string_agg(content_digest, '' order by bar_time), 'sha256'), 'hex')
    into v_digest
  from public.chart_ohlcv_derived_hourly where source_manifest_id = v_manifest.id;

  begin
    perform public.qeo_publish_chart_derived_hourly_readiness(
      v_manifest.id, v_manifest.sha256, v_manifest.range_start, v_manifest.range_end,
      v_manifest.row_count, v_manifest.format_version, v_manifest.canonical_content_digest,
      v_manifest.canonical_content_version, 'vn-session-v1', v_generation, 2, v_digest
    );
  exception when others then
    if position('QEO-147 publication derived proof mismatch' in sqlerrm) = 0 then raise; end if;
    v_failed_as_expected := true;
  end;
  if not v_failed_as_expected then
    raise exception 'QEO-147 rehearsal: interrupted one-row generation was published';
  end if;

  delete from public.chart_ohlcv_derived_hourly where source_manifest_id = v_manifest.id;
  v_generation := gen_random_uuid();
  insert into public.chart_ohlcv_derived_hourly (
    ticker, resolution, bar_time, open, high, low, close, volume,
    source_manifest_id, source_sha256, source_range_start, source_range_end,
    source_raw_row_count, source_format_version, source_canonical_content_digest,
    source_canonical_content_version, aggregation_version, generation_id, generated_at
  ) values
    (v_manifest.ticker, '1h', v_manifest.range_start, 10.0, 10.2, 9.9, 10.1, 1000,
     v_manifest.id, v_manifest.sha256, v_manifest.range_start, v_manifest.range_end,
     v_manifest.row_count, v_manifest.format_version, v_manifest.canonical_content_digest,
     v_manifest.canonical_content_version, 'vn-session-v1', v_generation, now()),
    (v_manifest.ticker, '1h', v_manifest.range_start + interval '1 hour', 10.1, 10.4, 10.0, 10.3, 1200,
     v_manifest.id, v_manifest.sha256, v_manifest.range_start, v_manifest.range_end,
     v_manifest.row_count, v_manifest.format_version, v_manifest.canonical_content_digest,
     v_manifest.canonical_content_version, 'vn-session-v1', v_generation, now());
  select encode(digest(string_agg(content_digest, '' order by bar_time), 'sha256'), 'hex')
    into v_digest
  from public.chart_ohlcv_derived_hourly where source_manifest_id = v_manifest.id;
  select public.qeo_publish_chart_derived_hourly_readiness(
    v_manifest.id, v_manifest.sha256, v_manifest.range_start, v_manifest.range_end,
    v_manifest.row_count, v_manifest.format_version, v_manifest.canonical_content_digest,
    v_manifest.canonical_content_version, 'vn-session-v1', v_generation, 2, v_digest
  ) into v_result;
  if v_result->>'status' <> 'ready' then raise exception 'QEO-147 rehearsal: complete generation was not published'; end if;
  select ready, reason into v_ready, v_reason
  from public.qeo_validate_chart_derived_hourly_manifests(array[v_manifest.id]);
  if not coalesce(v_ready, false) or v_reason <> 'ready' then
    raise exception 'QEO-147 rehearsal: complete generation failed validation: %, %', v_ready, v_reason;
  end if;

  delete from public.chart_ohlcv_derived_hourly
  where source_manifest_id = v_manifest.id and bar_time = v_manifest.range_start + interval '1 hour';
  if exists (select 1 from public.chart_ohlcv_derived_hourly_readiness where source_manifest_id = v_manifest.id) then
    raise exception 'QEO-147 rehearsal: deletion did not invalidate readiness';
  end if;
  select ready, reason into v_ready, v_reason
  from public.qeo_validate_chart_derived_hourly_manifests(array[v_manifest.id]);
  if coalesce(v_ready, false) then raise exception 'QEO-147 rehearsal: missing middle row remained ready'; end if;

  delete from public.chart_ohlcv_derived_hourly where source_manifest_id = v_manifest.id;
  v_generation := gen_random_uuid();
  insert into public.chart_ohlcv_derived_hourly (
    ticker, resolution, bar_time, open, high, low, close, volume,
    source_manifest_id, source_sha256, source_range_start, source_range_end,
    source_raw_row_count, source_format_version, source_canonical_content_digest,
    source_canonical_content_version, aggregation_version, generation_id, generated_at
  ) values
    (v_manifest.ticker, '1h', v_manifest.range_start, 10.0, 10.2, 9.9, 10.1, 1000,
     v_manifest.id, v_manifest.sha256, v_manifest.range_start, v_manifest.range_end,
     v_manifest.row_count, v_manifest.format_version, v_manifest.canonical_content_digest,
     v_manifest.canonical_content_version, 'vn-session-v1', v_generation, now()),
    (v_manifest.ticker, '1h', v_manifest.range_start + interval '1 hour', 10.1, 10.4, 10.0, 10.3, 1200,
     v_manifest.id, v_manifest.sha256, v_manifest.range_start, v_manifest.range_end,
     v_manifest.row_count, v_manifest.format_version, v_manifest.canonical_content_digest,
     v_manifest.canonical_content_version, 'vn-session-v1', v_generation, now());
  select encode(digest(string_agg(content_digest, '' order by bar_time), 'sha256'), 'hex')
    into v_digest from public.chart_ohlcv_derived_hourly where source_manifest_id = v_manifest.id;
  perform public.qeo_publish_chart_derived_hourly_readiness(
    v_manifest.id, v_manifest.sha256, v_manifest.range_start, v_manifest.range_end,
    v_manifest.row_count, v_manifest.format_version, v_manifest.canonical_content_digest,
    v_manifest.canonical_content_version, 'vn-session-v1', v_generation, 2, v_digest
  );
  update public.chart_ohlcv_derived_hourly
  set close = 10.15
  where source_manifest_id = v_manifest.id and bar_time = v_manifest.range_start;
  if exists (select 1 from public.chart_ohlcv_derived_hourly_readiness where source_manifest_id = v_manifest.id) then
    raise exception 'QEO-147 rehearsal: same-count OHLCV correction did not invalidate readiness';
  end if;

  -- Rebuild a ready generation for source-overwrite and concurrency checks.
  delete from public.chart_ohlcv_derived_hourly where source_manifest_id = v_manifest.id;
  v_generation := gen_random_uuid();
  insert into public.chart_ohlcv_derived_hourly (
    ticker, resolution, bar_time, open, high, low, close, volume,
    source_manifest_id, source_sha256, source_range_start, source_range_end,
    source_raw_row_count, source_format_version, source_canonical_content_digest,
    source_canonical_content_version, aggregation_version, generation_id, generated_at
  ) values
    (v_manifest.ticker, '1h', v_manifest.range_start, 10.0, 10.2, 9.9, 10.1, 1000,
     v_manifest.id, v_manifest.sha256, v_manifest.range_start, v_manifest.range_end,
     v_manifest.row_count, v_manifest.format_version, v_manifest.canonical_content_digest,
     v_manifest.canonical_content_version, 'vn-session-v1', v_generation, now()),
    (v_manifest.ticker, '1h', v_manifest.range_start + interval '1 hour', 10.1, 10.4, 10.0, 10.3, 1200,
     v_manifest.id, v_manifest.sha256, v_manifest.range_start, v_manifest.range_end,
     v_manifest.row_count, v_manifest.format_version, v_manifest.canonical_content_digest,
     v_manifest.canonical_content_version, 'vn-session-v1', v_generation, now());
  select encode(digest(string_agg(content_digest, '' order by bar_time), 'sha256'), 'hex')
    into v_digest from public.chart_ohlcv_derived_hourly where source_manifest_id = v_manifest.id;
  perform public.qeo_publish_chart_derived_hourly_readiness(
    v_manifest.id, v_manifest.sha256, v_manifest.range_start, v_manifest.range_end,
    v_manifest.row_count, v_manifest.format_version, v_manifest.canonical_content_digest,
    v_manifest.canonical_content_version, 'vn-session-v1', v_generation, 2, v_digest
  );

  update public.chart_ohlcv_cold_manifests set sha256 = repeat('2', 64) where id = v_manifest.id;
  select ready, reason into v_ready, v_reason
  from public.qeo_validate_chart_derived_hourly_manifests(array[v_manifest.id]);
  if coalesce(v_ready, false) or v_reason <> 'source_mismatch' then
    raise exception 'QEO-147 rehearsal: overwritten source manifest remained ready: %, %', v_ready, v_reason;
  end if;
  update public.chart_ohlcv_cold_manifests set sha256 = v_manifest.sha256 where id = v_manifest.id;
end;
$function$;
SQL

phase "prove a competing generation waits on the manifest lock and cannot leave stale READY"
MANIFEST_ID="$(psql_scalar "select manifest_id from public.qeo147_rehearsal_state limit 1")"
[[ "$MANIFEST_ID" =~ ^[0-9a-f-]{36}$ ]] || fail "fixture manifest id is invalid"
WRITER_LOG="$TMP_DIR/writer.log"
VALIDATOR_LOG="$TMP_DIR/validator.log"

psql_local_app "$WRITER_APP" -f - >"$WRITER_LOG" 2>&1 <<SQL &
begin;
update public.chart_ohlcv_derived_hourly
set generation_id = gen_random_uuid()
where source_manifest_id = '$MANIFEST_ID'::uuid
  and bar_time = (select range_start from public.chart_ohlcv_cold_manifests where id = '$MANIFEST_ID'::uuid);
select pg_sleep(2);
commit;
SQL
WRITER_PID=$!

wait_for_query "select case when exists (
  select 1 from pg_stat_activity a join pg_locks l on l.pid = a.pid
  where a.application_name = '$WRITER_APP' and a.state = 'active'
    and l.locktype = 'advisory' and l.granted
) then 1 else 0 end" "competing generation advisory lock holder"

psql_local_app "$VALIDATOR_APP" -Atqc "select ready::text || '|' || reason from public.qeo_validate_chart_derived_hourly_manifests(array['$MANIFEST_ID'::uuid])" >"$VALIDATOR_LOG" 2>&1 &
VALIDATOR_PID=$!

wait_for_query "select case when exists (
  select 1 from pg_stat_activity a join pg_locks l on l.pid = a.pid
  where a.application_name = '$VALIDATOR_APP' and a.state = 'active'
    and a.wait_event_type = 'Lock' and l.locktype = 'advisory' and not l.granted
) then 1 else 0 end" "validator advisory lock wait"

wait_pid "$WRITER_PID" "competing generation writer" "$WRITER_LOG"
wait_pid "$VALIDATOR_PID" "locked readiness validator" "$VALIDATOR_LOG"
VALIDATOR_RESULT="$(tr -d '[:space:]' < "$VALIDATOR_LOG")"
[[ "$VALIDATOR_RESULT" == "false|unknown" || "$VALIDATOR_RESULT" == "f|unknown" ]] \
  || fail "validator returned unexpected post-mutation state: $VALIDATOR_RESULT"

phase "cleanup isolated fixtures"
psql_local -f - <<'SQL'
delete from public.chart_ohlcv_derived_hourly
where source_manifest_id in (select manifest_id from public.qeo147_rehearsal_state);
delete from public.chart_ohlcv_derived_hourly_readiness
where source_manifest_id in (select manifest_id from public.qeo147_rehearsal_state);
delete from public.chart_ohlcv_cold_manifests
where id in (select manifest_id from public.qeo147_rehearsal_state);
drop table public.qeo147_rehearsal_state;
SQL

phase "PASS"
