\set ON_ERROR_STOP on

begin;

do $$
begin
  if to_regprocedure('public.qeo_persist_raw_daily_observation(jsonb,boolean)') is null then
    raise exception 'missing qeo_persist_raw_daily_observation(jsonb,boolean)';
  end if;
  if has_function_privilege('anon', 'public.qeo_persist_raw_daily_observation(jsonb,boolean)', 'execute') then
    raise exception 'anon must not execute raw Daily persistence';
  end if;
  if has_function_privilege('authenticated', 'public.qeo_persist_raw_daily_observation(jsonb,boolean)', 'execute') then
    raise exception 'authenticated must not execute raw Daily persistence';
  end if;
  if not has_function_privilege('service_role', 'public.qeo_persist_raw_daily_observation(jsonb,boolean)', 'execute') then
    raise exception 'service_role must execute raw Daily persistence';
  end if;
end
$$;

-- First observation persists exact RAW evidence and can be explicitly selected canonical.
do $$
declare
  v_result record;
  v_payload jsonb := jsonb_build_object(
    'ticker', 'VHM',
    'session_date', '2026-08-05',
    'open', 154.2,
    'high', 158.8,
    'low', 153.0,
    'close', 153.0,
    'volume', 10681100,
    'price_basis', 'RAW',
    'provider', 'StockBiz',
    'provider_detail', 'QEO-132 bounded VHM pilot',
    'source_url', 'https://web.stockbiz.vn/Stocks/VHM/LookupQuote.aspx?Date=05%2F08%2F2026',
    'source_price_unit', 'VND_THOUSANDS',
    'normalization_version', 'stockbiz-raw-v1',
    'raw_evidence_hash', repeat('a', 64),
    'fetched_at', '2026-09-07T00:00:00Z'
  );
begin
  select * into v_result from public.qeo_persist_raw_daily_observation(v_payload, true);
  if v_result.evidence_id is null or not v_result.canonical_selected then
    raise exception 'raw Daily persistence did not return selected evidence identity';
  end if;
  if (select count(*) from public.market_ohlcv_raw_daily_evidence where ticker='VHM' and session_date='2026-08-05') <> 1 then
    raise exception 'raw evidence was not persisted exactly once';
  end if;
  if not exists (
    select 1 from public.market_ohlcv_raw_daily
    where ticker='VHM' and session_date='2026-08-05'
      and evidence_id=v_result.evidence_id
      and open=154.2 and high=158.8 and low=153 and close=153 and volume=10681100
      and price_basis='RAW' and raw_evidence_hash=repeat('a',64)
  ) then
    raise exception 'canonical raw row does not exactly mirror selected evidence';
  end if;
end
$$;

-- Exact replay is idempotent and returns the same evidence id.
do $$
declare
  v_first uuid;
  v_replay uuid;
  v_payload jsonb := jsonb_build_object(
    'ticker','VHM','session_date','2026-06-26','open',157.5,'high',163.9,'low',156.5,'close',162.0,'volume',12073300,
    'price_basis','RAW','provider','StockBiz','provider_detail','QEO-132 bounded VHM pilot',
    'source_url','https://web.stockbiz.vn/Stocks/VHM/LookupQuote.aspx?Date=26%2F06%2F2026',
    'source_price_unit','VND_THOUSANDS','normalization_version','stockbiz-raw-v1',
    'raw_evidence_hash',repeat('b',64),'fetched_at','2026-09-07T00:00:00Z'
  );
begin
  select evidence_id into v_first from public.qeo_persist_raw_daily_observation(v_payload, true);
  select evidence_id into v_replay from public.qeo_persist_raw_daily_observation(v_payload, true);
  if v_first <> v_replay then
    raise exception 'exact raw observation replay created a second evidence identity';
  end if;
  if (select count(*) from public.market_ohlcv_raw_daily_evidence where ticker='VHM' and session_date='2026-06-26') <> 1 then
    raise exception 'exact replay duplicated raw evidence';
  end if;
end
$$;

-- Corrections preserve prior evidence and change canonical only when explicitly selected.
do $$
declare
  v_original uuid;
  v_correction uuid;
  v_current uuid;
  v_base jsonb := jsonb_build_object(
    'ticker','AAA','session_date','2026-01-05','open',100,'high',105,'low',99,'close',103,'volume',1000,
    'price_basis','RAW','provider','Fixture','provider_detail','original','source_url','https://example.test/raw/AAA/2026-01-05',
    'source_price_unit','VND_THOUSANDS','normalization_version','fixture-v1','raw_evidence_hash',repeat('c',64),
    'fetched_at','2026-01-06T00:00:00Z'
  );
  v_fixed jsonb := jsonb_build_object(
    'ticker','AAA','session_date','2026-01-05','open',100,'high',106,'low',99,'close',104,'volume',1100,
    'price_basis','RAW','provider','Fixture','provider_detail','correction','source_url','https://example.test/raw/AAA/2026-01-05',
    'source_price_unit','VND_THOUSANDS','normalization_version','fixture-v1','raw_evidence_hash',repeat('d',64),
    'fetched_at','2026-01-07T00:00:00Z'
  );
begin
  select evidence_id into v_original from public.qeo_persist_raw_daily_observation(v_base, true);
  select evidence_id into v_correction from public.qeo_persist_raw_daily_observation(v_fixed, false);
  select evidence_id into v_current from public.market_ohlcv_raw_daily where ticker='AAA' and session_date='2026-01-05';
  if v_current <> v_original then
    raise exception 'unselected correction changed canonical raw evidence';
  end if;
  if (select count(*) from public.market_ohlcv_raw_daily_evidence where ticker='AAA' and session_date='2026-01-05') <> 2 then
    raise exception 'correction did not preserve both raw evidence rows';
  end if;

  perform public.qeo_persist_raw_daily_observation(v_fixed, true);
  select evidence_id into v_current from public.market_ohlcv_raw_daily where ticker='AAA' and session_date='2026-01-05';
  if v_current <> v_correction then
    raise exception 'explicit correction selection did not move canonical evidence';
  end if;
  if not exists (select 1 from public.market_ohlcv_raw_daily_evidence where id=v_original and close=103) then
    raise exception 'prior raw evidence was rewritten';
  end if;
end
$$;

-- Non-RAW and structurally invalid observations fail atomically.
do $$
declare
  v_bad jsonb;
  v_failed boolean;
  v_before integer := (select count(*) from public.market_ohlcv_raw_daily_evidence where ticker='BAD');
begin
  foreach v_bad in array array[
    jsonb_build_object('ticker','BAD','session_date','2026-01-05','open',100,'high',105,'low',99,'close',103,'volume',1000,'price_basis','ADJUSTED','provider','Fixture','provider_detail','bad','source_url','https://example.test/bad','source_price_unit','VND_THOUSANDS','normalization_version','fixture-v1','raw_evidence_hash',repeat('e',64),'fetched_at','2026-01-06T00:00:00Z'),
    jsonb_build_object('ticker','BAD','session_date','2026-01-05','open',100,'high',98,'low',99,'close',103,'volume',1000,'price_basis','RAW','provider','Fixture','provider_detail','bad','source_url','https://example.test/bad','source_price_unit','VND_THOUSANDS','normalization_version','fixture-v1','raw_evidence_hash',repeat('f',64),'fetched_at','2026-01-06T00:00:00Z'),
    jsonb_build_object('ticker','BAD','session_date','2026-01-05','open',100,'high',105,'low',99,'close',103,'volume',-1,'price_basis','RAW','provider','Fixture','provider_detail','bad','source_url','https://example.test/bad','source_price_unit','VND_THOUSANDS','normalization_version','fixture-v1','raw_evidence_hash',repeat('1',63),'fetched_at','2026-01-06T00:00:00Z')
  ] loop
    v_failed := false;
    begin
      perform public.qeo_persist_raw_daily_observation(v_bad, true);
    exception when others then
      v_failed := true;
    end;
    if not v_failed then
      raise exception 'invalid raw observation unexpectedly persisted';
    end if;
  end loop;

  if (select count(*) from public.market_ohlcv_raw_daily_evidence where ticker='BAD') <> v_before then
    raise exception 'invalid raw observation leaked evidence state';
  end if;
  if exists (select 1 from public.market_ohlcv_raw_daily where ticker='BAD') then
    raise exception 'invalid raw observation leaked canonical state';
  end if;
end
$$;

-- Evidence cannot be updated or deleted even through service role table privileges.
do $$
declare
  v_id uuid;
  v_failed boolean;
begin
  select id into v_id from public.market_ohlcv_raw_daily_evidence where ticker='VHM' order by created_at limit 1;
  v_failed := false;
  begin
    update public.market_ohlcv_raw_daily_evidence set close = close + 1 where id=v_id;
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'append-only evidence allowed update'; end if;

  v_failed := false;
  begin
    delete from public.market_ohlcv_raw_daily_evidence where id=v_id;
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'append-only evidence allowed delete'; end if;
end
$$;

rollback;
