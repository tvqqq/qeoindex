begin;

-- QEO-20 portfolio compatibility backfill. Canonical level-1 values win when
-- already present; legacy values are copied only into missing canonical slots.
update public.portfolio_transactions
set target_price_1 = target_price
where target_price_1 is null
  and target_price is not null;

update public.portfolio_transactions
set stop_loss_1 = stop_loss
where stop_loss_1 is null
  and stop_loss is not null;

-- QEO-20 market-AI lease compatibility backfill. `lease_expires_at` is the
-- canonical lease clock; only fill it from the legacy column when absent.
update public.market_ai_conclusions
set lease_expires_at = lease_until
where lease_expires_at is null
  and lease_until is not null;

-- Fail closed rather than silently discard divergent compatibility data.
do $$
begin
  if exists (
    select 1
    from public.portfolio_transactions
    where target_price is not null
      and target_price_1 is distinct from target_price
  ) then
    raise exception 'QEO-20 target_price parity check failed';
  end if;

  if exists (
    select 1
    from public.portfolio_transactions
    where stop_loss is not null
      and stop_loss_1 is distinct from stop_loss
  ) then
    raise exception 'QEO-20 stop_loss parity check failed';
  end if;

  if exists (
    select 1
    from public.market_ai_conclusions
    where lease_until is not null
      and lease_expires_at is distinct from lease_until
  ) then
    raise exception 'QEO-20 lease parity check failed';
  end if;
end;
$$;

-- Preserve the latest first-claim ownership and ambiguity fixes while removing
-- every active dependency on the legacy lease column.
create or replace function public.claim_market_ai_conclusion(
  p_snapshot_id text, p_session_date date, p_as_of timestamptz,
  p_schema_version text, p_policy_version text, p_prompt_version text,
  p_evidence_hash text, p_evidence_manifest jsonb
) returns table (id uuid, claim_token uuid, status text, attempt_count integer)
language plpgsql security definer set search_path = public as $$
declare v public.market_ai_conclusions%rowtype;
begin
  if p_snapshot_id !~ '^[0-9a-f]{64}$' or p_evidence_hash !~ '^[0-9a-f]{64}$'
    or p_schema_version = '' or p_policy_version = '' or p_prompt_version = ''
    or p_evidence_manifest is null or jsonb_typeof(p_evidence_manifest) <> 'object' then return; end if;

  insert into public.market_ai_conclusions(
    snapshot_id, session_date, as_of, schema_version, policy_version,
    prompt_version, evidence_hash, status, posture, attempt_count,
    claim_token, claimed_at, lease_expires_at, evidence_manifest
  ) values (
    p_snapshot_id, p_session_date, p_as_of, p_schema_version, p_policy_version,
    p_prompt_version, p_evidence_hash, 'running', 'insufficient_evidence', 1,
    gen_random_uuid(), now(), now() + interval '10 minutes', p_evidence_manifest
  ) on conflict (session_date, policy_version, prompt_version, evidence_hash) do nothing
  returning * into v;

  if found then
    return query select v.id, v.claim_token, v.status, v.attempt_count;
    return;
  end if;

  select * into v from public.market_ai_conclusions
  where session_date = p_session_date and policy_version = p_policy_version
    and prompt_version = p_prompt_version and evidence_hash = p_evidence_hash
  for update;
  if not found then return; end if;
  if v.snapshot_id <> p_snapshot_id or v.as_of <> p_as_of
    or v.schema_version <> p_schema_version or v.evidence_manifest <> p_evidence_manifest then return; end if;
  if v.status in ('succeeded','insufficient_evidence','completion_unknown') then
    return query select v.id, null::uuid, v.status, v.attempt_count; return;
  end if;
  if v.status = 'running' and v.model_started_at is not null then
    if v.lease_expires_at is null or v.lease_expires_at <= now() then
      update public.market_ai_conclusions set status = 'completion_unknown', posture = 'insufficient_evidence',
        error_code = 'MODEL_COMPLETION_UNKNOWN', completed_at = now(), lease_expires_at = null,
        updated_at = now() where market_ai_conclusions.id = v.id returning * into v;
      return query select v.id, null::uuid, v.status, v.attempt_count; return;
    end if;
    return query select v.id, null::uuid, v.status, v.attempt_count; return;
  end if;
  if v.status = 'running' and v.lease_expires_at is not null and v.lease_expires_at > now() then
    return query select v.id, null::uuid, v.status, v.attempt_count; return;
  end if;
  if v.attempt_count >= 3 then return query select v.id, null::uuid, v.status, v.attempt_count; return; end if;

  update public.market_ai_conclusions set status = 'running', claim_token = gen_random_uuid(),
    claimed_at = now(), lease_expires_at = now() + interval '10 minutes',
    attempt_count = v.attempt_count + 1, error_code = null, completed_at = null,
    updated_at = now() where market_ai_conclusions.id = v.id returning * into v;
  return query select v.id, v.claim_token, v.status, v.attempt_count;
end $$;

revoke all on function public.claim_market_ai_conclusion(text,date,timestamptz,text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.claim_market_ai_conclusion(text,date,timestamptz,text,text,text,text,jsonb) to service_role;

create or replace function public.complete_market_ai_conclusion(
  p_id uuid, p_claim_token uuid, p_status text, p_posture text, p_payload jsonb,
  p_manifest jsonb, p_model text, p_input_tokens integer, p_output_tokens integer,
  p_cost numeric, p_error_code text
) returns boolean language plpgsql security definer set search_path = public as $$
declare v_manifest jsonb;
begin
  if p_status not in ('succeeded','failed','insufficient_evidence') or p_posture not in ('constructive','constructive_with_caution','neutral','defensive','insufficient_evidence') then return false; end if;
  if p_payload is null or p_manifest is null or jsonb_typeof(p_payload) <> 'object' or jsonb_typeof(p_manifest) <> 'object' then return false; end if;
  select evidence_manifest into v_manifest from public.market_ai_conclusions where id = p_id and claim_token = p_claim_token and status = 'running' for update;
  if not found or v_manifest <> p_manifest then return false; end if;
  if p_status = 'succeeded' and (p_posture = 'insufficient_evidence' or p_model is null or p_input_tokens is null or p_output_tokens is null or p_cost is null or p_cost < 0 or p_cost > 0.03 or p_payload = '{}'::jsonb) then return false; end if;
  if p_status = 'insufficient_evidence' and (p_posture <> 'insufficient_evidence' or p_model is not null or p_input_tokens is not null or p_output_tokens is not null or p_cost is not null or not (p_manifest ? 'missingEvidence')) then return false; end if;
  if p_status = 'failed' and (p_error_code is null or p_error_code = '' or p_payload <> '{}'::jsonb or p_model is not null or p_input_tokens is not null or p_output_tokens is not null or p_cost is not null) then return false; end if;
  update public.market_ai_conclusions set status = p_status, posture = p_posture,
    conclusion_payload = p_payload, model = p_model, input_tokens = p_input_tokens,
    output_tokens = p_output_tokens, estimated_cost_usd = p_cost, error_code = p_error_code,
    completed_at = now(), lease_expires_at = null, updated_at = now()
  where id = p_id and claim_token = p_claim_token and status = 'running';
  return found;
end $$;

revoke all on function public.complete_market_ai_conclusion(uuid,uuid,text,text,jsonb,jsonb,text,integer,integer,numeric,text) from public, anon, authenticated;
grant execute on function public.complete_market_ai_conclusion(uuid,uuid,text,text,jsonb,jsonb,text,integer,integer,numeric,text) to service_role;

alter table public.portfolio_transactions
  drop column if exists target_price,
  drop column if exists stop_loss;

alter table public.market_ai_conclusions
  drop column if exists lease_until;

commit;
