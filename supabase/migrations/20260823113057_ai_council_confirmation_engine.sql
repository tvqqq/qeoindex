create or replace function public.refresh_ai_council_confirmations(p_expiry_sessions integer default 10)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  source_row record;
  event_run_id uuid;
  event_date date;
  event_price numeric;
  event_session_no integer;
  event_status text;
  observed_sessions integer;
  affected integer := 0;
begin
  insert into public.ai_council_confirmations (source_run_id, ticker, source_as_of_date)
  select r.id, r.ticker, r.as_of_date
  from public.ai_council_runs r
  where r.signal = 'BUY_ON_CONFIRMATION'
  on conflict (source_run_id) do nothing;

  for source_row in
    select c.source_run_id, c.ticker, c.source_as_of_date
    from public.ai_council_confirmations c
  loop
    event_run_id := null;
    event_date := null;
    event_price := null;
    event_session_no := null;
    event_status := null;

    with daily_runs as (
      select distinct on (r.ticker, r.as_of_date)
        r.id, r.ticker, r.as_of_date, r.price, r.signal, r.risk_status, r.confirmation_pending, r.created_at
      from public.ai_council_runs r
      where r.ticker = source_row.ticker
        and r.as_of_date > source_row.source_as_of_date
      order by r.ticker, r.as_of_date, r.created_at desc
    ), numbered as (
      select d.*, row_number() over (order by d.as_of_date) as session_no
      from daily_runs d
    )
    select n.id, n.as_of_date, n.price, n.session_no,
      case
        when n.signal = 'BUY' and n.risk_status = 'approve' and n.confirmation_pending = false then 'triggered'
        else 'failed'
      end
    into event_run_id, event_date, event_price, event_session_no, event_status
    from numbered n
    where n.session_no <= greatest(1, p_expiry_sessions)
      and (
        (n.signal = 'BUY' and n.risk_status = 'approve' and n.confirmation_pending = false)
        or n.signal in ('REDUCE', 'SELL')
        or n.risk_status = 'veto'
      )
    order by n.as_of_date
    limit 1;

    select count(*)::integer
    into observed_sessions
    from (
      select distinct r.as_of_date
      from public.ai_council_runs r
      where r.ticker = source_row.ticker
        and r.as_of_date > source_row.source_as_of_date
    ) d;

    update public.ai_council_confirmations c
    set
      status = case
        when event_run_id is not null then event_status
        when observed_sessions >= greatest(1, p_expiry_sessions) then 'expired'
        else 'pending'
      end,
      resolved_date = case
        when event_run_id is not null then event_date
        when observed_sessions >= greatest(1, p_expiry_sessions) then (
          select max(x.as_of_date) from (
            select distinct r.as_of_date
            from public.ai_council_runs r
            where r.ticker = source_row.ticker
              and r.as_of_date > source_row.source_as_of_date
            order by r.as_of_date
            limit greatest(1, p_expiry_sessions)
          ) x
        )
        else null
      end,
      trigger_run_id = case when event_status = 'triggered' then event_run_id else null end,
      trigger_price = case when event_status = 'triggered' then event_price else null end,
      sessions_waited = least(coalesce(event_session_no, observed_sessions), 60)::smallint,
      reason = case
        when event_status = 'triggered' then 'Structured confirmation: a later final daily Council run reached BUY with risk APPROVE and confirmation_pending=false.'
        when event_status = 'failed' then 'Conditional thesis failed before confirmation because a later final daily run reached REDUCE/SELL or Risk VETO.'
        when observed_sessions >= greatest(1, p_expiry_sessions) then format('No confirmation within %s later trading sessions.', greatest(1, p_expiry_sessions))
        else 'Waiting for a later BUY + Risk APPROVE + confirmation_pending=false state.'
      end,
      last_refreshed_at = now()
    where c.source_run_id = source_row.source_run_id;

    affected := affected + 1;
  end loop;

  update public.ai_council_confirmations c
  set
    trigger_return_5d_pct = o.return_5d_pct,
    trigger_alpha_5d_pct = o.alpha_5d_pct,
    trigger_direction_correct_5d = case when o.return_5d_pct is null then null else o.return_5d_pct > 0 end,
    last_refreshed_at = now()
  from public.ai_council_outcomes o
  where c.status = 'triggered'
    and c.trigger_run_id = o.run_id;

  return affected;
end;
$$;

revoke all on function public.refresh_ai_council_confirmations(integer) from public;
revoke all on function public.refresh_ai_council_confirmations(integer) from anon;
revoke all on function public.refresh_ai_council_confirmations(integer) from authenticated;
grant execute on function public.refresh_ai_council_confirmations(integer) to service_role;
