#!/usr/bin/env bash
set -euo pipefail

container="supabase_db_stockos"
if ! docker inspect "$container" >/dev/null 2>&1; then
  echo "Local Supabase is not running. Run pnpm supabase:start first."
  exit 1
fi

tmp_dir="$(mktemp -d)"
cleanup() {
  docker exec "$container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -c \
    "delete from public.notion_sync_outbox where payload ->> 'ticker' = 'FPT';
     delete from public.signal_events where ticker = 'FPT';
     delete from public.trade_recommendations where ticker = 'FPT';" >/dev/null 2>&1 || true
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

cleanup_sql="delete from public.notion_sync_outbox where payload ->> 'ticker' = 'FPT';
delete from public.signal_events where ticker = 'FPT';
delete from public.trade_recommendations where ticker = 'FPT';"
docker exec "$container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -c "$cleanup_sql"

buy_sql() {
  local suffix="$1"
  printf '%s' "select result from public.create_buy_signal(
    'FPT', '2026-08-13 03:00:00+00', 72, 'concurrent breakout', 69, 4.17,
    78, 1700, 'Bullish', '2026-08-12', 'MEDIUM', 'DNSE', 'intraday-v1.0',
    1000000, 1.5, 'buy:FPT:2026-08-12:intraday-v1.0:0300:${suffix}',
    '{\"message\":\"BUY FPT\"}'::jsonb, '{\"ticker\":\"FPT\"}'::jsonb
  );"
}

docker exec "$container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -Atc "$(buy_sql a)" >"$tmp_dir/one" &
pid_one=$!
docker exec "$container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -Atc "$(buy_sql b)" >"$tmp_dir/two" &
pid_two=$!

wait "$pid_one"
wait "$pid_two"

outcomes="$(sort "$tmp_dir/one" "$tmp_dir/two" | tr '\n' ' ' | sed 's/ $//')"
counts="$(docker exec "$container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -Atc \
  "select
     (select count(*) from public.trade_recommendations where ticker = 'FPT' and status = 'open'),
     (select count(*) from public.signal_events where ticker = 'FPT' and event_type = 'BUY'),
     (select count(*) from public.notification_outbox no join public.signal_events se on se.id = no.event_id where se.ticker = 'FPT');")"

if [[ "$outcomes" != "created duplicate" ]]; then
  echo "Expected concurrent outcomes 'created duplicate', got '$outcomes'."
  exit 1
fi

if [[ "$counts" != "1|1|1" ]]; then
  echo "Expected one recommendation, BUY event, and notification; got '$counts'."
  exit 1
fi

echo "Concurrent BUY test passed: one durable recommendation/event/outbox item."
