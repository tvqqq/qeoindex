begin;

-- One-time source-backed reverse recovery for the eight published sessions
-- before the immutable 2026-10-13 Qeo anchor. This RPC is deliberately
-- separate from the forward EOD publisher and writes only missing prefix rows.
create or replace function public.backfill_market_insight_qeo_ex_vnindex_prefix(
  p_start date,
  p_anchor date,
  p_expected_anchor_hash text,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  -- Stored full-feed runs contain 1,752 rows through Oct 8 and 1,753 from Oct 9.
  -- Each must match its unique completed run and persisted candidate rows.
  v_prefix_dates date[] := array[
    date '2026-10-01', date '2026-10-02', date '2026-10-05',
    date '2026-10-06', date '2026-10-07', date '2026-10-08',
    date '2026-10-09', date '2026-10-12', date '2026-10-13'
  ];
  v_actual_dates date[];
  v_idx integer;
  v_session_date date;
  v_next_date date;
  v_latest_market_date date;
  v_latest_provider_date text;
  v_has_provider_session boolean;
  v_market public.market_insight_daily%rowtype;
  v_next_market public.market_insight_daily%rowtype;
  v_anchor public.market_insight_qeo_ex_vnindex_daily%rowtype;
  v_existing public.market_insight_qeo_ex_vnindex_daily%rowtype;
  v_rating public.kfsp_rating_sync_runs%rowtype;
  v_index_value numeric;
  v_index_sync_run_id uuid;
  v_breadth_count integer;
  v_anchor_member_count integer;
  v_anchor_included_count integer;
  v_anchor_excluded_count integer;
  v_anchor_invalid_count integer;
  v_anchor_current_cap numeric;
  v_anchor_reference_cap numeric;
  v_anchor_members jsonb;
  v_anchor_members_hash text;
  v_next_estimated_value numeric;
  v_next_current_cap numeric;
  v_next_reference_cap numeric;
  v_next_chain_hash text;
  v_rating_run_count integer;
  v_expected_candidate_count integer;
  v_candidate_count integer;
  v_hose_count integer;
  v_distinct_hose_count integer;
  v_invalid_freshness_count integer;
  v_invalid_hose_count integer;
  v_vic_vhm_count integer;
  v_source_members jsonb;
  v_members jsonb;
  v_source_hose_hash text;
  v_retained_member_hash text;
  v_input_hash text;
  v_current_cap numeric;
  v_reference_cap numeric;
  v_pe_count integer;
  v_pb_count integer;
  v_pe_cap numeric;
  v_pb_cap numeric;
  v_pe_denominator numeric;
  v_pb_denominator numeric;
  v_pe_value numeric;
  v_pb_value numeric;
  v_pe_coverage numeric;
  v_pb_coverage numeric;
  v_pe_mode text;
  v_pb_mode text;
  v_observed_from timestamptz;
  v_observed_to timestamptz;
  v_plan jsonb := '[]'::jsonb;
  v_point jsonb;
  v_preview jsonb;
  v_existing_member_count integer;
  v_idempotent_points integer := 0;
  v_inserted_points integer := 0;
begin
  if p_start is distinct from date '2026-10-01'
     or p_anchor is distinct from date '2026-10-13'
     or p_expected_anchor_hash is null
     or p_expected_anchor_hash !~ '^[0-9a-f]{64}$'
     or p_dry_run is null then
    raise exception 'QEO_PREFIX_INVALID:FIXED_WINDOW_OR_ANCHOR_HASH';
  end if;

  -- Serialize with the live forward publisher while source identity, the
  -- anchor, and all eight insert-only prefix rows are validated and published.
  perform pg_advisory_xact_lock(
    hashtextextended('market_insight_qeo_ex_vnindex_daily', 0)
  );

  select array_agg(d.session_date order by d.session_date)
    into v_actual_dates
  from public.market_insight_daily as d
  where d.session_date between p_start and p_anchor;

  if v_actual_dates is distinct from v_prefix_dates then
    raise exception 'QEO_PREFIX_INVALID:MARKET_SESSION_SET_MISMATCH';
  end if;

  select * into v_anchor
  from public.market_insight_qeo_ex_vnindex_daily as q
  where q.session_date = p_anchor
  for share;

  if not found
     or v_anchor.status <> 'available'
     or v_anchor.calculation_input_hash is distinct from p_expected_anchor_hash
     or v_anchor.base_session_date is distinct from p_anchor
     or v_anchor.base_vnindex_value is distinct from 1719.42::numeric
     or v_anchor.estimated_vnindex_value is distinct from 1719.42::numeric
     or v_anchor.source_candidate_count is distinct from 1753
     or v_anchor.source_hose_count is distinct from 413
     or v_anchor.retained_member_count is distinct from 411
     or v_anchor.source_market_sync_run_id is null
     or v_anchor.source_rating_sync_run_id is null
     or v_anchor.source_contract_version is null
     or v_anchor.market_cap_billion is null
     or v_anchor.reference_market_cap_billion is null
     or v_anchor.source_hose_hash is null
     or v_anchor.retained_member_hash is null then
    raise exception 'QEO_PREFIX_CONFLICT:IMMUTABLE_ANCHOR_MISMATCH';
  end if;

  select * into v_market
  from public.market_insight_daily as d
  where d.session_date = p_anchor
  for share;

  if not found
     or v_market.quality_status <> 'healthy'
     or v_market.sync_run_id is distinct from v_anchor.source_market_sync_run_id then
    raise exception 'QEO_PREFIX_CONFLICT:ANCHOR_MARKET_SNAPSHOT_CHANGED';
  end if;

  select i.value, i.sync_run_id, (i.advances + i.unchanged + i.declines)::integer
    into v_index_value, v_index_sync_run_id, v_breadth_count
  from public.market_insight_indexes as i
  where i.session_date = p_anchor and i.index_code = 'VNINDEX'
  for share;

  if not found
     or v_index_value is distinct from 1719.42::numeric
     or v_index_sync_run_id is distinct from v_anchor.source_market_sync_run_id then
    raise exception 'QEO_PREFIX_CONFLICT:ANCHOR_VNINDEX_SOURCE_CHANGED';
  end if;

  select r.* into v_rating
  from public.kfsp_rating_sync_runs as r
  where r.id = v_anchor.source_rating_sync_run_id
  for share;

  if not found
     or v_rating.status <> 'completed'
     or v_rating.as_of_date <> p_anchor
     or v_rating.provider is distinct from 'kfsp'
     or v_rating.provider_row_count <> 1753
     or v_rating.contract_version is distinct from v_anchor.source_contract_version
     or v_rating.completed_at is null
     or timezone('Asia/Ho_Chi_Minh', v_rating.completed_at)::date <> p_anchor
     or timezone('Asia/Ho_Chi_Minh', v_rating.completed_at)::time < time '15:00' then
    raise exception 'QEO_PREFIX_CONFLICT:ANCHOR_RATING_RUN_CHANGED';
  end if;

  perform 1
  from public.market_insight_qeo_ex_vnindex_members as m
  where m.session_date = p_anchor
  order by m.ticker
  for share;

  select
    count(*)::integer,
    count(*) filter (where m.included_in_estimate)::integer,
    count(*) filter (where m.ticker in ('VIC', 'VHM'))::integer,
    count(*) filter (where
      m.ticker !~ '^[A-Z0-9]{3}$'
      or m.exchange is distinct from 'HOSE'
      or m.sync_run_id is distinct from v_anchor.source_rating_sync_run_id
      or timezone('Asia/Ho_Chi_Minh', m.fetched_at)::date is distinct from p_anchor
      or timezone('Asia/Ho_Chi_Minh', m.fetched_at)::time < time '15:00'
      or m.market_cap_billion is null
      or m.market_cap_billion <= 0
      or m.market_cap_billion::text in ('NaN', 'Infinity', '-Infinity')
      or m.price is null
      or m.price <= 0
      or m.price::text in ('NaN', 'Infinity', '-Infinity')
      or m.price_change_pct is null
      or m.price_change_pct <= -100
      or m.price_change_pct::text in ('NaN', 'Infinity', '-Infinity')
      or (m.included_in_estimate and (
        m.reference_market_cap_billion is null
        or m.reference_market_cap_billion <= 0
        or m.reference_market_cap_billion::text in ('NaN', 'Infinity', '-Infinity')
      ))
      or (m.ticker in ('VIC', 'VHM') and (
        m.included_in_estimate
        or m.exclusion_reason is distinct from 'excluded_vic_vhm'
        or m.reference_market_cap_billion is not null
      ))
      or (m.ticker not in ('VIC', 'VHM') and (
        not m.included_in_estimate or m.exclusion_reason is not null
      ))
    )::integer,
    sum(m.market_cap_billion) filter (where m.included_in_estimate),
    sum(m.reference_market_cap_billion) filter (where m.included_in_estimate),
    jsonb_agg(jsonb_build_object(
      'ticker', m.ticker,
      'exchange', m.exchange,
      'included_in_estimate', m.included_in_estimate,
      'exclusion_reason', m.exclusion_reason,
      'market_cap_billion', m.market_cap_billion,
      'price', m.price,
      'price_change_pct', m.price_change_pct,
      'reference_market_cap_billion', m.reference_market_cap_billion,
      'pe_ttm', case when m.pe_ttm is not null and m.pe_ttm::text not in ('NaN', 'Infinity', '-Infinity') then m.pe_ttm else null end,
      'pb_ttm', case when m.pb_ttm is not null and m.pb_ttm::text not in ('NaN', 'Infinity', '-Infinity') then m.pb_ttm else null end,
      'sync_run_id', m.sync_run_id,
      'fetched_at', m.fetched_at
    ) order by m.ticker)
  into
    v_anchor_member_count, v_anchor_included_count, v_anchor_excluded_count,
    v_anchor_invalid_count, v_anchor_current_cap, v_anchor_reference_cap, v_anchor_members
  from public.market_insight_qeo_ex_vnindex_members as m
  where m.session_date = p_anchor;

  if v_anchor_member_count <> 413
     or v_anchor_included_count <> 411
     or v_anchor_excluded_count <> 2
     or v_anchor_invalid_count <> 0
     or (v_breadth_count > 0 and v_anchor_member_count < v_breadth_count)
     or v_anchor_current_cap is null
     or v_anchor_reference_cap is null
     or abs(v_anchor_current_cap - v_anchor.market_cap_billion) > greatest(abs(v_anchor_current_cap), 1) * 0.000000001
     or abs(v_anchor_reference_cap - v_anchor.reference_market_cap_billion) > greatest(abs(v_anchor_reference_cap), 1) * 0.000000001 then
    raise exception 'QEO_PREFIX_CONFLICT:ANCHOR_MEMBER_EVIDENCE_INVALID';
  end if;

  v_anchor_members_hash := encode(
    pg_catalog.sha256(convert_to(v_anchor_members::text, 'UTF8')),
    'hex'
  );
  v_next_estimated_value := v_anchor.estimated_vnindex_value;
  v_next_current_cap := v_anchor_current_cap;
  v_next_reference_cap := v_anchor_reference_cap;
  v_next_chain_hash := v_anchor.calculation_input_hash;

  for v_idx in reverse 8..1 loop
    v_session_date := v_prefix_dates[v_idx];
    v_next_date := v_prefix_dates[v_idx + 1];
    v_expected_candidate_count := case
      when v_session_date < date '2026-10-09' then 1752
      else 1753
    end;

    select max(d.session_date) into v_latest_market_date
    from public.market_insight_daily as d
    where d.session_date < v_next_date;

    if v_latest_market_date is distinct from v_session_date then
      raise exception 'QEO_PREFIX_INVALID:MARKET_SESSION_GAP';
    end if;

    select * into v_market
    from public.market_insight_daily as d
    where d.session_date = v_session_date
    for share;

    if not found
       or v_market.quality_status <> 'healthy'
       or v_market.sync_run_id is null
       or jsonb_typeof(v_market.valuation_history) is distinct from 'array' then
      raise exception 'QEO_PREFIX_INVALID:UNHEALTHY_MARKET_SESSION';
    end if;

    select coalesce(bool_or(p.value ->> 'trading_date' = v_session_date::text), false)
      into v_has_provider_session
    from jsonb_array_elements(v_market.valuation_history) as p(value);

    if not v_has_provider_session then
      raise exception 'QEO_PREFIX_INVALID:PROVIDER_VALUATION_DATE_MISSING';
    end if;

    select i.value, i.sync_run_id, (i.advances + i.unchanged + i.declines)::integer
      into v_index_value, v_index_sync_run_id, v_breadth_count
    from public.market_insight_indexes as i
    where i.session_date = v_session_date and i.index_code = 'VNINDEX'
    for share;

    if not found
       or v_index_value is null
       or v_index_value <= 0
       or v_index_sync_run_id is distinct from v_market.sync_run_id then
      raise exception 'QEO_PREFIX_INVALID:VNINDEX_SOURCE_MISMATCH';
    end if;

    select count(*)::integer into v_rating_run_count
    from public.kfsp_rating_sync_runs as r
    where r.as_of_date = v_session_date
      and r.status = 'completed'
      and r.completed_at is not null
      and timezone('Asia/Ho_Chi_Minh', r.completed_at)::date = v_session_date
      and timezone('Asia/Ho_Chi_Minh', r.completed_at)::time >= time '15:00';

    if v_rating_run_count <> 1 then
      raise exception 'QEO_PREFIX_INVALID:SOURCE_RATING_RUN_NOT_UNIQUE';
    end if;

    select r.* into v_rating
    from public.kfsp_rating_sync_runs as r
    where r.as_of_date = v_session_date
      and r.status = 'completed'
      and r.completed_at is not null
      and timezone('Asia/Ho_Chi_Minh', r.completed_at)::date = v_session_date
      and timezone('Asia/Ho_Chi_Minh', r.completed_at)::time >= time '15:00'
    for share;

    if not found then
      raise exception 'QEO_PREFIX_INVALID:SOURCE_RATING_RUN_MISSING';
    end if;

    if v_rating.provider is distinct from 'kfsp'
       or v_rating.contract_version is distinct from v_anchor.source_contract_version
       or v_rating.provider_row_count <> v_expected_candidate_count then
      raise exception 'QEO_PREFIX_INVALID:SOURCE_RATING_RUN_IDENTITY_MISMATCH';
    end if;

    perform 1
    from public.kfsp_universe_candidate_snapshots as c
    where c.as_of_date = v_session_date
      and c.sync_run_id = v_rating.id
    order by c.ticker
    for share;

    select
      count(*)::integer,
      count(*) filter (where upper(c.exchange) = 'HOSE')::integer,
      count(distinct c.ticker) filter (where upper(c.exchange) = 'HOSE')::integer,
      count(*) filter (where
        c.fetched_at is null
        or timezone('Asia/Ho_Chi_Minh', c.fetched_at)::date is distinct from v_session_date
        or timezone('Asia/Ho_Chi_Minh', c.fetched_at)::time < time '15:00'
      )::integer,
      count(*) filter (where upper(c.exchange) = 'HOSE' and (
        c.ticker is null
        or c.ticker is distinct from upper(c.ticker)
        or c.ticker !~ '^[A-Z0-9]{3}$'
        or c.market_cap_billion is null
        or c.market_cap_billion <= 0
        or c.market_cap_billion::text in ('NaN', 'Infinity', '-Infinity')
        or c.price is null
        or c.price <= 0
        or c.price::text in ('NaN', 'Infinity', '-Infinity')
        or c.price_change_pct is null
        or c.price_change_pct <= -100
        or c.price_change_pct::text in ('NaN', 'Infinity', '-Infinity')
      ))::integer,
      count(*) filter (where upper(c.exchange) = 'HOSE' and c.ticker in ('VIC', 'VHM'))::integer,
      min(c.fetched_at) filter (where upper(c.exchange) = 'HOSE'),
      max(c.fetched_at) filter (where upper(c.exchange) = 'HOSE'),
      sum(c.market_cap_billion) filter (where upper(c.exchange) = 'HOSE' and c.ticker not in ('VIC', 'VHM')),
      sum(case when c.market_cap_billion > 0
                 and c.market_cap_billion::text not in ('NaN', 'Infinity', '-Infinity')
                 and c.price_change_pct > -100
                 and c.price_change_pct::text not in ('NaN', 'Infinity', '-Infinity')
               then c.market_cap_billion / (1 + c.price_change_pct / 100)
               else null end)
        filter (where upper(c.exchange) = 'HOSE' and c.ticker not in ('VIC', 'VHM')),
      count(*) filter (where upper(c.exchange) = 'HOSE' and c.ticker not in ('VIC', 'VHM')
        and c.market_cap_billion > 0 and c.market_cap_billion::text not in ('NaN', 'Infinity', '-Infinity')
        and c.pe_ttm > 0 and c.pe_ttm::text not in ('NaN', 'Infinity', '-Infinity'))::integer,
      sum(c.market_cap_billion) filter (where upper(c.exchange) = 'HOSE' and c.ticker not in ('VIC', 'VHM')
        and c.market_cap_billion > 0 and c.market_cap_billion::text not in ('NaN', 'Infinity', '-Infinity')
        and c.pe_ttm > 0 and c.pe_ttm::text not in ('NaN', 'Infinity', '-Infinity')),
      sum(case when c.market_cap_billion > 0
                 and c.market_cap_billion::text not in ('NaN', 'Infinity', '-Infinity')
                 and c.pe_ttm > 0
                 and c.pe_ttm::text not in ('NaN', 'Infinity', '-Infinity')
               then c.market_cap_billion / c.pe_ttm
               else null end)
        filter (where upper(c.exchange) = 'HOSE' and c.ticker not in ('VIC', 'VHM')),
      count(*) filter (where upper(c.exchange) = 'HOSE' and c.ticker not in ('VIC', 'VHM')
        and c.market_cap_billion > 0 and c.market_cap_billion::text not in ('NaN', 'Infinity', '-Infinity')
        and c.pb_ttm > 0 and c.pb_ttm::text not in ('NaN', 'Infinity', '-Infinity'))::integer,
      sum(c.market_cap_billion) filter (where upper(c.exchange) = 'HOSE' and c.ticker not in ('VIC', 'VHM')
        and c.market_cap_billion > 0 and c.market_cap_billion::text not in ('NaN', 'Infinity', '-Infinity')
        and c.pb_ttm > 0 and c.pb_ttm::text not in ('NaN', 'Infinity', '-Infinity')),
      sum(case when c.market_cap_billion > 0
                 and c.market_cap_billion::text not in ('NaN', 'Infinity', '-Infinity')
                 and c.pb_ttm > 0
                 and c.pb_ttm::text not in ('NaN', 'Infinity', '-Infinity')
               then c.market_cap_billion / c.pb_ttm
               else null end)
        filter (where upper(c.exchange) = 'HOSE' and c.ticker not in ('VIC', 'VHM'))
    into
      v_candidate_count, v_hose_count, v_distinct_hose_count,
      v_invalid_freshness_count, v_invalid_hose_count, v_vic_vhm_count,
      v_observed_from, v_observed_to, v_current_cap, v_reference_cap,
      v_pe_count, v_pe_cap, v_pe_denominator, v_pb_count, v_pb_cap, v_pb_denominator
    from public.kfsp_universe_candidate_snapshots as c
    where c.as_of_date = v_session_date
      and c.sync_run_id = v_rating.id;

    if v_candidate_count <> v_expected_candidate_count
       or v_rating.provider_row_count <> v_expected_candidate_count
       or v_candidate_count <> v_rating.provider_row_count
       or v_hose_count <> 413
       or v_distinct_hose_count <> 413
       or v_invalid_freshness_count <> 0
       or v_invalid_hose_count <> 0
       or v_vic_vhm_count <> 2
       or v_breadth_count > 0 and v_hose_count < v_breadth_count
       or v_current_cap is null or v_current_cap <= 0
       or v_reference_cap is null or v_reference_cap <= 0
       or v_observed_from is null or v_observed_to is null then
      raise exception 'QEO_PREFIX_INVALID:SOURCE_COVERAGE_OR_MEMBERSHIP';
    end if;

    select * into v_next_market
    from public.market_insight_daily as d
    where d.session_date = v_next_date
    for share;

    if not found
       or v_next_market.session_date is distinct from v_next_date
       or v_next_market.quality_status <> 'healthy'
       or jsonb_typeof(v_next_market.valuation_history) is distinct from 'array' then
      raise exception 'QEO_PREFIX_INVALID:NEXT_MARKET_SNAPSHOT_INVALID';
    end if;

    select
      coalesce(bool_or(p.value ->> 'trading_date' = v_next_date::text), false),
      max(p.value ->> 'trading_date') filter (
        where p.value ->> 'trading_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          and p.value ->> 'trading_date' < v_next_date::text
      )
      into v_has_provider_session, v_latest_provider_date
    from jsonb_array_elements(v_next_market.valuation_history) as p(value);

    if not v_has_provider_session
       or v_latest_provider_date is distinct from v_session_date::text then
      raise exception 'QEO_PREFIX_INVALID:PROVIDER_VALUATION_SESSION_GAP';
    end if;

    select
      jsonb_agg(jsonb_build_object(
        'ticker', c.ticker,
        'exchange', 'HOSE',
        'included_in_estimate', c.ticker not in ('VIC', 'VHM'),
        'exclusion_reason', case when c.ticker in ('VIC', 'VHM') then 'excluded_vic_vhm' else null end,
        'market_cap_billion', c.market_cap_billion,
        'price', c.price,
        'price_change_pct', c.price_change_pct,
        'reference_market_cap_billion', case
          when c.ticker in ('VIC', 'VHM') then null
          else c.market_cap_billion / (1 + c.price_change_pct / 100)
        end,
        'pe_ttm', case when c.pe_ttm is not null and c.pe_ttm::text not in ('NaN', 'Infinity', '-Infinity') then c.pe_ttm else null end,
        'pb_ttm', case when c.pb_ttm is not null and c.pb_ttm::text not in ('NaN', 'Infinity', '-Infinity') then c.pb_ttm else null end,
        'sync_run_id', c.sync_run_id,
        'fetched_at', c.fetched_at
      ) order by c.ticker),
      jsonb_agg(jsonb_build_object(
        'ticker', c.ticker,
        'exchange', upper(c.exchange),
        'market_cap_billion', c.market_cap_billion,
        'price', c.price,
        'price_change_pct', c.price_change_pct,
        'pe_ttm_source', c.pe_ttm::text,
        'pb_ttm_source', c.pb_ttm::text,
        'sync_run_id', c.sync_run_id,
        'fetched_at', c.fetched_at
      ) order by c.ticker),
      encode(pg_catalog.sha256(convert_to(
        coalesce((jsonb_agg(to_jsonb(c.ticker) order by c.ticker)
          filter (where c.ticker not in ('VIC', 'VHM')))::text, '[]'),
        'UTF8'
      )), 'hex')
    into v_members, v_source_members, v_retained_member_hash
    from public.kfsp_universe_candidate_snapshots as c
    where c.as_of_date = v_session_date
      and c.sync_run_id = v_rating.id
      and upper(c.exchange) = 'HOSE';

    if jsonb_array_length(v_members) <> 413
       or jsonb_array_length(v_members) - 2 <> 411 then
      raise exception 'QEO_PREFIX_INVALID:MEMBER_EVIDENCE_INCOMPLETE';
    end if;

    v_source_hose_hash := encode(
      pg_catalog.sha256(convert_to(v_source_members::text, 'UTF8')),
      'hex'
    );

    if v_pe_count > 0 and v_pe_denominator > 0 then
      v_pe_value := v_pe_cap / v_pe_denominator;
      v_pe_coverage := round((v_pe_cap / v_current_cap) * 100, 2);
      v_pe_mode := 'positive_subset';
    else
      v_pe_value := null;
      v_pe_coverage := null;
      v_pe_count := 0;
      v_pe_mode := 'unavailable';
    end if;

    if v_pb_count > 0 and v_pb_denominator > 0 then
      v_pb_value := v_pb_cap / v_pb_denominator;
      v_pb_coverage := round((v_pb_cap / v_current_cap) * 100, 2);
      v_pb_mode := 'positive_subset';
    else
      v_pb_value := null;
      v_pb_coverage := null;
      v_pb_count := 0;
      v_pb_mode := 'unavailable';
    end if;

    v_next_estimated_value :=
      v_next_estimated_value * v_next_reference_cap / v_next_current_cap;

    if v_next_estimated_value is null
       or v_next_estimated_value <= 0
       or v_next_estimated_value::text in ('NaN', 'Infinity', '-Infinity') then
      raise exception 'QEO_PREFIX_INVALID:REVERSE_INDEX_ARITHMETIC';
    end if;

    v_input_hash := encode(
      pg_catalog.sha256(convert_to(jsonb_build_object(
        'calculation_version', 'qeo-ex-vic-vhm-reverse-prefix-v1',
        'session_date', v_session_date,
        'source_market_sync_run_id', v_market.sync_run_id,
        'source_official_vnindex', v_index_value,
        'source_rating_sync_run_id', v_rating.id,
        'source_contract_version', v_rating.contract_version,
        'source_candidate_count', v_candidate_count,
        'source_hose_count', v_hose_count,
        'retained_member_count', 411,
        'source_observed_from', v_observed_from,
        'source_observed_to', v_observed_to,
        'provider_breadth_count', case when v_breadth_count > 0 then v_breadth_count else null end,
        'provider_breadth_difference', case when v_breadth_count > 0 then v_hose_count - v_breadth_count else null end,
        'source_hose_hash', v_source_hose_hash,
        'retained_member_hash', v_retained_member_hash,
        'base_session_date', p_anchor,
        'base_vnindex_value', v_anchor.estimated_vnindex_value,
        'next_session_date', v_next_date,
        'next_session_chain_hash', v_next_chain_hash,
        'next_session_reverse_factor', v_next_reference_cap / v_next_current_cap,
        'next_session_current_market_cap_billion', v_next_current_cap,
        'next_session_reference_market_cap_billion', v_next_reference_cap,
        'anchor_member_evidence_hash', v_anchor_members_hash,
        'anchor_calculation_input_hash', p_expected_anchor_hash,
        'market_cap_billion', v_current_cap,
        'reference_market_cap_billion', v_reference_cap,
        'estimated_vnindex_value', v_next_estimated_value,
        'pe_ttm', v_pe_value,
        'pe_mode', v_pe_mode,
        'pe_member_count', v_pe_count,
        'pe_total_member_count', 411,
        'pe_market_cap_coverage_pct', v_pe_coverage,
        'pb_ttm', v_pb_value,
        'pb_mode', v_pb_mode,
        'pb_member_count', v_pb_count,
        'pb_total_member_count', 411,
        'pb_market_cap_coverage_pct', v_pb_coverage
      )::text, 'UTF8')),
      'hex'
    );

    v_point := jsonb_build_object(
      'session_date', v_session_date,
      'status', 'available',
      'calculation_version', 'qeo-ex-vic-vhm-reverse-prefix-v1',
      'source_market_sync_run_id', v_market.sync_run_id,
      'source_rating_sync_run_id', v_rating.id,
      'source_contract_version', v_rating.contract_version,
      'source_candidate_count', v_candidate_count,
      'source_hose_count', v_hose_count,
      'retained_member_count', 411,
      'calculation_input_hash', v_input_hash,
      'retained_member_hash', v_retained_member_hash,
      'source_hose_hash', v_source_hose_hash,
      'source_observed_from', v_observed_from,
      'source_observed_to', v_observed_to,
      'provider_breadth_count', case when v_breadth_count > 0 then v_breadth_count else null end,
      'provider_breadth_difference', case when v_breadth_count > 0 then v_hose_count - v_breadth_count else null end,
      'base_session_date', p_anchor,
      'base_vnindex_value', v_anchor.estimated_vnindex_value,
      'estimated_vnindex_value', v_next_estimated_value,
      'market_cap_billion', v_current_cap,
      'reference_market_cap_billion', v_reference_cap,
      'pe_ttm', v_pe_value,
      'pe_mode', v_pe_mode,
      'pe_member_count', v_pe_count,
      'pe_total_member_count', 411,
      'pe_market_cap_coverage_pct', v_pe_coverage,
      'pb_ttm', v_pb_value,
      'pb_mode', v_pb_mode,
      'pb_member_count', v_pb_count,
      'pb_total_member_count', 411,
      'pb_market_cap_coverage_pct', v_pb_coverage,
      'as_of', v_observed_to,
      'members', v_members
    );

    v_plan := v_plan || jsonb_build_array(v_point);
    v_next_current_cap := v_current_cap;
    v_next_reference_cap := v_reference_cap;
    v_next_chain_hash := v_input_hash;
  end loop;

  if jsonb_array_length(v_plan) <> 8 then
    raise exception 'QEO_PREFIX_INVALID:INCOMPLETE_PLAN';
  end if;

  -- Existing prefix rows are accepted only when every summary and every
  -- ordered source member matches exactly. Any mismatch is an immutable conflict.
  for v_point in
    select p.value
    from jsonb_array_elements(v_plan) as p(value)
    order by (p.value ->> 'session_date')::date
  loop
    select * into v_existing
    from public.market_insight_qeo_ex_vnindex_daily as q
    where q.session_date = (v_point ->> 'session_date')::date
    for share;

    if found then
      if v_existing.status is distinct from 'available'
         or v_existing.unavailable_reason is not null
         or v_existing.calculation_version is distinct from (v_point ->> 'calculation_version')
         or v_existing.source_market_sync_run_id is distinct from (v_point ->> 'source_market_sync_run_id')::uuid
         or v_existing.source_rating_sync_run_id is distinct from (v_point ->> 'source_rating_sync_run_id')::uuid
         or v_existing.source_contract_version is distinct from (v_point ->> 'source_contract_version')::integer
         or v_existing.source_candidate_count is distinct from (v_point ->> 'source_candidate_count')::integer
         or v_existing.source_hose_count is distinct from (v_point ->> 'source_hose_count')::integer
         or v_existing.retained_member_count is distinct from (v_point ->> 'retained_member_count')::integer
         or v_existing.calculation_input_hash is distinct from (v_point ->> 'calculation_input_hash')
         or v_existing.retained_member_hash is distinct from (v_point ->> 'retained_member_hash')
         or v_existing.source_hose_hash is distinct from (v_point ->> 'source_hose_hash')
         or v_existing.source_observed_from is distinct from (v_point ->> 'source_observed_from')::timestamptz
         or v_existing.source_observed_to is distinct from (v_point ->> 'source_observed_to')::timestamptz
         or v_existing.provider_breadth_count is distinct from nullif(v_point ->> 'provider_breadth_count', '')::integer
         or v_existing.provider_breadth_difference is distinct from nullif(v_point ->> 'provider_breadth_difference', '')::integer
         or v_existing.base_session_date is distinct from (v_point ->> 'base_session_date')::date
         or v_existing.base_vnindex_value is distinct from (v_point ->> 'base_vnindex_value')::numeric
         or v_existing.estimated_vnindex_value is distinct from (v_point ->> 'estimated_vnindex_value')::numeric
         or v_existing.market_cap_billion is distinct from (v_point ->> 'market_cap_billion')::numeric
         or v_existing.reference_market_cap_billion is distinct from (v_point ->> 'reference_market_cap_billion')::numeric
         or v_existing.pe_ttm is distinct from nullif(v_point ->> 'pe_ttm', '')::numeric
         or v_existing.pe_mode is distinct from (v_point ->> 'pe_mode')
         or v_existing.pe_member_count is distinct from (v_point ->> 'pe_member_count')::integer
         or v_existing.pe_total_member_count is distinct from (v_point ->> 'pe_total_member_count')::integer
         or v_existing.pe_market_cap_coverage_pct is distinct from nullif(v_point ->> 'pe_market_cap_coverage_pct', '')::numeric
         or v_existing.pb_ttm is distinct from nullif(v_point ->> 'pb_ttm', '')::numeric
         or v_existing.pb_mode is distinct from (v_point ->> 'pb_mode')
         or v_existing.pb_member_count is distinct from (v_point ->> 'pb_member_count')::integer
         or v_existing.pb_total_member_count is distinct from (v_point ->> 'pb_total_member_count')::integer
         or v_existing.pb_market_cap_coverage_pct is distinct from nullif(v_point ->> 'pb_market_cap_coverage_pct', '')::numeric
         or v_existing.as_of is distinct from (v_point ->> 'as_of')::timestamptz then
        raise exception 'QEO_PREFIX_CONFLICT:EXISTING_DAILY_ROW_MISMATCH';
      end if;

      perform 1
      from public.market_insight_qeo_ex_vnindex_members as m
      where m.session_date = (v_point ->> 'session_date')::date
      order by m.ticker
      for share;

      select count(*)::integer into v_existing_member_count
      from public.market_insight_qeo_ex_vnindex_members as m
      where m.session_date = (v_point ->> 'session_date')::date;

      if v_existing_member_count <> 413 or exists (
        select 1
        from jsonb_to_recordset(v_point -> 'members') as expected(
          ticker text,
          exchange text,
          included_in_estimate boolean,
          exclusion_reason text,
          market_cap_billion numeric,
          price numeric,
          price_change_pct numeric,
          reference_market_cap_billion numeric,
          pe_ttm numeric,
          pb_ttm numeric,
          sync_run_id uuid,
          fetched_at timestamptz
        )
        left join public.market_insight_qeo_ex_vnindex_members as actual
          on actual.session_date = (v_point ->> 'session_date')::date
         and actual.ticker = expected.ticker
        where actual.ticker is null
           or actual.exchange is distinct from expected.exchange
           or actual.included_in_estimate is distinct from expected.included_in_estimate
           or actual.exclusion_reason is distinct from expected.exclusion_reason
           or actual.market_cap_billion is distinct from expected.market_cap_billion
           or actual.price is distinct from expected.price
           or actual.price_change_pct is distinct from expected.price_change_pct
           or actual.reference_market_cap_billion is distinct from expected.reference_market_cap_billion
           or actual.pe_ttm is distinct from expected.pe_ttm
           or actual.pb_ttm is distinct from expected.pb_ttm
           or actual.sync_run_id is distinct from expected.sync_run_id
           or actual.fetched_at is distinct from expected.fetched_at
      ) then
        raise exception 'QEO_PREFIX_CONFLICT:EXISTING_MEMBER_ROWS_MISMATCH';
      end if;

      v_idempotent_points := v_idempotent_points + 1;
    end if;
  end loop;

  select coalesce(jsonb_agg(p.value - 'members' order by (p.value ->> 'session_date')::date), '[]'::jsonb)
    into v_preview
  from jsonb_array_elements(v_plan) as p(value);

  if p_dry_run then
    return jsonb_build_object(
      'dry_run', true,
      'calculation_version', 'qeo-ex-vic-vhm-reverse-prefix-v1',
      'anchor_session_date', p_anchor,
      'anchor_value', v_anchor.estimated_vnindex_value,
      'anchor_hash', v_anchor.calculation_input_hash,
      'prefix_count', jsonb_array_length(v_plan),
      'already_identical_count', v_idempotent_points,
      'points', v_preview
    );
  end if;

  -- Insert missing prefix points only. No UPDATE or DELETE path exists here.
  for v_point in
    select p.value
    from jsonb_array_elements(v_plan) as p(value)
    order by (p.value ->> 'session_date')::date
  loop
    if exists (
      select 1 from public.market_insight_qeo_ex_vnindex_daily as q
      where q.session_date = (v_point ->> 'session_date')::date
    ) then
      continue;
    end if;

    insert into public.market_insight_qeo_ex_vnindex_daily (
      session_date, status, unavailable_reason, calculation_version,
      source_market_sync_run_id, source_rating_sync_run_id, source_contract_version,
      source_candidate_count, source_hose_count, retained_member_count,
      calculation_input_hash, retained_member_hash, source_hose_hash,
      source_observed_from, source_observed_to,
      provider_breadth_count, provider_breadth_difference,
      base_session_date, base_vnindex_value, estimated_vnindex_value,
      market_cap_billion, reference_market_cap_billion,
      pe_ttm, pe_mode, pe_member_count, pe_total_member_count, pe_market_cap_coverage_pct,
      pb_ttm, pb_mode, pb_member_count, pb_total_member_count, pb_market_cap_coverage_pct,
      as_of, updated_at
    ) values (
      (v_point ->> 'session_date')::date,
      'available',
      null,
      v_point ->> 'calculation_version',
      (v_point ->> 'source_market_sync_run_id')::uuid,
      (v_point ->> 'source_rating_sync_run_id')::uuid,
      (v_point ->> 'source_contract_version')::integer,
      (v_point ->> 'source_candidate_count')::integer,
      (v_point ->> 'source_hose_count')::integer,
      (v_point ->> 'retained_member_count')::integer,
      v_point ->> 'calculation_input_hash',
      v_point ->> 'retained_member_hash',
      v_point ->> 'source_hose_hash',
      (v_point ->> 'source_observed_from')::timestamptz,
      (v_point ->> 'source_observed_to')::timestamptz,
      nullif(v_point ->> 'provider_breadth_count', '')::integer,
      nullif(v_point ->> 'provider_breadth_difference', '')::integer,
      (v_point ->> 'base_session_date')::date,
      (v_point ->> 'base_vnindex_value')::numeric,
      (v_point ->> 'estimated_vnindex_value')::numeric,
      (v_point ->> 'market_cap_billion')::numeric,
      (v_point ->> 'reference_market_cap_billion')::numeric,
      nullif(v_point ->> 'pe_ttm', '')::numeric,
      v_point ->> 'pe_mode',
      (v_point ->> 'pe_member_count')::integer,
      (v_point ->> 'pe_total_member_count')::integer,
      nullif(v_point ->> 'pe_market_cap_coverage_pct', '')::numeric,
      nullif(v_point ->> 'pb_ttm', '')::numeric,
      v_point ->> 'pb_mode',
      (v_point ->> 'pb_member_count')::integer,
      (v_point ->> 'pb_total_member_count')::integer,
      nullif(v_point ->> 'pb_market_cap_coverage_pct', '')::numeric,
      (v_point ->> 'as_of')::timestamptz,
      now()
    );

    insert into public.market_insight_qeo_ex_vnindex_members (
      session_date, ticker, exchange, included_in_estimate, exclusion_reason,
      market_cap_billion, price, price_change_pct, reference_market_cap_billion,
      pe_ttm, pb_ttm, sync_run_id, fetched_at
    )
    select
      (v_point ->> 'session_date')::date,
      m.ticker,
      m.exchange,
      m.included_in_estimate,
      m.exclusion_reason,
      m.market_cap_billion,
      m.price,
      m.price_change_pct,
      m.reference_market_cap_billion,
      m.pe_ttm,
      m.pb_ttm,
      m.sync_run_id,
      m.fetched_at
    from jsonb_to_recordset(v_point -> 'members') as m(
      ticker text,
      exchange text,
      included_in_estimate boolean,
      exclusion_reason text,
      market_cap_billion numeric,
      price numeric,
      price_change_pct numeric,
      reference_market_cap_billion numeric,
      pe_ttm numeric,
      pb_ttm numeric,
      sync_run_id uuid,
      fetched_at timestamptz
    );

    v_inserted_points := v_inserted_points + 1;
  end loop;

  return jsonb_build_object(
    'dry_run', false,
    'calculation_version', 'qeo-ex-vic-vhm-reverse-prefix-v1',
    'anchor_session_date', p_anchor,
    'anchor_value', v_anchor.estimated_vnindex_value,
    'anchor_hash', v_anchor.calculation_input_hash,
    'prefix_count', jsonb_array_length(v_plan),
    'inserted_count', v_inserted_points,
    'already_identical_count', v_idempotent_points,
    'points', v_preview
  );
end;
$function$;

revoke all on function public.backfill_market_insight_qeo_ex_vnindex_prefix(date, date, text, boolean) from public;
revoke all on function public.backfill_market_insight_qeo_ex_vnindex_prefix(date, date, text, boolean) from anon;
revoke all on function public.backfill_market_insight_qeo_ex_vnindex_prefix(date, date, text, boolean) from authenticated;
grant execute on function public.backfill_market_insight_qeo_ex_vnindex_prefix(date, date, text, boolean) to service_role;

comment on function public.backfill_market_insight_qeo_ex_vnindex_prefix(date, date, text, boolean) is
  'One-time service-role-only insert-only reverse prefix recovery from persisted HOSE sessions 2026-10-01 through 2026-10-12, anchored to the immutable 2026-10-13 estimate. Dry-run validates all evidence and arithmetic without writing.';

commit;
