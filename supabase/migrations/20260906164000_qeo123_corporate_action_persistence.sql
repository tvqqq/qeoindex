begin;

create or replace function public.persist_corporate_action_notice(
  p_evidence jsonb,
  p_actions jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_evidence_id uuid;
  v_action jsonb;
  v_action_id uuid;
  v_source text;
  v_source_event_id text;
  v_source_url text;
  v_ticker text;
  v_raw_evidence_hash text;
  v_source_published_at timestamptz;
  v_source_updated_at timestamptz;
  v_action_count integer := 0;
  v_applied_count integer := 0;
  v_stale_count integer := 0;
begin
  if jsonb_typeof(p_evidence) <> 'object' then
    raise exception 'corporate-action evidence must be a JSON object';
  end if;
  if jsonb_typeof(p_actions) <> 'array' or jsonb_array_length(p_actions) = 0 then
    raise exception 'corporate-action actions must be a non-empty JSON array';
  end if;
  if not (p_evidence ? 'raw_payload') then
    raise exception 'corporate-action evidence is missing raw_payload';
  end if;

  v_source := p_evidence ->> 'source';
  v_source_event_id := p_evidence ->> 'source_event_id';
  v_source_url := p_evidence ->> 'source_url';
  v_ticker := nullif(p_evidence ->> 'ticker', '');
  v_raw_evidence_hash := p_evidence ->> 'raw_evidence_hash';
  v_source_published_at := nullif(p_evidence ->> 'source_published_at', '')::timestamptz;
  v_source_updated_at := nullif(p_evidence ->> 'source_updated_at', '')::timestamptz;

  if v_source is null or v_source_event_id is null or v_source_url is null or v_raw_evidence_hash is null then
    raise exception 'corporate-action evidence is missing required source identity';
  end if;

  insert into public.corporate_action_source_evidence (
    source,
    source_event_id,
    source_url,
    ticker,
    raw_payload,
    raw_evidence_hash,
    source_published_at,
    source_updated_at,
    amendment_type,
    referenced_notice_number,
    referenced_notice_date,
    referenced_source_event_id
  ) values (
    v_source,
    v_source_event_id,
    v_source_url,
    v_ticker,
    p_evidence -> 'raw_payload',
    v_raw_evidence_hash,
    v_source_published_at,
    v_source_updated_at,
    nullif(p_evidence ->> 'amendment_type', ''),
    nullif(p_evidence ->> 'referenced_notice_number', ''),
    nullif(p_evidence ->> 'referenced_notice_date', '')::date,
    nullif(p_evidence ->> 'referenced_source_event_id', '')
  )
  on conflict (source, source_event_id, raw_evidence_hash) do nothing
  returning id into v_evidence_id;

  if v_evidence_id is null then
    select evidence.id
      into v_evidence_id
      from public.corporate_action_source_evidence as evidence
      where evidence.source = v_source
        and evidence.source_event_id = v_source_event_id
        and evidence.raw_evidence_hash = v_raw_evidence_hash;
  end if;

  if v_evidence_id is null then
    raise exception 'corporate-action evidence identity could not be resolved';
  end if;

  for v_action in
    select value from jsonb_array_elements(p_actions)
  loop
    v_action_count := v_action_count + 1;

    if jsonb_typeof(v_action) <> 'object' then
      raise exception 'corporate-action component % is not a JSON object', v_action_count - 1;
    end if;
    if nullif(v_action ->> 'record_date', '') is null then
      raise exception 'corporate-action component % is missing record_date', v_action_count - 1;
    end if;
    if nullif(v_action ->> 'lineage_root_source_event_id', '') is null
      or nullif(v_action ->> 'source_component_key', '') is null then
      raise exception 'corporate-action component % is missing canonical identity', v_action_count - 1;
    end if;

    if v_action ->> 'source' is distinct from v_source
      or v_action ->> 'source_event_id' is distinct from v_source_event_id
      or v_action ->> 'source_url' is distinct from v_source_url
      or v_action ->> 'raw_evidence_hash' is distinct from v_raw_evidence_hash then
      raise exception 'corporate-action component % does not match evidence identity', v_action_count - 1;
    end if;

    if v_ticker is not null and upper(v_action ->> 'ticker') is distinct from v_ticker then
      raise exception 'corporate-action component % ticker does not match evidence ticker', v_action_count - 1;
    end if;

    if nullif(v_action ->> 'source_updated_at', '')::timestamptz is distinct from v_source_updated_at
      or nullif(v_action ->> 'source_published_at', '')::timestamptz is distinct from v_source_published_at then
      raise exception 'corporate-action component % source timestamps do not match evidence', v_action_count - 1;
    end if;

    v_action_id := null;

    insert into public.corporate_actions (
      ticker,
      isin,
      exchange,
      action_type,
      status,
      record_date,
      ex_date,
      ex_date_basis,
      ex_date_derivation_method,
      trading_calendar_version,
      payment_date,
      effective_date,
      cash_per_share,
      stock_ratio_numerator,
      stock_ratio_denominator,
      rights_ratio_numerator,
      rights_ratio_denominator,
      subscription_price,
      source,
      source_event_id,
      lineage_root_source_event_id,
      source_component_key,
      source_url,
      raw_evidence_hash,
      source_evidence_id,
      source_published_at,
      source_updated_at,
      verified_at,
      normalization_version,
      updated_at
    ) values (
      upper(v_action ->> 'ticker'),
      nullif(v_action ->> 'isin', ''),
      upper(v_action ->> 'exchange'),
      v_action ->> 'action_type',
      coalesce(nullif(v_action ->> 'status', ''), 'active'),
      nullif(v_action ->> 'record_date', '')::date,
      nullif(v_action ->> 'ex_date', '')::date,
      coalesce(nullif(v_action ->> 'ex_date_basis', ''), 'unknown'),
      nullif(v_action ->> 'ex_date_derivation_method', ''),
      nullif(v_action ->> 'trading_calendar_version', ''),
      nullif(v_action ->> 'payment_date', '')::date,
      nullif(v_action ->> 'effective_date', '')::date,
      nullif(v_action ->> 'cash_per_share', '')::numeric,
      nullif(v_action ->> 'stock_ratio_numerator', '')::numeric,
      nullif(v_action ->> 'stock_ratio_denominator', '')::numeric,
      nullif(v_action ->> 'rights_ratio_numerator', '')::numeric,
      nullif(v_action ->> 'rights_ratio_denominator', '')::numeric,
      nullif(v_action ->> 'subscription_price', '')::numeric,
      v_source,
      v_source_event_id,
      v_action ->> 'lineage_root_source_event_id',
      v_action ->> 'source_component_key',
      v_source_url,
      v_raw_evidence_hash,
      v_evidence_id,
      v_source_published_at,
      v_source_updated_at,
      now(),
      v_action ->> 'normalization_version',
      now()
    )
    on conflict (source, lineage_root_source_event_id, source_component_key)
    do update set
      ticker = excluded.ticker,
      isin = excluded.isin,
      exchange = excluded.exchange,
      action_type = excluded.action_type,
      status = excluded.status,
      record_date = excluded.record_date,
      ex_date = excluded.ex_date,
      ex_date_basis = excluded.ex_date_basis,
      ex_date_derivation_method = excluded.ex_date_derivation_method,
      trading_calendar_version = excluded.trading_calendar_version,
      payment_date = excluded.payment_date,
      effective_date = excluded.effective_date,
      cash_per_share = excluded.cash_per_share,
      stock_ratio_numerator = excluded.stock_ratio_numerator,
      stock_ratio_denominator = excluded.stock_ratio_denominator,
      rights_ratio_numerator = excluded.rights_ratio_numerator,
      rights_ratio_denominator = excluded.rights_ratio_denominator,
      subscription_price = excluded.subscription_price,
      source_event_id = excluded.source_event_id,
      source_url = excluded.source_url,
      raw_evidence_hash = excluded.raw_evidence_hash,
      source_evidence_id = excluded.source_evidence_id,
      source_published_at = excluded.source_published_at,
      source_updated_at = excluded.source_updated_at,
      verified_at = excluded.verified_at,
      normalization_version = excluded.normalization_version,
      updated_at = now()
    where
      (
        excluded.source_updated_at is not null
        and (
          public.corporate_actions.source_updated_at is null
          or excluded.source_updated_at > public.corporate_actions.source_updated_at
          or (
            excluded.source_updated_at = public.corporate_actions.source_updated_at
            and excluded.source_event_id = public.corporate_actions.source_event_id
          )
        )
      )
      or (
        excluded.source_updated_at is null
        and public.corporate_actions.source_updated_at is null
        and excluded.source_event_id = public.corporate_actions.source_event_id
      )
    returning id into v_action_id;

    if v_action_id is null then
      v_stale_count := v_stale_count + 1;
    else
      v_applied_count := v_applied_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'evidence_id', v_evidence_id,
    'action_count', v_action_count,
    'applied_count', v_applied_count,
    'stale_count', v_stale_count
  );
end
$$;

revoke all on function public.persist_corporate_action_notice(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.persist_corporate_action_notice(jsonb, jsonb) to service_role;

comment on function public.persist_corporate_action_notice(jsonb, jsonb) is
  'QEO-123 atomic persistence boundary: append immutable source evidence and idempotently upsert canonical components without allowing stale source timestamps to roll canonical state backward.';

commit;
