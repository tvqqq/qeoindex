create function public.create_buy_signal(
  p_ticker text,
  p_signal_at timestamptz,
  p_buy_price numeric,
  p_buy_reason text,
  p_stop_price numeric,
  p_risk_pct numeric,
  p_initial_target numeric,
  p_vnindex_entry numeric,
  p_daily_bias text,
  p_scan_date date,
  p_confidence text,
  p_provider text,
  p_engine_version text,
  p_volume numeric,
  p_rel_volume numeric,
  p_idempotency_key text,
  p_notification_payload jsonb default '{}'::jsonb,
  p_notion_payload jsonb default '{}'::jsonb
)
returns table(result text, recommendation_id uuid, event_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recommendation_id uuid;
  v_event_id uuid;
begin
  select se.recommendation_id, se.id
    into v_recommendation_id, v_event_id
  from public.signal_events se
  where se.idempotency_key = p_idempotency_key;

  if found then
    return query select 'duplicate'::text, v_recommendation_id, v_event_id;
    return;
  end if;

  begin
    insert into public.trade_recommendations (
      ticker, status, buy_signal_at, buy_price, buy_reason, stop_price,
      risk_pct, initial_target, vnindex_entry, outcome, daily_bias,
      scan_date, confidence, provider, engine_version, last_monitor_at,
      last_price, last_rel_volume, max_favorable_pct, max_adverse_pct
    ) values (
      upper(p_ticker), 'open', p_signal_at, p_buy_price, p_buy_reason, p_stop_price,
      p_risk_pct, p_initial_target, p_vnindex_entry, 'open', p_daily_bias,
      p_scan_date, p_confidence, p_provider, p_engine_version, p_signal_at,
      p_buy_price, p_rel_volume, 0, 0
    ) returning id into v_recommendation_id;

    insert into public.signal_events (
      recommendation_id, ticker, event_type, signal_at, price, volume,
      rel_volume, rule, provider, scan_date, daily_bias, stop_price,
      vnindex, engine_version, idempotency_key
    ) values (
      v_recommendation_id, upper(p_ticker), 'BUY', p_signal_at, p_buy_price, p_volume,
      p_rel_volume, p_buy_reason, p_provider, p_scan_date, p_daily_bias, p_stop_price,
      p_vnindex_entry, p_engine_version, p_idempotency_key
    ) returning id into v_event_id;

    insert into public.notification_outbox (event_id, channel, payload)
    values (v_event_id, 'telegram', p_notification_payload);

    insert into public.notion_sync_outbox (
      entity_type, entity_id, operation, idempotency_key, payload
    )
    values
      (
        'trade_recommendation', v_recommendation_id, 'create',
        p_idempotency_key || ':notion:recommendation', p_notion_payload
      ),
      (
        'signal_event', v_event_id, 'create',
        p_idempotency_key || ':notion:event', p_notion_payload
      );
  exception
    when unique_violation then
      select tr.id into v_recommendation_id
      from public.trade_recommendations tr
      where tr.ticker = upper(p_ticker) and tr.status = 'open';

      select se.id into v_event_id
      from public.signal_events se
      where se.idempotency_key = p_idempotency_key;

      return query select 'duplicate'::text, v_recommendation_id, v_event_id;
      return;
  end;

  return query select 'created'::text, v_recommendation_id, v_event_id;
end;
$$;

create function public.close_recommendation(
  p_recommendation_id uuid,
  p_event_type text,
  p_signal_at timestamptz,
  p_sell_price numeric,
  p_sell_reason text,
  p_vnindex_exit numeric,
  p_provider text,
  p_engine_version text,
  p_volume numeric,
  p_rel_volume numeric,
  p_max_favorable_pct numeric,
  p_max_adverse_pct numeric,
  p_idempotency_key text,
  p_notification_payload jsonb default '{}'::jsonb,
  p_notion_payload jsonb default '{}'::jsonb
)
returns table(result text, recommendation_id uuid, event_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recommendation public.trade_recommendations%rowtype;
  v_existing_recommendation_id uuid;
  v_event_id uuid;
  v_return_pct numeric;
  v_vnindex_return_pct numeric;
  v_alpha_pct numeric;
  v_outcome text;
  v_status text;
begin
  if p_event_type not in ('SELL', 'EXIT_FAIL') then
    raise exception 'terminal event_type must be SELL or EXIT_FAIL';
  end if;

  select se.recommendation_id, se.id
    into v_existing_recommendation_id, v_event_id
  from public.signal_events se
  where se.idempotency_key = p_idempotency_key;

  if found then
    return query select 'duplicate'::text, v_existing_recommendation_id, v_event_id;
    return;
  end if;

  select * into v_recommendation
  from public.trade_recommendations tr
  where tr.id = p_recommendation_id
  for update;

  if not found then
    raise exception 'recommendation not found';
  end if;

  if v_recommendation.status <> 'open' then
    return query select 'already_closed'::text, v_recommendation.id, null::uuid;
    return;
  end if;

  v_return_pct := ((p_sell_price - v_recommendation.buy_price) / v_recommendation.buy_price) * 100;
  v_vnindex_return_pct := case
    when v_recommendation.vnindex_entry is not null and p_vnindex_exit is not null
      then ((p_vnindex_exit - v_recommendation.vnindex_entry) / v_recommendation.vnindex_entry) * 100
    else null
  end;
  v_alpha_pct := case when v_vnindex_return_pct is null then null else v_return_pct - v_vnindex_return_pct end;
  v_outcome := case when v_return_pct > 0 then 'win' when v_return_pct < 0 then 'loss' else 'flat' end;
  v_status := case when p_event_type = 'EXIT_FAIL' then 'stopped' else 'closed' end;

  update public.trade_recommendations set
    status = v_status,
    sell_signal_at = p_signal_at,
    sell_price = p_sell_price,
    sell_reason = p_sell_reason,
    return_pct = v_return_pct,
    vnindex_exit = p_vnindex_exit,
    vnindex_return_pct = v_vnindex_return_pct,
    alpha_pct = v_alpha_pct,
    outcome = v_outcome,
    last_monitor_at = p_signal_at,
    last_price = p_sell_price,
    last_rel_volume = p_rel_volume,
    max_favorable_pct = p_max_favorable_pct,
    max_adverse_pct = p_max_adverse_pct
  where id = v_recommendation.id;

  insert into public.signal_events (
    recommendation_id, ticker, event_type, signal_at, price, volume,
    rel_volume, rule, provider, scan_date, daily_bias, stop_price,
    vnindex, engine_version, idempotency_key
  ) values (
    v_recommendation.id, v_recommendation.ticker, p_event_type, p_signal_at,
    p_sell_price, p_volume, p_rel_volume, p_sell_reason, p_provider,
    v_recommendation.scan_date, v_recommendation.daily_bias,
    v_recommendation.stop_price, p_vnindex_exit, p_engine_version,
    p_idempotency_key
  ) returning id into v_event_id;

  insert into public.notification_outbox (event_id, channel, payload)
  values (v_event_id, 'telegram', p_notification_payload);

  insert into public.notion_sync_outbox (
    entity_type, entity_id, operation, idempotency_key, payload
  )
  values
    (
      'trade_recommendation', v_recommendation.id, 'update',
      p_idempotency_key || ':notion:recommendation', p_notion_payload
    ),
    (
      'signal_event', v_event_id, 'create',
      p_idempotency_key || ':notion:event', p_notion_payload
    );

  return query select 'closed'::text, v_recommendation.id, v_event_id;
end;
$$;
