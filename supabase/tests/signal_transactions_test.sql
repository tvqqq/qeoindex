BEGIN;
SELECT plan(46);

SELECT has_table('public', 'trade_recommendations', 'recommendation ledger exists');
SELECT has_table('public', 'signal_events', 'signal event ledger exists');
SELECT has_table('public', 'monitor_runs', 'monitor run ledger exists');
SELECT has_table('public', 'notification_outbox', 'notification outbox exists');
SELECT has_table('public', 'notion_sync_outbox', 'Notion outbox exists');
SELECT ok(
  to_regclass('public.one_open_recommendation_per_ticker') is not null,
  'partial unique Open recommendation index exists'
);

SELECT is(
  (SELECT result FROM public.create_buy_signal(
    p_ticker => 'HPG',
    p_signal_at => '2026-08-13 03:00:00+00',
    p_buy_price => 25,
    p_buy_reason => 'test breakout',
    p_stop_price => 24,
    p_risk_pct => 4,
    p_initial_target => 27,
    p_vnindex_entry => 1700,
    p_daily_bias => 'Bullish',
    p_scan_date => '2026-08-12',
    p_confidence => 'MEDIUM',
    p_provider => 'DNSE',
    p_engine_version => 'intraday-v1.0',
    p_volume => 1000000,
    p_rel_volume => 1.5,
    p_idempotency_key => 'buy:HPG:2026-08-12:intraday-v1.0:0300',
    p_notification_payload => '{"message":"BUY HPG"}',
    p_notion_payload => '{"ticker":"HPG"}'
  )),
  'created',
  'BUY transaction creates a recommendation'
);

SELECT is(
  (SELECT result FROM public.create_buy_signal(
    p_ticker => 'HPG',
    p_signal_at => '2026-08-13 03:00:00+00',
    p_buy_price => 25,
    p_buy_reason => 'test breakout',
    p_stop_price => 24,
    p_risk_pct => 4,
    p_initial_target => 27,
    p_vnindex_entry => 1700,
    p_daily_bias => 'Bullish',
    p_scan_date => '2026-08-12',
    p_confidence => 'MEDIUM',
    p_provider => 'DNSE',
    p_engine_version => 'intraday-v1.0',
    p_volume => 1000000,
    p_rel_volume => 1.5,
    p_idempotency_key => 'buy:HPG:2026-08-12:intraday-v1.0:0300'
  )),
  'duplicate',
  'same BUY idempotency key is a no-op'
);

SELECT is(
  (SELECT result FROM public.create_buy_signal(
    p_ticker => 'HPG',
    p_signal_at => '2026-08-13 03:01:00+00',
    p_buy_price => 25.1,
    p_buy_reason => 'overlapping monitor',
    p_stop_price => 24,
    p_risk_pct => 4.38,
    p_initial_target => 27.3,
    p_vnindex_entry => 1700,
    p_daily_bias => 'Bullish',
    p_scan_date => '2026-08-12',
    p_confidence => 'MEDIUM',
    p_provider => 'DNSE',
    p_engine_version => 'intraday-v1.0',
    p_volume => 1001000,
    p_rel_volume => 1.51,
    p_idempotency_key => 'buy:HPG:2026-08-12:intraday-v1.0:0301'
  )),
  'duplicate',
  'partial unique index suppresses a second Open BUY'
);

SELECT is((SELECT count(*) FROM public.trade_recommendations WHERE ticker = 'HPG'), 1::bigint, 'one recommendation persisted');
SELECT is((SELECT count(*) FROM public.signal_events WHERE ticker = 'HPG' AND event_type = 'BUY'), 1::bigint, 'one BUY event persisted');
SELECT is((SELECT count(*) FROM public.notification_outbox no JOIN public.signal_events se ON se.id = no.event_id WHERE se.ticker = 'HPG'), 1::bigint, 'one Telegram outbox item persisted');
SELECT is((SELECT count(*) FROM public.notion_sync_outbox WHERE payload ->> 'ticker' = 'HPG'), 2::bigint, 'recommendation and event Notion work persisted');

SELECT is(
  (SELECT result FROM public.close_recommendation(
    p_recommendation_id => (SELECT id FROM public.trade_recommendations WHERE ticker = 'HPG'),
    p_event_type => 'EXIT_FAIL',
    p_signal_at => '2026-08-13 04:00:00+00',
    p_sell_price => 23.5,
    p_sell_reason => 'hard stop',
    p_vnindex_exit => 1683,
    p_provider => 'DNSE',
    p_engine_version => 'intraday-v1.0',
    p_volume => 1500000,
    p_rel_volume => 1.8,
    p_max_favorable_pct => 1,
    p_max_adverse_pct => -6,
    p_idempotency_key => 'exit:HPG:test:0400',
    p_notification_payload => '{"message":"EXIT HPG"}',
    p_notion_payload => '{"ticker":"HPG"}'
  )),
  'closed',
  'EXIT transaction closes the recommendation'
);

SELECT is(
  (SELECT result FROM public.close_recommendation(
    p_recommendation_id => (SELECT id FROM public.trade_recommendations WHERE ticker = 'HPG'),
    p_event_type => 'EXIT_FAIL',
    p_signal_at => '2026-08-13 04:00:00+00',
    p_sell_price => 23.5,
    p_sell_reason => 'hard stop',
    p_vnindex_exit => 1683,
    p_provider => 'DNSE',
    p_engine_version => 'intraday-v1.0',
    p_volume => 1500000,
    p_rel_volume => 1.8,
    p_max_favorable_pct => 1,
    p_max_adverse_pct => -6,
    p_idempotency_key => 'exit:HPG:test:0400'
  )),
  'duplicate',
  'same EXIT idempotency key is a no-op'
);

SELECT is((SELECT status FROM public.trade_recommendations WHERE ticker = 'HPG'), 'stopped', 'EXIT_FAIL records stopped status');
SELECT is((SELECT count(*) FROM public.signal_events WHERE event_type = 'EXIT_FAIL'), 1::bigint, 'one terminal event persisted');
SELECT is((SELECT count(*) FROM public.notification_outbox no JOIN public.signal_events se ON se.id = no.event_id WHERE se.ticker = 'HPG'), 2::bigint, 'BUY and EXIT notifications are durable');
SELECT is((SELECT count(*) FROM public.notion_sync_outbox WHERE payload ->> 'ticker' = 'HPG'), 4::bigint, 'BUY and EXIT Notion work is durable');
SELECT ok((SELECT alpha_pct is not null FROM public.trade_recommendations WHERE ticker = 'HPG'), 'benchmark alpha is calculated');

SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.trade_recommendations'::regclass), 'recommendations RLS enabled');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.signal_events'::regclass), 'events RLS enabled');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.monitor_runs'::regclass), 'monitor runs RLS enabled');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.notification_outbox'::regclass), 'notification outbox RLS enabled');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.notion_sync_outbox'::regclass), 'Notion outbox RLS enabled');
SELECT ok(not has_table_privilege('anon', 'public.trade_recommendations', 'select'), 'anon cannot read recommendations');
SELECT ok(not has_table_privilege('authenticated', 'public.signal_events', 'select'), 'authenticated browser cannot read events directly');
SELECT ok(
  not has_function_privilege('anon', 'public.create_buy_signal(text,timestamptz,numeric,text,numeric,numeric,numeric,numeric,text,date,text,text,text,numeric,numeric,text,jsonb,jsonb)', 'execute'),
  'anon cannot execute BUY transaction'
);
SELECT ok(has_table_privilege('service_role', 'public.trade_recommendations', 'select'), 'signal monitor can read recommendations');
SELECT ok(has_table_privilege('service_role', 'public.trade_recommendations', 'update'), 'signal monitor can update recommendation metrics');
SELECT ok(has_table_privilege('service_role', 'public.monitor_runs', 'insert'), 'signal monitor can create run logs');
SELECT ok(not has_table_privilege('authenticated', 'public.monitor_runs', 'select'), 'authenticated browser cannot read monitor internals');
SELECT is((SELECT count(*) FROM public.claim_notification_outbox(1)), 1::bigint, 'one Telegram item can be claimed');
SELECT is((SELECT count(*) FROM public.notification_outbox WHERE status = 'processing'), 1::bigint, 'claimed Telegram item is processing');
SELECT is((SELECT max(attempt_count) FROM public.notification_outbox), 1, 'Telegram claim increments attempt count');
SELECT is((SELECT count(*) FROM public.notification_outbox WHERE status = 'pending'), 1::bigint, 'unclaimed Telegram item remains pending');
SELECT is((SELECT count(*) FROM public.claim_notion_sync_outbox(2)), 2::bigint, 'bounded Notion batch can be claimed');
SELECT is((SELECT count(*) FROM public.notion_sync_outbox WHERE status = 'processing'), 2::bigint, 'claimed Notion work is processing');
SELECT is((SELECT count(*) FROM public.notion_sync_outbox WHERE status = 'pending'), 2::bigint, 'unclaimed Notion work remains pending');
SELECT ok(has_function_privilege('service_role', 'public.claim_notification_outbox(integer)', 'execute'), 'service role can claim Telegram work');
SELECT ok(not has_function_privilege('anon', 'public.claim_notification_outbox(integer)', 'execute'), 'anon cannot claim Telegram work');
SELECT ok(not has_function_privilege('authenticated', 'public.claim_notion_sync_outbox(integer)', 'execute'), 'authenticated browser cannot claim Notion work');
UPDATE public.notification_outbox SET status = 'dead';
ALTER TABLE public.notification_outbox DISABLE TRIGGER notification_outbox_set_updated_at;
UPDATE public.notification_outbox SET status = 'processing', attempt_count = 4, updated_at = now() - interval '6 minutes'
WHERE id = (SELECT id FROM public.notification_outbox ORDER BY created_at LIMIT 1);
ALTER TABLE public.notification_outbox ENABLE TRIGGER notification_outbox_set_updated_at;
SELECT is((SELECT count(*) FROM public.claim_notification_outbox(1)), 1::bigint, 'expired worker lease is reclaimed');
SELECT is((SELECT max(attempt_count) FROM public.notification_outbox WHERE status = 'processing'), 5, 'lease reclaim consumes the final attempt');
ALTER TABLE public.notification_outbox DISABLE TRIGGER notification_outbox_set_updated_at;
UPDATE public.notification_outbox SET updated_at = now() - interval '6 minutes' WHERE status = 'processing';
ALTER TABLE public.notification_outbox ENABLE TRIGGER notification_outbox_set_updated_at;
SELECT is((SELECT count(*) FROM public.claim_notification_outbox(1)), 0::bigint, 'expired final lease is not claimed again');
SELECT ok(not exists (SELECT 1 FROM public.notification_outbox WHERE status <> 'dead'), 'expired final lease is dead-lettered');

SELECT * FROM finish();
ROLLBACK;
