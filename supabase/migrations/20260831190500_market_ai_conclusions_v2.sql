-- Phase 2 corrective state machine. The finalized manifest is claimed once and
-- is immutable for the lifetime of an identity.
alter table public.market_ai_conclusions
  add column if not exists model_started_at timestamptz;

alter table public.market_ai_conclusions drop constraint if exists market_ai_conclusions_status_check;
alter table public.market_ai_conclusions drop constraint if exists market_ai_pending_empty;
alter table public.market_ai_conclusions drop constraint if exists market_ai_running_lease;
alter table public.market_ai_conclusions drop constraint if exists market_ai_terminal_coherence;
alter table public.market_ai_conclusions drop constraint if exists market_ai_insufficient_coherence;
alter table public.market_ai_conclusions drop constraint if exists market_ai_failed_coherence;
alter table public.market_ai_conclusions add constraint market_ai_conclusions_status_check check (status = any (array['pending','running','succeeded','failed','insufficient_evidence','completion_unknown']::text[]));

drop function if exists public.claim_market_ai_conclusion(text,date,timestamptz,text,text,text,text);
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

  -- Insert-on-conflict closes the first-claim race; the row is then locked for
  -- every decision below. No caller may replace the finalized manifest.
  insert into public.market_ai_conclusions(
    snapshot_id, session_date, as_of, schema_version, policy_version,
    prompt_version, evidence_hash, status, posture, attempt_count,
    claim_token, claimed_at, lease_expires_at, evidence_manifest
  ) values (
    p_snapshot_id, p_session_date, p_as_of, p_schema_version, p_policy_version,
    p_prompt_version, p_evidence_hash, 'running', 'insufficient_evidence', 1,
    gen_random_uuid(), now(), now() + interval '10 minutes', p_evidence_manifest
  ) on conflict (session_date, policy_version, prompt_version, evidence_hash) do nothing;

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

create or replace function public.start_market_ai_conclusion_model(p_id uuid, p_claim_token uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.market_ai_conclusions set model_started_at = now(), updated_at = now()
  where id = p_id and claim_token = p_claim_token and status = 'running' and model_started_at is null;
  return found;
end $$;
revoke all on function public.start_market_ai_conclusion_model(uuid,uuid) from public, anon, authenticated;
grant execute on function public.start_market_ai_conclusion_model(uuid,uuid) to service_role;

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
    completed_at = now(), lease_expires_at = null, lease_until = null, updated_at = now()
  where id = p_id and claim_token = p_claim_token and status = 'running';
  return found;
end $$;
revoke all on function public.complete_market_ai_conclusion(uuid,uuid,text,text,jsonb,jsonb,text,integer,integer,numeric,text) from public, anon, authenticated;
grant execute on function public.complete_market_ai_conclusion(uuid,uuid,text,text,jsonb,jsonb,text,integer,integer,numeric,text) to service_role;

create or replace function public.market_ai_conclusion_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if TG_OP = 'UPDATE' then
    if OLD.session_date <> NEW.session_date or OLD.as_of <> NEW.as_of or OLD.snapshot_id <> NEW.snapshot_id
      or OLD.schema_version <> NEW.schema_version or OLD.policy_version <> NEW.policy_version
      or OLD.prompt_version <> NEW.prompt_version or OLD.evidence_hash <> NEW.evidence_hash
      or OLD.evidence_manifest <> NEW.evidence_manifest then raise exception 'market AI identity/evidence manifest is immutable'; end if;
    if OLD.status in ('succeeded','insufficient_evidence','completion_unknown') then raise exception 'terminal market AI conclusion is immutable'; end if;
    if OLD.status = 'pending' and NEW.status <> 'running' then raise exception 'pending must be claimed before completion'; end if;
    if OLD.status = 'running' and NEW.status not in ('running','succeeded','failed','insufficient_evidence','completion_unknown') then raise exception 'invalid market AI transition'; end if;
  end if;
  return NEW;
end $$;
drop trigger if exists market_ai_conclusion_guard on public.market_ai_conclusions;
create trigger market_ai_conclusion_guard before update on public.market_ai_conclusions for each row execute function public.market_ai_conclusion_guard();
alter table public.market_ai_conclusions add constraint market_ai_pending_empty check (status <> 'pending' or (claim_token is null and model is null and input_tokens is null and output_tokens is null and estimated_cost_usd is null and conclusion_payload = '{}'::jsonb));
alter table public.market_ai_conclusions add constraint market_ai_running_lease check (status <> 'running' or (claim_token is not null and lease_expires_at is not null));
alter table public.market_ai_conclusions add constraint market_ai_terminal_coherence check (status <> 'succeeded' or (posture <> 'insufficient_evidence' and model is not null and model_started_at is not null and input_tokens is not null and output_tokens is not null and estimated_cost_usd is not null and completed_at is not null and conclusion_payload <> '{}'::jsonb));
alter table public.market_ai_conclusions add constraint market_ai_insufficient_coherence check (status <> 'insufficient_evidence' or (posture = 'insufficient_evidence' and model is null and input_tokens is null and output_tokens is null and estimated_cost_usd is null and completed_at is not null and evidence_manifest ? 'missingEvidence'));
alter table public.market_ai_conclusions add constraint market_ai_unknown_coherence check (status <> 'completion_unknown' or (posture = 'insufficient_evidence' and error_code = 'MODEL_COMPLETION_UNKNOWN' and completed_at is not null and conclusion_payload = '{}'::jsonb));
alter table public.market_ai_conclusions add constraint market_ai_failed_coherence check (status <> 'failed' or (error_code is not null and error_code <> '' and conclusion_payload = '{}'::jsonb and model is null and input_tokens is null and output_tokens is null and estimated_cost_usd is null and completed_at is not null));

-- Manual/service-role dispatch only. No cron or EOD workflow invokes this RPC.
create or replace function public.dispatch_market_ai_conclusion(p_mode text, p_session_date date default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_secret text; v_url text; v_request bigint;
begin
  if p_mode not in ('latest','session') or (p_mode = 'session' and p_session_date is null) then raise exception 'invalid market AI dispatch'; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'market_ai_conclusion_secret' limit 1;
  v_url := current_setting('app.settings.supabase_url', true);
  if coalesce(v_secret, '') = '' or coalesce(v_url, '') = '' then raise exception 'market AI dispatch is not configured'; end if;
  select net.http_post(url := v_url || '/functions/v1/market-ai-conclusion', headers := jsonb_build_object('Content-Type','application/json','x-market-ai-secret',v_secret), body := jsonb_build_object('mode',p_mode) || case when p_mode = 'session' then jsonb_build_object('sessionDate',p_session_date) else '{}'::jsonb end, timeout_milliseconds := 5000) into v_request;
  return v_request;
end $$;
revoke all on function public.dispatch_market_ai_conclusion(text,date) from public, anon, authenticated;
grant execute on function public.dispatch_market_ai_conclusion(text,date) to service_role;
alter function public.market_ai_conclusion_guard() set search_path = public;
