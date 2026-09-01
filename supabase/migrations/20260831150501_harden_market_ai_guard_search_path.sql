-- Keep clean replays safe when the corrective Phase 2 migration has not yet
-- created the trigger function. The later Phase 2 v2 migration reapplies this
-- setting after recreating the function.
do $$
begin
  if to_regprocedure('public.market_ai_conclusion_guard()') is not null then
    alter function public.market_ai_conclusion_guard() set search_path = public;
  end if;
end;
$$;
