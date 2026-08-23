create table if not exists public.ai_council_runs (
  id uuid primary key default gen_random_uuid(),
  as_of_date date not null,
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  bar_closed_at timestamptz,
  rating_date date not null,
  policy_version text not null,
  evidence_version text not null,
  evidence_hash text not null check (evidence_hash ~ '^[0-9a-f]{64}$'),
  signal text not null check (signal = any (array['BUY','BUY_ON_CONFIRMATION','WAIT','REDUCE','SELL']::text[])),
  council_score smallint not null check (council_score between 0 and 100),
  confidence smallint not null check (confidence between 0 and 100),
  consensus smallint not null check (consensus between 0 and 100),
  bull_votes smallint not null default 0 check (bull_votes >= 0),
  neutral_votes smallint not null default 0 check (neutral_votes >= 0),
  bear_votes smallint not null default 0 check (bear_votes >= 0),
  risk_status text not null check (risk_status = any (array['approve','caution','veto']::text[])),
  confirmation_pending boolean not null default false,
  data_quality text not null check (data_quality = any (array['HIGH','MEDIUM','LOW']::text[])),
  price numeric,
  support text not null default '',
  resistance text not null default '',
  confirmation text not null default '',
  invalidation text not null default '',
  bull_case jsonb not null default '[]'::jsonb check (jsonb_typeof(bull_case) = 'array'),
  bear_case jsonb not null default '[]'::jsonb check (jsonb_typeof(bear_case) = 'array'),
  dissent text not null default '',
  what_changes_decision jsonb not null default '[]'::jsonb check (jsonb_typeof(what_changes_decision) = 'array'),
  decision_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(decision_payload) = 'object'),
  created_at timestamptz not null default now(),
  constraint ai_council_runs_evidence_revision_key unique (ticker, as_of_date, policy_version, evidence_hash)
);

comment on table public.ai_council_runs is 'Immutable AI Council decision snapshots. A changed evidence hash creates a new same-day revision instead of rewriting prior predictions.';
comment on column public.ai_council_runs.evidence_hash is 'SHA-256 of the normalized point-in-time rating + Wyckoff evidence packet.';
comment on column public.ai_council_runs.decision_payload is 'Exact Council output at decision time for audit/replay; source evidence remains in canonical rating/Wyckoff tables.';

create index if not exists ai_council_runs_ticker_date_idx on public.ai_council_runs (ticker, as_of_date desc, created_at desc);
create index if not exists ai_council_runs_date_signal_idx on public.ai_council_runs (as_of_date desc, signal);

create table if not exists public.ai_council_votes (
  run_id uuid not null references public.ai_council_runs(id) on delete cascade,
  agent_key text not null check (agent_key = any (array['wyckoff','momentum','fundamental','flow','market','risk']::text[])),
  agent_label text not null,
  role text not null,
  stance text not null check (stance = any (array['bullish','neutral','bearish','approve','caution','veto']::text[])),
  score smallint not null check (score between 0 and 100),
  confidence smallint not null check (confidence between 0 and 100),
  summary text not null default '',
  evidence_for jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_for) = 'array'),
  evidence_against jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_against) = 'array'),
  engine text not null default 'deterministic',
  policy_version text not null,
  created_at timestamptz not null default now(),
  primary key (run_id, agent_key)
);

comment on table public.ai_council_votes is 'Per-specialist blind-round Council opinions persisted with each immutable Council run.';
create index if not exists ai_council_votes_agent_idx on public.ai_council_votes (agent_key, created_at desc);

create table if not exists public.ai_council_outcomes (
  run_id uuid primary key references public.ai_council_runs(id) on delete cascade,
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  as_of_date date not null,
  start_price numeric,
  evaluated_through_date date,
  sessions_observed smallint not null default 0 check (sessions_observed between 0 and 20),
  return_1d_pct numeric,
  return_5d_pct numeric,
  return_20d_pct numeric,
  benchmark text not null default 'VNINDEX',
  alpha_1d_pct numeric,
  alpha_5d_pct numeric,
  alpha_20d_pct numeric,
  mfe_20d_pct numeric,
  mae_20d_pct numeric,
  direction_correct_5d boolean,
  outcome_status text not null default 'pending' check (outcome_status = any (array['pending','partial','matured','unavailable']::text[])),
  notes text not null default '',
  last_refreshed_at timestamptz not null default now()
);

comment on table public.ai_council_outcomes is 'Forward close-to-close outcomes from published KFSP sessions. BUY_ON_CONFIRMATION and WAIT are not scored directionally until structured trigger tracking exists.';
comment on column public.ai_council_outcomes.alpha_1d_pct is 'Reserved for point-in-time VNINDEX benchmark alpha once a canonical daily benchmark series is persisted.';
comment on column public.ai_council_outcomes.mfe_20d_pct is 'Maximum favorable close-to-close excursion over the first 20 published sessions; not intraday MFE.';
comment on column public.ai_council_outcomes.mae_20d_pct is 'Maximum adverse close-to-close excursion over the first 20 published sessions; not intraday MAE.';
create index if not exists ai_council_outcomes_status_idx on public.ai_council_outcomes (outcome_status, evaluated_through_date desc);

alter table public.ai_council_runs enable row level security;
alter table public.ai_council_votes enable row level security;
alter table public.ai_council_outcomes enable row level security;

revoke all on table public.ai_council_runs from anon;
revoke all on table public.ai_council_votes from anon;
revoke all on table public.ai_council_outcomes from anon;
grant select on table public.ai_council_runs to authenticated;
grant select on table public.ai_council_votes to authenticated;
grant select on table public.ai_council_outcomes to authenticated;

drop policy if exists ai_council_runs_authenticated_read on public.ai_council_runs;
create policy ai_council_runs_authenticated_read on public.ai_council_runs for select to authenticated using (true);
drop policy if exists ai_council_votes_authenticated_read on public.ai_council_votes;
create policy ai_council_votes_authenticated_read on public.ai_council_votes for select to authenticated using (true);
drop policy if exists ai_council_outcomes_authenticated_read on public.ai_council_outcomes;
create policy ai_council_outcomes_authenticated_read on public.ai_council_outcomes for select to authenticated using (true);

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
      row_number() over (partition by r.id order by rp.as_of_date) as session_no
    from public.ai_council_runs r
    join rating_prices rp
      on rp.ticker = r.ticker
     and rp.as_of_date > r.as_of_date
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
      max(((fp.eval_price / r.price) - 1) * 100) filter (where fp.session_no <= 20) as mfe_20d_pct,
      min(((fp.eval_price / r.price) - 1) * 100) filter (where fp.session_no <= 20) as mae_20d_pct
    from public.ai_council_runs r
    left join future_prices fp on fp.run_id = r.id
    group by r.id
  )
  update public.ai_council_outcomes o
  set
    evaluated_through_date = a.evaluated_through_date,
    sessions_observed = least(a.sessions_observed, 20),
    return_1d_pct = a.return_1d_pct,
    return_5d_pct = a.return_5d_pct,
    return_20d_pct = a.return_20d_pct,
    mfe_20d_pct = a.mfe_20d_pct,
    mae_20d_pct = a.mae_20d_pct,
    direction_correct_5d = case
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
      when r.signal in ('BUY_ON_CONFIRMATION', 'WAIT') then 'Conditional/non-directional signal: return is tracked, but direction_correct_5d remains null until structured confirmation tracking exists.'
      else 'Forward returns use published KFSP close snapshots; MFE/MAE are close-to-close over up to 20 sessions.'
    end,
    last_refreshed_at = now()
  from aggregates a
  join public.ai_council_runs r on r.id = a.run_id
  where o.run_id = a.run_id;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.refresh_ai_council_outcomes() from public;
revoke all on function public.refresh_ai_council_outcomes() from anon;
revoke all on function public.refresh_ai_council_outcomes() from authenticated;
grant execute on function public.refresh_ai_council_outcomes() to service_role;
