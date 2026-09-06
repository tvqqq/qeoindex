begin;

create table public.corporate_action_source_evidence (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_event_id text not null,
  source_url text not null,
  ticker text,
  raw_payload jsonb not null,
  raw_evidence_hash text not null,
  source_published_at timestamptz,
  source_updated_at timestamptz,
  fetched_at timestamptz not null default now(),
  amendment_type text,
  referenced_notice_number text,
  referenced_notice_date date,
  referenced_source_event_id text,
  created_at timestamptz not null default now(),
  constraint corporate_action_source_evidence_source_check
    check (source = lower(source) and source ~ '^[a-z0-9][a-z0-9_-]{1,31}$'),
  constraint corporate_action_source_evidence_event_check
    check (btrim(source_event_id) <> ''),
  constraint corporate_action_source_evidence_url_check
    check (source_url ~ '^https://'),
  constraint corporate_action_source_evidence_ticker_check
    check (ticker is null or ticker ~ '^[A-Z0-9]{2,12}$'),
  constraint corporate_action_source_evidence_hash_check
    check (raw_evidence_hash ~ '^[a-f0-9]{64}$'),
  constraint corporate_action_source_evidence_amendment_check
    check (amendment_type is null or amendment_type in ('correction', 'replacement', 'cancellation')),
  constraint corporate_action_source_evidence_amendment_reference_check
    check (
      amendment_type is null
      or referenced_notice_number is not null
      or referenced_source_event_id is not null
    ),
  unique (source, source_event_id, raw_evidence_hash)
);

create index corporate_action_source_evidence_event_idx
  on public.corporate_action_source_evidence (source, source_event_id, fetched_at desc);

create index corporate_action_source_evidence_reference_idx
  on public.corporate_action_source_evidence (source, referenced_source_event_id)
  where referenced_source_event_id is not null;

alter table public.corporate_action_source_evidence enable row level security;

revoke all privileges on table public.corporate_action_source_evidence from public, anon, authenticated;
grant select, insert on table public.corporate_action_source_evidence to service_role;

create table public.corporate_actions (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  isin text,
  exchange text not null,
  action_type text not null,
  status text not null default 'active',
  record_date date,
  ex_date date,
  ex_date_basis text not null default 'unknown',
  ex_date_derivation_method text,
  trading_calendar_version text,
  payment_date date,
  effective_date date,
  cash_per_share numeric,
  stock_ratio_numerator numeric,
  stock_ratio_denominator numeric,
  rights_ratio_numerator numeric,
  rights_ratio_denominator numeric,
  subscription_price numeric,
  source text not null,
  source_event_id text not null,
  lineage_root_source_event_id text not null,
  source_component_key text not null,
  source_url text not null,
  raw_evidence_hash text not null,
  source_evidence_id uuid not null references public.corporate_action_source_evidence (id),
  source_published_at timestamptz,
  source_updated_at timestamptz,
  verified_at timestamptz not null default now(),
  normalization_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint corporate_actions_ticker_check
    check (ticker ~ '^[A-Z0-9]{2,12}$'),
  constraint corporate_actions_isin_check
    check (isin is null or isin ~ '^[A-Z0-9]{12}$'),
  constraint corporate_actions_exchange_check
    check (exchange in ('HOSE', 'HNX', 'UPCOM')),
  constraint corporate_actions_action_type_check
    check (action_type in ('cash_dividend', 'stock_dividend', 'bonus_issue', 'stock_split', 'rights_issue')),
  constraint corporate_actions_status_check
    check (status in ('active', 'superseded', 'cancelled')),
  constraint corporate_actions_source_check
    check (source = lower(source) and source ~ '^[a-z0-9][a-z0-9_-]{1,31}$'),
  constraint corporate_actions_source_event_check
    check (btrim(source_event_id) <> '' and btrim(lineage_root_source_event_id) <> ''),
  constraint corporate_actions_component_key_check
    check (source_component_key ~ '^component:[0-9]+$'),
  constraint corporate_actions_source_url_check
    check (source_url ~ '^https://'),
  constraint corporate_actions_hash_check
    check (raw_evidence_hash ~ '^[a-f0-9]{64}$'),
  constraint corporate_actions_normalization_version_check
    check (btrim(normalization_version) <> ''),
  constraint corporate_actions_ex_date_basis_check
    check (ex_date_basis in ('source', 'derived', 'unknown')),
  constraint corporate_actions_ex_date_provenance_check
    check (
      (ex_date_basis = 'source'
        and ex_date is not null
        and ex_date_derivation_method is null
        and trading_calendar_version is null)
      or
      (ex_date_basis = 'derived'
        and ex_date is not null
        and ex_date_derivation_method is not null
        and trading_calendar_version is not null)
      or
      (ex_date_basis = 'unknown'
        and ex_date is null
        and ex_date_derivation_method is null
        and trading_calendar_version is null)
    ),
  constraint corporate_actions_record_ex_date_check
    check (record_date is null or ex_date is null or ex_date < record_date),
  constraint corporate_actions_cash_check
    check (cash_per_share is null or cash_per_share > 0),
  constraint corporate_actions_stock_ratio_check
    check (
      (stock_ratio_numerator is null and stock_ratio_denominator is null)
      or (stock_ratio_numerator > 0 and stock_ratio_denominator > 0)
    ),
  constraint corporate_actions_rights_ratio_check
    check (
      (rights_ratio_numerator is null and rights_ratio_denominator is null)
      or (rights_ratio_numerator > 0 and rights_ratio_denominator > 0)
    ),
  constraint corporate_actions_subscription_price_check
    check (subscription_price is null or subscription_price >= 0),
  constraint corporate_actions_action_terms_check
    check (
      (action_type = 'cash_dividend'
        and cash_per_share is not null
        and stock_ratio_numerator is null
        and rights_ratio_numerator is null
        and subscription_price is null)
      or
      (action_type in ('stock_dividend', 'bonus_issue', 'stock_split')
        and cash_per_share is null
        and stock_ratio_numerator is not null
        and rights_ratio_numerator is null
        and subscription_price is null)
      or
      (action_type = 'rights_issue'
        and cash_per_share is null
        and stock_ratio_numerator is null
        and rights_ratio_numerator is not null
        and subscription_price is not null)
    ),
  unique (source, lineage_root_source_event_id, source_component_key)
);

create index corporate_actions_ticker_ex_date_idx
  on public.corporate_actions (ticker, ex_date desc, record_date desc);

create index corporate_actions_ticker_record_date_idx
  on public.corporate_actions (ticker, record_date desc);

create index corporate_actions_source_event_idx
  on public.corporate_actions (source, source_event_id);

alter table public.corporate_actions enable row level security;

revoke all privileges on table public.corporate_actions from public, anon, authenticated;

drop policy if exists corporate_actions_authenticated_read on public.corporate_actions;
create policy corporate_actions_authenticated_read
  on public.corporate_actions
  for select
  to authenticated
  using (true);

grant select on table public.corporate_actions to authenticated;
grant select, insert, update on table public.corporate_actions to service_role;

create or replace function public.persist_corporate_action_notice(
  p_evidence jsonb,
  p_actions jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_source text := p_evidence->>'source';
  v_source_event_id text := p_evidence->>'source_event_id';
  v_hash text := p_evidence->>'raw_evidence_hash';
  v_evidence_id uuid;
  v_action jsonb;
  v_referenced_source_event_id text := nullif(p_evidence->>'referenced_source_event_id', '');
begin
  if jsonb_typeof(p_evidence) <> 'object' then
    raise exception 'corporate-action evidence must be a JSON object';
  end if;
  if jsonb_typeof(p_actions) <> 'array' or jsonb_array_length(p_actions) = 0 then
    raise exception 'corporate-action persistence requires at least one canonical component';
  end if;

  if v_source is null or v_source_event_id is null or v_hash is null then
    raise exception 'corporate-action evidence identity is incomplete';
  end if;

  if p_evidence ? 'amendment_type' then
    if v_referenced_source_event_id is null then
      raise exception 'corporate-action amendment is missing referenced_source_event_id';
    end if;
    if not exists (
      select 1
      from public.corporate_action_source_evidence e
      where e.source = v_source
        and e.source_event_id = v_referenced_source_event_id
    ) then
      raise exception 'corporate-action amendment references unknown source event %', v_referenced_source_event_id;
    end if;
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
    p_evidence->>'source_url',
    nullif(p_evidence->>'ticker', ''),
    p_evidence->'raw_payload',
    v_hash,
    nullif(p_evidence->>'source_published_at', '')::timestamptz,
    nullif(p_evidence->>'source_updated_at', '')::timestamptz,
    nullif(p_evidence->>'amendment_type', ''),
    nullif(p_evidence->>'referenced_notice_number', ''),
    nullif(p_evidence->>'referenced_notice_date', '')::date,
    v_referenced_source_event_id
  )
  on conflict (source, source_event_id, raw_evidence_hash) do nothing
  returning id into v_evidence_id;

  if v_evidence_id is null then
    select e.id
      into v_evidence_id
      from public.corporate_action_source_evidence e
      where e.source = v_source
        and e.source_event_id = v_source_event_id
        and e.raw_evidence_hash = v_hash
      order by e.created_at asc
      limit 1;
  end if;

  if v_evidence_id is null then
    raise exception 'corporate-action evidence could not be persisted';
  end if;

  for v_action in select value from jsonb_array_elements(p_actions)
  loop
    if jsonb_typeof(v_action) <> 'object' then
      raise exception 'corporate-action component must be a JSON object';
    end if;

    if v_action->>'source' is distinct from v_source
      or v_action->>'source_event_id' is distinct from v_source_event_id
      or v_action->>'raw_evidence_hash' is distinct from v_hash then
      raise exception 'corporate-action component evidence identity mismatch';
    end if;

    if v_referenced_source_event_id is not null
      and v_action->>'lineage_root_source_event_id' is distinct from v_referenced_source_event_id then
      raise exception 'corporate-action amendment lineage root mismatch';
    end if;

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
      normalization_version
    ) values (
      v_action->>'ticker',
      nullif(v_action->>'isin', ''),
      v_action->>'exchange',
      v_action->>'action_type',
      coalesce(nullif(v_action->>'status', ''), 'active'),
      nullif(v_action->>'record_date', '')::date,
      nullif(v_action->>'ex_date', '')::date,
      coalesce(nullif(v_action->>'ex_date_basis', ''), 'unknown'),
      nullif(v_action->>'ex_date_derivation_method', ''),
      nullif(v_action->>'trading_calendar_version', ''),
      nullif(v_action->>'payment_date', '')::date,
      nullif(v_action->>'effective_date', '')::date,
      nullif(v_action->>'cash_per_share', '')::numeric,
      nullif(v_action->>'stock_ratio_numerator', '')::numeric,
      nullif(v_action->>'stock_ratio_denominator', '')::numeric,
      nullif(v_action->>'rights_ratio_numerator', '')::numeric,
      nullif(v_action->>'rights_ratio_denominator', '')::numeric,
      nullif(v_action->>'subscription_price', '')::numeric,
      v_source,
      v_source_event_id,
      v_action->>'lineage_root_source_event_id',
      v_action->>'source_component_key',
      v_action->>'source_url',
      v_hash,
      v_evidence_id,
      nullif(v_action->>'source_published_at', '')::timestamptz,
      nullif(v_action->>'source_updated_at', '')::timestamptz,
      v_action->>'normalization_version'
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
      normalization_version = excluded.normalization_version,
      verified_at = now(),
      updated_at = now()
    where
      public.corporate_actions.source_updated_at is null
      or (
        excluded.source_updated_at is not null
        and excluded.source_updated_at >= public.corporate_actions.source_updated_at
      );
  end loop;
end;
$$;

revoke all on function public.persist_corporate_action_notice(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.persist_corporate_action_notice(jsonb, jsonb) to service_role;

comment on function public.persist_corporate_action_notice(jsonb, jsonb) is
  'QEO-123 service-role-only atomic persistence boundary: immutable evidence append plus timestamp-monotonic canonical component upsert.';
comment on table public.corporate_action_source_evidence is
  'QEO-123 immutable raw corporate-action source snapshots. Application roles append evidence; existing snapshots are never updated or deleted.';
comment on table public.corporate_actions is
  'QEO-123 canonical logical corporate-action components. Identity is source + lineage root source event + stable component ordinal.';
comment on column public.corporate_actions.lineage_root_source_event_id is
  'Stable original source event identity retained when a later amendment/correction has its own source_event_id.';
comment on column public.corporate_actions.source_component_key is
  'Stable ordinal key such as component:0. It intentionally excludes action_type so corrections may change classification without creating a second logical action.';
comment on column public.corporate_actions.ex_date_basis is
  'source = explicitly supplied by authoritative source; derived = deterministic verified-calendar derivation; unknown = fail closed with null ex_date.';

commit;
