-- An ambiguous provider response is terminal manual-review state; it must not
-- be converted into a retryable failure after the model-start marker exists.
create or replace function public.mark_market_ai_completion_unknown(p_id uuid, p_claim_token uuid, p_error_code text default 'MODEL_COMPLETION_UNKNOWN')
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_error_code is null or p_error_code !~ '^[A-Z][A-Z0-9_]{1,80}$' then return false; end if;
  update public.market_ai_conclusions set status = 'completion_unknown', posture = 'insufficient_evidence',
    conclusion_payload = '{}'::jsonb, error_code = 'MODEL_COMPLETION_UNKNOWN', completed_at = now(),
    lease_expires_at = null, updated_at = now()
  where id = p_id and claim_token = p_claim_token and status = 'running' and model_started_at is not null;
  return found;
end $$;
revoke all on function public.mark_market_ai_completion_unknown(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.mark_market_ai_completion_unknown(uuid,uuid,text) to service_role;
