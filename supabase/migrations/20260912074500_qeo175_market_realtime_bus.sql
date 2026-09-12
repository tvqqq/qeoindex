begin;

create table if not exists public.market_realtime_bus (
  stream text primary key,
  sequence bigint not null,
  provider text not null default 'DNSE',
  frames jsonb not null default '[]'::jsonb,
  source_updated_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint market_realtime_bus_stream_check check (stream ~ '^[a-z0-9_-]{2,40}$'),
  constraint market_realtime_bus_frames_array_check check (jsonb_typeof(frames) = 'array'),
  constraint market_realtime_bus_payload_size_check check (octet_length(frames::text) <= 524288)
);

alter table public.market_realtime_bus replica identity full;
alter table public.market_realtime_bus enable row level security;

revoke all on table public.market_realtime_bus from public, anon, authenticated;
grant select on public.market_realtime_bus to authenticated;
grant all on table public.market_realtime_bus to service_role;

drop policy if exists "Authenticated read access to market realtime bus" on public.market_realtime_bus;
create policy "Authenticated read access to market realtime bus"
  on public.market_realtime_bus
  for select
  to authenticated
  using (true);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'market_realtime_bus'
  ) then
    alter publication supabase_realtime add table public.market_realtime_bus;
  end if;
end
$$;

comment on table public.market_realtime_bus is
  'QEO-175 bounded current-state bus for centralized provider realtime. One coalesced batch per stream replaces browser-to-provider fanout.';

commit;
