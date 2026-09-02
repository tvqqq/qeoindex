begin;

-- QEO-22: application reads the default watchlist with maybeSingle(), so the
-- database must enforce at most one default row per user. Repair any historical
-- duplicates deterministically before restoring the partial unique index.
with ranked_defaults as (
  select
    id,
    row_number() over (
      partition by user_id
      order by sort_order asc, created_at asc, id asc
    ) as rn
  from public.watchlists
  where is_default = true
)
update public.watchlists as w
set is_default = false
from ranked_defaults as ranked
where w.id = ranked.id
  and ranked.rn > 1;

create unique index if not exists watchlists_one_default_per_user
  on public.watchlists(user_id)
  where is_default = true;

commit;
