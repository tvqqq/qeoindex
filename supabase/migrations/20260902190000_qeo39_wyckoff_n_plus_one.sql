begin;

-- QEO-39: serve bounded per-ticker recent Daily history in one RPC call.
-- The LATERAL lookup lets Postgres use market_ohlcv_history_lookup_idx for each
-- requested ticker instead of ranking/scanning all matching history together.
create or replace function public.qeo_market_ohlcv_recent(p_tickers text[], p_limit integer default 260)
returns table (
  ticker text,
  timeframe text,
  bar_time timestamptz,
  open double precision,
  high double precision,
  low double precision,
  close double precision,
  volume double precision,
  provider text,
  provider_detail text,
  source_url text,
  fetched_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with requested as (
    select distinct upper(btrim(input.raw_ticker)) as ticker
    from unnest(p_tickers) as input(raw_ticker)
    where upper(btrim(input.raw_ticker)) ~ '^[A-Z0-9]{2,12}$'
  )
  select
    h.ticker,
    h.timeframe,
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
  from requested q
  cross join lateral (
    select
      source.ticker,
      source.timeframe,
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
    from public.market_ohlcv_history source
    where source.ticker = q.ticker
      and source.timeframe = '1D'
    order by source.bar_time desc
    limit greatest(1, least(coalesce(p_limit, 260), 1700))
  ) h
  order by h.ticker, h.timeframe, h.bar_time;
$$;

revoke all on function public.qeo_market_ohlcv_recent(text[], integer) from public, anon, authenticated;
grant execute on function public.qeo_market_ohlcv_recent(text[], integer) to service_role;

-- Workflow step outputs are durably recorded. Keep the large 400-snapshot build
-- payload out of workflow state by staging exactly two snapshots per ticker here.
-- This is ephemeral run state, never a canonical market-history source.
create table if not exists public.wyckoff_build_artifacts (
  run_id uuid not null references public.system_job_runs(id) on delete cascade,
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  run_key text not null,
  scan_date date not null,
  validation_hash text not null check (validation_hash ~ '^[a-f0-9]{64}$'),
  snapshots jsonb not null check (jsonb_typeof(snapshots) = 'array' and jsonb_array_length(snapshots) = 2),
  created_at timestamptz not null default now(),
  primary key (run_id, ticker)
);

alter table public.wyckoff_build_artifacts enable row level security;
revoke all privileges on table public.wyckoff_build_artifacts from anon, authenticated;
grant all privileges on table public.wyckoff_build_artifacts to service_role;

-- Terminal build artifacts only need to bridge BUILD -> VALIDATE -> PUBLISH.
-- Preserve queued/running runs and delete terminal artifacts after one day.
create or replace function public.qeo_run_wyckoff_build_artifact_cleanup(
  p_reference_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_started_at timestamptz := clock_timestamp();
  v_cutoff timestamptz := p_reference_at - interval '1 day';
  v_deleted integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('qeoindex.wyckoff_build_artifact_cleanup'));

  delete from public.wyckoff_build_artifacts a
  using public.system_job_runs r
  where r.id = a.run_id
    and r.status in ('succeeded', 'failed', 'skipped')
    and coalesce(r.finished_at, r.created_at) < v_cutoff;
  get diagnostics v_deleted = row_count;

  return jsonb_build_object(
    'status', 'succeeded',
    'referenceAt', p_reference_at,
    'durationMs', greatest(0, round(extract(epoch from (clock_timestamp() - v_started_at)) * 1000)::integer),
    'tables', jsonb_build_array(jsonb_build_object(
      'table', 'wyckoff_build_artifacts',
      'cutoff', v_cutoff,
      'deletedRows', v_deleted,
      'policy', 'terminal Wyckoff build artifacts 1d'
    ))
  );
end;
$$;

revoke all on function public.qeo_run_wyckoff_build_artifact_cleanup(timestamptz) from public, anon, authenticated;
grant execute on function public.qeo_run_wyckoff_build_artifact_cleanup(timestamptz) to service_role;

commit;
