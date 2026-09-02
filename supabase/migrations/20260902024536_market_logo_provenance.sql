begin;

-- Logo provenance must outlive disposable universe membership runs. The clean
-- rebuild intentionally truncates market_universe_memberships, so that table
-- cannot be the source of truth for whether a stored logo is official or a
-- deterministic generated fallback.
create table if not exists public.market_logo_provenance (
  ticker text primary key check (ticker ~ '^[A-Z0-9]{2,12}$'),
  logo_path text not null unique check (length(btrim(logo_path)) > 0),
  logo_kind text not null check (logo_kind in ('official', 'generated_fallback')),
  source text not null check (length(btrim(source)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.market_logo_provenance enable row level security;
revoke all privileges on table public.market_logo_provenance from anon, authenticated;
grant all privileges on table public.market_logo_provenance to service_role;

-- Seed every currently referenced Storage object before any clean rebuild can
-- remove membership history. Existing durable rows win if this migration is
-- resumed after a partial application.
insert into public.market_logo_provenance (
  ticker,
  logo_path,
  logo_kind,
  source,
  created_at,
  updated_at
)
select distinct on (ticker)
  ticker,
  logo_path,
  logo_kind,
  case
    when logo_kind = 'generated_fallback' then 'generated_fallback'
    else 'membership_backfill'
  end as source,
  created_at,
  now()
from public.market_universe_memberships
where logo_path is not null
  and length(btrim(logo_path)) > 0
order by ticker, created_at desc
on conflict (ticker) do nothing;

comment on table public.market_logo_provenance is
  'Durable stock-logo provenance independent of disposable market universe membership history.';

commit;
