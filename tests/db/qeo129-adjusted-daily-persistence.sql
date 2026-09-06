\set ON_ERROR_STOP on

begin;

insert into public.market_adjustment_factor_runs (
  id,
  ticker,
  factor_version,
  engine_version,
  event_lineage_hash,
  as_of_date,
  status,
  blocked_reason
) values (
  '00000000-0000-4000-8000-000000000129'::uuid,
  'Q129',
  'qeo124-v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'qeo124-v1',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  '2026-01-06'::date,
  'candidate',
  null
);

insert into public.market_ohlcv_adjusted_daily (
  ticker,
  session_date,
  bar_time,
  open,
  high,
  low,
  close,
  volume,
  raw_bar_time,
  factor_run_id,
  factor_version,
  event_lineage_hash,
  adjustment_engine_version
) values
  (
    'Q129',
    '2026-01-05'::date,
    '2026-01-05T02:00:00Z'::timestamptz,
    50,
    55,
    48,
    52.5,
    2000,
    '2026-01-05T02:00:00Z'::timestamptz,
    '00000000-0000-4000-8000-000000000129'::uuid,
    'qeo124-v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'qeo124-v1'
  ),
  (
    'Q129',
    '2026-01-06'::date,
    '2026-01-06T02:00:00Z'::timestamptz,
    110,
    120,
    100,
    115,
    2000,
    '2026-01-06T02:00:00Z'::timestamptz,
    '00000000-0000-4000-8000-000000000129'::uuid,
    'qeo124-v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'qeo124-v1'
  );

do $$
declare
  v_dates date[];
  v_count integer;
begin
  select array_agg(r.session_date order by r.session_date)
  into v_dates
  from public.qeo_adjusted_daily_readback(
    'Q129',
    '2026-01-05'::date,
    '2026-01-06'::date,
    '00000000-0000-4000-8000-000000000129'::uuid,
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  ) r;

  if v_dates is distinct from array['2026-01-05'::date, '2026-01-06'::date] then
    raise exception 'QEO-129 exact readback did not preserve canonical session order: %', v_dates;
  end if;

  select count(*)
  into v_count
  from public.qeo_adjusted_daily_readback(
    'Q129',
    '2026-01-05'::date,
    '2026-01-06'::date,
    '00000000-0000-4000-8000-000000000129'::uuid,
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  );
  if v_count <> 0 then
    raise exception 'QEO-129 wrong-lineage readback returned % rows', v_count;
  end if;

  select count(*)
  into v_count
  from public.qeo_adjusted_daily_readback(
    'Q129',
    '2026-01-05'::date,
    '2026-01-06'::date,
    '00000000-0000-4000-8000-000000000130'::uuid,
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  );
  if v_count <> 0 then
    raise exception 'QEO-129 wrong-run readback returned % rows', v_count;
  end if;
end
$$;

do $$
begin
  begin
    insert into public.market_ohlcv_adjusted_daily (
      ticker,
      session_date,
      bar_time,
      open,
      high,
      low,
      close,
      volume,
      raw_bar_time,
      factor_run_id,
      factor_version,
      event_lineage_hash,
      adjustment_engine_version
    ) values (
      'Q129',
      '2026-01-05'::date,
      '2026-01-05T03:00:00Z'::timestamptz,
      51,
      56,
      49,
      53,
      2100,
      '2026-01-05T03:00:00Z'::timestamptz,
      '00000000-0000-4000-8000-000000000129'::uuid,
      'qeo124-v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'qeo124-v1'
    );
    raise exception 'QEO-129 duplicate canonical session unexpectedly persisted';
  exception
    when unique_violation then
      null;
  end;
end
$$;

rollback;

do $$
declare
  v_run_count integer;
  v_adjusted_count integer;
begin
  select count(*) into v_run_count
  from public.market_adjustment_factor_runs
  where id = '00000000-0000-4000-8000-000000000129'::uuid;

  select count(*) into v_adjusted_count
  from public.market_ohlcv_adjusted_daily
  where ticker = 'Q129';

  if v_run_count <> 0 or v_adjusted_count <> 0 then
    raise exception 'QEO-129 SQL fixture left residual rows: run=%, adjusted=%', v_run_count, v_adjusted_count;
  end if;
end
$$;
