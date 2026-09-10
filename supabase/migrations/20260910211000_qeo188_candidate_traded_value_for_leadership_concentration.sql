begin;

alter table public.kfsp_universe_candidate_snapshots
  add column if not exists traded_value_1d_billion numeric
    check (traded_value_1d_billion is null or traded_value_1d_billion >= 0);

comment on column public.kfsp_universe_candidate_snapshots.traded_value_1d_billion is
  'KFSP exact 1D traded value in billion VND; factual input for QEO-188 leadership liquidity concentration.';

commit;
