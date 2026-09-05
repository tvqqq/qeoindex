-- QEO-102: allow verified valid historical repairs to replace provably invalid
-- legacy Daily rows while preserving the canonical provider hierarchy.
-- TitanLabs is Daily historical last-resort only and ranks below VNDirect.

create or replace function public.qeo_preserve_daily_ohlcv_provider_precedence()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  old_rank integer;
  new_rank integer;
  old_valid boolean;
  new_valid boolean;
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

  has_mismatch := old.open is distinct from new.open
    or old.high is distinct from new.high
    or old.low is distinct from new.low
    or old.close is distinct from new.close
    or old.volume is distinct from new.volume;

  chosen_action := case
    when old_valid and not new_valid then 'preserve_valid_existing'
    when not old_valid and new_valid then 'replace_invalid_existing'
    when new_rank < old_rank then 'preserve_higher_priority_existing'
    else 'replace_with_incoming'
  end;

  if has_mismatch then
    raise warning 'QEO-102 Daily OHLCV overlap mismatch ticker=% bar_time=% existing_provider=% incoming_provider=% existing_rank=% incoming_rank=% existing_valid=% incoming_valid=% action=%',
      old.ticker,
      old.bar_time,
      old.provider,
      new.provider,
      old_rank,
      new_rank,
      old_valid,
      new_valid,
      chosen_action;
  end if;

  if old_valid and not new_valid then
    return old;
  end if;

  if not old_valid and new_valid then
    return new;
  end if;

  if new_rank < old_rank then
    return old;
  end if;

  return new;
end;
$$;

comment on function public.qeo_preserve_daily_ohlcv_provider_precedence() is
  'QEO-102 completed Daily precedence: VCI > DNSE > verified final-close repair > Yahoo/Fallback > VNDirect > TitanLabs. A valid incoming repair may replace a provably invalid legacy row regardless of provider rank; an invalid incoming row can never replace a valid stored row.';
