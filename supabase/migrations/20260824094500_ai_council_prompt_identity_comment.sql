begin;

comment on column public.ai_council_llm_research_contexts.prompt_identity_hash is
  'SHA-256 identity over deterministic evidence hash + raw LLM evidence hash + research context hash + prompt version. From llm-debate-v3-first-class-context onward runtime uses this identity for OpenAI prompt-cache routing when the prompt version matches; retries after a prompt bump recompute from the immutable component hashes.';

commit;
