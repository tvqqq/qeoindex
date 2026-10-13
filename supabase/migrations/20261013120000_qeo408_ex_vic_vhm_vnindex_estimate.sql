begin;

alter table public.kfsp_universe_candidate_snapshots
  add column if not exists pe_ttm numeric,
  add column if not exists pb_ttm numeric;

comment on column public.kfsp_universe_candidate_snapshots.pe_ttm is
  'KFSP filter-feed P/E TTM multiple retained for the full provider candidate snapshot; null remains unavailable.';
comment on column public.kfsp_universe_candidate_snapshots.pb_ttm is
  'KFSP filter-feed P/B TTM multiple retained for the full provider candidate snapshot; null remains unavailable.';

create table if not exists public.market_insight_qeo_ex_vnindex_daily (
  session_date date primary key,
  status text not null check (status in ('available', 'unavailable')),
  unavailable_reason text,
  calculation_version text not null,
  source_market_sync_run_id uuid,
  source_rating_sync_run_id uuid,
  source_contract_version integer,
  source_candidate_count integer not null default 0 check (source_candidate_count >= 0),
  source_hose_count integer not null default 0 check (source_hose_count >= 0),
  retained_member_count integer not null default 0 check (retained_member_count >= 0),
  calculation_input_hash text check (calculation_input_hash is null or calculation_input_hash ~ '^[0-9a-f]{64}$'),
  retained_member_hash text check (retained_member_hash is null or retained_member_hash ~ '^[0-9a-f]{64}$'),
  source_hose_hash text check (source_hose_hash is null or source_hose_hash ~ '^[0-9a-f]{64}$'),
  source_observed_from timestamptz,
  source_observed_to timestamptz,
  provider_breadth_count integer check (provider_breadth_count is null or provider_breadth_count >= 0),
  provider_breadth_difference integer,
  base_session_date date,
  base_vnindex_value numeric check (base_vnindex_value is null or base_vnindex_value > 0),
  estimated_vnindex_value numeric check (estimated_vnindex_value is null or estimated_vnindex_value > 0),
  market_cap_billion numeric check (market_cap_billion is null or market_cap_billion > 0),
  reference_market_cap_billion numeric check (reference_market_cap_billion is null or reference_market_cap_billion > 0),
  pe_ttm numeric,
  pe_mode text not null check (pe_mode in ('all_signed', 'positive_subset', 'unavailable')),
  pe_member_count integer not null default 0 check (pe_member_count >= 0),
  pe_total_member_count integer not null default 0 check (pe_total_member_count >= 0),
  pe_market_cap_coverage_pct numeric check (pe_market_cap_coverage_pct is null or pe_market_cap_coverage_pct between 0 and 100),
  pb_ttm numeric,
  pb_mode text not null check (pb_mode in ('all_signed', 'positive_subset', 'unavailable')),
  pb_member_count integer not null default 0 check (pb_member_count >= 0),
  pb_total_member_count integer not null default 0 check (pb_total_member_count >= 0),
  pb_market_cap_coverage_pct numeric check (pb_market_cap_coverage_pct is null or pb_market_cap_coverage_pct between 0 and 100),
  as_of timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_observed_to is null or source_observed_from is null or source_observed_to >= source_observed_from),
  check (status <> 'available' or (
    base_session_date is not null and base_vnindex_value is not null and estimated_vnindex_value is not null
    and calculation_input_hash is not null and retained_member_hash is not null and source_hose_hash is not null
  ))
);

create index if not exists market_insight_qeo_ex_vnindex_daily_session_idx
  on public.market_insight_qeo_ex_vnindex_daily(session_date desc);

create table if not exists public.market_insight_qeo_ex_vnindex_members (
  session_date date not null references public.market_insight_qeo_ex_vnindex_daily(session_date) on delete cascade,
  ticker text not null check (ticker ~ '^[A-Z]{3}$'),
  exchange text not null check (exchange = 'HOSE'),
  included_in_estimate boolean not null,
  exclusion_reason text,
  market_cap_billion numeric check (market_cap_billion is null or market_cap_billion > 0),
  price numeric check (price is null or price > 0),
  price_change_pct numeric check (price_change_pct is null or price_change_pct > -100),
  reference_market_cap_billion numeric check (reference_market_cap_billion is null or reference_market_cap_billion > 0),
  pe_ttm numeric,
  pb_ttm numeric,
  sync_run_id uuid not null,
  fetched_at timestamptz not null,
  primary key (session_date, ticker),
  check ((included_in_estimate and exclusion_reason is null) or (not included_in_estimate and exclusion_reason = 'excluded_vic_vhm'))
);

create index if not exists market_insight_qeo_ex_vnindex_members_ticker_date_idx
  on public.market_insight_qeo_ex_vnindex_members(ticker, session_date desc);

alter table public.market_insight_qeo_ex_vnindex_daily enable row level security;
alter table public.market_insight_qeo_ex_vnindex_members enable row level security;

revoke all privileges on table public.market_insight_qeo_ex_vnindex_daily from anon, authenticated;
revoke all privileges on table public.market_insight_qeo_ex_vnindex_members from anon, authenticated;
grant all privileges on table public.market_insight_qeo_ex_vnindex_daily to service_role;
grant all privileges on table public.market_insight_qeo_ex_vnindex_members to service_role;
grant select on table public.market_insight_qeo_ex_vnindex_daily to authenticated, anon;

create policy "Allow read published Qeo ex VIC VHM VNINDEX estimates"
  on public.market_insight_qeo_ex_vnindex_daily
  for select
  to authenticated, anon
  using (true);

create policy "Service role owns Qeo ex VIC VHM VNINDEX members"
  on public.market_insight_qeo_ex_vnindex_members
  for all
  to service_role
  using (true)
  with check (true);

create or replace function public.publish_market_insight_qeo_ex_vnindex_estimate(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_estimate jsonb;
  v_members jsonb;
  v_session_date date;
  v_status text;
  v_member_count integer;
  v_included_member_count integer;
  v_session_exclusion_count integer;
  v_input_hash text;
  v_source_market_sync_run_id uuid;
  v_source_rating_sync_run_id uuid;
  v_source_candidate_count integer;
  v_source_hose_count integer;
  v_existing public.market_insight_qeo_ex_vnindex_daily%rowtype;
  v_latest_prior public.market_insight_qeo_ex_vnindex_daily%rowtype;
  v_latest_anchor public.market_insight_qeo_ex_vnindex_daily%rowtype;
  v_market_daily public.market_insight_daily%rowtype;
  v_current_index_value numeric;
  v_previous_market_session_date date;
  v_candidate_count integer;
  v_hose_count integer;
  v_invalid_candidate_count integer;
  v_invalid_hose_count integer;
  v_vic_vhm_count integer;
  v_rating_run public.kfsp_rating_sync_runs%rowtype;
  v_expected_value numeric;
  v_has_latest_prior boolean := false;
  v_has_latest_anchor boolean := false;
begin
  if jsonb_typeof(p_payload) <> 'object'
     or jsonb_typeof(p_payload -> 'estimate') <> 'object'
     or jsonb_typeof(p_payload -> 'members') <> 'array' then
    raise exception 'Qeo ex-index estimate payload is invalid';
  end if;

  v_estimate := p_payload -> 'estimate';
  v_members := p_payload -> 'members';
  v_session_date := (v_estimate ->> 'sessionDate')::date;
  v_status := v_estimate ->> 'status';
  v_member_count := jsonb_array_length(v_members);
  v_input_hash := nullif(v_estimate ->> 'calculationInputHash', '');
  v_source_market_sync_run_id := nullif(v_estimate ->> 'sourceMarketSyncRunId', '')::uuid;
  v_source_rating_sync_run_id := nullif(v_estimate ->> 'sourceRatingSyncRunId', '')::uuid;
  v_source_candidate_count := nullif(v_estimate ->> 'sourceCandidateCount', '')::integer;
  v_source_hose_count := nullif(v_estimate ->> 'sourceHoseCount', '')::integer;

  if v_status is null or v_status not in ('available', 'unavailable')
     or coalesce(v_estimate ->> 'calculationVersion', '') = ''
     or coalesce(v_estimate ->> 'asOf', '') = ''
     or v_input_hash is null
     or v_source_market_sync_run_id is null then
    raise exception 'Qeo ex-index estimate metadata is invalid';
  end if;

  -- Serialize all estimate writers while they compare the observed prior
  -- market/Qeo session and store the next point.
  perform pg_advisory_xact_lock(hashtextextended('market_insight_qeo_ex_vnindex_daily', 0));

  select * into v_market_daily
  from public.market_insight_daily as d
  where d.session_date = v_session_date
  for share;
  if not found
     or v_market_daily.quality_status <> 'healthy'
     or v_market_daily.sync_run_id is distinct from v_source_market_sync_run_id then
    raise exception 'QEO_ESTIMATE_CONFLICT:MARKET_SNAPSHOT_CHANGED';
  end if;

  select i.value into v_current_index_value
  from public.market_insight_indexes as i
  where i.session_date = v_session_date and i.index_code = 'VNINDEX'
  for share;
  if not found or v_current_index_value is null or v_current_index_value <= 0 then
    raise exception 'QEO_ESTIMATE_CONFLICT:PUBLISHED_VNINDEX_MISSING';
  end if;

  select * into v_existing
  from public.market_insight_qeo_ex_vnindex_daily
  where session_date = v_session_date
  for update;
  if found and v_existing.status = 'available' then
    if v_status = 'available' and v_existing.calculation_input_hash = v_input_hash then
      return jsonb_build_object(
        'session_date', v_session_date,
        'status', v_existing.status,
        'member_count', (select count(*) from public.market_insight_qeo_ex_vnindex_members where session_date = v_session_date),
        'idempotent', true
      );
    end if;
    raise exception 'QEO_ESTIMATE_CONFLICT:AVAILABLE_POINT_IMMUTABLE';
  end if;

  select max(d.session_date) into v_previous_market_session_date
  from public.market_insight_daily as d
  where d.session_date < v_session_date;
  if nullif(v_estimate ->> 'previousMarketSessionDate', '')::date is distinct from v_previous_market_session_date then
    raise exception 'QEO_ESTIMATE_CONFLICT:MARKET_SESSION_ADVANCED';
  end if;

  select * into v_latest_prior
  from public.market_insight_qeo_ex_vnindex_daily
  where session_date < v_session_date
  order by session_date desc
  limit 1;
  v_has_latest_prior := found;

  select * into v_latest_anchor
  from public.market_insight_qeo_ex_vnindex_daily
  where session_date < v_session_date and base_session_date is not null
  order by session_date desc
  limit 1;
  v_has_latest_anchor := found;

  if v_status = 'available' then
    if v_source_rating_sync_run_id is null then
      raise exception 'QEO_ESTIMATE_INVALID:SOURCE_RATING_RUN_MISSING';
    end if;

    select * into v_rating_run
    from public.kfsp_rating_sync_runs
    where id = v_source_rating_sync_run_id
    for share;
    if not found
       or v_rating_run.status <> 'completed'
       or v_rating_run.as_of_date <> v_session_date
       or v_rating_run.provider_row_count <> v_source_candidate_count
       or v_rating_run.contract_version <> nullif(v_estimate ->> 'sourceContractVersion', '')::integer
       or v_rating_run.completed_at is null
       or timezone('Asia/Ho_Chi_Minh', v_rating_run.completed_at)::date <> v_session_date
       or timezone('Asia/Ho_Chi_Minh', v_rating_run.completed_at)::time < time '15:00' then
      raise exception 'QEO_ESTIMATE_INVALID:SOURCE_RATING_RUN_INCOMPLETE';
    end if;

    -- Hold row locks across the source count/hash evidence check and summary
    -- write so a same-date rating refresh cannot replace part of this run.
    perform 1
    from public.kfsp_universe_candidate_snapshots as c
    where c.as_of_date = v_session_date and c.sync_run_id = v_source_rating_sync_run_id
    for share;

    select
      count(*)::integer,
      count(*) filter (where upper(c.exchange) = 'HOSE')::integer,
      count(*) filter (where c.fetched_at is null
        or timezone('Asia/Ho_Chi_Minh', c.fetched_at)::date <> v_session_date
        or timezone('Asia/Ho_Chi_Minh', c.fetched_at)::time < time '15:00')::integer,
      count(*) filter (where upper(c.exchange) = 'HOSE' and (
        c.market_cap_billion is null or c.market_cap_billion <= 0
        or c.price is null or c.price <= 0
        or c.price_change_pct is null or c.price_change_pct <= -100
      ))::integer,
      count(*) filter (where upper(c.exchange) = 'HOSE' and c.ticker in ('VIC', 'VHM'))::integer
    into v_candidate_count, v_hose_count, v_invalid_candidate_count, v_invalid_hose_count, v_vic_vhm_count
    from public.kfsp_universe_candidate_snapshots as c
    where c.as_of_date = v_session_date and c.sync_run_id = v_source_rating_sync_run_id;

    if v_candidate_count is distinct from v_source_candidate_count
       or v_hose_count is distinct from v_source_hose_count
       or v_invalid_candidate_count <> 0
       or v_invalid_hose_count <> 0
       or v_vic_vhm_count <> 2
       or v_hose_count < 350
       or (nullif(v_estimate ->> 'providerBreadthCount', '')::integer is not null
         and v_hose_count < nullif(v_estimate ->> 'providerBreadthCount', '')::integer)
       or (v_has_latest_prior and v_hose_count < ceil(v_latest_prior.source_hose_count * 0.9)) then
      raise exception 'QEO_ESTIMATE_INVALID:SOURCE_COVERAGE_OR_MEMBERSHIP';
    end if;

    select count(*) filter (where c.ticker in ('VIC', 'VHM'))::integer,
           count(*) filter (where c."includedInEstimate")::integer
    into v_session_exclusion_count, v_included_member_count
    from jsonb_to_recordset(v_members) as c(ticker text, "includedInEstimate" boolean);
    if v_member_count <> v_hose_count
       or v_included_member_count is distinct from nullif(v_estimate ->> 'retainedMemberCount', '')::integer
       or v_session_exclusion_count <> 2
       or exists (
         select 1 from jsonb_to_recordset(v_members) as c(ticker text, "includedInEstimate" boolean)
         where (c.ticker in ('VIC', 'VHM') and c."includedInEstimate" is distinct from false)
            or (c.ticker not in ('VIC', 'VHM') and c."includedInEstimate" is distinct from true)
       ) then
      raise exception 'QEO_ESTIMATE_INVALID:RETAINED_MEMBER_EVIDENCE_MISMATCH';
    end if;

    -- Published rows alone cannot establish trading-session continuity: an
    -- entire Market Close run may have been missed. Recheck the provider's
    -- observed session history before using one daily return in the chain.
    if v_has_latest_anchor and (
      not exists (
        select 1 from jsonb_array_elements(v_market_daily.valuation_history) as point
        where point ->> 'trading_date' = v_session_date::text
      )
      or (select max(point ->> 'trading_date')
          from jsonb_array_elements(v_market_daily.valuation_history) as point
          where point ->> 'trading_date' < v_session_date::text)
        is distinct from v_previous_market_session_date::text
    ) then
      v_status := 'unavailable';
      v_estimate := v_estimate || jsonb_build_object(
        'status', 'unavailable',
        'unavailableReason', 'PROVIDER_MARKET_SESSION_GAP',
        'estimatedVnindexValue', null
      );
    elsif v_has_latest_anchor then
      if not v_has_latest_prior
         or v_latest_prior.session_date <> v_previous_market_session_date
         or v_latest_prior.status <> 'available'
         or v_latest_prior.base_session_date is distinct from v_latest_anchor.base_session_date
         or v_latest_prior.base_vnindex_value is distinct from v_latest_anchor.base_vnindex_value
         or nullif(v_estimate ->> 'previousEstimateSessionDate', '')::date is distinct from v_latest_prior.session_date
         or nullif(v_estimate ->> 'previousEstimatedVnindexValue', '')::numeric is distinct from v_latest_prior.estimated_vnindex_value
         or nullif(v_estimate ->> 'baseSessionDate', '')::date is distinct from v_latest_anchor.base_session_date
         or nullif(v_estimate ->> 'baseVnindexValue', '')::numeric is distinct from v_latest_anchor.base_vnindex_value then
        raise exception 'QEO_ESTIMATE_CONFLICT:PREVIOUS_QEO_SESSION_MISSING';
      end if;
      v_expected_value := v_latest_prior.estimated_vnindex_value
        * nullif(v_estimate ->> 'marketCapBillion', '')::numeric
        / nullif(v_estimate ->> 'referenceMarketCapBillion', '')::numeric;
      if v_expected_value is null
         or abs(v_expected_value - nullif(v_estimate ->> 'estimatedVnindexValue', '')::numeric) > greatest(abs(v_expected_value), 1) * 0.000000001 then
        raise exception 'QEO_ESTIMATE_CONFLICT:CHAINED_VALUE_MISMATCH';
      end if;
    else
      if exists (
        select 1 from public.market_insight_qeo_ex_vnindex_daily
        where session_date > v_session_date and base_session_date is not null
      ) then
        raise exception 'QEO_ESTIMATE_CONFLICT:ANCHOR_ALREADY_ESTABLISHED_LATER';
      end if;
      if nullif(v_estimate ->> 'previousEstimateSessionDate', '')::date is distinct from (case when v_has_latest_prior then v_latest_prior.session_date else null end)
         or nullif(v_estimate ->> 'previousEstimatedVnindexValue', '')::numeric is distinct from (case when v_has_latest_prior then v_latest_prior.estimated_vnindex_value else null end)
         or nullif(v_estimate ->> 'baseSessionDate', '')::date is distinct from v_session_date
         or nullif(v_estimate ->> 'baseVnindexValue', '')::numeric is distinct from v_current_index_value
         or nullif(v_estimate ->> 'estimatedVnindexValue', '')::numeric is distinct from v_current_index_value then
        raise exception 'QEO_ESTIMATE_CONFLICT:INITIAL_ANCHOR_MISMATCH';
      end if;
    end if;
  end if;

  insert into public.market_insight_qeo_ex_vnindex_daily (
    session_date, status, unavailable_reason, calculation_version,
    source_market_sync_run_id, source_rating_sync_run_id, source_contract_version,
    source_candidate_count, source_hose_count, retained_member_count,
    calculation_input_hash,
    retained_member_hash, source_hose_hash, source_observed_from, source_observed_to,
    provider_breadth_count, provider_breadth_difference,
    base_session_date, base_vnindex_value, estimated_vnindex_value,
    market_cap_billion, reference_market_cap_billion,
    pe_ttm, pe_mode, pe_member_count, pe_total_member_count, pe_market_cap_coverage_pct,
    pb_ttm, pb_mode, pb_member_count, pb_total_member_count, pb_market_cap_coverage_pct,
    as_of, updated_at
  ) values (
    v_session_date, v_status, v_estimate ->> 'unavailableReason', v_estimate ->> 'calculationVersion',
    nullif(v_estimate ->> 'sourceMarketSyncRunId', '')::uuid,
    nullif(v_estimate ->> 'sourceRatingSyncRunId', '')::uuid,
    nullif(v_estimate ->> 'sourceContractVersion', '')::integer,
    coalesce(nullif(v_estimate ->> 'sourceCandidateCount', '')::integer, 0),
    coalesce(nullif(v_estimate ->> 'sourceHoseCount', '')::integer, 0),
    coalesce(nullif(v_estimate ->> 'retainedMemberCount', '')::integer, 0),
    v_input_hash,
    nullif(v_estimate ->> 'retainedMemberHash', ''),
    nullif(v_estimate ->> 'sourceHoseHash', ''),
    nullif(v_estimate ->> 'sourceObservedFrom', '')::timestamptz,
    nullif(v_estimate ->> 'sourceObservedTo', '')::timestamptz,
    nullif(v_estimate ->> 'providerBreadthCount', '')::integer,
    nullif(v_estimate ->> 'providerBreadthDifference', '')::integer,
    nullif(v_estimate ->> 'baseSessionDate', '')::date,
    nullif(v_estimate ->> 'baseVnindexValue', '')::numeric,
    nullif(v_estimate ->> 'estimatedVnindexValue', '')::numeric,
    nullif(v_estimate ->> 'marketCapBillion', '')::numeric,
    nullif(v_estimate ->> 'referenceMarketCapBillion', '')::numeric,
    nullif(v_estimate #>> '{pe,value}', '')::numeric,
    coalesce(v_estimate #>> '{pe,mode}', 'unavailable'),
    coalesce(nullif(v_estimate #>> '{pe,memberCount}', '')::integer, 0),
    coalesce(nullif(v_estimate #>> '{pe,totalMemberCount}', '')::integer, 0),
    nullif(v_estimate #>> '{pe,marketCapCoveragePct}', '')::numeric,
    nullif(v_estimate #>> '{pb,value}', '')::numeric,
    coalesce(v_estimate #>> '{pb,mode}', 'unavailable'),
    coalesce(nullif(v_estimate #>> '{pb,memberCount}', '')::integer, 0),
    coalesce(nullif(v_estimate #>> '{pb,totalMemberCount}', '')::integer, 0),
    nullif(v_estimate #>> '{pb,marketCapCoveragePct}', '')::numeric,
    (v_estimate ->> 'asOf')::timestamptz,
    now()
  )
  on conflict (session_date) do update set
    status = excluded.status,
    unavailable_reason = excluded.unavailable_reason,
    calculation_version = excluded.calculation_version,
    source_market_sync_run_id = excluded.source_market_sync_run_id,
    source_rating_sync_run_id = excluded.source_rating_sync_run_id,
    source_contract_version = excluded.source_contract_version,
    source_candidate_count = excluded.source_candidate_count,
    source_hose_count = excluded.source_hose_count,
    retained_member_count = excluded.retained_member_count,
    calculation_input_hash = excluded.calculation_input_hash,
    retained_member_hash = excluded.retained_member_hash,
    source_hose_hash = excluded.source_hose_hash,
    source_observed_from = excluded.source_observed_from,
    source_observed_to = excluded.source_observed_to,
    provider_breadth_count = excluded.provider_breadth_count,
    provider_breadth_difference = excluded.provider_breadth_difference,
    base_session_date = excluded.base_session_date,
    base_vnindex_value = excluded.base_vnindex_value,
    estimated_vnindex_value = excluded.estimated_vnindex_value,
    market_cap_billion = excluded.market_cap_billion,
    reference_market_cap_billion = excluded.reference_market_cap_billion,
    pe_ttm = excluded.pe_ttm,
    pe_mode = excluded.pe_mode,
    pe_member_count = excluded.pe_member_count,
    pe_total_member_count = excluded.pe_total_member_count,
    pe_market_cap_coverage_pct = excluded.pe_market_cap_coverage_pct,
    pb_ttm = excluded.pb_ttm,
    pb_mode = excluded.pb_mode,
    pb_member_count = excluded.pb_member_count,
    pb_total_member_count = excluded.pb_total_member_count,
    pb_market_cap_coverage_pct = excluded.pb_market_cap_coverage_pct,
    as_of = excluded.as_of,
    updated_at = now();

  delete from public.market_insight_qeo_ex_vnindex_members
  where session_date = v_session_date;

  insert into public.market_insight_qeo_ex_vnindex_members (
    session_date, ticker, exchange, included_in_estimate, exclusion_reason,
    market_cap_billion, price, price_change_pct, reference_market_cap_billion,
    pe_ttm, pb_ttm, sync_run_id, fetched_at
  )
  select
    v_session_date,
    member ->> 'ticker',
    coalesce(member ->> 'exchange', 'HOSE'),
    coalesce((member ->> 'includedInEstimate')::boolean, false),
    nullif(member ->> 'exclusionReason', ''),
    nullif(member ->> 'marketCapBillion', '')::numeric,
    nullif(member ->> 'price', '')::numeric,
    nullif(member ->> 'priceChangePct', '')::numeric,
    nullif(member ->> 'referenceMarketCapBillion', '')::numeric,
    nullif(member ->> 'pe', '')::numeric,
    nullif(member ->> 'pb', '')::numeric,
    (member ->> 'syncRunId')::uuid,
    (member ->> 'fetchedAt')::timestamptz
  from jsonb_array_elements(v_members) as member;

  return jsonb_build_object(
    'session_date', v_session_date,
    'status', v_status,
    'unavailable_reason', v_estimate ->> 'unavailableReason',
    'member_count', v_member_count
  );
end;
$function$;

revoke all on function public.publish_market_insight_qeo_ex_vnindex_estimate(jsonb) from public;
revoke all on function public.publish_market_insight_qeo_ex_vnindex_estimate(jsonb) from anon;
revoke all on function public.publish_market_insight_qeo_ex_vnindex_estimate(jsonb) from authenticated;
grant execute on function public.publish_market_insight_qeo_ex_vnindex_estimate(jsonb) to service_role;

comment on table public.market_insight_qeo_ex_vnindex_daily is
  'Forward-only Qeo estimated VNINDEX and cap-weighted KFSP PE/PB with VIC and VHM removed; not an official VNINDEX ex-constituents index.';
comment on table public.market_insight_qeo_ex_vnindex_members is
  'Service-role-only retained per-session KFSP HOSE member inputs for the Qeo estimated VNINDEX ex VIC/VHM calculation.';
comment on function public.publish_market_insight_qeo_ex_vnindex_estimate(jsonb) is
  'Idempotently publishes one Qeo ex VIC/VHM valuation estimate and its full observed HOSE member evidence in one transaction.';

commit;
