begin;

alter table public.market_insight_qeo_ex_vnindex_members
  drop constraint if exists market_insight_qeo_ex_vnindex_members_ticker_check;

alter table public.market_insight_qeo_ex_vnindex_members
  add constraint market_insight_qeo_ex_vnindex_members_ticker_check
  check (ticker ~ '^[A-Z0-9]{3}$');

commit;
