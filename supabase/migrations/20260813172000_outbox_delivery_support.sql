alter table public.notification_outbox
  add column telegram_message_id text;

alter table public.trade_recommendations
  add column notion_page_id text unique;

alter table public.signal_events
  add column notion_page_id text unique;

grant select, update on table public.signal_events to service_role;
grant select, update on table public.notification_outbox to service_role;
grant select, update on table public.notion_sync_outbox to service_role;

create function public.claim_notification_outbox(p_limit integer default 10)
returns setof public.notification_outbox
language sql
security definer
set search_path = ''
as $$
  with abandoned as (
    update public.notification_outbox stale
    set status = 'dead', last_error = coalesce(stale.last_error, 'Worker lease expired after final attempt')
    where stale.status = 'processing' and stale.updated_at <= now() - interval '5 minutes' and stale.attempt_count >= 5
  ), claimed as (
    update public.notification_outbox as item
    set status = 'processing', attempt_count = item.attempt_count + 1
    where item.id in (
      select candidate.id
      from public.notification_outbox candidate
      where (
        (candidate.status in ('pending', 'failed') and candidate.next_attempt_at <= now())
        or (candidate.status = 'processing' and candidate.updated_at <= now() - interval '5 minutes')
      )
        and candidate.attempt_count < 5
      order by candidate.created_at
      for update skip locked
      limit greatest(1, least(p_limit, 50))
    )
    returning item.*
  )
  select claimed.* from claimed;
$$;

create function public.claim_notion_sync_outbox(p_limit integer default 10)
returns setof public.notion_sync_outbox
language sql
security definer
set search_path = ''
as $$
  with abandoned as (
    update public.notion_sync_outbox stale
    set status = 'dead', last_error = coalesce(stale.last_error, 'Worker lease expired after final attempt')
    where stale.status = 'processing' and stale.updated_at <= now() - interval '5 minutes' and stale.attempt_count >= 5
  ), claimed as (
    update public.notion_sync_outbox as item
    set status = 'processing', attempt_count = item.attempt_count + 1
    where item.id in (
      select candidate.id
      from public.notion_sync_outbox candidate
      where (
        (candidate.status in ('pending', 'failed') and candidate.next_attempt_at <= now())
        or (candidate.status = 'processing' and candidate.updated_at <= now() - interval '5 minutes')
      )
        and candidate.attempt_count < 5
      order by
        case when candidate.entity_type = 'trade_recommendation' then 0 else 1 end,
        candidate.created_at
      for update skip locked
      limit greatest(1, least(p_limit, 50))
    )
    returning item.*
  )
  select claimed.* from claimed;
$$;

revoke all on function public.claim_notification_outbox(integer) from public, anon, authenticated;
revoke all on function public.claim_notion_sync_outbox(integer) from public, anon, authenticated;
grant execute on function public.claim_notification_outbox(integer) to service_role;
grant execute on function public.claim_notion_sync_outbox(integer) to service_role;
