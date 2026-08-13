-- Daily scanner writes the canonical scan first, then queues its asynchronous
-- Notion mirror. Keep the service role limited to the existing outbox table.
grant insert on table public.notion_sync_outbox to service_role;
