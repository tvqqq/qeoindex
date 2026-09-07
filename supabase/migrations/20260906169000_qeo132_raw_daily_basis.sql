-- QEO-132: separate auditable RAW Daily evidence from legacy adjusted Daily history.
-- This migration deliberately does not alter market_ohlcv_history.

create table public.market_ohlcv_raw_daily_evidence (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  session_date date not null,
  open numeric not null,
  high numeric not null,
  low numeric not null,
  close numeric not null,
  volume numeric not null,
  price_basis text not null,
  provider text not null,
  provider_detail text not null,
  source_url text not null,
  source_price_unit text not null,
  normalization_version text not null,
  raw_evidence_hash text not null,
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint market_ohlcv_raw_daily_evidence_ticker_check
    check (ticker ~ '^[A-Z0-9]{2,12}$'),
  constraint market_ohlcv_raw_daily_evidence_price_basis_check
    check (price_basis = 'RAW'),
  constraint market_ohlcv_raw_daily_evidence_open_check check (open > 0),
  constraint market_ohlcv_raw_daily_evidence_high_check check (high > 0),
  constraint market_ohlcv_raw_daily_evidence_low_check check (low > 0),
  constraint market_ohlcv_raw_daily_evidence_close_check check (close > 0),
  constraint market_ohlcv_raw_daily_evidence_volume_check check (volume >= 0),
  constraint market_ohlcv_raw_daily_evidence_ohlc_high_check
    check (high >= greatest(open, close, low)),
  constraint market_ohlcv_raw_daily_evidence_ohlc_low_check
    check (low <= least(open, close, high)),
  constraint market_ohlcv_raw_daily_evidence_provider_check
    check (length(btrim(provider)) > 0),
  constraint market_ohlcv_raw_daily_evidence_provider_detail_check
    check (length(btrim(provider_detail)) > 0),
  constraint market_ohlcv_raw_daily_evidence_source_url_check
    check (length(btrim(source_url)) > 0),
  constraint market_ohlcv_raw_daily_evidence_source_price_unit_check
    check (length(btrim(source_price_unit)) > 0),
  constraint market_ohlcv_raw_daily_evidence_normalization_version_check
    check (length(btrim(normalization_version)) > 0),
  constraint market_ohlcv_raw_daily_evidence_hash_check
    check (raw_evidence_hash ~ '^[a-f0-9]{64}$'),
  constraint market_ohlcv_raw_daily_evidence_exact_observation_key
    unique (provider, ticker, session_date, raw_evidence_hash, normalization_version),
  constraint market_ohlcv_raw_daily_evidence_identity_key
    unique (id, ticker, session_date)
);

create index market_ohlcv_raw_daily_evidence_ticker_session_idx
  on public.market_ohlcv_raw_daily_evidence (ticker, session_date desc, created_at desc);

create table public.market_ohlcv_raw_daily (
  ticker text not null,
  session_date date not null,
  evidence_id uuid not null,
  open numeric not null,
  high numeric not null,
  low numeric not null,
  close numeric not null,
  volume numeric not null,
  price_basis text not null,
  provider text not null,
  provider_detail text not null,
  source_url text not null,
  source_price_unit text not null,
  normalization_version text not null,
  raw_evidence_hash text not null,
  selected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint market_ohlcv_raw_daily_pkey primary key (ticker, session_date),
  constraint market_ohlcv_raw_daily_evidence_fkey
    foreign key (evidence_id, ticker, session_date)
    references public.market_ohlcv_raw_daily_evidence (id, ticker, session_date),
  constraint market_ohlcv_raw_daily_ticker_check
    check (ticker ~ '^[A-Z0-9]{2,12}$'),
  constraint market_ohlcv_raw_daily_price_basis_check
    check (price_basis = 'RAW'),
  constraint market_ohlcv_raw_daily_open_check check (open > 0),
  constraint market_ohlcv_raw_daily_high_check check (high > 0),
  constraint market_ohlcv_raw_daily_low_check check (low > 0),
  constraint market_ohlcv_raw_daily_close_check check (close > 0),
  constraint market_ohlcv_raw_daily_volume_check check (volume >= 0),
  constraint market_ohlcv_raw_daily_ohlc_high_check
    check (high >= greatest(open, close, low)),
  constraint market_ohlcv_raw_daily_ohlc_low_check
    check (low <= least(open, close, high)),
  constraint market_ohlcv_raw_daily_hash_check
    check (raw_evidence_hash ~ '^[a-f0-9]{64}$')
);

create index market_ohlcv_raw_daily_session_idx
  on public.market_ohlcv_raw_daily (session_date desc, ticker);

create or replace function public.qeo_reject_raw_daily_evidence_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'market_ohlcv_raw_daily_evidence is append-only';
end;
$$;

create trigger market_ohlcv_raw_daily_evidence_append_only
before update or delete on public.market_ohlcv_raw_daily_evidence
for each row execute function public.qeo_reject_raw_daily_evidence_mutation();

create or replace function public.qeo_persist_raw_daily_observation(
  p_observation jsonb,
  p_select_canonical boolean default false
)
returns table (
  evidence_id uuid,
  canonical_selected boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ticker text;
  v_session_date date;
  v_open numeric;
  v_high numeric;
  v_low numeric;
  v_close numeric;
  v_volume numeric;
  v_price_basis text;
  v_provider text;
  v_provider_detail text;
  v_source_url text;
  v_source_price_unit text;
  v_normalization_version text;
  v_raw_evidence_hash text;
  v_fetched_at timestamptz;
  v_evidence public.market_ohlcv_raw_daily_evidence%rowtype;
begin
  if p_observation is null or jsonb_typeof(p_observation) <> 'object' then
    raise exception 'raw Daily observation must be a JSON object';
  end if;

  v_ticker := upper(btrim(coalesce(p_observation->>'ticker', '')));
  if v_ticker !~ '^[A-Z0-9]{2,12}$' then
    raise exception 'invalid raw Daily ticker';
  end if;

  begin
    v_session_date := (p_observation->>'session_date')::date;
  exception when others then
    raise exception 'invalid raw Daily session_date';
  end;
  if v_session_date is null then
    raise exception 'missing raw Daily session_date';
  end if;

  begin
    v_open := (p_observation->>'open')::numeric;
    v_high := (p_observation->>'high')::numeric;
    v_low := (p_observation->>'low')::numeric;
    v_close := (p_observation->>'close')::numeric;
    v_volume := (p_observation->>'volume')::numeric;
  exception when others then
    raise exception 'invalid raw Daily OHLCV';
  end;

  if v_open is null or v_high is null or v_low is null or v_close is null or v_volume is null
     or v_open <= 0 or v_high <= 0 or v_low <= 0 or v_close <= 0 or v_volume < 0
     or v_high < greatest(v_open, v_close, v_low)
     or v_low > least(v_open, v_close, v_high) then
    raise exception 'invalid raw Daily OHLCV';
  end if;

  v_price_basis := btrim(coalesce(p_observation->>'price_basis', ''));
  if v_price_basis <> 'RAW' then
    raise exception 'raw Daily price_basis must be RAW';
  end if;

  v_provider := btrim(coalesce(p_observation->>'provider', ''));
  v_provider_detail := btrim(coalesce(p_observation->>'provider_detail', ''));
  v_source_url := btrim(coalesce(p_observation->>'source_url', ''));
  v_source_price_unit := btrim(coalesce(p_observation->>'source_price_unit', ''));
  v_normalization_version := btrim(coalesce(p_observation->>'normalization_version', ''));
  v_raw_evidence_hash := lower(btrim(coalesce(p_observation->>'raw_evidence_hash', '')));

  if v_provider = '' or v_provider_detail = '' or v_source_url = ''
     or v_source_price_unit = '' or v_normalization_version = '' then
    raise exception 'raw Daily provenance is incomplete';
  end if;
  if v_raw_evidence_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid raw Daily evidence hash';
  end if;

  begin
    v_fetched_at := (p_observation->>'fetched_at')::timestamptz;
  exception when others then
    raise exception 'invalid raw Daily fetched_at';
  end;
  if v_fetched_at is null then
    raise exception 'missing raw Daily fetched_at';
  end if;

  insert into public.market_ohlcv_raw_daily_evidence (
    ticker,
    session_date,
    open,
    high,
    low,
    close,
    volume,
    price_basis,
    provider,
    provider_detail,
    source_url,
    source_price_unit,
    normalization_version,
    raw_evidence_hash,
    fetched_at
  ) values (
    v_ticker,
    v_session_date,
    v_open,
    v_high,
    v_low,
    v_close,
    v_volume,
    v_price_basis,
    v_provider,
    v_provider_detail,
    v_source_url,
    v_source_price_unit,
    v_normalization_version,
    v_raw_evidence_hash,
    v_fetched_at
  )
  on conflict (provider, ticker, session_date, raw_evidence_hash, normalization_version)
  do nothing
  returning * into v_evidence;

  if v_evidence.id is null then
    select *
      into v_evidence
      from public.market_ohlcv_raw_daily_evidence e
     where e.provider = v_provider
       and e.ticker = v_ticker
       and e.session_date = v_session_date
       and e.raw_evidence_hash = v_raw_evidence_hash
       and e.normalization_version = v_normalization_version;

    if v_evidence.id is null then
      raise exception 'raw Daily evidence replay could not be resolved';
    end if;

    if v_evidence.open <> v_open
       or v_evidence.high <> v_high
       or v_evidence.low <> v_low
       or v_evidence.close <> v_close
       or v_evidence.volume <> v_volume
       or v_evidence.price_basis <> v_price_basis
       or v_evidence.provider_detail <> v_provider_detail
       or v_evidence.source_url <> v_source_url
       or v_evidence.source_price_unit <> v_source_price_unit then
      raise exception 'raw Daily evidence hash/replay mismatch';
    end if;
  end if;

  if coalesce(p_select_canonical, false) then
    insert into public.market_ohlcv_raw_daily (
      ticker,
      session_date,
      evidence_id,
      open,
      high,
      low,
      close,
      volume,
      price_basis,
      provider,
      provider_detail,
      source_url,
      source_price_unit,
      normalization_version,
      raw_evidence_hash,
      selected_at,
      updated_at
    ) values (
      v_evidence.ticker,
      v_evidence.session_date,
      v_evidence.id,
      v_evidence.open,
      v_evidence.high,
      v_evidence.low,
      v_evidence.close,
      v_evidence.volume,
      v_evidence.price_basis,
      v_evidence.provider,
      v_evidence.provider_detail,
      v_evidence.source_url,
      v_evidence.source_price_unit,
      v_evidence.normalization_version,
      v_evidence.raw_evidence_hash,
      now(),
      now()
    )
    on conflict (ticker, session_date) do update
      set evidence_id = excluded.evidence_id,
          open = excluded.open,
          high = excluded.high,
          low = excluded.low,
          close = excluded.close,
          volume = excluded.volume,
          price_basis = excluded.price_basis,
          provider = excluded.provider,
          provider_detail = excluded.provider_detail,
          source_url = excluded.source_url,
          source_price_unit = excluded.source_price_unit,
          normalization_version = excluded.normalization_version,
          raw_evidence_hash = excluded.raw_evidence_hash,
          selected_at = excluded.selected_at,
          updated_at = excluded.updated_at;
  end if;

  return query
  select v_evidence.id, coalesce(p_select_canonical, false);
end;
$$;

alter table public.market_ohlcv_raw_daily_evidence enable row level security;
alter table public.market_ohlcv_raw_daily enable row level security;

revoke all privileges on table public.market_ohlcv_raw_daily_evidence from public, anon, authenticated;
revoke all privileges on table public.market_ohlcv_raw_daily from public, anon, authenticated;
revoke all privileges on table public.market_ohlcv_raw_daily_evidence from service_role;
revoke all privileges on table public.market_ohlcv_raw_daily from service_role;

grant select, insert on table public.market_ohlcv_raw_daily_evidence to service_role;
grant select on table public.market_ohlcv_raw_daily to service_role;

revoke all on function public.qeo_reject_raw_daily_evidence_mutation() from public, anon, authenticated;
revoke all on function public.qeo_persist_raw_daily_observation(jsonb, boolean) from public, anon, authenticated;
grant execute on function public.qeo_persist_raw_daily_observation(jsonb, boolean) to service_role;

comment on table public.market_ohlcv_raw_daily_evidence is
  'QEO-132 append-only provider RAW Daily evidence. Provider name alone never establishes RAW basis.';
comment on table public.market_ohlcv_raw_daily is
  'QEO-132 canonical RAW Daily selection: exactly one explicitly selected evidence row per ticker/session.';
comment on function public.qeo_persist_raw_daily_observation(jsonb, boolean) is
  'QEO-132 atomic service-only persistence for explicit RAW Daily observations and optional canonical selection.';
