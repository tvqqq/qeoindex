begin;

alter table public.kfsp_universe_candidate_snapshots
  add column if not exists price numeric check (price is null or price >= 0),
  add column if not exists price_change_pct numeric;

comment on column public.kfsp_universe_candidate_snapshots.price is
  'KFSP candidate-feed close/last price normalized by kfsp-rating-sync; input evidence for Qeo-derived VNINDEX contributor estimates.';
comment on column public.kfsp_universe_candidate_snapshots.price_change_pct is
  'KFSP candidate-feed 1D price change percent; input evidence for Qeo-derived VNINDEX contributor estimates.';

commit;
