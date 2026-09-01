-- Return the freshly inserted row to its owner. The previous implementation
-- mistook that row's own live lease for a concurrent worker.
update public.market_ai_conclusions
set lease_expires_at = now(), lease_until = null, updated_at = now()
where status = 'running' and model_started_at is null;

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
        lease_until = null, updated_at = now() where id = v.id returning * into v;
      return query select v.id, null::uuid, v.status, v.attempt_count; return;
    end if;
    return query select v.id, null::uuid, v.status, v.attempt_count; return;
  end if;
  if v.status = 'running' and v.lease_expires_at is not null and v.lease_expires_at > now() then
    return query select v.id, null::uuid, v.status, v.attempt_count; return;
  end if;
  if v.attempt_count >= 3 then return query select v.id, null::uuid, v.status, v.attempt_count; return; end if;

  update public.market_ai_conclusions set status = 'running', claim_token = gen_random_uuid(),
    claimed_at = now(), lease_expires_at = now() + interval '10 minutes', lease_until = null,
    attempt_count = v.attempt_count + 1, error_code = null, completed_at = null,
    updated_at = now() where id = v.id returning * into v;
  return query select v.id, v.claim_token, v.status, v.attempt_count;
end $$;

revoke all on function public.claim_market_ai_conclusion(text,date,timestamptz,text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.claim_market_ai_conclusion(text,date,timestamptz,text,text,text,text,jsonb) to service_role;
