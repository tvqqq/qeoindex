-- QEO-332: Capture transient VNINDEX liquidity frames without requiring
-- an UpCloud worker rollout or browser sessions. The checkpoint can contain
-- MI for only a few seconds, so minute-aligned pg_cron reads can miss it.
-- The worker already publishes the DNSE checkpoint server-side at ~1 Hz.
begin;

create or replace function public.qeo_capture_board_liquidity_from_bus()
returns trigger
language plpgsql security definer set search_path = ''
as $function$
declare
  v_sample_at timestamptz := NEW.updated_at;
  v_clock timestamp;
  v_day date;
  v_frame jsonb;
  v_source_at timestamptz;
  v_value double precision;
  v_volume double precision;
begin
  if NEW.stream <> 'dnse-market' then return NEW; end if;
  v_clock := v_sample_at at time zone 'Asia/Ho_Chi_Minh';
  v_day := v_clock::date;
  if extract(isodow from v_clock) > 5 or not (
    (extract(hour from v_clock) = 9 and extract(minute from v_clock) >= 15)
    or extract(hour from v_clock) = 10
    or (extract(hour from v_clock) = 11 and extract(minute from v_clock) <= 30)
    or extract(hour from v_clock) = 13
    or (extract(hour from v_clock) = 14 and extract(minute from v_clock) <= 50)
  ) then return NEW; end if;

  select f, source_time into v_frame, v_source_at
  from (
    select f, public.qeo_board_frame_asof(f, 'transactTime') as source_time
    from pg_catalog.jsonb_array_elements(NEW.frames) as j(f)
    where f ->> 'T' = 'mi'
      and pg_catalog.upper(coalesce(f ->> 'indexName', f ->> 'symbol', '')) = 'VNINDEX'
  ) as observed
  where source_time is not null
    and (source_time at time zone 'Asia/Ho_Chi_Minh')::date = v_day
    and source_time between v_sample_at - interval '120 seconds'
      and v_sample_at + interval '5 seconds'
  order by source_time desc limit 1;
  if v_frame is null or (v_frame ->> 'grossTradeAmount') !~ '^[0-9]+([.][0-9]+)?$' then
    return NEW;
  end if;

  v_value := (v_frame ->> 'grossTradeAmount')::double precision * 1000000000;
  v_volume := case when (v_frame ->> 'totalVolumeTraded') ~ '^[0-9]+([.][0-9]+)?$'
    then (v_frame ->> 'totalVolumeTraded')::double precision else null end;
  if v_value is null or v_value not between 0 and 10000000000000000
    or (v_volume is not null and v_volume not between 0 and 1000000000000) then
    return NEW;
  end if;

  -- Each row is an actual provider-observed minute, never a forward-filled
  -- marker at cron time. Only refresh same-minute rows every 15s at most.
  insert into public.market_board_intraday_minutes
    (session_date, minute_at, kind, source, source_as_of, traded_value, volume)
  values (v_day, pg_catalog.date_trunc('minute', v_source_at),
    'liquidity', 'index-quote', v_source_at, v_value, v_volume)
  on conflict (session_date, kind, source, minute_at) do update
    set source_as_of = excluded.source_as_of,
      traded_value = excluded.traded_value, volume = excluded.volume
  where excluded.source_as_of >=
    market_board_intraday_minutes.source_as_of + interval '15 seconds';
  return NEW;
end;
$function$;

revoke all on function public.qeo_capture_board_liquidity_from_bus()
  from public, anon, authenticated;

drop trigger if exists qeo_board_capture_liquidity_checkpoint on public.market_realtime_bus;
create trigger qeo_board_capture_liquidity_checkpoint
  after insert or update of frames on public.market_realtime_bus
  for each row
  when (NEW.stream = 'dnse-market' and NEW.frames @> '[{"T":"mi"}]'::jsonb)
  execute function public.qeo_capture_board_liquidity_from_bus();

commit;
