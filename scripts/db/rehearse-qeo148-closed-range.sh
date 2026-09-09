#!/usr/bin/env bash
set -euo pipefail

PRODUCTION_PROJECT_REF="glwhhrmejlonhyorvtzm"
DB_CONTAINER="${QEO_Q148_DB_CONTAINER:-supabase_db_qeoindex}"
MIGRATION="supabase/pending-migrations/20260909160500_qeo148_closed_range_coordination.sql"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/qeo148-rehearsal.XXXXXX")"

phase() {
  printf '\n==> QEO-148 %s\n' "$1"
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM

[[ -f "$MIGRATION" ]] || fail "pending QEO-148 migration is missing"
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

service_scalar_app() {
  local application_name="$1"
  local query="$2"
  psql_local_app "$application_name" -Atq -c "set role service_role; $query"
}

new_uuid() {
  psql_scalar "select gen_random_uuid()"
}

lease_state() {
  local range_id="$1"
  psql_scalar "select coalesce(lease_owner::text,'null') || ':' || lease_fence::text || ':' || (lease_expires_at > clock_timestamp())::text from public.chart_ohlcv_backfill_ranges where id='$range_id'::uuid"
}

phase "preflight QEO-149 safe-writer dependency"
psql_local -f - <<'SQL'
do $function$
begin
  if to_regprocedure('public.qeo_upsert_chart_intraday_bars(text,jsonb)') is null then
    raise exception 'QEO-148 rehearsal: QEO-149 safe writer is missing';
  end if;
  if not has_function_privilege('service_role', 'public.qeo_upsert_chart_intraday_bars(text,jsonb)', 'EXECUTE') then
    raise exception 'QEO-148 rehearsal: service_role cannot execute the QEO-149 safe writer';
  end if;
end;
$function$;
SQL

phase "apply quarantined QEO-148 migration in the isolated local database"
psql_local -f - < "$MIGRATION"

phase "assert private range state and RPC privilege boundary"
psql_local -f - <<'SQL'
do $function$
declare
  v_rls boolean;
begin
  select c.relrowsecurity into v_rls
  from pg_class c
  where c.oid = 'public.chart_ohlcv_backfill_ranges'::regclass;
  if not coalesce(v_rls, false) then
    raise exception 'QEO-148 rehearsal: range table RLS is disabled';
  end if;

  if has_table_privilege('service_role', 'public.chart_ohlcv_backfill_ranges', 'INSERT')
     or has_table_privilege('service_role', 'public.chart_ohlcv_backfill_ranges', 'UPDATE')
     or has_table_privilege('service_role', 'public.chart_ohlcv_backfill_ranges', 'DELETE') then
    raise exception 'QEO-148 rehearsal: service_role can bypass range coordination RPCs';
  end if;

  if not has_function_privilege('service_role', 'public.qeo_chart_intraday_success_coverage(text,text,timestamptz,timestamptz)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.qeo_claim_chart_intraday_range(text,text,timestamptz,timestamptz,uuid,boolean,integer)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.qeo_complete_chart_intraday_range(uuid,uuid,bigint,text,integer,uuid,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.qeo_abandon_chart_intraday_range(uuid,uuid,bigint,text)', 'EXECUTE') then
    raise exception 'QEO-148 rehearsal: service-role RPC grants are incomplete';
  end if;

  if has_function_privilege('anon', 'public.qeo_claim_chart_intraday_range(text,text,timestamptz,timestamptz,uuid,boolean,integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.qeo_complete_chart_intraday_range(uuid,uuid,bigint,text,integer,uuid,text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.qeo_chart_intraday_backfill_lock_key(text,text)', 'EXECUTE') then
    raise exception 'QEO-148 rehearsal: private coordination privilege leaked';
  end if;
end;
$function$;
SQL

phase "clear isolated fixture namespace"
psql_local -f - <<'SQL'
delete from public.chart_ohlcv_backfill_ranges where ticker like 'Q148%';
delete from public.chart_ohlcv_intraday where ticker like 'Q148%';
delete from public.chart_ohlcv_provenance_batches where ticker like 'Q148%';
SQL

phase "prove two-client overlap contention and ordinary success reuse"
OWNER_A="$(new_uuid)"
OWNER_B="$(new_uuid)"
BATCH_A="$(new_uuid)"
CONTENT_A="$(printf 'a%.0s' {1..64})"

STATUS_A="$(service_scalar_app "qeo148-client-a" "select public.qeo_claim_chart_intraday_range('Q148A','PRIMARY_PROVIDER','2026-08-10T02:00:00Z','2026-08-10T03:00:00Z','$OWNER_A'::uuid,false,60)->>'status';")"
[[ "$STATUS_A" == "claimed" ]] || fail "client A expected claimed, got $STATUS_A"
STATUS_B="$(service_scalar_app "qeo148-client-b" "select public.qeo_claim_chart_intraday_range('Q148A','PRIMARY_PROVIDER','2026-08-10T02:30:00Z','2026-08-10T03:30:00Z','$OWNER_B'::uuid,false,60)->>'status';")"
[[ "$STATUS_B" == "busy" ]] || fail "client B expected 'busy', got $STATUS_B"

RANGE_A="$(psql_scalar "select id from public.chart_ohlcv_backfill_ranges where ticker='Q148A' and lease_owner='$OWNER_A'::uuid")"
FENCE_A="$(psql_scalar "select lease_fence from public.chart_ohlcv_backfill_ranges where id='$RANGE_A'::uuid")"
[[ "$(lease_state "$RANGE_A")" == "$OWNER_A:$FENCE_A:true" ]] || fail "client A lease state changed before persistence"

psql_local -v batch_a="$BATCH_A" -f - <<'SQL'
set role service_role;
insert into public.chart_ohlcv_provenance_batches
  (id, provider, ticker, base_resolution, range_start, range_end, row_count, fetched_at, detail)
values
  (:'batch_a'::uuid, 'QEO-148-REHEARSAL', 'Q148A', '1m',
   '2026-08-10T02:00:00Z', '2026-08-10T02:59:00Z', 2, now(),
   jsonb_build_object('workflow','QEO-148-REHEARSAL','case','contention-success'));
select public.qeo_upsert_chart_intraday_bars('Q148A', jsonb_build_array(
  jsonb_build_object('bar_time','2026-08-10T02:00:00Z','open',10,'high',11,'low',9,'close',10.5,'volume',100,
                     'provenance_batch_id',:'batch_a'::uuid,'fetched_at',now()),
  jsonb_build_object('bar_time','2026-08-10T02:59:00Z','open',10.5,'high',11.5,'low',10,'close',11,'volume',120,
                     'provenance_batch_id',:'batch_a'::uuid,'fetched_at',now())
));
reset role;
SQL

LEASE_A="$(lease_state "$RANGE_A")"
COMPLETE_A="$(service_scalar_app "qeo148-client-a" "select public.qeo_complete_chart_intraday_range('$RANGE_A'::uuid,'$OWNER_A'::uuid,$FENCE_A,'QEO-148-REHEARSAL',2,'$BATCH_A'::uuid,'$CONTENT_A')->>'status';")"
[[ "$COMPLETE_A" == "completed" ]] || fail "client A completion expected completed, got $COMPLETE_A with lease=$LEASE_A"

OWNER_REPLAY="$(new_uuid)"
STATUS_REPLAY="$(service_scalar_app "qeo148-client-replay" "select public.qeo_claim_chart_intraday_range('Q148A','PRIMARY_PROVIDER','2026-08-10T02:00:00Z','2026-08-10T03:00:00Z','$OWNER_REPLAY'::uuid,false,60)->>'status';")"
[[ "$STATUS_REPLAY" == "covered" ]] || fail "ordinary replay expected covered, got $STATUS_REPLAY"

phase "prove provenance plus partial HOT cannot publish coverage and retry recovers"
OWNER_P1="$(new_uuid)"
BATCH_P1="$(new_uuid)"
STATUS_P1="$(service_scalar_app "qeo148-partial-owner" "select public.qeo_claim_chart_intraday_range('Q148P','PRIMARY_PROVIDER','2026-08-10T04:00:00Z','2026-08-10T05:00:00Z','$OWNER_P1'::uuid,false,60)->>'status';")"
[[ "$STATUS_P1" == "claimed" ]] || fail "partial case expected first claim"
RANGE_P="$(psql_scalar "select id from public.chart_ohlcv_backfill_ranges where ticker='Q148P' and lease_owner='$OWNER_P1'::uuid")"
FENCE_P1="$(psql_scalar "select lease_fence from public.chart_ohlcv_backfill_ranges where id='$RANGE_P'::uuid")"

psql_local -v batch_p1="$BATCH_P1" -f - <<'SQL'
set role service_role;
insert into public.chart_ohlcv_provenance_batches
  (id, provider, ticker, base_resolution, range_start, range_end, row_count, fetched_at, detail)
values
  (:'batch_p1'::uuid, 'QEO-148-REHEARSAL', 'Q148P', '1m',
   '2026-08-10T04:00:00Z', '2026-08-10T04:59:00Z', 2, now(),
   jsonb_build_object('workflow','QEO-148-REHEARSAL','case','partial-before-failure'));
select public.qeo_upsert_chart_intraday_bars('Q148P', jsonb_build_array(
  jsonb_build_object('bar_time','2026-08-10T04:00:00Z','open',20,'high',21,'low',19,'close',20.5,'volume',200,
                     'provenance_batch_id',:'batch_p1'::uuid,'fetched_at',now())
));
reset role;
SQL

PARTIAL_COVERAGE="$(service_scalar_app "qeo148-partial-reader" "select count(*) from public.qeo_chart_intraday_success_coverage('Q148P','PRIMARY_PROVIDER','2026-08-10T04:00:00Z','2026-08-10T05:00:00Z');")"
[[ "$PARTIAL_COVERAGE" == "0" ]] || fail "partial HOT/provenance falsely published success coverage"
ABANDON_P1="$(service_scalar_app "qeo148-partial-owner" "select public.qeo_abandon_chart_intraday_range('$RANGE_P'::uuid,'$OWNER_P1'::uuid,$FENCE_P1,'partial persistence')->>'status';")"
[[ "$ABANDON_P1" == "abandoned" ]] || fail "partial owner could not abandon failed lease"

OWNER_P2="$(new_uuid)"
BATCH_P2="$(new_uuid)"
CONTENT_P2="$(printf 'b%.0s' {1..64})"
STATUS_P2="$(service_scalar_app "qeo148-partial-recovery" "select public.qeo_claim_chart_intraday_range('Q148P','PRIMARY_PROVIDER','2026-08-10T04:00:00Z','2026-08-10T05:00:00Z','$OWNER_P2'::uuid,false,60)->>'status';")"
[[ "$STATUS_P2" == "claimed" ]] || fail "partial failure did not recover to a new claim"
FENCE_P2="$(psql_scalar "select lease_fence from public.chart_ohlcv_backfill_ranges where id='$RANGE_P'::uuid")"

psql_local -v batch_p2="$BATCH_P2" -f - <<'SQL'
set role service_role;
insert into public.chart_ohlcv_provenance_batches
  (id, provider, ticker, base_resolution, range_start, range_end, row_count, fetched_at, detail)
values
  (:'batch_p2'::uuid, 'QEO-148-REHEARSAL', 'Q148P', '1m',
   '2026-08-10T04:00:00Z', '2026-08-10T04:59:00Z', 2, now(),
   jsonb_build_object('workflow','QEO-148-REHEARSAL','case','partial-recovery'));
select public.qeo_upsert_chart_intraday_bars('Q148P', jsonb_build_array(
  jsonb_build_object('bar_time','2026-08-10T04:00:00Z','open',20,'high',21,'low',19,'close',20.5,'volume',200,
                     'provenance_batch_id',:'batch_p2'::uuid,'fetched_at',now()),
  jsonb_build_object('bar_time','2026-08-10T04:59:00Z','open',20.5,'high',21.5,'low',20,'close',21,'volume',220,
                     'provenance_batch_id',:'batch_p2'::uuid,'fetched_at',now())
));
reset role;
SQL

COMPLETE_P2="$(service_scalar_app "qeo148-partial-recovery" "select public.qeo_complete_chart_intraday_range('$RANGE_P'::uuid,'$OWNER_P2'::uuid,$FENCE_P2,'QEO-148-REHEARSAL',2,'$BATCH_P2'::uuid,'$CONTENT_P2')->>'status';")"
[[ "$COMPLETE_P2" == "completed" ]] || fail "partial recovery completion failed: $COMPLETE_P2 lease=$(lease_state "$RANGE_P")"
RECOVERED_COVERAGE="$(service_scalar_app "qeo148-partial-reader" "select count(*) from public.qeo_chart_intraday_success_coverage('Q148P','PRIMARY_PROVIDER','2026-08-10T04:00:00Z','2026-08-10T05:00:00Z');")"
[[ "$RECOVERED_COVERAGE" == "1" ]] || fail "recovered durable persistence did not publish coverage"
PARTIAL_PROVENANCE_COUNT="$(psql_scalar "select count(*) from public.chart_ohlcv_provenance_batches where ticker='Q148P'")"
[[ "$PARTIAL_PROVENANCE_COUNT" == "2" ]] || fail "partial failure provenance was not preserved for audit"

phase "prove expired lease recovery and stale-owner fencing"
OWNER_S1="$(new_uuid)"
OWNER_S2="$(new_uuid)"
BATCH_S2="$(new_uuid)"
CONTENT_S2="$(printf 'c%.0s' {1..64})"
STATUS_S1="$(service_scalar_app "qeo148-stale-owner" "select public.qeo_claim_chart_intraday_range('Q148S','PRIMARY_PROVIDER','2026-08-10T06:00:00Z','2026-08-10T07:00:00Z','$OWNER_S1'::uuid,false,60)->>'status';")"
[[ "$STATUS_S1" == "claimed" ]] || fail "stale-owner fixture failed initial claim"
RANGE_S="$(psql_scalar "select id from public.chart_ohlcv_backfill_ranges where ticker='Q148S' and lease_owner='$OWNER_S1'::uuid")"
FENCE_S1="$(psql_scalar "select lease_fence from public.chart_ohlcv_backfill_ranges where id='$RANGE_S'::uuid")"

# Local-only crash fault injection: expire the durable lease without completing it.
psql_local -c "update public.chart_ohlcv_backfill_ranges set lease_expires_at=clock_timestamp()-interval '1 second' where id='$RANGE_S'::uuid;" >/dev/null
STATUS_S2="$(service_scalar_app "qeo148-recovery-owner" "select public.qeo_claim_chart_intraday_range('Q148S','PRIMARY_PROVIDER','2026-08-10T06:00:00Z','2026-08-10T07:00:00Z','$OWNER_S2'::uuid,false,60)->>'status';")"
[[ "$STATUS_S2" == "claimed" ]] || fail "expired lease was not recoverable"
FENCE_S2="$(psql_scalar "select lease_fence from public.chart_ohlcv_backfill_ranges where id='$RANGE_S'::uuid")"
(( FENCE_S2 > FENCE_S1 )) || fail "lease fencing did not advance after expiry recovery"

STALE_STATUS="$(service_scalar_app "qeo148-stale-owner" "select public.qeo_complete_chart_intraday_range('$RANGE_S'::uuid,'$OWNER_S1'::uuid,$FENCE_S1,'QEO-148-REHEARSAL',1,'$BATCH_A'::uuid,'$(printf 'd%.0s' {1..64})')->>'status';")"
[[ "$STALE_STATUS" == "stale" ]] || fail "expired owner expected 'stale', got $STALE_STATUS"

psql_local -v batch_s2="$BATCH_S2" -f - <<'SQL'
set role service_role;
insert into public.chart_ohlcv_provenance_batches
  (id, provider, ticker, base_resolution, range_start, range_end, row_count, fetched_at, detail)
values
  (:'batch_s2'::uuid, 'QEO-148-REHEARSAL', 'Q148S', '1m',
   '2026-08-10T06:00:00Z', '2026-08-10T06:59:00Z', 1, now(),
   jsonb_build_object('workflow','QEO-148-REHEARSAL','case','expired-lease-recovery'));
select public.qeo_upsert_chart_intraday_bars('Q148S', jsonb_build_array(
  jsonb_build_object('bar_time','2026-08-10T06:00:00Z','open',30,'high',31,'low',29,'close',30.5,'volume',300,
                     'provenance_batch_id',:'batch_s2'::uuid,'fetched_at',now())
));
reset role;
SQL

COMPLETE_S2="$(service_scalar_app "qeo148-recovery-owner" "select public.qeo_complete_chart_intraday_range('$RANGE_S'::uuid,'$OWNER_S2'::uuid,$FENCE_S2,'QEO-148-REHEARSAL',1,'$BATCH_S2'::uuid,'$CONTENT_S2')->>'status';")"
[[ "$COMPLETE_S2" == "completed" ]] || fail "expired lease recovery completion failed: $COMPLETE_S2 lease=$(lease_state "$RANGE_S")"

phase "prove explicit correction revalidation preserves old provenance and writes a revision"
OWNER_R="$(new_uuid)"
BATCH_R="$(new_uuid)"
CONTENT_R="$(printf 'e%.0s' {1..64})"
REVALIDATE_JSON="$(service_scalar_app "qeo148-correction-owner" "select public.qeo_claim_chart_intraday_range('Q148A','PRIMARY_PROVIDER','2026-08-10T02:00:00Z','2026-08-10T03:00:00Z','$OWNER_R'::uuid,true,60)::text;")"
[[ "$REVALIDATE_JSON" == *'"status": "claimed"'* ]] || fail "explicit correction revalidation did not claim"
[[ "$REVALIDATE_JSON" == *"$CONTENT_A"* ]] || fail "correction claim did not return previous content identity"
[[ "$REVALIDATE_JSON" == *"$BATCH_A"* ]] || fail "correction claim did not return previous provenance identity"
FENCE_R="$(psql_scalar "select lease_fence from public.chart_ohlcv_backfill_ranges where id='$RANGE_A'::uuid")"

psql_local -v batch_r="$BATCH_R" -f - <<'SQL'
set role service_role;
insert into public.chart_ohlcv_provenance_batches
  (id, provider, ticker, base_resolution, range_start, range_end, row_count, fetched_at, detail)
values
  (:'batch_r'::uuid, 'QEO-148-REHEARSAL', 'Q148A', '1m',
   '2026-08-10T02:00:00Z', '2026-08-10T02:59:00Z', 2, now(),
   jsonb_build_object('workflow','QEO-148-REHEARSAL','case','late-correction'));
select public.qeo_upsert_chart_intraday_bars('Q148A', jsonb_build_array(
  jsonb_build_object('bar_time','2026-08-10T02:00:00Z','open',10,'high',11.2,'low',9,'close',10.7,'volume',105,
                     'provenance_batch_id',:'batch_r'::uuid,'fetched_at',now()),
  jsonb_build_object('bar_time','2026-08-10T02:59:00Z','open',10.7,'high',11.7,'low',10,'close',11.2,'volume',125,
                     'provenance_batch_id',:'batch_r'::uuid,'fetched_at',now())
));
reset role;
SQL

COMPLETE_R="$(service_scalar_app "qeo148-correction-owner" "select public.qeo_complete_chart_intraday_range('$RANGE_A'::uuid,'$OWNER_R'::uuid,$FENCE_R,'QEO-148-REHEARSAL',2,'$BATCH_R'::uuid,'$CONTENT_R')->>'status';")"
[[ "$COMPLETE_R" == "completed" ]] || fail "correction completion failed: $COMPLETE_R lease=$(lease_state "$RANGE_A")"
CORRECTION_IDENTITY="$(psql_scalar "select success_content_id || ':' || success_provenance_batch_id::text from public.chart_ohlcv_backfill_ranges where id='$RANGE_A'::uuid")"
[[ "$CORRECTION_IDENTITY" == "$CONTENT_R:$BATCH_R" ]] || fail "correction did not replace durable success identity"
OLD_PROVENANCE_EXISTS="$(psql_scalar "select count(*) from public.chart_ohlcv_provenance_batches where id='$BATCH_A'::uuid")"
[[ "$OLD_PROVENANCE_EXISTS" == "1" ]] || fail "legitimate prior correction provenance was not preserved"

phase "prove server-side coverage remains complete beyond the 1000-row REST cap"
BATCH_CAP="$(new_uuid)"
CAP_START="2026-08-11T02:00:00Z"

psql_local -v batch_cap="$BATCH_CAP" -f - <<'SQL'
set role service_role;
insert into public.chart_ohlcv_provenance_batches
  (id, provider, ticker, base_resolution, range_start, range_end, row_count, fetched_at, detail)
values
  (:'batch_cap'::uuid, 'QEO-148-REHEARSAL', 'Q148CAP', '1m',
   '2026-08-11T02:00:00Z', '2026-08-11T22:01:00Z', 1202, now(),
   jsonb_build_object('workflow','QEO-148-REHEARSAL','case','over-rest-cap'));

select public.qeo_upsert_chart_intraday_bars('Q148CAP', (
  select jsonb_agg(jsonb_build_object(
    'bar_time', '2026-08-11T02:00:00Z'::timestamptz + g * interval '1 minute',
    'open', 40 + g / 10000.0, 'high', 41 + g / 10000.0,
    'low', 39 + g / 10000.0, 'close', 40.5 + g / 10000.0,
    'volume', 400 + g,
    'provenance_batch_id', :'batch_cap'::uuid, 'fetched_at', now()
  ) order by g)
  from generate_series(0, 499) g
));
select public.qeo_upsert_chart_intraday_bars('Q148CAP', (
  select jsonb_agg(jsonb_build_object(
    'bar_time', '2026-08-11T02:00:00Z'::timestamptz + g * interval '1 minute',
    'open', 40 + g / 10000.0, 'high', 41 + g / 10000.0,
    'low', 39 + g / 10000.0, 'close', 40.5 + g / 10000.0,
    'volume', 400 + g,
    'provenance_batch_id', :'batch_cap'::uuid, 'fetched_at', now()
  ) order by g)
  from generate_series(500, 999) g
));
select public.qeo_upsert_chart_intraday_bars('Q148CAP', (
  select jsonb_agg(jsonb_build_object(
    'bar_time', '2026-08-11T02:00:00Z'::timestamptz + g * interval '1 minute',
    'open', 40 + g / 10000.0, 'high', 41 + g / 10000.0,
    'low', 39 + g / 10000.0, 'close', 40.5 + g / 10000.0,
    'volume', 400 + g,
    'provenance_batch_id', :'batch_cap'::uuid, 'fetched_at', now()
  ) order by g)
  from generate_series(1000, 1201) g
));
reset role;

-- PostgreSQL-only test scaffolding: publish 1201 success metadata rows only
-- after all 1202 canonical HOT rows and their provenance batch exist.
insert into public.chart_ohlcv_backfill_ranges (
  ticker, source_key, base_resolution, price_basis,
  range_start, range_end, lease_fence,
  success_at, success_provider, success_provenance_batch_id,
  success_row_count, success_content_id, created_at, updated_at
)
select
  'Q148CAP', 'PRIMARY_PROVIDER', '1m', 'RAW',
  '2026-08-11T02:00:00Z'::timestamptz + g * interval '1 minute',
  '2026-08-11T02:00:00Z'::timestamptz + (g + 1) * interval '1 minute',
  1, now(), 'QEO-148-REHEARSAL', :'batch_cap'::uuid,
  2, encode(digest('qeo148-cap-' || g::text, 'sha256'), 'hex'), now(), now()
from generate_series(0, 1200) g;
SQL

CAP_ROWS="$(psql_scalar "select count(*) from public.chart_ohlcv_backfill_ranges where ticker='Q148CAP' and success_at is not null")"
[[ "$CAP_ROWS" == "1201" ]] || fail "over-cap fixture did not create exactly 1201 durable success rows"
CAP_HOT_ROWS="$(psql_scalar "select count(*) from public.chart_ohlcv_intraday where ticker='Q148CAP' and base_resolution='1m'")"
[[ "$CAP_HOT_ROWS" == "1202" ]] || fail "over-cap fixture did not durably persist all 1202 HOT rows first"

CAP_SUMMARY="$(service_scalar_app "qeo148-cap-reader" "select count(*)::text || ':' || extract(epoch from min(range_start))::bigint::text || ':' || extract(epoch from max(range_end))::bigint::text from public.qeo_chart_intraday_success_coverage('Q148CAP','PRIMARY_PROVIDER','$CAP_START','$CAP_START'::timestamptz + interval '1201 minutes');")"
CAP_EXPECTED_START="$(psql_scalar "select extract(epoch from '$CAP_START'::timestamptz)::bigint")"
CAP_EXPECTED_END="$(psql_scalar "select extract(epoch from '$CAP_START'::timestamptz + interval '1201 minutes')::bigint")"
[[ "$CAP_SUMMARY" == "1:$CAP_EXPECTED_START:$CAP_EXPECTED_END" ]] || fail "server-side over-cap coverage was incomplete: expected 1:$CAP_EXPECTED_START:$CAP_EXPECTED_END got $CAP_SUMMARY"

phase "cleanup isolated QEO-148 fixtures"
psql_local -f - <<'SQL'
delete from public.chart_ohlcv_backfill_ranges where ticker like 'Q148%';
delete from public.chart_ohlcv_intraday where ticker like 'Q148%';
delete from public.chart_ohlcv_provenance_batches where ticker like 'Q148%';
SQL

phase "PASS"
printf 'QEO-148 isolated closed-range rehearsal passed: contention, partial persistence, expiry fencing, correction audit, and 1201-row coverage summary.\n'
