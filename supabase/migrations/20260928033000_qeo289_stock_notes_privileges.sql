begin;

revoke all on table public.stock_notes from anon;
revoke all on table public.stock_notes from authenticated;

grant select, insert, update, delete on public.stock_notes to authenticated;

commit;
