begin;

alter table public.watchlists
  add column if not exists emoji text;

alter table public.watchlists
  drop constraint if exists watchlists_emoji_length_check;

alter table public.watchlists
  add constraint watchlists_emoji_length_check
  check (emoji is null or char_length(emoji) between 1 and 16);

commit;
