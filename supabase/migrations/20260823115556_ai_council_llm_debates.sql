create table if not exists public.ai_council_llm_debates (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null unique references public.ai_council_runs(id) on delete cascade,
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  as_of_date date not null,
  evidence_hash text not null check (evidence_hash ~ '^[0-9a-f]{64}$'),
  selection_reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(selection_reasons) = 'array'),
  status text not null default 'pending' check (status = any (array['pending','completed','partial','failed']::text[])),
  model text not null,
  prompt_version text not null,
  engine text not null,
  deterministic_signal text not null check (deterministic_signal = any (array['BUY','BUY_ON_CONFIRMATION','WAIT','REDUCE','SELL']::text[])),
  deterministic_score smallint not null check (deterministic_score between 0 and 100),
  deterministic_risk_status text not null check (deterministic_risk_status = any (array['approve','caution','veto']::text[])),
  bull_payload jsonb,
  bear_payload jsonb,
  risk_payload jsonb,
  chair_payload jsonb,
  call_audit jsonb not null default '[]'::jsonb check (jsonb_typeof(call_audit) = 'array'),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  total_tokens integer not null default 0 check (total_tokens >= 0),
  latency_ms integer not null default 0 check (latency_ms >= 0),
  error text not null default '',
  final_authority text not null default 'deterministic' check (final_authority = 'deterministic'),
  llm_advisory_only boolean not null default true check (llm_advisory_only = true),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.ai_council_llm_debates is 'P4 event-selected LLM Bull/Bear/Risk debates attached to immutable deterministic Council runs. LLM output is advisory-only and cannot overwrite the deterministic signal.';
comment on column public.ai_council_llm_debates.selection_reasons is 'Event gates such as signal_changed, high_disagreement, breakout_watch, risk_conflict, or explicit_watchlist.';
comment on column public.ai_council_llm_debates.call_audit is 'Per-role response identifiers, token usage, latency and bounded error metadata; no hidden chain-of-thought is persisted.';
comment on column public.ai_council_llm_debates.final_authority is 'Hard guardrail: deterministic QeoIndex policy remains final authority.';

create index if not exists ai_council_llm_debates_date_status_idx on public.ai_council_llm_debates (as_of_date desc, status);
create index if not exists ai_council_llm_debates_ticker_date_idx on public.ai_council_llm_debates (ticker, as_of_date desc, created_at desc);

alter table public.ai_council_llm_debates enable row level security;
revoke all on table public.ai_council_llm_debates from anon;
grant select on table public.ai_council_llm_debates to authenticated;

drop policy if exists ai_council_llm_debates_authenticated_read on public.ai_council_llm_debates;
create policy ai_council_llm_debates_authenticated_read
  on public.ai_council_llm_debates
  for select
  to authenticated
  using (true);
