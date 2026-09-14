begin;

drop policy if exists "qeo216_authenticated_orderbook_broadcast_read" on "realtime"."messages";

create policy "qeo216_authenticated_orderbook_broadcast_read"
on "realtime"."messages"
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and (select realtime.topic()) ~ '^orderbook:v1:[0-9]{2}$'
);

commit;
