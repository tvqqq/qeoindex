alter table public.ai_council_llm_debates
  add column if not exists model_route jsonb not null default '{}'::jsonb check (jsonb_typeof(model_route) = 'object'),
  add column if not exists cached_input_tokens integer not null default 0 check (cached_input_tokens >= 0),
  add column if not exists reasoning_tokens integer not null default 0 check (reasoning_tokens >= 0),
  add column if not exists estimated_cost_usd numeric(12,6),
  add column if not exists pricing_version text not null default 'openai-standard-2026-08-23',
  add column if not exists escalated boolean not null default false,
  add column if not exists escalation_reason text not null default '',
  add column if not exists fallback_used boolean not null default false;

comment on column public.ai_council_llm_debates.model_route is 'Role-based OpenAI model and reasoning-effort routing used for this debate.';
comment on column public.ai_council_llm_debates.cached_input_tokens is 'OpenAI input tokens served from prompt cache across all successful calls.';
comment on column public.ai_council_llm_debates.reasoning_tokens is 'OpenAI reasoning-token usage across all successful calls.';
comment on column public.ai_council_llm_debates.estimated_cost_usd is 'Approximate list-price inference cost derived from reported input/cached/output tokens; billing promotions and cache-write charges may differ.';
comment on column public.ai_council_llm_debates.escalated is 'True when the severe-conflict gate attempted a Sol Chair escalation.';
comment on column public.ai_council_llm_debates.fallback_used is 'True when any role used the configured fallback model after a recoverable primary-model failure.';
