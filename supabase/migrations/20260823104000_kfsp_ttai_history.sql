begin;

create table if not exists public.kfsp_ttai_quarterly_history (
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  period text not null check (period ~ '^Q[1-4]\\.[0-9]{2}$'),
  period_year smallint not null check (period_year between 2000 and 2100),
  period_quarter smallint not null check (period_quarter between 1 and 4),
  fourm_score numeric check (fourm_score is null or fourm_score between 0 and 100),
  canslim_score numeric check (canslim_score is null or canslim_score between 0 and 100),
  fourm_components jsonb not null default '{}'::jsonb check (jsonb_typeof(fourm_components) = 'object'),
  canslim_components jsonb not null default '{}'::jsonb check (jsonb_typeof(canslim_components) = 'object'),
  source text not null default 'kfsp' check (source = 'kfsp'),
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (ticker, period)
);

create index if not exists kfsp_ttai_history_ticker_period_idx
  on public.kfsp_ttai_quarterly_history(ticker, period_year desc, period_quarter desc);

create table if not exists public.kfsp_ttai_sync_state (
  ticker text primary key check (ticker ~ '^[A-Z0-9]{2,12}$'),
  financial_period text,
  latest_provider_period text,
  last_success_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

create table if not exists public.kfsp_ttai_sync_runs (
  id uuid primary key,
  status text not null check (status in ('running', 'completed', 'failed')),
  latest_rating_date date,
  candidate_count integer not null default 0 check (candidate_count >= 0),
  processed_count integer not null default 0 check (processed_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.kfsp_ttai_quarterly_history enable row level security;
alter table public.kfsp_ttai_sync_state enable row level security;
alter table public.kfsp_ttai_sync_runs enable row level security;

revoke all privileges on table public.kfsp_ttai_quarterly_history from anon, authenticated;
revoke all privileges on table public.kfsp_ttai_sync_state from anon, authenticated;
revoke all privileges on table public.kfsp_ttai_sync_runs from anon, authenticated;

grant select (
  ticker, period, period_year, period_quarter,
  fourm_score, canslim_score, fourm_components, canslim_components,
  source, fetched_at
) on public.kfsp_ttai_quarterly_history to authenticated;

grant all privileges on table public.kfsp_ttai_quarterly_history to service_role;
grant all privileges on table public.kfsp_ttai_sync_state to service_role;
grant all privileges on table public.kfsp_ttai_sync_runs to service_role;

drop policy if exists kfsp_ttai_history_authenticated_read on public.kfsp_ttai_quarterly_history;
create policy kfsp_ttai_history_authenticated_read
  on public.kfsp_ttai_quarterly_history
  for select
  to authenticated
  using (true);

comment on table public.kfsp_ttai_quarterly_history is
  'Normalized quarterly 4M/CANSLIM score history and component scores from the KFSP chart endpoint. ECharts presentation configuration is intentionally not stored.';
comment on column public.kfsp_ttai_quarterly_history.fourm_components is
  'Provider 4M component scores keyed by provider criterion label. Values are 0-100; rows with fewer values than headers are right-aligned to the latest periods.';
comment on column public.kfsp_ttai_quarterly_history.canslim_components is
  'Provider CANSLIM component scores keyed by provider criterion label. Values are 0-100.';

create or replace function public.qeo_touch_kfsp_ttai_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.qeo_touch_kfsp_ttai_updated_at() from public, anon, authenticated;

drop trigger if exists kfsp_ttai_history_updated_at on public.kfsp_ttai_quarterly_history;
create trigger kfsp_ttai_history_updated_at
before update on public.kfsp_ttai_quarterly_history
for each row execute function public.qeo_touch_kfsp_ttai_updated_at();

drop trigger if exists kfsp_ttai_sync_state_updated_at on public.kfsp_ttai_sync_state;
create trigger kfsp_ttai_sync_state_updated_at
before update on public.kfsp_ttai_sync_state
for each row execute function public.qeo_touch_kfsp_ttai_updated_at();

do $$
begin
  if exists (select 1 from cron.job where jobname = 'kfsp-ttai-history-hourly') then
    perform cron.unschedule('kfsp-ttai-history-hourly');
  end if;
end $$;

select cron.schedule(
  'kfsp-ttai-history-hourly',
  '17 * * * *',
  $cron$
  select net.http_post(
    url := 'https://glwhhrmejlonhyorvtzm.supabase.co/functions/v1/kfsp-ttai-history-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-KFSP-Sync-Secret', coalesce(
        (select decrypted_secret from vault.decrypted_secrets where name = 'kfsp_sync_secret' limit 1),
        ''
      )
    ),
    body := jsonb_build_object('source', 'supabase_pg_cron'),
    timeout_milliseconds := 55000
  );
  $cron$
);

commit;
