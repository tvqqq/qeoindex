-- QEO-101: canonicalize every completed Daily bar to one Vietnam session timestamp.
-- 09:00 Asia/Ho_Chi_Minh == 02:00 UTC. This trigger runs before unique-key
-- conflict detection so provider-specific timestamps cannot create two rows for
-- the same ticker/session. Existing non-canonical rows are re-upserted through
-- the QEO-101 provider-precedence trigger, then removed.

create or replace function public.qeo_canonicalize_daily_ohlcv_session_time()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.timeframe = '1D' then
    new.bar_time := (
      (new.bar_time at time zone 'Asia/Ho_Chi_Minh')::date::timestamp + time '09:00'
    ) at time zone 'Asia/Ho_Chi_Minh';
  end if;
  return new;
end;
$$;

drop trigger if exists qeo_market_ohlcv_daily_canonical_time on public.market_ohlcv_history;

create trigger qeo_market_ohlcv_daily_canonical_time
before insert or update on public.market_ohlcv_history
for each row
execute function public.qeo_canonicalize_daily_ohlcv_session_time();

comment on function public.qeo_canonicalize_daily_ohlcv_session_time() is
  'QEO-101 canonical Daily session timestamp invariant: every 1D row is normalized to 09:00 Asia/Ho_Chi_Minh (02:00 UTC) before unique-key conflict detection and provider precedence.';

insert into public.market_ohlcv_history (
  ticker,
  timeframe,
  bar_time,
  open,
  high,
  low,
  close,
  volume,
  provider,
  provider_detail,
  source_url,
  fetched_at
)
select
  h.ticker,
  h.timeframe,
  h.bar_time,
  h.open,
  h.high,
  h.low,
  h.close,
  h.volume,
  h.provider,
  h.provider_detail,
  h.source_url,
  h.fetched_at
from public.market_ohlcv_history h
where h.timeframe = '1D'
  and h.bar_time <> (
    (h.bar_time at time zone 'Asia/Ho_Chi_Minh')::date::timestamp + time '09:00'
  ) at time zone 'Asia/Ho_Chi_Minh'
on conflict (ticker, timeframe, bar_time) do update
set open = excluded.open,
    high = excluded.high,
    low = excluded.low,
    close = excluded.close,
    volume = excluded.volume,
    provider = excluded.provider,
    provider_detail = excluded.provider_detail,
    source_url = excluded.source_url,
    fetched_at = excluded.fetched_at;

delete from public.market_ohlcv_history h
where h.timeframe = '1D'
  and h.bar_time <> (
    (h.bar_time at time zone 'Asia/Ho_Chi_Minh')::date::timestamp + time '09:00'
  ) at time zone 'Asia/Ho_Chi_Minh';

do $$
begin
  if exists (
    select 1
    from public.market_ohlcv_history h
    where h.timeframe = '1D'
      and h.bar_time <> (
        (h.bar_time at time zone 'Asia/Ho_Chi_Minh')::date::timestamp + time '09:00'
      ) at time zone 'Asia/Ho_Chi_Minh'
  ) then
    raise exception 'QEO-101 Daily timestamp canonicalization left non-canonical rows';
  end if;
end;
$$;
