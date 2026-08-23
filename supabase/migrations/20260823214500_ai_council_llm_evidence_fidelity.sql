begin;

create table if not exists public.ai_council_llm_evidence (
  run_id uuid primary key references public.ai_council_runs(id) on delete cascade,
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  rating_date date not null,
  context_version text not null,
  context_hash text not null check (context_hash ~ '^[0-9a-f]{64}$'),
  context_payload jsonb not null check (jsonb_typeof(context_payload) = 'object'),
  source_limitations jsonb not null default '[]'::jsonb check (jsonb_typeof(source_limitations) = 'array'),
  captured_at timestamptz not null default now()
);

comment on table public.ai_council_llm_evidence is
  'Immutable P4.3 evidence-fidelity snapshots used by advisory LLM debates. Contains raw/current KFSP metrics, bounded quarterly TTAI history, and raw Wyckoff MTF evidence; no hidden chain-of-thought.';
comment on column public.ai_council_llm_evidence.context_hash is
  'SHA-256 of the canonical frozen LLM evidence context. Separate from ai_council_runs.evidence_hash because these fields are advisory and do not change deterministic scoring.';
comment on column public.ai_council_llm_evidence.context_payload is
  'Frozen point-in-time-ish provider context captured for the run. Upstream TTAI history can later revise, but the saved context for this run is never updated.';

create index if not exists ai_council_llm_evidence_ticker_date_idx
  on public.ai_council_llm_evidence(ticker, rating_date desc, captured_at desc);
create index if not exists ai_council_llm_evidence_context_hash_idx
  on public.ai_council_llm_evidence(context_hash);

alter table public.ai_council_llm_evidence enable row level security;
revoke all on table public.ai_council_llm_evidence from anon;
grant select on table public.ai_council_llm_evidence to authenticated;
grant all privileges on table public.ai_council_llm_evidence to service_role;

drop policy if exists ai_council_llm_evidence_authenticated_read on public.ai_council_llm_evidence;
create policy ai_council_llm_evidence_authenticated_read
  on public.ai_council_llm_evidence
  for select
  to authenticated
  using (true);

create or replace function public.qeo_reject_ai_council_llm_evidence_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'ai_council_llm_evidence rows are immutable';
end;
$$;

revoke all on function public.qeo_reject_ai_council_llm_evidence_update() from public, anon, authenticated;

drop trigger if exists ai_council_llm_evidence_no_update on public.ai_council_llm_evidence;
create trigger ai_council_llm_evidence_no_update
before update on public.ai_council_llm_evidence
for each row execute function public.qeo_reject_ai_council_llm_evidence_update();

commit;
