begin;

comment on column public.ai_council_llm_research_contexts.prompt_identity_hash is
  'SHA-256 identity over deterministic evidence hash + raw LLM evidence hash + research context hash + prompt version. From llm-debate-v3-first-class-context onward this identity is the OpenAI prompt-cache routing key and audit identity.';

commit;
