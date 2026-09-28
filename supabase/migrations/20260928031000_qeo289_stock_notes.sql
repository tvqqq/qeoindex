begin;

create table if not exists public.stock_notes (
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  content text not null default '' check (char_length(content) <= 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, ticker)
);

create index if not exists stock_notes_user_updated_idx
  on public.stock_notes(user_id, updated_at desc);

drop trigger if exists qeo_stock_notes_updated_at on public.stock_notes;
create trigger qeo_stock_notes_updated_at
before update on public.stock_notes
for each row execute function public.qeo_touch_updated_at();

alter table public.stock_notes enable row level security;

revoke all on public.stock_notes from anon;
grant select, insert, update, delete on public.stock_notes to authenticated;

drop policy if exists stock_notes_select_own on public.stock_notes;
create policy stock_notes_select_own on public.stock_notes
for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists stock_notes_insert_own on public.stock_notes;
create policy stock_notes_insert_own on public.stock_notes
for insert to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists stock_notes_update_own on public.stock_notes;
create policy stock_notes_update_own on public.stock_notes
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists stock_notes_delete_own on public.stock_notes;
create policy stock_notes_delete_own on public.stock_notes
for delete to authenticated
using (user_id = (select auth.uid()));

commit;
