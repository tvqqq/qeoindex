alter table public.trade_recommendations enable row level security;
alter table public.signal_events enable row level security;
alter table public.monitor_runs enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.notion_sync_outbox enable row level security;

revoke all on table public.trade_recommendations from anon, authenticated;
revoke all on table public.signal_events from anon, authenticated;
revoke all on table public.monitor_runs from anon, authenticated;
revoke all on table public.notification_outbox from anon, authenticated;
revoke all on table public.notion_sync_outbox from anon, authenticated;

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.create_buy_signal(
  text, timestamptz, numeric, text, numeric, numeric, numeric, numeric,
  text, date, text, text, text, numeric, numeric, text, jsonb, jsonb
) from public, anon, authenticated;
revoke all on function public.close_recommendation(
  uuid, text, timestamptz, numeric, text, numeric, text, text, numeric,
  numeric, numeric, numeric, text, jsonb, jsonb
) from public, anon, authenticated;

grant execute on function public.create_buy_signal(
  text, timestamptz, numeric, text, numeric, numeric, numeric, numeric,
  text, date, text, text, text, numeric, numeric, text, jsonb, jsonb
) to service_role;
grant execute on function public.close_recommendation(
  uuid, text, timestamptz, numeric, text, numeric, text, text, numeric,
  numeric, numeric, numeric, text, jsonb, jsonb
) to service_role;
