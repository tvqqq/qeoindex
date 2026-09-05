-- QEO-101: deterministic provider precedence for canonical completed Daily OHLCV.
-- VCI is the current Daily authority; DNSE is the official fallback; verified
-- market-close repair is emergency redundancy; Yahoo/VNDirect are lower-priority gaps.

create or replace function public.qeo_preserve_daily_ohlcv_provider_precedence()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  old_rank integer;
  new_rank integer;
  has_mismatch boolean;
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
    else 0
  end;

  new_rank := case
    when new.provider = 'VCI' then 400
    when new.provider = 'DNSE' then 300
    when new.provider = 'Fallback' and new.source_url = 'internal://stock_orderbook_snapshots' then 250
    when new.provider = 'Fallback' then 200
    when new.provider = 'VNDirect' then 100
    else 0
  end;

  has_mismatch := old.open is distinct from new.open
    or old.high is distinct from new.high
    or old.low is distinct from new.low
    or old.close is distinct from new.close
    or old.volume is distinct from new.volume;

  if has_mismatch then
    raise warning 'QEO-101 Daily OHLCV overlap mismatch ticker=% bar_time=% existing_provider=% incoming_provider=% existing_rank=% incoming_rank=% action=%',
      old.ticker,
      old.bar_time,
      old.provider,
      new.provider,
      old_rank,
      new_rank,
      case when new_rank < old_rank then 'preserve_existing' else 'replace_with_incoming' end;
  end if;

  if new_rank < old_rank then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists qeo_market_ohlcv_daily_provider_precedence on public.market_ohlcv_history;

create trigger qeo_market_ohlcv_daily_provider_precedence
before update on public.market_ohlcv_history
for each row
execute function public.qeo_preserve_daily_ohlcv_provider_precedence();

comment on function public.qeo_preserve_daily_ohlcv_provider_precedence() is
  'QEO-101 canonical Daily provider precedence: VCI > DNSE > verified final-close repair > Yahoo/Fallback > VNDirect. Lower-priority overlaps cannot silently overwrite higher-priority evidence; OHLCV mismatches emit database warning telemetry.';
