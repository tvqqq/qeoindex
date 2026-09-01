-- Market-level AI is distinct from per-stock Council. snapshot_id is sha256(session_date, as_of, source).
create table if not exists public.market_ai_conclusions (
  id uuid primary key default gen_random_uuid(), snapshot_id text not null check (snapshot_id ~ '^[0-9a-f]{64}$'), session_date date not null, as_of timestamptz not null,
  schema_version text not null, policy_version text not null, prompt_version text not null, evidence_hash text not null check (evidence_hash ~ '^[0-9a-f]{64}$'),
  status text not null check (status = any (array['pending','running','succeeded','failed','insufficient_evidence']::text[])), posture text not null check (posture = any (array['constructive','constructive_with_caution','neutral','defensive','insufficient_evidence']::text[])),
  conclusion_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(conclusion_payload) = 'object'), evidence_manifest jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence_manifest) = 'object'),
  claim_token uuid, claimed_at timestamptz, lease_until timestamptz, lease_expires_at timestamptz, attempt_count integer not null default 0 check (attempt_count between 0 and 3), model text, input_tokens integer check (input_tokens is null or input_tokens >= 0), output_tokens integer check (output_tokens is null or output_tokens >= 0), estimated_cost_usd numeric check (estimated_cost_usd is null or estimated_cost_usd between 0 and 0.03), error_code text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), completed_at timestamptz,
  constraint market_ai_conclusions_identity unique (session_date, policy_version, prompt_version, evidence_hash)
);
create index if not exists market_ai_conclusions_latest_idx on public.market_ai_conclusions (session_date desc, created_at desc);
alter table public.market_ai_conclusions enable row level security;
revoke all on public.market_ai_conclusions from public, anon, authenticated;
comment on column public.market_ai_conclusions.snapshot_id is 'Deterministic published snapshot identity: sha256(session_date, as_of, source), never random.';

create or replace function public.claim_market_ai_conclusion(p_snapshot_id text,p_session_date date,p_as_of timestamptz,p_schema_version text,p_policy_version text,p_prompt_version text,p_evidence_hash text)
returns table (id uuid,claim_token uuid,status text,attempt_count integer) language plpgsql security definer set search_path=public as $$ declare v public.market_ai_conclusions%rowtype; begin
 if p_snapshot_id !~ '^[0-9a-f]{64}$' or p_evidence_hash !~ '^[0-9a-f]{64}$' or p_schema_version='' or p_policy_version='' or p_prompt_version='' then return; end if;
 select * into v from public.market_ai_conclusions where session_date=p_session_date and policy_version=p_policy_version and prompt_version=p_prompt_version and evidence_hash=p_evidence_hash for update;
 if found and (v.snapshot_id<>p_snapshot_id or v.as_of<>p_as_of or v.schema_version<>p_schema_version) then return; end if;
 if found and v.status in ('succeeded','insufficient_evidence') then return query select v.id,null::uuid,v.status,v.attempt_count; return; end if;
 if found and v.status='running' and v.lease_until>now() then return query select v.id,null::uuid,v.status,v.attempt_count; return; end if;
  if found then update public.market_ai_conclusions set status='running',claim_token=gen_random_uuid(),claimed_at=now(),lease_until=now()+interval '10 minutes',lease_expires_at=now()+interval '10 minutes',attempt_count=attempt_count+1,updated_at=now() where id=v.id and attempt_count < 3 returning * into v;
  else insert into public.market_ai_conclusions(snapshot_id,session_date,as_of,schema_version,policy_version,prompt_version,evidence_hash,status,posture,attempt_count,claim_token,claimed_at,lease_until,lease_expires_at) values(p_snapshot_id,p_session_date,p_as_of,p_schema_version,p_policy_version,p_prompt_version,p_evidence_hash,'running','insufficient_evidence',1,gen_random_uuid(),now(),now()+interval '10 minutes',now()+interval '10 minutes') returning * into v; end if;
 return query select v.id,v.claim_token,v.status,v.attempt_count; end $$;
revoke all on function public.claim_market_ai_conclusion(text,date,timestamptz,text,text,text,text) from public,anon,authenticated;
grant execute on function public.claim_market_ai_conclusion(text,date,timestamptz,text,text,text,text) to service_role;

create or replace function public.complete_market_ai_conclusion(p_id uuid,p_claim_token uuid,p_status text,p_posture text,p_payload jsonb,p_manifest jsonb,p_model text,p_input_tokens integer,p_output_tokens integer,p_cost numeric,p_error_code text)
returns boolean language plpgsql security definer set search_path=public as $$ begin
 if p_status not in ('succeeded','failed','insufficient_evidence') or p_posture not in ('constructive','constructive_with_caution','neutral','defensive','insufficient_evidence') or p_cost<0 or p_cost>0.03 then return false; end if;
 if p_payload is null or p_manifest is null or jsonb_typeof(p_payload) <> 'object' or jsonb_typeof(p_manifest) <> 'object' then return false; end if;
 if p_status='succeeded' and (p_posture='insufficient_evidence' or p_model is null or p_input_tokens is null or p_output_tokens is null or p_cost is null or p_cost > 0.03 or p_payload='{}'::jsonb) then return false; end if;
 if p_status='insufficient_evidence' and (p_posture <> 'insufficient_evidence' or p_model is not null or p_input_tokens is not null or p_output_tokens is not null or p_cost is not null or not (p_manifest ? 'missingEvidence')) then return false; end if;
 if p_status='failed' and (p_error_code is null or p_error_code='' or p_payload <> '{}'::jsonb or p_model is not null or p_input_tokens is not null or p_output_tokens is not null or p_cost is not null) then return false; end if;
 update public.market_ai_conclusions set status=p_status,posture=p_posture,conclusion_payload=p_payload,evidence_manifest=p_manifest,model=p_model,input_tokens=p_input_tokens,output_tokens=p_output_tokens,estimated_cost_usd=p_cost,error_code=p_error_code,completed_at=now(),lease_until=null,lease_expires_at=null,updated_at=now() where id=p_id and claim_token=p_claim_token and status='running'; return found; end $$;
revoke all on function public.complete_market_ai_conclusion(uuid,uuid,text,text,jsonb,jsonb,text,integer,integer,numeric,text) from public,anon,authenticated;
grant execute on function public.complete_market_ai_conclusion(uuid,uuid,text,text,jsonb,jsonb,text,integer,integer,numeric,text) to service_role;

create or replace function public.market_ai_conclusion_guard() returns trigger language plpgsql as $$ begin
  if TG_OP='UPDATE' then
    if OLD.session_date<>NEW.session_date or OLD.as_of<>NEW.as_of or OLD.snapshot_id<>NEW.snapshot_id or OLD.schema_version<>NEW.schema_version or OLD.policy_version<>NEW.policy_version or OLD.prompt_version<>NEW.prompt_version or OLD.evidence_hash<>NEW.evidence_hash or OLD.evidence_manifest<>NEW.evidence_manifest then raise exception 'market AI identity/evidence manifest is immutable'; end if;
    if OLD.status in ('succeeded','insufficient_evidence') then raise exception 'terminal market AI conclusion is immutable'; end if;
    if OLD.status='pending' and NEW.status<>'running' then raise exception 'pending must be claimed before completion'; end if;
    if OLD.status='running' and NEW.status not in ('running','succeeded','failed','insufficient_evidence') then raise exception 'invalid market AI transition'; end if;
  end if;
  return NEW;
end $$;
drop trigger if exists market_ai_conclusion_guard on public.market_ai_conclusions;
create trigger market_ai_conclusion_guard before update on public.market_ai_conclusions for each row execute function public.market_ai_conclusion_guard();
alter table public.market_ai_conclusions add constraint market_ai_pending_empty check (status <> 'pending' or (claim_token is null and model is null and input_tokens is null and output_tokens is null and estimated_cost_usd is null and conclusion_payload='{}'::jsonb));
alter table public.market_ai_conclusions add constraint market_ai_running_lease check (status <> 'running' or (claim_token is not null and lease_expires_at is not null));
alter table public.market_ai_conclusions add constraint market_ai_terminal_coherence check (status <> 'succeeded' or (posture <> 'insufficient_evidence' and model is not null and input_tokens is not null and output_tokens is not null and estimated_cost_usd is not null and completed_at is not null and conclusion_payload <> '{}'::jsonb));
alter table public.market_ai_conclusions add constraint market_ai_insufficient_coherence check (status <> 'insufficient_evidence' or (posture='insufficient_evidence' and model is null and input_tokens is null and output_tokens is null and estimated_cost_usd is null and completed_at is not null and evidence_manifest ? 'missingEvidence'));
alter table public.market_ai_conclusions add constraint market_ai_failed_coherence check (status <> 'failed' or (error_code is not null and error_code <> '' and conclusion_payload='{}'::jsonb and model is null and input_tokens is null and output_tokens is null and estimated_cost_usd is null and completed_at is not null));
