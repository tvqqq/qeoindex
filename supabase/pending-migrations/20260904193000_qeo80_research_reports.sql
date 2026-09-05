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
  parsed_page_count integer not null default 0 check (parsed_page_count >= 0),
  ingestion_status text not null default 'discovered'
    check (ingestion_status in ('discovered', 'fetching', 'parsed', 'needs_ocr', 'failed', 'unsupported')),
  ingestion_error text,
  analysis_status text not null default 'pending'
    check (analysis_status in ('pending', 'processing', 'ready', 'needs_ocr', 'failed', 'unsupported')),
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
  model_route_key text not null,
  reasoning_effort text not null,
  chunk_version text not null,
  model_requested text not null,
  model_actual text,
  executive_summary text not null,
  key_points jsonb not null default '[]'::jsonb check (jsonb_typeof(key_points) = 'array'),
  market_view text,
  sector_outlook text,
  catalysts jsonb not null default '[]'::jsonb check (jsonb_typeof(catalysts) = 'array'),
  risks jsonb not null default '[]'::jsonb check (jsonb_typeof(risks) = 'array'),
  confidence jsonb not null default '{}'::jsonb check (jsonb_typeof(confidence) = 'object'),
  response_id text,
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  cached_input_tokens bigint not null default 0 check (cached_input_tokens >= 0),
  cache_write_tokens bigint not null default 0 check (cache_write_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  reasoning_tokens bigint not null default 0 check (reasoning_tokens >= 0),
  total_tokens bigint not null default 0 check (total_tokens >= 0),
  latency_ms integer not null default 0 check (latency_ms >= 0),
  estimated_cost_usd numeric(18,8),
  pricing_version text,
  processed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (report_id, content_hash, analysis_version, prompt_version, model_route_key)
);

create index if not exists market_research_report_analyses_report_idx
  on public.market_research_report_analyses(report_id, processed_at desc);
create index if not exists market_research_report_analyses_content_hash_idx
  on public.market_research_report_analyses(content_hash);

create table if not exists public.market_research_report_analysis_leases (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.market_research_reports(id) on delete cascade,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  analysis_version text not null,
  prompt_version text not null,
  model_route_key text not null,
  owner_run_id uuid not null references public.system_job_runs(id) on delete cascade,
  lease_token uuid not null default gen_random_uuid(),
  expires_at timestamptz not null,
  terminal_outcome text check (terminal_outcome is null or terminal_outcome in ('ready', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (report_id, content_hash, analysis_version, prompt_version, model_route_key),
  unique (lease_token)
);

create index if not exists market_research_report_analysis_leases_expires_idx
  on public.market_research_report_analysis_leases(expires_at);

create table if not exists public.market_research_report_run_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.system_job_runs(id) on delete cascade,
  job_key text not null check (job_key ~ '^[a-z0-9_]+([.][a-z0-9_]+)*$'),
  report_id uuid not null references public.market_research_reports(id) on delete cascade,
  provider text not null,
  external_report_id text not null,
  publish_date date not null,
  content_hash text check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$'),
  outcome text check (outcome is null or outcome in (
    'ready', 'skipped_existing', 'skipped_concurrent', 'needs_ocr', 'unsupported',
    'failed', 'deferred_budget', 'deferred_report_limit'
  )),
  terminal_stage text,
  error_code text,
  error_message text,
  attempted_models jsonb not null default '[]'::jsonb check (jsonb_typeof(attempted_models) = 'array'),
  ai_request_count integer not null default 0 check (ai_request_count >= 0),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  cached_input_tokens bigint not null default 0 check (cached_input_tokens >= 0),
  cache_write_tokens bigint not null default 0 check (cache_write_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  reasoning_tokens bigint not null default 0 check (reasoning_tokens >= 0),
  total_tokens bigint not null default 0 check (total_tokens >= 0),
  unknown_usage_attempts integer not null default 0 check (unknown_usage_attempts >= 0),
  estimated_cost_usd numeric(18,8),
  pricing_version text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms bigint check (duration_ms is null or duration_ms >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, report_id)
);

create index if not exists market_research_report_run_items_run_idx
  on public.market_research_report_run_items(run_id, started_at asc);
create index if not exists market_research_report_run_items_report_idx
  on public.market_research_report_run_items(report_id, started_at desc);

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
  chunk_version text not null,
  page_number integer not null check (page_number > 0),
  chunk_index integer not null check (chunk_index >= 0),
  content text not null,
  search_vector tsvector generated always as (
    to_tsvector('simple'::regconfig, coalesce(content, ''))
  ) stored,
  chunk_hash text not null check (chunk_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (report_id, content_hash, chunk_version, page_number, chunk_index)
);

create index if not exists market_research_report_chunks_report_page_idx
  on public.market_research_report_chunks(report_id, page_number, chunk_index);
create index if not exists market_research_report_chunks_hash_idx
  on public.market_research_report_chunks(content_hash, chunk_hash);
create index if not exists market_research_report_chunks_search_idx
  on public.market_research_report_chunks using gin(search_vector);

alter table public.market_research_reports enable row level security;
alter table public.market_research_report_analyses enable row level security;
alter table public.market_research_report_analysis_leases enable row level security;
alter table public.market_research_report_run_items enable row level security;
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

revoke all privileges on table
  public.market_research_report_analysis_leases,
  public.market_research_report_run_items
from public, anon, authenticated;

grant all privileges on table
  public.market_research_report_analysis_leases,
  public.market_research_report_run_items
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

create or replace function public.qeo_acquire_research_report_analysis_lease(
  p_report_id uuid,
  p_content_hash text,
  p_analysis_version text,
  p_prompt_version text,
  p_model_route_key text,
  p_run_id uuid,
  p_ttl_seconds integer default 900
) returns table (
  outcome text,
  lease_token uuid,
  expires_at timestamptz,
  analysis_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_analysis_id uuid;
  v_lease_token uuid := gen_random_uuid();
  v_expires_at timestamptz;
  v_busy_expires_at timestamptz;
  v_ttl_seconds integer := least(greatest(coalesce(p_ttl_seconds, 900), 60), 3600);
begin
  if p_content_hash is null or p_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid research report content hash';
  end if;
  if nullif(btrim(coalesce(p_analysis_version, '')), '') is null
     or nullif(btrim(coalesce(p_prompt_version, '')), '') is null
     or nullif(btrim(coalesce(p_model_route_key, '')), '') is null
     or p_run_id is null then
    raise exception 'invalid research report analysis lease identity';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    concat_ws(':', p_report_id::text, p_content_hash, p_analysis_version, p_prompt_version, p_model_route_key),
    0
  ));

  select a.id
    into v_analysis_id
    from public.market_research_report_analyses a
   where a.report_id = p_report_id
     and a.content_hash = p_content_hash
     and a.analysis_version = p_analysis_version
     and a.prompt_version = p_prompt_version
     and a.model_route_key = p_model_route_key
   limit 1;

  if found then
    return query select 'existing_success'::text, null::uuid, null::timestamptz, v_analysis_id;
    return;
  end if;

  v_expires_at := now() + make_interval(secs => v_ttl_seconds);

  insert into public.market_research_report_analysis_leases (
    report_id,
    content_hash,
    analysis_version,
    prompt_version,
    model_route_key,
    owner_run_id,
    lease_token,
    expires_at,
    terminal_outcome,
    updated_at
  ) values (
    p_report_id,
    p_content_hash,
    p_analysis_version,
    p_prompt_version,
    p_model_route_key,
    p_run_id,
    v_lease_token,
    v_expires_at,
    null,
    now()
  )
  on conflict (report_id, content_hash, analysis_version, prompt_version, model_route_key)
  do update set
    owner_run_id = excluded.owner_run_id,
    lease_token = excluded.lease_token,
    expires_at = excluded.expires_at,
    terminal_outcome = null,
    updated_at = now()
  where public.market_research_report_analysis_leases.expires_at <= now()
     or public.market_research_report_analysis_leases.owner_run_id = p_run_id
  returning public.market_research_report_analysis_leases.lease_token,
            public.market_research_report_analysis_leases.expires_at
    into v_lease_token, v_expires_at;

  if found then
    return query select 'acquired'::text, v_lease_token, v_expires_at, null::uuid;
    return;
  end if;

  select l.expires_at
    into v_busy_expires_at
    from public.market_research_report_analysis_leases l
   where l.report_id = p_report_id
     and l.content_hash = p_content_hash
     and l.analysis_version = p_analysis_version
     and l.prompt_version = p_prompt_version
     and l.model_route_key = p_model_route_key;

  return query select 'busy'::text, null::uuid, v_busy_expires_at, null::uuid;
end;
$$;

revoke all on function public.qeo_acquire_research_report_analysis_lease(uuid, text, text, text, text, uuid, integer)
from public, anon, authenticated;
grant execute on function public.qeo_acquire_research_report_analysis_lease(uuid, text, text, text, text, uuid, integer)
to service_role;

create or replace function public.qeo_release_research_report_analysis_lease(
  p_lease_token uuid,
  p_terminal_outcome text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated boolean := false;
begin
  if p_lease_token is null
     or p_terminal_outcome not in ('ready', 'failed') then
    raise exception 'invalid research report analysis lease release';
  end if;

  update public.market_research_report_analysis_leases
     set terminal_outcome = p_terminal_outcome,
         expires_at = now(),
         updated_at = now()
   where lease_token = p_lease_token;

  v_updated := found;
  return v_updated;
end;
$$;

revoke all on function public.qeo_release_research_report_analysis_lease(uuid, text)
from public, anon, authenticated;
grant execute on function public.qeo_release_research_report_analysis_lease(uuid, text)
to service_role;

create or replace function public.qeo_publish_research_report_analysis(
  p_report_id uuid,
  p_content_hash text,
  p_analysis jsonb,
  p_chunks jsonb,
  p_mentions jsonb
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_report_hash text;
  v_analysis_id uuid;
  v_analysis_version text := nullif(p_analysis ->> 'analysis_version', '');
  v_prompt_version text := nullif(p_analysis ->> 'prompt_version', '');
  v_model_route_key text := nullif(p_analysis ->> 'model_route_key', '');
  v_reasoning_effort text := nullif(p_analysis ->> 'reasoning_effort', '');
  v_chunk_version text := nullif(p_analysis ->> 'chunk_version', '');
  v_parsed_page_count integer;
begin
  if p_content_hash is null or p_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid research report content hash';
  end if;

  if jsonb_typeof(p_analysis) is distinct from 'object'
     or jsonb_typeof(p_chunks) is distinct from 'array'
     or jsonb_typeof(p_mentions) is distinct from 'array' then
    raise exception 'invalid research report publish payload';
  end if;

  if v_analysis_version is null
     or v_prompt_version is null
     or v_model_route_key is null
     or v_reasoning_effort is null
     or v_chunk_version is null then
    raise exception 'missing research report analysis identity';
  end if;

  begin
    v_parsed_page_count := (p_analysis ->> 'parsed_page_count')::integer;
  exception when others then
    raise exception 'invalid parsed page count';
  end;
  if v_parsed_page_count < 1 then
    raise exception 'invalid parsed page count';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_report_id::text, 0));

  select content_hash
    into v_report_hash
    from public.market_research_reports
   where id = p_report_id
   for update;

  if not found then
    raise exception 'research report not found';
  end if;
  if v_report_hash is distinct from p_content_hash then
    raise exception 'stale research report content identity';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_chunks) item
     where item ->> 'chunk_version' is distinct from v_chunk_version
  ) then
    raise exception 'chunk version mismatch';
  end if;

  insert into public.market_research_report_analyses (
    report_id,
    content_hash,
    analysis_version,
    prompt_version,
    model_route_key,
    reasoning_effort,
    chunk_version,
    model_requested,
    model_actual,
    executive_summary,
    key_points,
    market_view,
    sector_outlook,
    catalysts,
    risks,
    confidence,
    response_id,
    input_tokens,
    cached_input_tokens,
    cache_write_tokens,
    output_tokens,
    reasoning_tokens,
    total_tokens,
    latency_ms,
    estimated_cost_usd,
    pricing_version,
    processed_at
  ) values (
    p_report_id,
    p_content_hash,
    v_analysis_version,
    v_prompt_version,
    v_model_route_key,
    v_reasoning_effort,
    v_chunk_version,
    p_analysis ->> 'model_requested',
    p_analysis ->> 'model_actual',
    p_analysis ->> 'executive_summary',
    coalesce(p_analysis -> 'key_points', '[]'::jsonb),
    p_analysis ->> 'market_view',
    p_analysis ->> 'sector_outlook',
    coalesce(p_analysis -> 'catalysts', '[]'::jsonb),
    coalesce(p_analysis -> 'risks', '[]'::jsonb),
    coalesce(p_analysis -> 'confidence', '{}'::jsonb),
    p_analysis ->> 'response_id',
    coalesce((p_analysis ->> 'input_tokens')::bigint, 0),
    coalesce((p_analysis ->> 'cached_input_tokens')::bigint, 0),
    coalesce((p_analysis ->> 'cache_write_tokens')::bigint, 0),
    coalesce((p_analysis ->> 'output_tokens')::bigint, 0),
    coalesce((p_analysis ->> 'reasoning_tokens')::bigint, 0),
    coalesce((p_analysis ->> 'total_tokens')::bigint, 0),
    coalesce((p_analysis ->> 'latency_ms')::integer, 0),
    (p_analysis ->> 'estimated_cost_usd')::numeric,
    p_analysis ->> 'pricing_version',
    now()
  )
  on conflict (report_id, content_hash, analysis_version, prompt_version, model_route_key)
  do update set
    reasoning_effort = excluded.reasoning_effort,
    chunk_version = excluded.chunk_version,
    model_requested = excluded.model_requested,
    model_actual = excluded.model_actual,
    executive_summary = excluded.executive_summary,
    key_points = excluded.key_points,
    market_view = excluded.market_view,
    sector_outlook = excluded.sector_outlook,
    catalysts = excluded.catalysts,
    risks = excluded.risks,
    confidence = excluded.confidence,
    response_id = excluded.response_id,
    input_tokens = excluded.input_tokens,
    cached_input_tokens = excluded.cached_input_tokens,
    cache_write_tokens = excluded.cache_write_tokens,
    output_tokens = excluded.output_tokens,
    reasoning_tokens = excluded.reasoning_tokens,
    total_tokens = excluded.total_tokens,
    latency_ms = excluded.latency_ms,
    estimated_cost_usd = excluded.estimated_cost_usd,
    pricing_version = excluded.pricing_version,
    processed_at = now()
  returning id into v_analysis_id;

  delete from public.market_research_report_chunks
   where report_id = p_report_id
     and content_hash = p_content_hash
     and chunk_version = v_chunk_version;

  insert into public.market_research_report_chunks (
    report_id,
    content_hash,
    chunk_version,
    page_number,
    chunk_index,
    content,
    chunk_hash
  )
  select
    p_report_id,
    p_content_hash,
    v_chunk_version,
    (item ->> 'page_number')::integer,
    (item ->> 'chunk_index')::integer,
    item ->> 'content',
    item ->> 'chunk_hash'
  from jsonb_array_elements(p_chunks) item;

  delete from public.market_research_report_ticker_mentions
   where analysis_id = v_analysis_id;

  insert into public.market_research_report_ticker_mentions (
    report_id,
    analysis_id,
    ticker,
    stance,
    recommendation_text,
    target_price,
    target_currency,
    target_source,
    rationale,
    evidence
  )
  select
    p_report_id,
    v_analysis_id,
    item ->> 'ticker',
    item ->> 'stance',
    item ->> 'recommendation_text',
    (item ->> 'target_price')::numeric,
    item ->> 'target_currency',
    item ->> 'target_source',
    item ->> 'rationale',
    coalesce(item -> 'evidence', '[]'::jsonb)
  from jsonb_array_elements(p_mentions) item;

  update public.market_research_reports
     set parsed_page_count = v_parsed_page_count,
         ingestion_status = 'parsed',
         ingestion_error = null,
         analysis_status = 'ready',
         analysis_error = null,
         updated_at = now()
   where id = p_report_id;

  return v_analysis_id;
end;
$$;

revoke all on function public.qeo_publish_research_report_analysis(uuid, text, jsonb, jsonb, jsonb)
from public, anon, authenticated;
grant execute on function public.qeo_publish_research_report_analysis(uuid, text, jsonb, jsonb, jsonb)
to service_role;

create or replace function public.qeo_search_research_report_chunks(
  p_report_id uuid,
  p_content_hash text,
  p_chunk_version text,
  p_query text,
  p_limit integer default 8
) returns table (
  id uuid,
  report_id uuid,
  content_hash text,
  chunk_version text,
  page_number integer,
  chunk_index integer,
  content text,
  rank real
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with query_input as (
    select websearch_to_tsquery(
      'simple'::regconfig,
      left(trim(coalesce(p_query, '')), 4000)
    ) as q
  )
  select
    c.id,
    c.report_id,
    c.content_hash,
    c.chunk_version,
    c.page_number,
    c.chunk_index,
    c.content,
    ts_rank_cd(c.search_vector, query_input.q)::real as rank
  from public.market_research_report_chunks c
  cross join query_input
  where c.report_id = p_report_id
    and c.content_hash = p_content_hash
    and c.chunk_version = p_chunk_version
    and trim(coalesce(p_query, '')) <> ''
    and c.search_vector @@ query_input.q
  order by rank desc, c.page_number asc, c.chunk_index asc, c.id asc
  limit least(greatest(coalesce(p_limit, 8), 1), 8);
$$;

revoke all on function public.qeo_search_research_report_chunks(uuid, text, text, text, integer)
from public, anon, authenticated;
grant execute on function public.qeo_search_research_report_chunks(uuid, text, text, text, integer)
to service_role;

create or replace function public.qeo_trigger_research_reports_daily()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app_url text;
  v_cron_secret text;
  v_request_id bigint;
begin
  select s.decrypted_secret
    into v_app_url
    from vault.decrypted_secrets s
   where s.name = 'qeoindex_app_url'
   limit 1;

  if nullif(btrim(v_app_url), '') is null then
    raise exception 'qeoindex_app_url is not configured in Supabase Vault';
  end if;

  select s.decrypted_secret
    into v_cron_secret
    from vault.decrypted_secrets s
   where s.name = 'qeoindex_cron_secret'
   limit 1;

  if nullif(btrim(v_cron_secret), '') is null then
    raise exception 'qeoindex_cron_secret is not configured in Supabase Vault';
  end if;

  select net.http_post(
    url := rtrim(v_app_url, '/') || '/api/research-reports/daily',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_cron_secret
    ),
    body := jsonb_build_object(
      'source', 'supabase_pg_cron',
      'job', 'research_reports.daily'
    ),
    timeout_milliseconds := 55000
  )
    into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.qeo_trigger_research_reports_daily()
from public, anon, authenticated;
grant execute on function public.qeo_trigger_research_reports_daily()
to service_role;

do $$
begin
  if exists (
    select 1
      from cron.job
     where jobname = 'research-reports-daily-0705-ict'
  ) then
    perform cron.unschedule('research-reports-daily-0705-ict');
  end if;
end $$;

select cron.schedule(
  'research-reports-daily-0705-ict',
  '5 0 * * *',
  $cron$
  select public.qeo_trigger_research_reports_daily();
  $cron$
);

commit;
