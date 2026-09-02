begin;

-- ai_council_llm_debates is a strict one-to-one child of ai_council_runs.
-- Align it with the other one-to-one Council child tables by using run_id as
-- the primary key instead of carrying a second surrogate UUID plus a unique
-- index on run_id.
alter table public.ai_council_llm_debates
  drop constraint if exists ai_council_llm_debates_pkey,
  drop constraint if exists ai_council_llm_debates_run_id_key;

alter table public.ai_council_llm_debates
  drop column if exists id;

alter table public.ai_council_llm_debates
  add constraint ai_council_llm_debates_pkey primary key (run_id);

comment on table public.ai_council_llm_debates is
  'One advisory LLM debate per deterministic AI Council run. run_id is both identity and cascade FK to ai_council_runs.';

commit;
