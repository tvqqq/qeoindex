begin;

create table if not exists public.market_research_reports (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  external_report_id text not null,
  title text not null,
  source_name text not null,
  publish_date date not null,
  original_type_report text,
  category text not null check (category in ('macro', 'strategy', 'sector', 'other')),
  sector_name text,
  recommendation text,
  target_price numeric(18,4),
  code text,
  link text,
  pdf_url text not null,
  source_payload jsonb not null check (jsonb_typeof(source_payload) = 'object'),
  content_hash text check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$'),
  ingestion_status text not null default 'discovered'
    check (ingestion_status in ('discovered', 'fetching', 'parsed', 'failed', 'unsupported')),
  ingestion_error text,
  analysis_status text not null default 'pending'
    check (analysis_status in ('pending', 'processing', 'ready', 'failed', 'unsupported')),
  analysis_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_report_id)
);

comment on table public.market_research_reports is
  'Provider research-report metadata. PDF content and AI-derived evidence are processed separately and versioned by content hash.';
comment on column public.market_research_reports.recommendation is
  'Broker recommendation from provider metadata; source opinion evidence, not a verified company fact.';
comment on column public.market_research_reports.target_price is
  'Broker target price from provider metadata when present; source opinion evidence, not a verified company fact.';

create index if not exists market_research_reports_publish_date_idx
  on public.market_research_reports(publish_date desc, id);
create index if not exists market_research_reports_category_date_idx
  on public.market_research_reports(category, publish_date desc, id);
create index if not exists market_research_reports_source_date_idx
  on public.market_research_reports(source_name, publish_date desc, id);
create index if not exists market_research_reports_analysis_status_idx
  on public.market_research_reports(analysis_status, publish_date desc, id);

create table if not exists public.market_research_report_analyses (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.market_research_reports(id) on delete cascade,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  analysis_version text not null,
  prompt_version text not null,
  model_requested text not null,
  model_actual text,
  executive_summary text not null,
  key_points jsonb not null default '[]'::jsonb check (jsonb_typeof(key_points) = 'array'),
  market_view jsonb not null default '{}'::jsonb check (jsonb_typeof(market_view) = 'object'),
  catalysts jsonb not null default '[]'::jsonb check (jsonb_typeof(catalysts) = 'array'),
  risks jsonb not null default '[]'::jsonb check (jsonb_typeof(risks) = 'array'),
  confidence jsonb not null default '{}'::jsonb check (jsonb_typeof(confidence) = 'object'),
  response_id text,
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  cached_input_tokens bigint not null default 0 check (cached_input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  reasoning_tokens bigint not null default 0 check (reasoning_tokens >= 0),
  total_tokens bigint not null default 0 check (total_tokens >= 0),
  latency_ms integer not null default 0 check (latency_ms >= 0),
  estimated_cost_usd numeric(18,8),
  pricing_version text,
  processed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (report_id, content_hash, analysis_version, prompt_version, model_requested)
);

create index if not exists market_research_report_analyses_report_idx
  on public.market_research_report_analyses(report_id, processed_at desc);
create index if not exists market_research_report_analyses_content_hash_idx
  on public.market_research_report_analyses(content_hash);

create table if not exists public.market_research_report_ticker_mentions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.market_research_reports(id) on delete cascade,
  analysis_id uuid not null references public.market_research_report_analyses(id) on delete cascade,
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  stance text not null check (stance in ('positive', 'negative', 'neutral', 'mixed')),
  recommendation_text text,
  target_price numeric(18,4),
  target_currency text,
  target_source text check (target_source is null or target_source in ('topi_metadata', 'report_extracted')),
  rationale text,
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  created_at timestamptz not null default now(),
  unique (analysis_id, ticker)
);

comment on column public.market_research_report_ticker_mentions.recommendation_text is
  'Broker recommendation extracted from a report; source opinion evidence, not a verified company fact.';
comment on column public.market_research_report_ticker_mentions.target_price is
  'Broker target price extracted from a report; source opinion evidence, not a verified company fact.';

create index if not exists market_research_report_mentions_report_ticker_idx
  on public.market_research_report_ticker_mentions(report_id, ticker);
create index if not exists market_research_report_mentions_ticker_idx
  on public.market_research_report_ticker_mentions(ticker, report_id);

create table if not exists public.market_research_report_chunks (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.market_research_reports(id) on delete cascade,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  page_number integer not null check (page_number > 0),
  chunk_index integer not null check (chunk_index >= 0),
  content text not null,
  chunk_hash text not null check (chunk_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (report_id, content_hash, page_number, chunk_index)
);

create index if not exists market_research_report_chunks_report_page_idx
  on public.market_research_report_chunks(report_id, page_number, chunk_index);
create index if not exists market_research_report_chunks_hash_idx
  on public.market_research_report_chunks(content_hash, chunk_hash);

alter table public.market_research_reports enable row level security;
alter table public.market_research_report_analyses enable row level security;
alter table public.market_research_report_ticker_mentions enable row level security;
alter table public.market_research_report_chunks enable row level security;

revoke all privileges on table
  public.market_research_reports,
  public.market_research_report_analyses,
  public.market_research_report_ticker_mentions,
  public.market_research_report_chunks
from anon;

revoke insert, update, delete, truncate, references, trigger on table
  public.market_research_reports,
  public.market_research_report_analyses,
  public.market_research_report_ticker_mentions,
  public.market_research_report_chunks
from authenticated;

grant select on table
  public.market_research_reports,
  public.market_research_report_analyses,
  public.market_research_report_ticker_mentions,
  public.market_research_report_chunks
to authenticated;

grant all privileges on table
  public.market_research_reports,
  public.market_research_report_analyses,
  public.market_research_report_ticker_mentions,
  public.market_research_report_chunks
to service_role;

drop policy if exists market_research_reports_authenticated_read on public.market_research_reports;
create policy market_research_reports_authenticated_read
  on public.market_research_reports for select to authenticated using (true);

drop policy if exists market_research_report_analyses_authenticated_read on public.market_research_report_analyses;
create policy market_research_report_analyses_authenticated_read
  on public.market_research_report_analyses for select to authenticated using (true);

drop policy if exists market_research_report_mentions_authenticated_read on public.market_research_report_ticker_mentions;
create policy market_research_report_mentions_authenticated_read
  on public.market_research_report_ticker_mentions for select to authenticated using (true);

drop policy if exists market_research_report_chunks_authenticated_read on public.market_research_report_chunks;
create policy market_research_report_chunks_authenticated_read
  on public.market_research_report_chunks for select to authenticated using (true);

commit;
