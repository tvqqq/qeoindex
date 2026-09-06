create or replace function public.qeo_hydrate_research_report_chunks(
  p_report_id uuid,
  p_content_hash text,
  p_chunk_version text,
  p_chunk_ids uuid[]
)
returns table (
  id uuid,
  report_id uuid,
  content_hash text,
  chunk_version text,
  page_number integer,
  chunk_index integer,
  content text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.id,
    c.report_id,
    c.content_hash,
    c.chunk_version,
    c.page_number,
    c.chunk_index,
    c.content
  from public.market_research_report_chunks c
  where c.report_id = p_report_id
    and c.content_hash = p_content_hash
    and c.chunk_version = p_chunk_version
    and cardinality(p_chunk_ids) between 1 and 8
    and c.id = any(p_chunk_ids)
  order by array_position(p_chunk_ids, c.id)
  limit 8;
$$;

revoke all on function public.qeo_hydrate_research_report_chunks(uuid, text, text, uuid[])
from public, anon, authenticated;

grant execute on function public.qeo_hydrate_research_report_chunks(uuid, text, text, uuid[])
to service_role;
