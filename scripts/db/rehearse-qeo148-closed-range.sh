#!/usr/bin/env bash
set -euo pipefail

PRODUCTION_PROJECT_REF="glwhhrmejlonhyorvtzm"
DB_CONTAINER="${QEO_Q148_DB_CONTAINER:-supabase_db_qeoindex}"
MIGRATION="supabase/pending-migrations/20260909160500_qeo148_closed_range_coordination.sql"

phase() {
  printf '\n==> QEO-148 %s\n' "$1"
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

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

service_scalar() {
  local application_name="$1"
  local query="$2"
  psql_local_app "$application_name" -Atq -c "set role service_role; $query"
}

new_uuid() {
  psql_scalar "select gen_random_uuid()"
}

phase "preflight QEO-149 writer dependency"
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

phase "apply quarantined QEO-148 migration in isolated local DB"
psql_local -f - < "$MIGRATION"

phase "assert private durable state and RPC boundary"
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
    raise exception 'QEO-148 rehearsal: service_role can bypass coordination RPCs';
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

phase "prove shared overlap contention then 100 ordinary covered replays"
OWNER_A="$(new_uuid)"
OWNER_B="$(new_uuid)"
BATCH_A="$(new_uuid)"
CONTENT_A="$(printf 'a%.0s' {1..64})"
STATUS_A="$(service_scalar qeo148-client-a "select public.qeo_claim_chart_intraday_range('Q148A','PRIMARY_PROVIDER','2026-08-10T02:00:00Z','2026-08-10T03:00:00Z','$OWNER_A'::uuid,false,60)->>'status';")"
[[ "$STATUS_A" == "claimed" ]] || fail "client A expected claimed, got $STATUS_A"
STATUS_B="$(service_scalar qeo148-client-b "select public.qeo_claim_chart_intraday_range('Q148A','PRIMARY_PROVIDER','2026-08-10T02:30:00Z','2026-08-10T03:30:00Z','$OWNER_B'::uuid,false,60)->>'status';")"
[[ "$STATUS_B" == "busy" ]] || fail "overlapping client expected busy, got $STATUS_B"
RANGE_A="$(psql_scalar "select id from public.chart_ohlcv_backfill_ranges where ticker='Q148A' and lease_owner='$OWNER_A'::uuid")"
FENCE_A="$(psql_scalar "select lease_fence from public.chart_ohlcv_backfill_ranges where id='$RANGE_A'::uuid")"

psql_local -v batch="$BATCH_A" -f - <<'SQL'
set role service_role;
insert into public.chart_ohlcv_provenance_batches
  (id, provider, ticker, base_resolution, range_start, range_end, row_count, fetched_at, detail)
values
  (:'batch'::uuid, 'QEO-148-REHEARSAL', 'Q148A', '1m',
   '2026-08-10T02:00:00Z', '2026-08-10T02:59:00Z', 2, now(),
   jsonb_build_object('workflow','QEO-148-REHEARSAL','case','contention-success'));
select public.qeo_upsert_chart_intraday_bars('Q148A', jsonb_build_array(
  jsonb_build_object('bar_time','2026-08-10T02:00:00Z','open',10,'high',11,'low',9,'close',10.5,'volume',100,'provenance_batch_id',:'batch'::uuid,'fetched_at',now()),
  jsonb_build_object('bar_time','2026-08-10T02:59:00Z','open',10.5,'high',11.5,'low',10,'close',11,'volume',120,'provenance_batch_id',:'batch'::uuid,'fetched_at',now())
));
reset role;
SQL
COMPLETE_A="$(service_scalar qeo148-client-a "select public.qeo_complete_chart_intraday_range('$RANGE_A'::uuid,'$OWNER_A'::uuid,$FENCE_A,'QEO-148-REHEARSAL',2,'$BATCH_A'::uuid,'$CONTENT_A')->>'status';")"
[[ "$COMPLETE_A" == "completed" ]] || fail "first durable completion failed: $COMPLETE_A"

for replay in $(seq 1 100); do
  replay_owner="$(new_uuid)"
  replay_status="$(service_scalar "qeo148-replay-$replay" "select public.qeo_claim_chart_intraday_range('Q148A','PRIMARY_PROVIDER','2026-08-10T02:00:00Z','2026-08-10T03:00:00Z','$replay_owner'::uuid,false,60)->>'status';")"
  [[ "$replay_status" == "covered" ]] || fail "ordinary replay $replay expected covered, got $replay_status"
done
[[ "$(psql_scalar "select lease_fence from public.chart_ohlcv_backfill_ranges where id='$RANGE_A'::uuid")" == "$FENCE_A" ]] || fail "covered replays unexpectedly mutated the lease fence"

phase "prove provenance plus partial HOT cannot publish success"
OWNER_P1="$(new_uuid)"
BATCH_P1="$(new_uuid)"
STATUS_P1="$(service_scalar qeo148-partial-1 "select public.qeo_claim_chart_intraday_range('Q148P','PRIMARY_PROVIDER','2026-08-10T04:00:00Z','2026-08-10T05:00:00Z','$OWNER_P1'::uuid,false,60)->>'status';")"
[[ "$STATUS_P1" == "claimed" ]] || fail "partial fixture failed first claim"
RANGE_P="$(psql_scalar "select id from public.chart_ohlcv_backfill_ranges where ticker='Q148P' and lease_owner='$OWNER_P1'::uuid")"
FENCE_P1="$(psql_scalar "select lease_fence from public.chart_ohlcv_backfill_ranges where id='$RANGE_P'::uuid")"
psql_local -v batch="$BATCH_P1" -f - <<'SQL'
set role service_role;
insert into public.chart_ohlcv_provenance_batches
  (id, provider, ticker, base_resolution, range_start, range_end, row_count, fetched_at, detail)
values
  (:'batch'::uuid, 'QEO-148-REHEARSAL', 'Q148P', '1m', '2026-08-10T04:00:00Z', '2026-08-10T04:59:00Z', 2, now(),
   jsonb_build_object('workflow','QEO-148-REHEARSAL','case','partial-before-failure'));
select public.qeo_upsert_chart_intraday_bars('Q148P', jsonb_build_array(
  jsonb_build_object('bar_time','2026-08-10T04:00:00Z','open',20,'high',21,'low',19,'close',20.5,'volume',200,'provenance_batch_id',:'batch'::uuid,'fetched_at',now())
));
reset role;
SQL
PARTIAL_COVERAGE="$(service_scalar qeo148-partial-reader "select jsonb_array_length(public.qeo_chart_intraday_success_coverage('Q148P','PRIMARY_PROVIDER','2026-08-10T04:00:00Z','2026-08-10T05:00:00Z'));")"
[[ "$PARTIAL_COVERAGE" == "0" ]] || fail "partial HOT/provenance falsely published coverage"
ABANDON_P1="$(service_scalar qeo148-partial-1 "select public.qeo_abandon_chart_intraday_range('$RANGE_P'::uuid,'$OWNER_P1'::uuid,$FENCE_P1,'partial persistence')->>'status';")"
[[ "$ABANDON_P1" == "abandoned" ]] || fail "failed partial lease did not abandon"

OWNER_P2="$(new_uuid)"
BATCH_P2="$(new_uuid)"
CONTENT_P2="$(printf 'b%.0s' {1..64})"
STATUS_P2="$(service_scalar qeo148-partial-2 "select public.qeo_claim_chart_intraday_range('Q148P','PRIMARY_PROVIDER','2026-08-10T04:00:00Z','2026-08-10T05:00:00Z','$OWNER_P2'::uuid,false,60)->>'status';")"
[[ "$STATUS_P2" == "claimed" ]] || fail "partial failure did not recover to a new claim"
FENCE_P2="$(psql_scalar "select lease_fence from public.chart_ohlcv_backfill_ranges where id='$RANGE_P'::uuid")"
(( FENCE_P2 > FENCE_P1 )) || fail "partial retry did not advance the fence"
psql_local -v batch="$BATCH_P2" -f - <<'SQL'
set role service_role;
insert into public.chart_ohlcv_provenance_batches
  (id, provider, ticker, base_resolution, range_start, range_end, row_count, fetched_at, detail)
values
  (:'batch'::uuid, 'QEO-148-REHEARSAL', 'Q148P', '1m', '2026-08-10T04:00:00Z', '2026-08-10T04:59:00Z', 2, now(),
   jsonb_build_object('workflow','QEO-148-REHEARSAL','case','partial-recovery'));
select public.qeo_upsert_chart_intraday_bars('Q148P', jsonb_build_array(
  jsonb_build_object('bar_time','2026-08-10T04:00:00Z','open',20,'high',21,'low',19,'close',20.5,'volume',200,'provenance_batch_id',:'batch'::uuid,'fetched_at',now()),
  jsonb_build_object('bar_time','2026-08-10T04:59:00Z','open',20.5,'high',21.5,'low',20,'close',21,'volume',220,'provenance_batch_id',:'batch'::uuid,'fetched_at',now())
));
reset role;
SQL
COMPLETE_P2="$(service_scalar qeo148-partial-2 "select public.qeo_complete_chart_intraday_range('$RANGE_P'::uuid,'$OWNER_P2'::uuid,$FENCE_P2,'QEO-148-REHEARSAL',2,'$BATCH_P2'::uuid,'$CONTENT_P2')->>'status';")"
[[ "$COMPLETE_P2" == "completed" ]] || fail "recovered partial range did not complete"
[[ "$(service_scalar qeo148-partial-reader "select jsonb_array_length(public.qeo_chart_intraday_success_coverage('Q148P','PRIMARY_PROVIDER','2026-08-10T04:00:00Z','2026-08-10T05:00:00Z'));")" == "1" ]] || fail "recovered persistence did not publish one durable interval"
[[ "$(psql_scalar "select count(*) from public.chart_ohlcv_provenance_batches where ticker='Q148P'")" == "2" ]] || fail "partial-failure provenance was not preserved for audit"

phase "prove expired lease recovery and stale-owner fencing"
OWNER_S1="$(new_uuid)"
OWNER_S2="$(new_uuid)"
STATUS_S1="$(service_scalar qeo148-stale-1 "select public.qeo_claim_chart_intraday_range('Q148S','PRIMARY_PROVIDER','2026-08-10T06:00:00Z','2026-08-10T07:00:00Z','$OWNER_S1'::uuid,false,60)->>'status';")"
[[ "$STATUS_S1" == "claimed" ]] || fail "stale fixture failed first claim"
RANGE_S="$(psql_scalar "select id from public.chart_ohlcv_backfill_ranges where ticker='Q148S' and lease_owner='$OWNER_S1'::uuid")"
FENCE_S1="$(psql_scalar "select lease_fence from public.chart_ohlcv_backfill_ranges where id='$RANGE_S'::uuid")"
psql_local -c "update public.chart_ohlcv_backfill_ranges set lease_expires_at=clock_timestamp()-interval '1 second' where id='$RANGE_S'::uuid;" >/dev/null
STATUS_S2="$(service_scalar qeo148-stale-2 "select public.qeo_claim_chart_intraday_range('Q148S','PRIMARY_PROVIDER','2026-08-10T06:00:00Z','2026-08-10T07:00:00Z','$OWNER_S2'::uuid,false,60)->>'status';")"
[[ "$STATUS_S2" == "claimed" ]] || fail "expired lease was not recoverable"
FENCE_S2="$(psql_scalar "select lease_fence from public.chart_ohlcv_backfill_ranges where id='$RANGE_S'::uuid")"
(( FENCE_S2 > FENCE_S1 )) || fail "expiry recovery did not advance fencing"
STALE_BATCH="$(new_uuid)"
STALE_STATUS="$(service_scalar qeo148-stale-1 "select public.qeo_complete_chart_intraday_range('$RANGE_S'::uuid,'$OWNER_S1'::uuid,$FENCE_S1,'QEO-148-REHEARSAL',1,'$STALE_BATCH'::uuid,'$(printf 'c%.0s' {1..64})')->>'status';")"
[[ "$STALE_STATUS" == "stale" ]] || fail "expired owner expected stale, got $STALE_STATUS"

BATCH_S2="$(new_uuid)"
CONTENT_S2="$(printf 'd%.0s' {1..64})"
psql_local -v batch="$BATCH_S2" -f - <<'SQL'
set role service_role;
insert into public.chart_ohlcv_provenance_batches
  (id, provider, ticker, base_resolution, range_start, range_end, row_count, fetched_at, detail)
values
  (:'batch'::uuid, 'QEO-148-REHEARSAL', 'Q148S', '1m', '2026-08-10T06:00:00Z', '2026-08-10T06:00:00Z', 1, now(),
   jsonb_build_object('workflow','QEO-148-REHEARSAL','case','expired-lease-recovery'));
select public.qeo_upsert_chart_intraday_bars('Q148S', jsonb_build_array(
  jsonb_build_object('bar_time','2026-08-10T06:00:00Z','open',30,'high',31,'low',29,'close',30.5,'volume',300,'provenance_batch_id',:'batch'::uuid,'fetched_at',now())
));
reset role;
SQL
COMPLETE_S2="$(service_scalar qeo148-stale-2 "select public.qeo_complete_chart_intraday_range('$RANGE_S'::uuid,'$OWNER_S2'::uuid,$FENCE_S2,'QEO-148-REHEARSAL',1,'$BATCH_S2'::uuid,'$CONTENT_S2')->>'status';")"
[[ "$COMPLETE_S2" == "completed" ]] || fail "recovered owner could not complete"

phase "prove explicit correction revalidation remains writable and auditable"
OWNER_R="$(new_uuid)"
BATCH_R="$(new_uuid)"
CONTENT_R="$(printf 'e%.0s' {1..64})"
REVALIDATE_JSON="$(service_scalar qeo148-correction "select public.qeo_claim_chart_intraday_range('Q148A','PRIMARY_PROVIDER','2026-08-10T02:00:00Z','2026-08-10T03:00:00Z','$OWNER_R'::uuid,true,60)::text;")"
[[ "$REVALIDATE_JSON" == *'"status": "claimed"'* ]] || fail "correction revalidation did not claim"
[[ "$REVALIDATE_JSON" == *"$CONTENT_A"* ]] || fail "correction claim omitted previous content identity"
[[ "$REVALIDATE_JSON" == *"$BATCH_A"* ]] || fail "correction claim omitted previous provenance identity"
FENCE_R="$(psql_scalar "select lease_fence from public.chart_ohlcv_backfill_ranges where id='$RANGE_A'::uuid")"
psql_local -v batch="$BATCH_R" -f - <<'SQL'
set role service_role;
insert into public.chart_ohlcv_provenance_batches
  (id, provider, ticker, base_resolution, range_start, range_end, row_count, fetched_at, detail)
values
  (:'batch'::uuid, 'QEO-148-REHEARSAL', 'Q148A', '1m', '2026-08-10T02:00:00Z', '2026-08-10T02:59:00Z', 2, now(),
   jsonb_build_object('workflow','QEO-148-REHEARSAL','case','late-correction'));
select public.qeo_upsert_chart_intraday_bars('Q148A', jsonb_build_array(
  jsonb_build_object('bar_time','2026-08-10T02:00:00Z','open',10,'high',11.2,'low',9,'close',10.7,'volume',105,'provenance_batch_id',:'batch'::uuid,'fetched_at',now()),
  jsonb_build_object('bar_time','2026-08-10T02:59:00Z','open',10.7,'high',11.7,'low',10,'close',11.2,'volume',125,'provenance_batch_id',:'batch'::uuid,'fetched_at',now())
));
reset role;
SQL
COMPLETE_R="$(service_scalar qeo148-correction "select public.qeo_complete_chart_intraday_range('$RANGE_A'::uuid,'$OWNER_R'::uuid,$FENCE_R,'QEO-148-REHEARSAL',2,'$BATCH_R'::uuid,'$CONTENT_R')->>'status';")"
[[ "$COMPLETE_R" == "completed" ]] || fail "correction completion failed"
[[ "$(psql_scalar "select success_content_id || ':' || success_provenance_batch_id::text from public.chart_ohlcv_backfill_ranges where id='$RANGE_A'::uuid")" == "$CONTENT_R:$BATCH_R" ]] || fail "correction did not replace durable success identity"
[[ "$(psql_scalar "select count(*) from public.chart_ohlcv_provenance_batches where id='$BATCH_A'::uuid")" == "1" ]] || fail "prior provenance disappeared after correction"

phase "prove JSONB coverage is complete for 1201 disjoint intervals beyond REST row cap"
BATCH_CAP="$(new_uuid)"
psql_local -v batch="$BATCH_CAP" -f - <<'SQL'
set role service_role;
insert into public.chart_ohlcv_provenance_batches
  (id, provider, ticker, base_resolution, range_start, range_end, row_count, fetched_at, detail)
values
  (:'batch'::uuid, 'QEO-148-REHEARSAL', 'Q148CAP', '1m',
   '2026-08-11T02:00:00Z', '2026-08-12T18:01:00Z', 2402, now(),
   jsonb_build_object('workflow','QEO-148-REHEARSAL','case','1201-disjoint-over-rest-cap'));

do $function$
declare
  v_from integer := 0;
  v_to integer;
  v_rows jsonb;
begin
  while v_from <= 2401 loop
    v_to := least(v_from + 499, 2401);
    select jsonb_agg(jsonb_build_object(
      'bar_time', '2026-08-11T02:00:00Z'::timestamptz + g * interval '1 minute',
      'open', 40 + g / 10000.0, 'high', 41 + g / 10000.0,
      'low', 39 + g / 10000.0, 'close', 40.5 + g / 10000.0,
      'volume', 400 + g, 'provenance_batch_id', :'batch'::uuid, 'fetched_at', now()
    ) order by g)
    into v_rows
    from generate_series(v_from, v_to) g;
    perform public.qeo_upsert_chart_intraday_bars('Q148CAP', v_rows);
    v_from := v_to + 1;
  end loop;
end;
$function$;
reset role;

-- PostgreSQL-only test scaffolding. Publish metadata only after all 2402 HOT rows
-- and the provenance batch exist. Every success interval is disjoint by one minute.
insert into public.chart_ohlcv_backfill_ranges (
  ticker, source_key, base_resolution, price_basis,
  range_start, range_end, lease_fence,
  success_at, success_provider, success_provenance_batch_id,
  success_row_count, success_content_id, created_at, updated_at
)
select
  'Q148CAP', 'PRIMARY_PROVIDER', '1m', 'RAW',
  '2026-08-11T02:00:00Z'::timestamptz + (g * 2) * interval '1 minute',
  '2026-08-11T02:00:00Z'::timestamptz + (g * 2 + 1) * interval '1 minute',
  1, now(), 'QEO-148-REHEARSAL', :'batch'::uuid,
  2, encode(digest('qeo148-cap-' || g::text, 'sha256'), 'hex'), now(), now()
from generate_series(0, 1200) g;
SQL
[[ "$(psql_scalar "select count(*) from public.chart_ohlcv_intraday where ticker='Q148CAP' and base_resolution='1m'")" == "2402" ]] || fail "over-cap fixture did not persist all 2402 HOT rows first"
[[ "$(psql_scalar "select count(*) from public.chart_ohlcv_backfill_ranges where ticker='Q148CAP' and success_at is not null")" == "1201" ]] || fail "over-cap fixture did not create 1201 durable success intervals"
CAP_LENGTH="$(service_scalar qeo148-cap-reader "select jsonb_array_length(public.qeo_chart_intraday_success_coverage('Q148CAP','PRIMARY_PROVIDER','2026-08-11T02:00:00Z','2026-08-12T18:01:00Z'));")"
[[ "$CAP_LENGTH" == "1201" ]] || fail "JSONB coverage truncated disjoint intervals: expected 1201 got $CAP_LENGTH"
CAP_DISJOINT="$(service_scalar qeo148-cap-reader "with x as (select public.qeo_chart_intraday_success_coverage('Q148CAP','PRIMARY_PROVIDER','2026-08-11T02:00:00Z','2026-08-12T18:01:00Z') j) select bool_and((j->i->>'range_start')::timestamptz > (j->(i-1)->>'range_end')::timestamptz) from x, generate_series(1,1200) i;")"
[[ "$CAP_DISJOINT" == "t" ]] || fail "1201 coverage intervals were not returned in stable disjoint order"
CAP_ENDPOINTS="$(service_scalar qeo148-cap-reader "with x as (select public.qeo_chart_intraday_success_coverage('Q148CAP','PRIMARY_PROVIDER','2026-08-11T02:00:00Z','2026-08-12T18:01:00Z') j) select (((j->0->>'range_start')::timestamptz='2026-08-11T02:00:00Z'::timestamptz)::int)::text || ':' || ((((j->1200->>'range_end')::timestamptz=('2026-08-11T02:00:00Z'::timestamptz + interval '2401 minutes'))::int)::text) from x;")"
[[ "$CAP_ENDPOINTS" == "1:1" ]] || fail "coverage endpoints were truncated or reordered: $CAP_ENDPOINTS"
CAP_OWNER="$(new_uuid)"
CAP_COVERED="$(service_scalar qeo148-cap-claim "select public.qeo_claim_chart_intraday_range('Q148CAP','PRIMARY_PROVIDER','2026-08-12T14:40:00Z','2026-08-12T14:41:00Z','$CAP_OWNER'::uuid,false,60)->>'status';")"
[[ "$CAP_COVERED" == "covered" ]] || fail "claim could not consume a covered interval beyond the 1000th JSON element"

phase "cleanup isolated QEO-148 fixtures"
psql_local -f - <<'SQL'
delete from public.chart_ohlcv_backfill_ranges where ticker like 'Q148%';
delete from public.chart_ohlcv_intraday where ticker like 'Q148%';
delete from public.chart_ohlcv_provenance_batches where ticker like 'Q148%';
SQL

phase "PASS"
printf 'QEO-148 isolated rehearsal passed: 100 replays, overlap contention, partial persistence, expiry fencing, correction audit, and 1201 disjoint JSONB coverage intervals.\n'
