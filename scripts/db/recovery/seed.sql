\set ON_ERROR_STOP on

-- Synthetic local-only fixture for destructive recovery rehearsal. No production row is copied.
-- The auth user is deterministic so the rehearsal can be repeated after reset.
insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token,
  email_change,
  email_change_token_new
)
values (
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-4111-8111-111111111111',
  'authenticated',
  'authenticated',
  'qeo-recovery@example.invalid',
  '',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"QEO Recovery Fixture"}'::jsonb,
  now(),
  now(),
  '',
  '',
  '',
  ''
)
on conflict (id) do nothing;

-- qeo_bootstrap_auth_user creates the default portfolio for a new auth user.
insert into public.portfolio_transactions (
  id,
  portfolio_id,
  user_id,
  ticker,
  action,
  quantity,
  price,
  fee,
  transaction_date,
  note,
  tags,
  target_price_1,
  stop_loss_1
)
select
  '22222222-2222-4222-8222-222222222222',
  p.id,
  '11111111-1111-4111-8111-111111111111',
  'QEO',
  'buy',
  100,
  30.00,
  0,
  date '2026-09-02',
  'QEO-26 synthetic recovery fixture',
  array['qeo26'],
  42.50,
  25.00
from public.portfolios p
where p.user_id = '11111111-1111-4111-8111-111111111111'
order by p.created_at, p.id
limit 1
on conflict (id) do update
set target_price_1 = excluded.target_price_1,
    stop_loss_1 = excluded.stop_loss_1,
    note = excluded.note;

-- Synthetic compatibility column: this keeps the recovery rehearsal capable of
-- proving a DROP COLUMN restore after QEO-20 removes the real legacy columns.
alter table public.portfolio_transactions
  add column if not exists qeo_recovery_legacy_target numeric(15,2);

update public.portfolio_transactions
set qeo_recovery_legacy_target = 42.50
where id = '22222222-2222-4222-8222-222222222222';

-- Independent table-drop fixture. It deliberately does not depend on any real
-- legacy application table so the recovery rehearsal remains valid indefinitely.
create table if not exists public.qeo_recovery_table_fixture (
  fixture_key text primary key,
  ticker text not null,
  rank integer not null check (rank > 0),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.qeo_recovery_table_fixture enable row level security;
revoke all on table public.qeo_recovery_table_fixture from anon, authenticated;
grant select, insert, update, delete on table public.qeo_recovery_table_fixture to service_role;

insert into public.qeo_recovery_table_fixture (fixture_key, ticker, rank, payload)
values (
  'qeo26-table-drop',
  'QEO',
  1,
  '{"kind":"synthetic","market_cap_billion":12345}'::jsonb
)
on conflict (fixture_key) do update
set ticker = excluded.ticker,
    rank = excluded.rank,
    payload = excluded.payload;
