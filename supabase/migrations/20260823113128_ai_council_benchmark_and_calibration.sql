create or replace function public.refresh_ai_council_outcomes()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer := 0;
begin
  insert into public.ai_council_outcomes (run_id, ticker, as_of_date, start_price, outcome_status, notes)
  select r.id, r.ticker, r.as_of_date, r.price,
    case when r.price is null or r.price <= 0 then 'unavailable' else 'pending' end,
    case when r.price is null or r.price <= 0 then 'Missing positive start price; forward returns cannot be evaluated.' else '' end
  from public.ai_council_runs r
  on conflict (run_id) do nothing;

  with rating_prices as (
    select distinct on (ticker, as_of_date)
      ticker,
      as_of_date,
      price
    from public.insights_stock_ratings
    where source = 'kfsp'
      and is_published = true
      and price is not null
      and price > 0
    order by ticker, as_of_date, updated_at desc, id desc
  ),
  future_prices as (
    select
      r.id as run_id,
      rp.as_of_date as eval_date,
      rp.price as eval_price,
      bm.close as benchmark_eval_price,
      row_number() over (partition by r.id order by rp.as_of_date) as session_no
    from public.ai_council_runs r
    join rating_prices rp
      on rp.ticker = r.ticker
     and rp.as_of_date > r.as_of_date
    left join public.ai_council_market_benchmarks bm
      on bm.symbol = 'VNINDEX'
     and bm.session_date = rp.as_of_date
    where r.price is not null
      and r.price > 0
  ),
  aggregates as (
    select
      r.id as run_id,
      max(fp.eval_date) filter (where fp.session_no <= 20) as evaluated_through_date,
      count(*) filter (where fp.session_no <= 20)::smallint as sessions_observed,
      max(case when fp.session_no = 1 then ((fp.eval_price / r.price) - 1) * 100 end) as return_1d_pct,
      max(case when fp.session_no = 5 then ((fp.eval_price / r.price) - 1) * 100 end) as return_5d_pct,
      max(case when fp.session_no = 20 then ((fp.eval_price / r.price) - 1) * 100 end) as return_20d_pct,
      max(case when fp.session_no = 1 and bs.close > 0 and fp.benchmark_eval_price > 0 then ((fp.benchmark_eval_price / bs.close) - 1) * 100 end) as benchmark_return_1d_pct,
      max(case when fp.session_no = 5 and bs.close > 0 and fp.benchmark_eval_price > 0 then ((fp.benchmark_eval_price / bs.close) - 1) * 100 end) as benchmark_return_5d_pct,
      max(case when fp.session_no = 20 and bs.close > 0 and fp.benchmark_eval_price > 0 then ((fp.benchmark_eval_price / bs.close) - 1) * 100 end) as benchmark_return_20d_pct,
      max(((fp.eval_price / r.price) - 1) * 100) filter (where fp.session_no <= 20) as mfe_20d_pct,
      min(((fp.eval_price / r.price) - 1) * 100) filter (where fp.session_no <= 20) as mae_20d_pct
    from public.ai_council_runs r
    left join future_prices fp on fp.run_id = r.id
    left join public.ai_council_market_benchmarks bs
      on bs.symbol = 'VNINDEX'
     and bs.session_date = r.as_of_date
    group by r.id, bs.close
  )
  update public.ai_council_outcomes o
  set
    evaluated_through_date = a.evaluated_through_date,
    sessions_observed = least(a.sessions_observed, 20),
    return_1d_pct = a.return_1d_pct,
    return_5d_pct = a.return_5d_pct,
    return_20d_pct = a.return_20d_pct,
    alpha_1d_pct = case when a.return_1d_pct is null or a.benchmark_return_1d_pct is null then null else a.return_1d_pct - a.benchmark_return_1d_pct end,
    alpha_5d_pct = case when a.return_5d_pct is null or a.benchmark_return_5d_pct is null then null else a.return_5d_pct - a.benchmark_return_5d_pct end,
    alpha_20d_pct = case when a.return_20d_pct is null or a.benchmark_return_20d_pct is null then null else a.return_20d_pct - a.benchmark_return_20d_pct end,
    mfe_20d_pct = a.mfe_20d_pct,
    mae_20d_pct = a.mae_20d_pct,
    direction_correct_5d = case
      when r.signal = 'BUY_ON_CONFIRMATION' then c.trigger_direction_correct_5d
      when a.return_5d_pct is null then null
      when r.signal = 'BUY' then a.return_5d_pct > 0
      when r.signal in ('SELL', 'REDUCE') then a.return_5d_pct < 0
      else null
    end,
    outcome_status = case
      when o.start_price is null or o.start_price <= 0 then 'unavailable'
      when a.sessions_observed >= 20 then 'matured'
      when a.sessions_observed > 0 then 'partial'
      else 'pending'
    end,
    notes = case
      when o.start_price is null or o.start_price <= 0 then 'Missing positive start price; forward returns cannot be evaluated.'
      when r.signal = 'BUY_ON_CONFIRMATION' and c.status = 'triggered' then 'Conditional signal triggered later; directional correctness is evaluated from the trigger run, while displayed raw returns remain anchored to the original decision date.'
      when r.signal = 'BUY_ON_CONFIRMATION' then 'Conditional signal: original-date returns are tracked, directional correctness waits for structured confirmation.'
      when r.signal = 'WAIT' then 'Non-directional WAIT: return/alpha are tracked, direction_correct_5d remains null.'
      else 'Forward returns use published KFSP close snapshots; alpha uses the persisted VNINDEX daily benchmark; MFE/MAE are close-to-close over up to 20 sessions.'
    end,
    last_refreshed_at = now()
  from aggregates a
  join public.ai_council_runs r on r.id = a.run_id
  left join public.ai_council_confirmations c on c.source_run_id = r.id
  where o.run_id = a.run_id;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.refresh_ai_council_outcomes() from public;
revoke all on function public.refresh_ai_council_outcomes() from anon;
revoke all on function public.refresh_ai_council_outcomes() from authenticated;
grant execute on function public.refresh_ai_council_outcomes() to service_role;

create or replace function public.refresh_ai_council_agent_stats(p_as_of_date date default current_date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer := 0;
  inserted_count integer := 0;
begin
  delete from public.ai_council_agent_stats where as_of_date = p_as_of_date;

  with agents(agent_key, base_weight) as (
    values
      ('wyckoff'::text, 0.30::numeric),
      ('momentum'::text, 0.20::numeric),
      ('fundamental'::text, 0.20::numeric),
      ('flow'::text, 0.15::numeric),
      ('market'::text, 0.15::numeric)
  ), observations as (
    select
      v.agent_key,
      v.stance,
      v.score::numeric / 100.0 as probability_up,
      o.return_5d_pct,
      case when o.return_5d_pct > 0 then 1.0 when o.return_5d_pct < 0 then 0.0 else 0.5 end as actual_up
    from public.ai_council_votes v
    join public.ai_council_runs r on r.id = v.run_id
    join public.ai_council_outcomes o on o.run_id = r.id
    where v.agent_key <> 'risk'
      and r.as_of_date < p_as_of_date
      and o.return_5d_pct is not null
  ), aggregate_stats as (
    select
      a.agent_key,
      a.base_weight,
      count(o.agent_key)::integer as sample_count,
      count(*) filter (where o.stance in ('bullish','bearish'))::integer as directional_count,
      case when count(*) filter (where o.stance in ('bullish','bearish')) = 0 then null else
        100.0 * count(*) filter (where (o.stance = 'bullish' and o.return_5d_pct > 0) or (o.stance = 'bearish' and o.return_5d_pct < 0))
        / count(*) filter (where o.stance in ('bullish','bearish'))
      end as hit_rate_pct,
      avg(power(o.probability_up - o.actual_up, 2)) as brier_score,
      avg(case when o.stance = 'bullish' then o.return_5d_pct when o.stance = 'bearish' then -o.return_5d_pct else null end) as average_signed_return_5d_pct
    from agents a
    left join observations o on o.agent_key = a.agent_key
    group by a.agent_key, a.base_weight
  ), factors as (
    select
      s.*,
      case when s.sample_count >= 30 and s.brier_score is not null then
        1 + greatest(-0.5, least(0.5, (0.25 - s.brier_score) / 0.25)) * 0.60 * (s.sample_count::numeric / (s.sample_count + 60.0))
      else 1 end as skill_factor,
      case when s.sample_count >= 30 and s.brier_score is not null then true else false end as calibrated
    from aggregate_stats s
  ), weights as (
    select f.*, f.base_weight * f.skill_factor as raw_weight
    from factors f
  )
  insert into public.ai_council_agent_stats (
    as_of_date, agent_key, market_regime, sample_count, directional_count, hit_rate_pct, brier_score,
    average_signed_return_5d_pct, skill_factor, recommended_weight, calibrated, updated_at
  )
  select
    p_as_of_date,
    w.agent_key,
    'ALL',
    w.sample_count,
    w.directional_count,
    w.hit_rate_pct,
    w.brier_score,
    w.average_signed_return_5d_pct,
    w.skill_factor,
    w.raw_weight / sum(w.raw_weight) over (),
    w.calibrated,
    now()
  from weights w;

  get diagnostics inserted_count = row_count;
  affected := affected + inserted_count;

  with agents(agent_key, base_weight) as (
    values
      ('wyckoff'::text, 0.30::numeric),
      ('momentum'::text, 0.20::numeric),
      ('fundamental'::text, 0.20::numeric),
      ('flow'::text, 0.15::numeric),
      ('market'::text, 0.15::numeric)
  ), observations as (
    select
      v.agent_key,
      coalesce(r.market_regime, 'UNKNOWN') as market_regime,
      v.stance,
      v.score::numeric / 100.0 as probability_up,
      o.return_5d_pct,
      case when o.return_5d_pct > 0 then 1.0 when o.return_5d_pct < 0 then 0.0 else 0.5 end as actual_up
    from public.ai_council_votes v
    join public.ai_council_runs r on r.id = v.run_id
    join public.ai_council_outcomes o on o.run_id = r.id
    where v.agent_key <> 'risk'
      and r.as_of_date < p_as_of_date
      and o.return_5d_pct is not null
  ), aggregate_stats as (
    select
      o.market_regime,
      a.agent_key,
      a.base_weight,
      count(o.agent_key)::integer as sample_count,
      count(*) filter (where o.stance in ('bullish','bearish'))::integer as directional_count,
      case when count(*) filter (where o.stance in ('bullish','bearish')) = 0 then null else
        100.0 * count(*) filter (where (o.stance = 'bullish' and o.return_5d_pct > 0) or (o.stance = 'bearish' and o.return_5d_pct < 0))
        / count(*) filter (where o.stance in ('bullish','bearish'))
      end as hit_rate_pct,
      avg(power(o.probability_up - o.actual_up, 2)) as brier_score,
      avg(case when o.stance = 'bullish' then o.return_5d_pct when o.stance = 'bearish' then -o.return_5d_pct else null end) as average_signed_return_5d_pct
    from observations o
    join agents a on a.agent_key = o.agent_key
    group by o.market_regime, a.agent_key, a.base_weight
  ), factors as (
    select
      s.*,
      case when s.sample_count >= 20 and s.brier_score is not null then
        1 + greatest(-0.5, least(0.5, (0.25 - s.brier_score) / 0.25)) * 0.60 * (s.sample_count::numeric / (s.sample_count + 40.0))
      else 1 end as skill_factor,
      case when s.sample_count >= 20 and s.brier_score is not null then true else false end as calibrated
    from aggregate_stats s
  ), weights as (
    select f.*, f.base_weight * f.skill_factor as raw_weight
    from factors f
  )
  insert into public.ai_council_agent_stats (
    as_of_date, agent_key, market_regime, sample_count, directional_count, hit_rate_pct, brier_score,
    average_signed_return_5d_pct, skill_factor, recommended_weight, calibrated, updated_at
  )
  select
    p_as_of_date,
    w.agent_key,
    w.market_regime,
    w.sample_count,
    w.directional_count,
    w.hit_rate_pct,
    w.brier_score,
    w.average_signed_return_5d_pct,
    w.skill_factor,
    w.raw_weight / sum(w.raw_weight) over (partition by w.market_regime),
    w.calibrated,
    now()
  from weights w;

  get diagnostics inserted_count = row_count;
  affected := affected + inserted_count;
  return affected;
end;
$$;

revoke all on function public.refresh_ai_council_agent_stats(date) from public;
revoke all on function public.refresh_ai_council_agent_stats(date) from anon;
revoke all on function public.refresh_ai_council_agent_stats(date) from authenticated;
grant execute on function public.refresh_ai_council_agent_stats(date) to service_role;

comment on table public.ai_council_outcomes is 'Forward close-to-close outcomes with VNINDEX alpha. BUY_ON_CONFIRMATION directional correctness is evaluated from its structured trigger run.';
comment on column public.ai_council_outcomes.alpha_1d_pct is 'Stock return minus persisted VNINDEX return over the same published-session horizon.';

select public.refresh_ai_council_agent_stats(current_date);
