begin;

-- The trigger function is internal database orchestration. It must not be exposed
-- through PostgREST RPC as a SECURITY DEFINER function.
revoke all on function public.qeo_prune_orderbook_after_universe_publish()
  from public, anon, authenticated;

grant execute on function public.qeo_prune_orderbook_after_universe_publish()
  to service_role;

commit;
