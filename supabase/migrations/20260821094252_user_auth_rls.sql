begin;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  default_page text not null default 'board' check (default_page in ('board', 'research', 'signals', 'scanner', 'fa')),
  compact_board boolean not null default false,
  sound_enabled boolean not null default true,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_features (
  user_id uuid not null references auth.users(id) on delete cascade,
  feature_key text not null check (feature_key ~ '^[a-z0-9_]{2,40}$'),
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, feature_key)
);

create table if not exists public.watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Theo dõi' check (char_length(name) between 1 and 80),
  is_default boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create unique index if not exists watchlists_one_default_per_user
  on public.watchlists(user_id)
  where is_default;

create index if not exists watchlists_user_sort_idx
  on public.watchlists(user_id, sort_order, created_at);

create table if not exists public.watchlist_items (
  id uuid primary key default gen_random_uuid(),
  watchlist_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (watchlist_id, user_id)
    references public.watchlists(id, user_id)
    on delete cascade,
  unique (watchlist_id, ticker)
);

create index if not exists watchlist_items_user_idx
  on public.watchlist_items(user_id, watchlist_id, sort_order, created_at);

create or replace function public.qeo_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.qeo_bootstrap_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), '')
    )
  )
  on conflict (id) do nothing;

  insert into public.user_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.watchlists (user_id, name, is_default, sort_order)
  values (new.id, 'Theo dõi', true, 0)
  on conflict do nothing;

  insert into public.user_features (user_id, feature_key, enabled)
  values
    (new.id, 'market_board', true),
    (new.id, 'research', true),
    (new.id, 'signals', true),
    (new.id, 'finhay_live', true)
  on conflict (user_id, feature_key) do nothing;

  return new;
end;
$$;

revoke all on function public.qeo_bootstrap_auth_user() from public;

insert into public.profiles (id, display_name)
select
  u.id,
  coalesce(
    nullif(u.raw_user_meta_data ->> 'display_name', ''),
    nullif(u.raw_user_meta_data ->> 'full_name', ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), '')
  )
from auth.users u
on conflict (id) do nothing;

insert into public.user_preferences (user_id)
select u.id from auth.users u
on conflict (user_id) do nothing;

insert into public.watchlists (user_id, name, is_default, sort_order)
select u.id, 'Theo dõi', true, 0
from auth.users u
where not exists (
  select 1 from public.watchlists w where w.user_id = u.id and w.is_default
);

insert into public.user_features (user_id, feature_key, enabled)
select u.id, f.feature_key, true
from auth.users u
cross join (values
  ('market_board'),
  ('research'),
  ('signals'),
  ('finhay_live')
) as f(feature_key)
on conflict (user_id, feature_key) do nothing;

drop trigger if exists qeo_profiles_updated_at on public.profiles;
create trigger qeo_profiles_updated_at
before update on public.profiles
for each row execute function public.qeo_touch_updated_at();

drop trigger if exists qeo_user_preferences_updated_at on public.user_preferences;
create trigger qeo_user_preferences_updated_at
before update on public.user_preferences
for each row execute function public.qeo_touch_updated_at();

drop trigger if exists qeo_user_features_updated_at on public.user_features;
create trigger qeo_user_features_updated_at
before update on public.user_features
for each row execute function public.qeo_touch_updated_at();

drop trigger if exists qeo_watchlists_updated_at on public.watchlists;
create trigger qeo_watchlists_updated_at
before update on public.watchlists
for each row execute function public.qeo_touch_updated_at();

drop trigger if exists qeo_watchlist_items_updated_at on public.watchlist_items;
create trigger qeo_watchlist_items_updated_at
before update on public.watchlist_items
for each row execute function public.qeo_touch_updated_at();

drop trigger if exists qeo_auth_user_bootstrap on auth.users;
create trigger qeo_auth_user_bootstrap
after insert on auth.users
for each row execute function public.qeo_bootstrap_auth_user();

alter table public.profiles enable row level security;
alter table public.user_preferences enable row level security;
alter table public.user_features enable row level security;
alter table public.watchlists enable row level security;
alter table public.watchlist_items enable row level security;

revoke all on public.profiles from anon;
revoke all on public.user_preferences from anon;
revoke all on public.user_features from anon;
revoke all on public.watchlists from anon;
revoke all on public.watchlist_items from anon;

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.user_preferences to authenticated;
grant select on public.user_features to authenticated;
grant select, insert, update, delete on public.watchlists to authenticated;
grant select, insert, update, delete on public.watchlist_items to authenticated;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
for select to authenticated
using (id = (select auth.uid()));

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
for insert to authenticated
with check (id = (select auth.uid()));

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

drop policy if exists preferences_select_own on public.user_preferences;
create policy preferences_select_own on public.user_preferences
for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists preferences_insert_own on public.user_preferences;
create policy preferences_insert_own on public.user_preferences
for insert to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists preferences_update_own on public.user_preferences;
create policy preferences_update_own on public.user_preferences
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists preferences_delete_own on public.user_preferences;
create policy preferences_delete_own on public.user_preferences
for delete to authenticated
using (user_id = (select auth.uid()));

drop policy if exists features_select_own on public.user_features;
create policy features_select_own on public.user_features
for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists watchlists_select_own on public.watchlists;
create policy watchlists_select_own on public.watchlists
for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists watchlists_insert_own on public.watchlists;
create policy watchlists_insert_own on public.watchlists
for insert to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists watchlists_update_own on public.watchlists;
create policy watchlists_update_own on public.watchlists
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists watchlists_delete_own on public.watchlists;
create policy watchlists_delete_own on public.watchlists
for delete to authenticated
using (user_id = (select auth.uid()));

drop policy if exists watchlist_items_select_own on public.watchlist_items;
create policy watchlist_items_select_own on public.watchlist_items
for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists watchlist_items_insert_own on public.watchlist_items;
create policy watchlist_items_insert_own on public.watchlist_items
for insert to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists watchlist_items_update_own on public.watchlist_items;
create policy watchlist_items_update_own on public.watchlist_items
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists watchlist_items_delete_own on public.watchlist_items;
create policy watchlist_items_delete_own on public.watchlist_items
for delete to authenticated
using (user_id = (select auth.uid()));

commit;;
