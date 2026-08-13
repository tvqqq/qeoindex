-- Baseline extension required for UUID generation in later operational schemas.
-- Operational tables, queues, RPCs, and schedules intentionally belong to later PRs.
create extension if not exists pgcrypto with schema extensions;
