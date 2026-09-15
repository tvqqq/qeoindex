begin;

create or replace view public.market_ohlcv_history_compat
with (security_invoker = true)
as
select
  history.ticker,
  history.timeframe,
  history.bar_time,
  history.open,
  history.high,
  history.low,
  history.close,
  history.volume,
  history.provider,
  case
    when history.provenance_id is null then history.provider_detail
    else registry.provider_detail
  end as provider_detail,
  case
    when history.provenance_id is null then history.source_url
    else registry.source_url
  end as source_url,
  history.fetched_at,
  history.provenance_id,
  (
    history.provenance_id is null
    or (
      registry.id is not null
      and history.provider = registry.provider
      and history.provider_detail = registry.provider_detail
      and history.source_url = registry.source_url
    )
  ) as provenance_consistent
from public.market_ohlcv_history history
left join public.market_ohlcv_provenance registry
  on registry.id = history.provenance_id;

revoke all privileges on table public.market_ohlcv_history_compat from public, anon, authenticated;
grant select on table public.market_ohlcv_history_compat to service_role;

create or replace function public.qeo_market_ohlcv_provenance_backfill_batch(
  p_limit integer default 1000,
  p_max_database_bytes bigint default null
)
returns table (
  updated_rows bigint,
  remaining_rows bigint,
  mismatch_rows bigint,
  database_bytes_before bigint,
  database_bytes_after bigint,
  table_bytes_after bigint,
  dead_tuples_after bigint,
  paused boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_updated bigint := 0;
  v_remaining bigint := 0;
  v_mismatch bigint := 0;
  v_database_before bigint := 0;
  v_database_after bigint := 0;
  v_table_after bigint := 0;
  v_dead_after bigint := 0;
  v_lock_acquired boolean := false;
begin
  if p_limit is null or p_limit < 1 or p_limit > 5000 then
    raise exception 'QEO-233 backfill p_limit must be between 1 and 5000';
  end if;

  v_limit := greatest(1, least(p_limit, 5000));
  v_database_before := pg_catalog.pg_database_size(pg_catalog.current_database());

  v_lock_acquired := pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('qeo233_daily_provenance_backfill', 0)
  );

  select count(*)::bigint
  into v_mismatch
  from public.market_ohlcv_history history
  join public.market_ohlcv_provenance registry
    on registry.id = history.provenance_id
  where history.provenance_id is not null
    and (
      history.provider is distinct from registry.provider
      or history.provider_detail is distinct from registry.provider_detail
      or history.source_url is distinct from registry.source_url
    );

  if not v_lock_acquired
    or v_mismatch > 0
    or (p_max_database_bytes is not null and v_database_before >= p_max_database_bytes)
  then
    select count(*)::bigint
    into v_remaining
    from public.market_ohlcv_history
    where provenance_id is null;

    v_database_after := pg_catalog.pg_database_size(pg_catalog.current_database());
    v_table_after := pg_catalog.pg_total_relation_size('public.market_ohlcv_history'::regclass);
    select coalesce(stats.n_dead_tup, 0)::bigint
    into v_dead_after
    from pg_catalog.pg_stat_user_tables stats
    where stats.relid = 'public.market_ohlcv_history'::regclass;

    return query
    select
      0::bigint,
      v_remaining,
      v_mismatch,
      v_database_before,
      v_database_after,
      v_table_after,
      v_dead_after,
      true;
    return;
  end if;

  insert into public.market_ohlcv_provenance (
    identity_version,
    provider,
    provider_detail,
    source_url
  )
  select distinct
    1,
    candidate.provider,
    candidate.provider_detail,
    candidate.source_url
  from (
    select
      history.provider,
      history.provider_detail,
      history.source_url
    from public.market_ohlcv_history history
    where history.provenance_id is null
    order by history.ticker, history.timeframe, history.bar_time
    limit v_limit
  ) candidate
  on conflict (identity_version, provider, provider_detail, source_url) do nothing;

  with candidates as (
    select
      history.ticker,
      history.timeframe,
      history.bar_time,
      history.provider,
      history.provider_detail,
      history.source_url
    from public.market_ohlcv_history history
    where history.provenance_id is null
    order by history.ticker, history.timeframe, history.bar_time
    limit v_limit
  ), resolved as (
    select
      candidate.ticker,
      candidate.timeframe,
      candidate.bar_time,
      registry.id as provenance_id
    from candidates candidate
    join public.market_ohlcv_provenance registry
      on registry.identity_version = 1
      and registry.provider = candidate.provider
      and registry.provider_detail = candidate.provider_detail
      and registry.source_url = candidate.source_url
  )
  update public.market_ohlcv_history history
  set provenance_id = resolved.provenance_id
  from resolved
  where history.ticker = resolved.ticker
    and history.timeframe = resolved.timeframe
    and history.bar_time = resolved.bar_time
    and history.provenance_id is null;

  get diagnostics v_updated = row_count;

  select count(*)::bigint
  into v_remaining
  from public.market_ohlcv_history
  where provenance_id is null;

  select count(*)::bigint
  into v_mismatch
  from public.market_ohlcv_history history
  join public.market_ohlcv_provenance registry
    on registry.id = history.provenance_id
  where history.provenance_id is not null
    and (
      history.provider is distinct from registry.provider
      or history.provider_detail is distinct from registry.provider_detail
      or history.source_url is distinct from registry.source_url
    );

  v_database_after := pg_catalog.pg_database_size(pg_catalog.current_database());
  v_table_after := pg_catalog.pg_total_relation_size('public.market_ohlcv_history'::regclass);
  select coalesce(stats.n_dead_tup, 0)::bigint
  into v_dead_after
  from pg_catalog.pg_stat_user_tables stats
  where stats.relid = 'public.market_ohlcv_history'::regclass;

  return query
  select
    v_updated,
    v_remaining,
    v_mismatch,
    v_database_before,
    v_database_after,
    v_table_after,
    v_dead_after,
    false;
end;
$$;

revoke all on function public.qeo_market_ohlcv_provenance_backfill_batch(integer, bigint) from public, anon, authenticated;
grant execute on function public.qeo_market_ohlcv_provenance_backfill_batch(integer, bigint) to service_role;

-- Preserve the grouped Daily positional ABI exactly:
-- [bar_time, open, high, low, close, volume, provider, provider_detail, source_url, fetched_at]
create or replace function public.qeo_market_ohlcv_recent_grouped(
  p_tickers text[],
  p_limit integer default 260
)
returns table (
  ticker text,
  rows jsonb
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if exists (
    with requested as (
      select distinct upper(btrim(input.raw_ticker)) as ticker
      from unnest(p_tickers) as input(raw_ticker)
      where upper(btrim(input.raw_ticker)) ~ '^[A-Z0-9]{2,12}$'
    )
    select 1
    from public.market_ohlcv_history_compat source
    join requested q on q.ticker = source.ticker
    where source.timeframe = '1D'
      and source.provenance_consistent is not true
  ) then
    raise exception 'Daily OHLCV provenance consistency violation';
  end if;

  return query
  with requested as (
    select distinct upper(btrim(input.raw_ticker)) as ticker
    from unnest(p_tickers) as input(raw_ticker)
    where upper(btrim(input.raw_ticker)) ~ '^[A-Z0-9]{2,12}$'
  )
  select
    q.ticker,
    coalesce(
      jsonb_agg(
        jsonb_build_array(
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
        ) order by h.bar_time
      ) filter (where h.bar_time is not null),
      '[]'::jsonb
    ) as rows
  from requested q
  left join lateral (
    select
      source.bar_time,
      source.open,
      source.high,
      source.low,
      source.close,
      source.volume,
      source.provider,
      source.provider_detail,
      source.source_url,
      source.fetched_at
    from public.market_ohlcv_history_compat source
    where source.ticker = q.ticker
      and source.timeframe = '1D'
      and source.provenance_consistent is true
    order by source.bar_time desc
    limit greatest(1, least(coalesce(p_limit, 260), 1700))
  ) h on true
  group by q.ticker
  order by q.ticker;
end;
$$;

revoke all on function public.qeo_market_ohlcv_recent_grouped(text[], integer) from public, anon, authenticated;
grant execute on function public.qeo_market_ohlcv_recent_grouped(text[], integer) to service_role;

commit;