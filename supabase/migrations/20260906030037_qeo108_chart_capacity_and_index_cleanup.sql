create or replace function public.qeo_chart_storage_capacity()
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $$
declare
  v_database_bytes bigint;
  v_hot_heap_bytes bigint := 0;
  v_hot_index_bytes bigint := 0;
  v_hot_rows bigint := 0;
  v_partition_count bigint := 0;
  v_oldest date;
  v_newest date;
begin
  v_database_bytes := pg_database_size(current_database());
  v_hot_heap_bytes := pg_relation_size('public.chart_ohlcv_intraday'::regclass);
  v_hot_index_bytes := pg_indexes_size('public.chart_ohlcv_intraday'::regclass);

  select
    v_hot_heap_bytes + coalesce(sum(pg_relation_size(c.oid)), 0),
    v_hot_index_bytes + coalesce(sum(pg_indexes_size(c.oid)), 0),
    count(*)::bigint
  into v_hot_heap_bytes, v_hot_index_bytes, v_partition_count
  from pg_inherits i
  join pg_class c on c.oid = i.inhrelid
  where i.inhparent = 'public.chart_ohlcv_intraday'::regclass;

  select count(*)::bigint,
    min((bar_time at time zone 'Asia/Ho_Chi_Minh')::date),
    max((bar_time at time zone 'Asia/Ho_Chi_Minh')::date)
  into v_hot_rows, v_oldest, v_newest
  from public.chart_ohlcv_intraday;

  return jsonb_build_object(
    'databaseBytes', v_database_bytes,
    'hotHeapBytes', v_hot_heap_bytes,
    'hotIndexBytes', v_hot_index_bytes,
    'hotTotalBytes', v_hot_heap_bytes + v_hot_index_bytes,
    'hotRows', v_hot_rows,
    'partitionCount', v_partition_count,
    'oldestHotSession', v_oldest,
    'newestHotSession', v_newest
  );
end;
$$;

revoke all on function public.qeo_chart_storage_capacity() from public, anon, authenticated;
grant execute on function public.qeo_chart_storage_capacity() to service_role;

drop index if exists public.chart_ohlcv_intraday_lookup_idx;
