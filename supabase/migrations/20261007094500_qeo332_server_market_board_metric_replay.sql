-- QEO-332 unattended Market Board intraday replay.
-- Capture *observed* source-scope snapshots from the existing worker checkpoint:
-- full-HOSE VNINDEX matched value, and separately DNSE canonical Top-200 foreign.
-- No browser, Finhay OAuth cookie, interpolated history, or extra provider socket.
begin;

create table if not exists public.market_board_intraday_minutes (
  session_date date not null,
  minute_at timestamptz not null,
  kind text not null check (kind in ('liquidity', 'foreign')),
  source text not null check (source in ('index-quote', 'top200-partial')),
  source_as_of timestamptz not null,
  traded_value double precision,
  volume double precision,
  buy_value double precision,
  sell_value double precision,
  covered_symbols integer,
  primary key (session_date, kind, source, minute_at),
  constraint qeo_board_metrics_scope_check check (
    (kind = 'liquidity' and source = 'index-quote'
      and traded_value is not null and traded_value >= 0
      and (volume is null or volume >= 0)
      and buy_value is null and sell_value is null and covered_symbols is null)
    or
    (kind = 'foreign' and source = 'top200-partial'
      and traded_value is null and volume is null
      and buy_value is not null and sell_value is not null
      and buy_value >= 0 and sell_value >= 0
      and covered_symbols is not null and covered_symbols between 1 and 200)
  ),
  constraint qeo_board_metrics_date_check check (
    (minute_at at time zone 'Asia/Ho_Chi_Minh')::date = session_date
    and (source_as_of at time zone 'Asia/Ho_Chi_Minh')::date = session_date
  )
);
create index if not exists market_board_intraday_minutes_date_idx
  on public.market_board_intraday_minutes (session_date desc, minute_at);

alter table public.market_board_intraday_minutes enable row level security;
revoke all on table public.market_board_intraday_minutes from public, anon, authenticated;
grant select on table public.market_board_intraday_minutes to authenticated;
grant all on table public.market_board_intraday_minutes to service_role;
create policy "Read market board intraday observations"
  on public.market_board_intraday_minutes for select to authenticated using (true);

-- The DNSE frame protocol carries provider source time as protobuf seconds/nanos.
-- Never substitute checkpoint receipt time for missing/unparseable source time.
create or replace function public.qeo_board_frame_asof(p_frame jsonb, p_field text)
returns timestamptz language sql immutable
set search_path = ''
as $body$
  select case when (
    coalesce(p_frame -> p_field ->> 'Seconds', p_frame -> p_field ->> 'seconds',
      case when jsonb_typeof(p_frame -> p_field) in ('number', 'string')
        then p_frame ->> p_field else null end)
  ) ~ '^[0-9]{10,13}$'
  then to_timestamp(
    (coalesce(p_frame -> p_field ->> 'Seconds', p_frame -> p_field ->> 'seconds',
      p_frame ->> p_field))::double precision /
    (case when length(coalesce(p_frame -> p_field ->> 'Seconds',
      p_frame -> p_field ->> 'seconds', p_frame ->> p_field)) > 10 then 1000 else 1 end)
  ) else null end;
$body$;

create or replace function public.qeo_capture_market_board_minute()
returns void language plpgsql security definer
set search_path = ''
as $body$
declare
  v_now timestamptz := clock_timestamp();
  v_local timestamp;
  v_day date;
  v_minute timestamptz;
  v_frames jsonb;
  v_mi jsonb;
  v_mi_asof timestamptz;
  v_value double precision;
  v_volume double precision;
  v_buy double precision;
  v_sell double precision;
  v_coverage integer;
  v_foreign_asof timestamptz;
  v_keep date;
begin
  v_local := v_now at time zone 'Asia/Ho_Chi_Minh';
  v_day := v_local::date;
  -- Actual HOSE collection windows only; lunch, holidays and stale bus skip.
  if extract(isodow from v_local) > 5 or not (
    (extract(hour from v_local) = 9 and extract(minute from v_local) >= 15)
    or extract(hour from v_local) = 10
    or (extract(hour from v_local) = 11 and extract(minute from v_local) <= 30)
    or extract(hour from v_local) = 13
    or (extract(hour from v_local) = 14 and extract(minute from v_local) <= 50)
  ) then return; end if;

  select frames into v_frames
    from public.market_realtime_bus
    where stream = 'dnse-market' and updated_at >= v_now - interval '15 seconds'
      and source_updated_at >= v_now - interval '15 seconds';
  if v_frames is null or jsonb_typeof(v_frames) <> 'array' then return; end if;
  v_minute := date_trunc('minute', v_now);

  select f, asof into v_mi, v_mi_asof
  from (
    select f, public.qeo_board_frame_asof(f, 'transactTime') as asof
    from jsonb_array_elements(v_frames) as e(f)
    where f ->> 'T' = 'mi'
      and upper(coalesce(f ->> 'indexName', f ->> 'symbol', '')) = 'VNINDEX'
  ) as x
  where asof between ((v_day::timestamp + interval '9 hours') at time zone 'Asia/Ho_Chi_Minh')
    and v_now + interval '5 seconds'
    and asof >= v_now - interval '120 seconds'
  order by asof desc limit 1;

  if v_mi is not null and (v_mi ->> 'grossTradeAmount') ~ '^[0-9]+([.][0-9]+)?$'
    then
    v_value := (v_mi ->> 'grossTradeAmount')::double precision * 1000000000;
    v_volume := case when (v_mi ->> 'totalVolumeTraded') ~ '^[0-9]+([.][0-9]+)?    if v_value between 0 and 10000000000000000
      and (v_volume is null or v_volume between 0 and 1000000000000) then
      insert into public.market_board_intraday_minutes
        (session_date, minute_at, kind, source, source_as_of, traded_value, volume)
      values (v_day, v_minute, 'liquidity', 'index-quote', v_mi_asof, v_value, v_volume)
      on conflict (session_date, kind, source, minute_at) do update
        set source_as_of = excluded.source_as_of,
          traded_value = excluded.traded_value, volume = excluded.volume
      where excluded.source_as_of >= market_board_intraday_minutes.source_as_of;
    end if;
  end if;

  -- Cumulative foreign frames are maintained by the unattended worker, with
  -- validated canonical Top-200 membership. Sum only *complete* same-day
  -- buy/sell frame pairs; do not treat missing amounts as verified zero.
  with parsed as (
    select f ->> 'symbol' as symbol,
      public.qeo_board_frame_asof(f, 'multicastReceiveTime') as asof,
      coalesce(f ->> 'totalBuyTradedAmount', f ->> 'buyTradedAmount') as buy,
      coalesce(f ->> 'totalSellTradedAmount', f ->> 'sellTradedAmount') as sell
    from jsonb_array_elements(v_frames) as e(f) where f ->> 'T' = 'f'
  ), valid as (
    select symbol, asof, buy::double precision as buy, sell::double precision as sell
    from parsed
    where symbol ~ '^[A-Z0-9]{2,12}$'
      and buy ~ '^[0-9]+([.][0-9]+)?$' and sell ~ '^[0-9]+([.][0-9]+)?$'
      and asof between ((v_day::timestamp + interval '9 hours') at time zone 'Asia/Ho_Chi_Minh')
        and v_now + interval '5 seconds'
  ), latest as (
    select distinct on (symbol) symbol, asof, buy, sell
    from valid where buy between 0 and 1000000000000000
      and sell between 0 and 1000000000000000
    order by symbol, asof desc
  )
  select sum(buy), sum(sell), count(*)::integer, max(asof)
    into v_buy, v_sell, v_coverage, v_foreign_asof from latest;

  if v_coverage between 1 and 200
    and v_foreign_asof >= v_now - interval '120 seconds' then
    insert into public.market_board_intraday_minutes
      (session_date, minute_at, kind, source, source_as_of, buy_value, sell_value, covered_symbols)
    values (v_day, v_minute, 'foreign', 'top200-partial',
      v_foreign_asof, v_buy, v_sell, v_coverage)
    on conflict (session_date, kind, source, minute_at) do update
      set source_as_of = excluded.source_as_of, buy_value = excluded.buy_value,
        sell_value = excluded.sell_value, covered_symbols = excluded.covered_symbols
    where excluded.source_as_of >= market_board_intraday_minutes.source_as_of;
  end if;

  -- Three actual *recorded* sessions, not three calendar days (Tết/weekends).
  if extract(hour from v_local) = 9 and extract(minute from v_local) = 15 then
    select session_date into v_keep from (
      select distinct session_date from public.market_board_intraday_minutes
      order by session_date desc offset 2 limit 1
    ) as sessions;
    if v_keep is not null then
      delete from public.market_board_intraday_minutes where session_date < v_keep;
    end if;
  end if;
end;
$body$;

revoke all on function public.qeo_board_frame_asof(jsonb, text)
  from public, anon, authenticated;
revoke all on function public.qeo_capture_market_board_minute()
  from public, anon, authenticated;

create extension if not exists pg_cron with schema extensions;
do $schedule$
begin
  if exists (select 1 from cron.job where jobname = 'qeo-board-intraday-minute') then
    perform cron.unschedule('qeo-board-intraday-minute');
  end if;
  perform cron.schedule('qeo-board-intraday-minute', '* 2-7 * * 1-5',
    $cron$select public.qeo_capture_market_board_minute();$cron$);
end;
$schedule$;
commit;

      then (v_mi ->> 'totalVolumeTraded')::double precision else null end;
    if v_value between 0 and 10000000000000000
      and v_volume between 0 and 1000000000000 then
      insert into public.market_board_intraday_minutes
        (session_date, minute_at, kind, source, source_as_of, traded_value, volume)
      values (v_day, v_minute, 'liquidity', 'index-quote', v_mi_asof, v_value, v_volume)
      on conflict (session_date, kind, source, minute_at) do update
        set source_as_of = excluded.source_as_of,
          traded_value = excluded.traded_value, volume = excluded.volume
      where excluded.source_as_of >= market_board_intraday_minutes.source_as_of;
    end if;
  end if;

  -- Cumulative foreign frames are maintained by the unattended worker, with
  -- validated canonical Top-200 membership. Sum only *complete* same-day
  -- buy/sell frame pairs; do not treat missing amounts as verified zero.
  with parsed as (
    select f ->> 'symbol' as symbol,
      public.qeo_board_frame_asof(f, 'multicastReceiveTime') as asof,
      coalesce(f ->> 'totalBuyTradedAmount', f ->> 'buyTradedAmount') as buy,
      coalesce(f ->> 'totalSellTradedAmount', f ->> 'sellTradedAmount') as sell
    from jsonb_array_elements(v_frames) as e(f) where f ->> 'T' = 'f'
  ), valid as (
    select symbol, asof, buy::double precision as buy, sell::double precision as sell
    from parsed
    where symbol ~ '^[A-Z0-9]{2,12}$'
      and buy ~ '^[0-9]+([.][0-9]+)?$' and sell ~ '^[0-9]+([.][0-9]+)?$'
      and asof between ((v_day::timestamp + interval '9 hours') at time zone 'Asia/Ho_Chi_Minh')
        and v_now + interval '5 seconds'
  ), latest as (
    select distinct on (symbol) symbol, asof, buy, sell
    from valid where buy between 0 and 1000000000000000
      and sell between 0 and 1000000000000000
    order by symbol, asof desc
  )
  select sum(buy), sum(sell), count(*)::integer, max(asof)
    into v_buy, v_sell, v_coverage, v_foreign_asof from latest;

  if v_coverage between 1 and 200
    and v_foreign_asof >= v_now - interval '120 seconds' then
    insert into public.market_board_intraday_minutes
      (session_date, minute_at, kind, source, source_as_of, buy_value, sell_value, covered_symbols)
    values (v_day, v_minute, 'foreign', 'top200-partial',
      v_foreign_asof, v_buy, v_sell, v_coverage)
    on conflict (session_date, kind, source, minute_at) do update
      set source_as_of = excluded.source_as_of, buy_value = excluded.buy_value,
        sell_value = excluded.sell_value, covered_symbols = excluded.covered_symbols
    where excluded.source_as_of >= market_board_intraday_minutes.source_as_of;
  end if;

  -- Three actual *recorded* sessions, not three calendar days (Tết/weekends).
  if extract(hour from v_local) = 9 and extract(minute from v_local) = 15 then
    select session_date into v_keep from (
      select distinct session_date from public.market_board_intraday_minutes
      order by session_date desc offset 2 limit 1
    ) as sessions;
    if v_keep is not null then
      delete from public.market_board_intraday_minutes where session_date < v_keep;
    end if;
  end if;
end;
$body$;

revoke all on function public.qeo_board_frame_asof(jsonb, text)
  from public, anon, authenticated;
revoke all on function public.qeo_capture_market_board_minute()
  from public, anon, authenticated;

create extension if not exists pg_cron with schema extensions;
do $schedule$
begin
  if exists (select 1 from cron.job where jobname = 'qeo-board-intraday-minute') then
    perform cron.unschedule('qeo-board-intraday-minute');
  end if;
  perform cron.schedule('qeo-board-intraday-minute', '* 2-7 * * 1-5',
    $cron$select public.qeo_capture_market_board_minute();$cron$);
end;
$schedule$;
commit;

      then (v_mi ->> 'totalVolumeTraded')::double precision else null end;
    if v_value between 0 and 10000000000000000
      and (v_volume is null or v_volume between 0 and 1000000000000) then
      insert into public.market_board_intraday_minutes
        (session_date, minute_at, kind, source, source_as_of, traded_value, volume)
      values (v_day, v_minute, 'liquidity', 'index-quote', v_mi_asof, v_value, v_volume)
      on conflict (session_date, kind, source, minute_at) do update
        set source_as_of = excluded.source_as_of,
          traded_value = excluded.traded_value, volume = excluded.volume
      where excluded.source_as_of >= market_board_intraday_minutes.source_as_of;
    end if;
  end if;

  -- Cumulative foreign frames are maintained by the unattended worker, with
  -- validated canonical Top-200 membership. Sum only *complete* same-day
  -- buy/sell frame pairs; do not treat missing amounts as verified zero.
  with parsed as (
    select f ->> 'symbol' as symbol,
      public.qeo_board_frame_asof(f, 'multicastReceiveTime') as asof,
      coalesce(f ->> 'totalBuyTradedAmount', f ->> 'buyTradedAmount') as buy,
      coalesce(f ->> 'totalSellTradedAmount', f ->> 'sellTradedAmount') as sell
    from jsonb_array_elements(v_frames) as e(f) where f ->> 'T' = 'f'
  ), valid as (
    select symbol, asof, buy::double precision as buy, sell::double precision as sell
    from parsed
    where symbol ~ '^[A-Z0-9]{2,12}$'
      and buy ~ '^[0-9]+([.][0-9]+)?$' and sell ~ '^[0-9]+([.][0-9]+)?$'
      and asof between ((v_day::timestamp + interval '9 hours') at time zone 'Asia/Ho_Chi_Minh')
        and v_now + interval '5 seconds'
  ), latest as (
    select distinct on (symbol) symbol, asof, buy, sell
    from valid where buy between 0 and 1000000000000000
      and sell between 0 and 1000000000000000
    order by symbol, asof desc
  )
  select sum(buy), sum(sell), count(*)::integer, max(asof)
    into v_buy, v_sell, v_coverage, v_foreign_asof from latest;

  if v_coverage between 1 and 200
    and v_foreign_asof >= v_now - interval '120 seconds' then
    insert into public.market_board_intraday_minutes
      (session_date, minute_at, kind, source, source_as_of, buy_value, sell_value, covered_symbols)
    values (v_day, v_minute, 'foreign', 'top200-partial',
      v_foreign_asof, v_buy, v_sell, v_coverage)
    on conflict (session_date, kind, source, minute_at) do update
      set source_as_of = excluded.source_as_of, buy_value = excluded.buy_value,
        sell_value = excluded.sell_value, covered_symbols = excluded.covered_symbols
    where excluded.source_as_of >= market_board_intraday_minutes.source_as_of;
  end if;

  -- Three actual *recorded* sessions, not three calendar days (Tết/weekends).
  if extract(hour from v_local) = 9 and extract(minute from v_local) = 15 then
    select session_date into v_keep from (
      select distinct session_date from public.market_board_intraday_minutes
      order by session_date desc offset 2 limit 1
    ) as sessions;
    if v_keep is not null then
      delete from public.market_board_intraday_minutes where session_date < v_keep;
    end if;
  end if;
end;
$body$;

revoke all on function public.qeo_board_frame_asof(jsonb, text)
  from public, anon, authenticated;
revoke all on function public.qeo_capture_market_board_minute()
  from public, anon, authenticated;

create extension if not exists pg_cron with schema extensions;
do $schedule$
begin
  if exists (select 1 from cron.job where jobname = 'qeo-board-intraday-minute') then
    perform cron.unschedule('qeo-board-intraday-minute');
  end if;
  perform cron.schedule('qeo-board-intraday-minute', '* 2-7 * * 1-5',
    $cron$select public.qeo_capture_market_board_minute();$cron$);
end;
$schedule$;
commit;

      then (v_mi ->> 'totalVolumeTraded')::double precision else null end;
    if v_value between 0 and 10000000000000000
      and v_volume between 0 and 1000000000000 then
      insert into public.market_board_intraday_minutes
        (session_date, minute_at, kind, source, source_as_of, traded_value, volume)
      values (v_day, v_minute, 'liquidity', 'index-quote', v_mi_asof, v_value, v_volume)
      on conflict (session_date, kind, source, minute_at) do update
        set source_as_of = excluded.source_as_of,
          traded_value = excluded.traded_value, volume = excluded.volume
      where excluded.source_as_of >= market_board_intraday_minutes.source_as_of;
    end if;
  end if;

  -- Cumulative foreign frames are maintained by the unattended worker, with
  -- validated canonical Top-200 membership. Sum only *complete* same-day
  -- buy/sell frame pairs; do not treat missing amounts as verified zero.
  with parsed as (
    select f ->> 'symbol' as symbol,
      public.qeo_board_frame_asof(f, 'multicastReceiveTime') as asof,
      coalesce(f ->> 'totalBuyTradedAmount', f ->> 'buyTradedAmount') as buy,
      coalesce(f ->> 'totalSellTradedAmount', f ->> 'sellTradedAmount') as sell
    from jsonb_array_elements(v_frames) as e(f) where f ->> 'T' = 'f'
  ), valid as (
    select symbol, asof, buy::double precision as buy, sell::double precision as sell
    from parsed
    where symbol ~ '^[A-Z0-9]{2,12}$'
      and buy ~ '^[0-9]+([.][0-9]+)?$' and sell ~ '^[0-9]+([.][0-9]+)?$'
      and asof between ((v_day::timestamp + interval '9 hours') at time zone 'Asia/Ho_Chi_Minh')
        and v_now + interval '5 seconds'
  ), latest as (
    select distinct on (symbol) symbol, asof, buy, sell
    from valid where buy between 0 and 1000000000000000
      and sell between 0 and 1000000000000000
    order by symbol, asof desc
  )
  select sum(buy), sum(sell), count(*)::integer, max(asof)
    into v_buy, v_sell, v_coverage, v_foreign_asof from latest;

  if v_coverage between 1 and 200
    and v_foreign_asof >= v_now - interval '120 seconds' then
    insert into public.market_board_intraday_minutes
      (session_date, minute_at, kind, source, source_as_of, buy_value, sell_value, covered_symbols)
    values (v_day, v_minute, 'foreign', 'top200-partial',
      v_foreign_asof, v_buy, v_sell, v_coverage)
    on conflict (session_date, kind, source, minute_at) do update
      set source_as_of = excluded.source_as_of, buy_value = excluded.buy_value,
        sell_value = excluded.sell_value, covered_symbols = excluded.covered_symbols
    where excluded.source_as_of >= market_board_intraday_minutes.source_as_of;
  end if;

  -- Three actual *recorded* sessions, not three calendar days (Tết/weekends).
  if extract(hour from v_local) = 9 and extract(minute from v_local) = 15 then
    select session_date into v_keep from (
      select distinct session_date from public.market_board_intraday_minutes
      order by session_date desc offset 2 limit 1
    ) as sessions;
    if v_keep is not null then
      delete from public.market_board_intraday_minutes where session_date < v_keep;
    end if;
  end if;
end;
$body$;

revoke all on function public.qeo_board_frame_asof(jsonb, text)
  from public, anon, authenticated;
revoke all on function public.qeo_capture_market_board_minute()
  from public, anon, authenticated;

create extension if not exists pg_cron with schema extensions;
do $schedule$
begin
  if exists (select 1 from cron.job where jobname = 'qeo-board-intraday-minute') then
    perform cron.unschedule('qeo-board-intraday-minute');
  end if;
  perform cron.schedule('qeo-board-intraday-minute', '* 2-7 * * 1-5',
    $cron$select public.qeo_capture_market_board_minute();$cron$);
end;
$schedule$;
commit;
