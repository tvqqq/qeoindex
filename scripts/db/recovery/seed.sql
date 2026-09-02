\set ON_ERROR_STOP on

-- Synthetic local-only fixture for QEO-26. No production row is copied.
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
  target_price,
  stop_loss,
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
  25.00,
  42.50,
  25.00
from public.portfolios p
where p.user_id = '11111111-1111-4111-8111-111111111111'
order by p.created_at, p.id
limit 1
on conflict (id) do update
set target_price = excluded.target_price,
    target_price_1 = excluded.target_price_1,
    stop_loss = excluded.stop_loss,
    stop_loss_1 = excluded.stop_loss_1,
    note = excluded.note;

insert into public.wyckoff_universe_memberships (
  universe_key,
  ticker,
  exchange,
  rank,
  sector,
  market_cap_billion,
  effective_date,
  active,
  source
)
values (
  'qeo_recovery',
  'QEO',
  'HOSE',
  1,
  'Synthetic',
  12345,
  date '2026-09-02',
  true,
  'qeo26_synthetic'
)
on conflict (universe_key, ticker, effective_date) do update
set rank = excluded.rank,
    sector = excluded.sector,
    market_cap_billion = excluded.market_cap_billion,
    active = excluded.active,
    source = excluded.source;
