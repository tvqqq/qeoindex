begin;

-- QEO-92: chart-specific canonical 1m persistence. This is intentionally
-- isolated from market_ohlcv_history, whose active EOD/Wyckoff write contract
-- remains raw Daily-only.
create table if not exists public.chart_ohlcv_provenance_batches (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (char_length(provider) between 1 and 64),
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  base_resolution text not null check (base_resolution = '1m'),
  range_start timestamptz not null,
  range_end timestamptz not null,
  row_count integer not null check (row_count >= 0),
  fetched_at timestamptz not null default now(),
  detail jsonb not null default '{}'::jsonb,
  check (range_end >= range_start)
);

create index if not exists chart_ohlcv_provenance_lookup_idx
  on public.chart_ohlcv_provenance_batches (ticker, base_resolution, range_end desc);

create table if not exists public.chart_ohlcv_intraday (
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  base_resolution text not null check (base_resolution = '1m'),
  bar_time timestamptz not null,
  open double precision not null check (open > 0),
  high double precision not null check (high > 0),
  low double precision not null check (low > 0),
  close double precision not null check (close > 0),
  volume double precision not null check (volume >= 0),
  provenance_batch_id uuid references public.chart_ohlcv_provenance_batches(id) on delete set null,
  fetched_at timestamptz not null default now(),
  primary key (ticker, base_resolution, bar_time),
  check (high >= greatest(open, close, low)),
  check (low <= least(open, close, high))
);

create index if not exists chart_ohlcv_intraday_lookup_idx
  on public.chart_ohlcv_intraday (ticker, base_resolution, bar_time desc);

create table if not exists public.chart_ohlcv_cold_manifests (
  id uuid primary key default gen_random_uuid(),
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  base_resolution text not null check (base_resolution = '1m'),
  range_start timestamptz not null,
  range_end timestamptz not null,
  object_path text not null check (char_length(object_path) between 1 and 512),
  archive_format text not null check (archive_format in ('ndjson.gz', 'parquet')),
  row_count integer not null check (row_count > 0),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  provenance_batch_id uuid references public.chart_ohlcv_provenance_batches(id) on delete set null,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (range_end >= range_start),
  unique (object_path),
  unique (ticker, base_resolution, range_start, range_end, sha256)
);

create index if not exists chart_ohlcv_cold_manifest_lookup_idx
  on public.chart_ohlcv_cold_manifests (ticker, base_resolution, range_start, range_end);

alter table public.chart_ohlcv_provenance_batches enable row level security;
alter table public.chart_ohlcv_intraday enable row level security;
alter table public.chart_ohlcv_cold_manifests enable row level security;

revoke all privileges on table public.chart_ohlcv_provenance_batches from public, anon, authenticated;
revoke all privileges on table public.chart_ohlcv_intraday from public, anon, authenticated;
revoke all privileges on table public.chart_ohlcv_cold_manifests from public, anon, authenticated;

grant all privileges on table public.chart_ohlcv_provenance_batches to service_role;
grant all privileges on table public.chart_ohlcv_intraday to service_role;
grant all privileges on table public.chart_ohlcv_cold_manifests to service_role;

-- Private immutable cold-history bucket. Service-role callers bypass Storage RLS;
-- no public/authenticated object policy is created here.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chart-ohlcv',
  'chart-ohlcv',
  false,
  52428800,
  array['application/gzip', 'application/octet-stream']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

commit;
