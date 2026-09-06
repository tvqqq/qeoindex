begin;

create table if not exists public.ai_council_ticker_knowledge_snapshots (
  run_id uuid primary key references public.ai_council_runs(id) on delete cascade,
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  as_of_date date not null,
  context_version text not null,
  context_hash text not null check (context_hash ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('ready','empty','unavailable')),
  context_payload jsonb not null check (jsonb_typeof(context_payload) = 'object'),
  point_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(point_ids) = 'array'),
  captured_at timestamptz not null default now()
);

comment on table public.ai_council_ticker_knowledge_snapshots is
  'Immutable point-in-time ticker knowledge context frozen for one AI Council run. Qdrant is a rebuildable retrieval index; this row preserves the exact context that advisory LLM reasoning was allowed to use.';
comment on column public.ai_council_ticker_knowledge_snapshots.context_payload is
  'Bounded provenance-bearing ticker knowledge packet frozen before advisory reasoning. SOURCE_OPINION items remain opinions and never change deterministic Council authority.';

create index if not exists ai_council_ticker_knowledge_snapshots_ticker_date_idx
  on public.ai_council_ticker_knowledge_snapshots(ticker, as_of_date desc, captured_at desc);

alter table public.ai_council_ticker_knowledge_snapshots enable row level security;
revoke all on table public.ai_council_ticker_knowledge_snapshots from anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.ai_council_ticker_knowledge_snapshots from authenticated;
grant select on table public.ai_council_ticker_knowledge_snapshots to authenticated;
grant all privileges on table public.ai_council_ticker_knowledge_snapshots to service_role;

drop policy if exists ai_council_ticker_knowledge_snapshots_authenticated_read
  on public.ai_council_ticker_knowledge_snapshots;
create policy ai_council_ticker_knowledge_snapshots_authenticated_read
  on public.ai_council_ticker_knowledge_snapshots
  for select
  to authenticated
  using (true);

create or replace function public.qeo_reject_ai_council_ticker_knowledge_snapshot_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'ai_council_ticker_knowledge_snapshots rows are immutable';
end;
$$;

revoke all on function public.qeo_reject_ai_council_ticker_knowledge_snapshot_update()
  from public, anon, authenticated;

drop trigger if exists ai_council_ticker_knowledge_snapshots_no_update
  on public.ai_council_ticker_knowledge_snapshots;
create trigger ai_council_ticker_knowledge_snapshots_no_update
before update on public.ai_council_ticker_knowledge_snapshots
for each row execute function public.qeo_reject_ai_council_ticker_knowledge_snapshot_update();

commit;
