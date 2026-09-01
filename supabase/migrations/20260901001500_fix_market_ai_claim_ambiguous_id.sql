-- RETURNS TABLE exposes `id` as a PL/pgSQL output variable. Qualify update
-- predicates so PostgreSQL cannot confuse it with the table column.
do $$
declare
  v_definition text;
  v_fixed text;
begin
  select pg_get_functiondef(
    'public.claim_market_ai_conclusion(text,date,timestamp with time zone,text,text,text,text,jsonb)'::regprocedure
  ) into v_definition;
  v_fixed := replace(
    v_definition,
    'where id = v.id',
    'where market_ai_conclusions.id = v.id'
  );
  if v_fixed = v_definition then
    raise exception 'claim_market_ai_conclusion qualification target not found';
  end if;
  execute v_fixed;
end $$;
