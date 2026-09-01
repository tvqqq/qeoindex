begin;

create table if not exists public.eod_archive_checkpoints (
  trading_date date primary key,
  universe_run_id text,
  universe_count integer check (universe_count is null or universe_count between 1 and 200),
  validation_hash text,
  notion_status text not null default 'pending' check (notion_status in ('pending','archived','partial','blocked','error','skipped')),
  drive_status text not null default 'pending' check (drive_status in ('pending','archived','partial','blocked','error','skipped')),
  drive_manifest_url text,
  drive_manifest_sha256 text,
  drive_row_count integer check (drive_row_count is null or drive_row_count >= 0),
  drive_file_count integer check (drive_file_count is null or drive_file_count >= 0),
  retention_status text not null default 'pending' check (retention_status in ('pending','succeeded','blocked','failed','skipped')),
  archived_at timestamptz,
  retention_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists eod_archive_checkpoints_status_idx
  on public.eod_archive_checkpoints (trading_date desc, drive_status, notion_status, retention_status);

alter table public.eod_archive_checkpoints enable row level security;
revoke all on table public.eod_archive_checkpoints from public, anon, authenticated;
grant all on table public.eod_archive_checkpoints to service_role;

comment on table public.eod_archive_checkpoints is
  'Fail-closed archive ledger for Top Stocks EOD analytical/raw evidence. Retention may run only after verified Notion + Drive coverage.';

create or replace function public.qeo_archive_retention_preflight(p_reference_date date)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_missing_dates text[];
  v_required_count integer := 0;
  v_archived_count integer := 0;
begin
  if p_reference_date is null then
    raise exception 'p_reference_date is required';
  end if;

  with required_dates as (
    select distinct (h.bar_time at time zone 'Asia/Ho_Chi_Minh')::date as trading_date
    from public.market_ohlcv_history h
    where
      (h.timeframe = '1H' and h.bar_time < (p_reference_date::timestamptz - interval '90 days'))
      or
      (h.timeframe = '1D' and h.bar_time < (p_reference_date::timestamptz - interval '480 days'))
  ), coverage as (
    select
      r.trading_date,
      c.trading_date is not null
        and c.notion_status = 'archived'
        and c.drive_status = 'archived'
        and coalesce(c.drive_manifest_url, '') <> ''
        and coalesce(c.drive_manifest_sha256, '') ~ '^[0-9a-f]{64}$'
        and coalesce(c.drive_row_count, 0) > 0 as archived
    from required_dates r
    left join public.eod_archive_checkpoints c using (trading_date)
  )
  select
    count(*),
    count(*) filter (where archived),
    coalesce(array_agg(trading_date::text order by trading_date) filter (where not archived), array[]::text[])
  into v_required_count, v_archived_count, v_missing_dates
  from coverage;

  return jsonb_build_object(
    'safe', coalesce(array_length(v_missing_dates, 1), 0) = 0,
    'requiredDates', v_required_count,
    'archivedDates', v_archived_count,
    'missingDates', to_jsonb(v_missing_dates)
  );
end;
$$;

revoke all on function public.qeo_archive_retention_preflight(date) from public, anon, authenticated;
grant execute on function public.qeo_archive_retention_preflight(date) to service_role;

comment on function public.qeo_archive_retention_preflight(date) is
  'Returns safe=false whenever any OHLCV session eligible for retention lacks a verified Notion + Drive archive checkpoint.';

commit;
