begin;

create table if not exists public.ai_council_llm_research_contexts (
  run_id uuid primary key references public.ai_council_runs(id) on delete cascade,
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  as_of_date date not null,
  context_version text not null,
  context_hash text not null check (context_hash ~ '^[0-9a-f]{64}$'),
  raw_context_hash text not null check (raw_context_hash ~ '^[0-9a-f]{64}$'),
  prompt_identity_hash text not null check (prompt_identity_hash ~ '^[0-9a-f]{64}$'),
  mode text not null,
  status text not null check (status in ('ready', 'skipped', 'unavailable')),
  context_payload jsonb not null check (jsonb_typeof(context_payload) = 'object'),
  source_page_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(source_page_ids) = 'array'),
  source_last_edited jsonb not null default '{}'::jsonb check (jsonb_typeof(source_last_edited) = 'object'),
  captured_at timestamptz not null default now()
);

comment on table public.ai_council_llm_research_contexts is
  'Immutable curated Notion research context captured for advisory AI Council debates. Raw PDFs remain canonical in Google Drive; this table freezes the exact Notion digest/thesis context used for a Council run.';
comment on column public.ai_council_llm_research_contexts.prompt_identity_hash is
  'SHA-256 identity over deterministic evidence hash + raw LLM evidence hash + research context hash + prompt version. It is audit metadata in P4.3 pre-market rollout; prompt-cache routing remains unchanged until the first-class packet follow-up.';
comment on column public.ai_council_llm_research_contexts.context_payload is
  'Bounded Stock Thesis + eligible Research Sources snapshot. Broker forecasts and target prices remain source opinions and are never promoted to verified company facts.';

create index if not exists ai_council_llm_research_contexts_ticker_date_idx
  on public.ai_council_llm_research_contexts(ticker, as_of_date desc, captured_at desc);
create index if not exists ai_council_llm_research_contexts_prompt_identity_idx
  on public.ai_council_llm_research_contexts(prompt_identity_hash);

alter table public.ai_council_llm_research_contexts enable row level security;
revoke all on table public.ai_council_llm_research_contexts from anon;
grant select on table public.ai_council_llm_research_contexts to authenticated;
grant all privileges on table public.ai_council_llm_research_contexts to service_role;

drop policy if exists ai_council_llm_research_contexts_authenticated_read
  on public.ai_council_llm_research_contexts;
create policy ai_council_llm_research_contexts_authenticated_read
  on public.ai_council_llm_research_contexts
  for select
  to authenticated
  using (true);

create or replace function public.qeo_reject_ai_council_llm_research_context_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'ai_council_llm_research_contexts rows are immutable';
end;
$$;

revoke all on function public.qeo_reject_ai_council_llm_research_context_update()
  from public, anon, authenticated;

drop trigger if exists ai_council_llm_research_contexts_no_update
  on public.ai_council_llm_research_contexts;
create trigger ai_council_llm_research_contexts_no_update
before update on public.ai_council_llm_research_contexts
for each row execute function public.qeo_reject_ai_council_llm_research_context_update();

commit;
