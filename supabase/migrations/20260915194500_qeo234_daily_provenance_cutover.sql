begin;

-- QEO-234 Stage 2 is deliberately logical-only. Physical reclamation is a
-- separately authorized maintenance action documented in the runbook.
do $$
declare
  v_pending bigint;
  v_orphan bigint;
  v_provider_mismatch bigint;
  v_legacy_mismatch bigint;
begin
  select count(*)::bigint
  into v_pending
  from public.market_ohlcv_history
  where provenance_id is null;

  select count(*)::bigint
  into v_orphan
  from public.market_ohlcv_history history
  left join public.market_ohlcv_provenance registry
    on registry.id = history.provenance_id
  where history.provenance_id is not null
    and registry.id is null;

  select count(*)::bigint
  into v_provider_mismatch
  from public.market_ohlcv_history history
  join public.market_ohlcv_provenance registry
    on registry.id = history.provenance_id
  where history.provider is distinct from registry.provider;

  select count(*)::bigint
  into v_legacy_mismatch
  from public.market_ohlcv_history history
  join public.market_ohlcv_provenance registry
    on registry.id = history.provenance_id
  where (history.provider_detail is not null and history.provider_detail is distinct from registry.provider_detail)
     or (history.source_url is not null and history.source_url is distinct from registry.source_url);

  if v_pending <> 0
    or v_orphan <> 0
    or v_provider_mismatch <> 0
    or v_legacy_mismatch <> 0
  then
    raise exception
      'QEO-234 cutover gate failed pending=% orphan=% provider_mismatch=% legacy_mismatch=%',
      v_pending,
      v_orphan,
      v_provider_mismatch,
      v_legacy_mismatch;
  end if;
end;
$$;

-- Remove every trigger/function dependency on the two legacy long fields before
-- the columns are removed. Final compact facts require an exact registry row and
-- preserve provider as the short inline audit field.
drop trigger if exists qeo_market_ohlcv_provenance_consistency_guard
  on public.market_ohlcv_history;

create or replace function public.qeo_market_ohlcv_provenance_consistency_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  registry_provider text;
begin
  if new.provenance_id is null then
    raise exception 'Daily OHLCV provenance_id is required';
  end if;

  select registry.provider
  into registry_provider
  from public.market_ohlcv_provenance registry
  where registry.id = new.provenance_id;

  if not found then
    raise exception 'Daily OHLCV provenance_id % does not exist', new.provenance_id;
  end if;

  if new.provider is distinct from registry_provider then
    raise exception 'Daily OHLCV provenance provider mismatch for %.% at %',
      new.ticker, new.timeframe, new.bar_time;
  end if;

  return new;
end;
$$;

revoke all on function public.qeo_market_ohlcv_provenance_consistency_guard() from public, anon, authenticated;
grant execute on function public.qeo_market_ohlcv_provenance_consistency_guard() to service_role;

create trigger qeo_market_ohlcv_provenance_consistency_guard
before insert or update of provenance_id, provider
on public.market_ohlcv_history
for each row execute function public.qeo_market_ohlcv_provenance_consistency_guard();

-- Preserve the logical compatibility ABI while making registry provenance the
-- only source of the two long strings.
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
  registry.provider_detail,
  registry.source_url,
  history.fetched_at,
  history.provenance_id,
  (
    registry.id is not null
    and history.provider = registry.provider
  ) as provenance_consistent
from public.market_ohlcv_history history
left join public.market_ohlcv_provenance registry
  on registry.id = history.provenance_id;

revoke all privileges on table public.market_ohlcv_history_compat from public, anon, authenticated;
grant select on table public.market_ohlcv_history_compat to service_role;

-- The grouped Daily positional ABI remains exactly width 10:
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

-- QEO-233 historical reference backfill is obsolete only after all references
-- are proven complete by the assertions above.
drop function if exists public.qeo_market_ohlcv_provenance_backfill_batch(integer, bigint);

alter table public.market_ohlcv_history
  alter column provenance_id set not null;

alter table public.market_ohlcv_history
  drop column provider_detail,
  drop column source_url;

-- Fail closed unless the final compact shape and restrictive provenance FK are
-- exactly present. The FK name is intentionally asserted as production evidence:
-- market_ohlcv_history_provenance_id_fkey.
do $$
declare
  v_provider_not_null boolean;
  v_fetched_at_not_null boolean;
  v_provenance_not_null boolean;
  v_provider_detail_exists boolean;
  v_source_url_exists boolean;
  v_fk_ok boolean;
begin
  select attnotnull into v_provider_not_null
  from pg_catalog.pg_attribute
  where attrelid = 'public.market_ohlcv_history'::regclass
    and attname = 'provider'
    and not attisdropped;

  select attnotnull into v_fetched_at_not_null
  from pg_catalog.pg_attribute
  where attrelid = 'public.market_ohlcv_history'::regclass
    and attname = 'fetched_at'
    and not attisdropped;

  select attnotnull into v_provenance_not_null
  from pg_catalog.pg_attribute
  where attrelid = 'public.market_ohlcv_history'::regclass
    and attname = 'provenance_id'
    and not attisdropped;

  select exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = 'public.market_ohlcv_history'::regclass
      and attname = 'provider_detail'
      and not attisdropped
  ) into v_provider_detail_exists;

  select exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = 'public.market_ohlcv_history'::regclass
      and attname = 'source_url'
      and not attisdropped
  ) into v_source_url_exists;

  select exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.market_ohlcv_history'::regclass
      and constraint_row.conname = 'market_ohlcv_history_provenance_id_fkey'
      and constraint_row.contype = 'f'
      -- PostgreSQL confdeltype='a' is NO ACTION, which is restrictive just like
      -- an explicit FOREIGN KEY ... ON DELETE RESTRICT for this cutover.
      and constraint_row.confdeltype in ('a', 'r')
  ) into v_fk_ok;

  if coalesce(v_provider_not_null, false) is not true
    or coalesce(v_fetched_at_not_null, false) is not true
    or coalesce(v_provenance_not_null, false) is not true
    or v_provider_detail_exists
    or v_source_url_exists
    or not v_fk_ok
  then
    raise exception
      'QEO-234 final schema assertion failed provider_nn=% fetched_at_nn=% provenance_nn=% provider_detail_exists=% source_url_exists=% fk_ok=%',
      v_provider_not_null,
      v_fetched_at_not_null,
      v_provenance_not_null,
      v_provider_detail_exists,
      v_source_url_exists,
      v_fk_ok;
  end if;
end;
$$;

commit;
