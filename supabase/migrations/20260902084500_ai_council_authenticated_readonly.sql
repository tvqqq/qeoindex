begin;

-- AI Council data is produced by trusted server/service-role workflows.
-- Authenticated product users only need read access; make the grant boundary
-- match the existing SELECT-only RLS policies instead of relying on RLS alone
-- to reject writes.
revoke insert, update, delete, truncate, references, trigger on table
  public.ai_council_runs,
  public.ai_council_votes,
  public.ai_council_outcomes,
  public.ai_council_market_benchmarks,
  public.ai_council_confirmations,
  public.ai_council_agent_stats,
  public.ai_council_llm_debates,
  public.ai_council_llm_evidence,
  public.ai_council_llm_research_contexts
from authenticated;

grant select on table
  public.ai_council_runs,
  public.ai_council_votes,
  public.ai_council_outcomes,
  public.ai_council_market_benchmarks,
  public.ai_council_confirmations,
  public.ai_council_agent_stats,
  public.ai_council_llm_debates,
  public.ai_council_llm_evidence,
  public.ai_council_llm_research_contexts
to authenticated;

commit;
