-- QEO-234 compact Daily provenance follow-up.
--
-- Stage-1 compact writes intentionally omit provider_detail/source_url from the
-- fact row after resolving provenance_id. The legacy QEO-106 precedence trigger
-- ranked an incoming Fallback row from NEW.source_url, so a compact verified
-- final-close repair lost its 250 rank and was treated as generic Fallback=200.
-- That caused the trigger to return OLD and preserve the long inline fields,
-- blocking the production compact-writer canary.
--
-- Resolve the logical long provenance through market_ohlcv_provenance whenever
-- provenance_id is available. JSONB field access is deliberate: it keeps this
-- function valid both while the Stage-1 legacy columns exist and after Stage-2
-- drops them from market_ohlcv_history.

create or replace function public.qeo_preserve_daily_ohlcv_provider_precedence()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  old_payload jsonb;
  new_payload jsonb;
  old_provenance_id bigint;
  new_provenance_id bigint;
  old_registry_provider_detail text;
  old_registry_source_url text;
  new_registry_provider_detail text;
  new_registry_source_url text;
  old_provider_detail text;
  old_source_url text;
  new_provider_detail text;
  new_source_url text;
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

  old_payload := to_jsonb(old);
  new_payload := to_jsonb(new);
  old_provenance_id := nullif(old_payload->>'provenance_id', '')::bigint;
  new_provenance_id := nullif(new_payload->>'provenance_id', '')::bigint;

  if old_provenance_id is not null then
    select registry.provider_detail, registry.source_url
    into old_registry_provider_detail, old_registry_source_url
    from public.market_ohlcv_provenance registry
    where registry.id = old_provenance_id;
  end if;

  if new_provenance_id is not null then
    select registry.provider_detail, registry.source_url
    into new_registry_provider_detail, new_registry_source_url
    from public.market_ohlcv_provenance registry
    where registry.id = new_provenance_id;
  end if;

  old_provider_detail := coalesce(old_registry_provider_detail, old_payload->>'provider_detail');
  old_source_url := coalesce(old_registry_source_url, old_payload->>'source_url');
  new_provider_detail := coalesce(new_registry_provider_detail, new_payload->>'provider_detail');
  new_source_url := coalesce(new_registry_source_url, new_payload->>'source_url');

  old_rank := case
    when old.provider = 'VCI' then 400
    when old.provider = 'DNSE' then 300
    when old.provider = 'Fallback' and old_source_url = 'internal://stock_orderbook_snapshots' then 250
    when old.provider = 'Fallback' then 200
    when old.provider = 'VNDirect' then 100
    when old.provider = 'TitanLabs' then 50
    else 0
  end;

  new_rank := case
    when new.provider = 'VCI' then 400
    when new.provider = 'DNSE' then 300
    when new.provider = 'Fallback' and new_source_url = 'internal://stock_orderbook_snapshots' then 250
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
    and coalesce(old_source_url, '') like '%query1.finance.yahoo.com/v8/finance/chart/%'
    and coalesce(old_provider_detail, '') !~* 'adjusted OHLC'
  );

  new_semantic_valid := new_valid and not (
    new.provider = 'Fallback'
    and coalesce(new_source_url, '') like '%query1.finance.yahoo.com/v8/finance/chart/%'
    and coalesce(new_provider_detail, '') !~* 'adjusted OHLC'
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
  'QEO-234 registry-aware Daily precedence: logical provider_detail/source_url resolve from provenance_id when present so compact facts preserve QEO-106 VCI > DNSE > verified final-close repair > Yahoo/Fallback > VNDirect > TitanLabs semantics before and after long inline provenance columns are removed.';
