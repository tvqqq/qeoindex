-- QEO-106 semantic Daily basis precedence.
--
-- Legacy Yahoo/Fallback Daily rows captured before adjusted-OHLC normalization may be
-- structurally valid while still being semantically invalid for canonical chart price
-- history. A valid adjusted-basis repair must be allowed to replace those rows even
-- when the repair comes from a lower-ranked provider. All other provider precedence
-- rules remain unchanged.

create or replace function public.qeo_preserve_daily_ohlcv_provider_precedence()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  old_rank integer;
  new_rank integer;
  old_valid boolean;
  new_valid boolean;
  old_semantic_valid boolean;
  new_semantic_valid boolean;
  has_mismatch boolean;
  chosen_action text;
begin
  if old.timeframe is distinct from '1D' or new.timeframe is distinct from '1D' then
    return new;
  end if;

  old_rank := case
    when old.provider = 'VCI' then 400
    when old.provider = 'DNSE' then 300
    when old.provider = 'Fallback' and old.source_url = 'internal://stock_orderbook_snapshots' then 250
    when old.provider = 'Fallback' then 200
    when old.provider = 'VNDirect' then 100
    when old.provider = 'TitanLabs' then 50
    else 0
  end;

  new_rank := case
    when new.provider = 'VCI' then 400
    when new.provider = 'DNSE' then 300
    when new.provider = 'Fallback' and new.source_url = 'internal://stock_orderbook_snapshots' then 250
    when new.provider = 'Fallback' then 200
    when new.provider = 'VNDirect' then 100
    when new.provider = 'TitanLabs' then 50
    else 0
  end;

  old_valid := old.open > 0
    and old.high > 0
    and old.low > 0
    and old.close > 0
    and old.volume >= 0
    and old.high >= greatest(old.open, old.close, old.low)
    and old.low <= least(old.open, old.close, old.high);

  new_valid := new.open > 0
    and new.high > 0
    and new.low > 0
    and new.close > 0
    and new.volume >= 0
    and new.high >= greatest(new.open, new.close, new.low)
    and new.low <= least(new.open, new.close, new.high);

  old_semantic_valid := old_valid and not (
    old.provider = 'Fallback'
    and coalesce(old.source_url, '') like '%query1.finance.yahoo.com/v8/finance/chart/%'
    and coalesce(old.provider_detail, '') !~* 'adjusted OHLC'
  );

  new_semantic_valid := new_valid and not (
    new.provider = 'Fallback'
    and coalesce(new.source_url, '') like '%query1.finance.yahoo.com/v8/finance/chart/%'
    and coalesce(new.provider_detail, '') !~* 'adjusted OHLC'
  );

  has_mismatch := old.open is distinct from new.open
    or old.high is distinct from new.high
    or old.low is distinct from new.low
    or old.close is distinct from new.close
    or old.volume is distinct from new.volume;

  chosen_action := case
    when old_semantic_valid and not new_semantic_valid then 'preserve_semantically_valid_existing'
    when not old_semantic_valid and new_semantic_valid then 'replace_semantically_invalid_existing'
    when new_rank < old_rank then 'preserve_higher_priority_existing'
    else 'replace_with_incoming'
  end;

  if has_mismatch then
    raise warning 'QEO-106 Daily OHLCV overlap mismatch ticker=% bar_time=% existing_provider=% incoming_provider=% existing_rank=% incoming_rank=% existing_semantic_valid=% incoming_semantic_valid=% action=%',
      old.ticker,
      old.bar_time,
      old.provider,
      new.provider,
      old_rank,
      new_rank,
      old_semantic_valid,
      new_semantic_valid,
      chosen_action;
  end if;

  if old_semantic_valid and not new_semantic_valid then
    return old;
  end if;

  if not old_semantic_valid and new_semantic_valid then
    return new;
  end if;

  if new_rank < old_rank then
    return old;
  end if;

  return new;
end;
$$;

comment on function public.qeo_preserve_daily_ohlcv_provider_precedence() is
  'QEO-106 semantic Daily basis precedence: structurally valid legacy Yahoo rows without adjusted-OHLC provenance are not canonical semantic evidence and may be replaced by a valid adjusted-basis repair; otherwise VCI > DNSE > verified final-close repair > Yahoo/Fallback > VNDirect > TitanLabs remains enforced.';
