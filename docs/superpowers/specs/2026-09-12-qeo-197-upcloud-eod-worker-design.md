# QEO-197 UpCloud EOD Worker Design

## Goal
Move canonical Unified EOD execution from the Supabase-triggered Vercel Workflow owner to a single UpCloud Node worker scheduled at 15:01 ICT on trading weekdays, without changing canonical EOD data contracts.

## Scheduling contract
The UpCloud systemd timer fires at 15:01 ICT Monday-Friday. Trigger time is not readiness: MARKET_CLOSE_COLLECT and EOD_READY remain fail-closed gates. MARKET_CLOSE_COLLECT gets six total attempts with five-minute spacing; retries are scheduled from the actual failure time so a delayed upstream phase cannot consume later retries instantly. EOD_READY keeps four total attempts with five-minute spacing using the same relative retry rule.

## Runtime architecture
The existing business graph moves into `modules/eod/orchestrator.ts`. The Vercel Workflow wrapper remains as a rollback path and injects durable `workflow.sleep`; the UpCloud CLI injects native Node sleep. Existing `"use step"` functions remain unchanged and are called by the shared orchestrator.

The production worker is bundled with pinned esbuild into a single ESM artifact. `server-only` is aliased to an empty build-time module because it is a Next compile-time guard, not a runtime dependency. The runtime image contains Node plus the bundle only; it exposes no ports.

## UpCloud deployment
`services/eod-worker` owns the Dockerfile, build script, Compose file, systemd service, and timer. The service is oneshot and uses `docker compose run --rm` so no idle EOD container consumes RAM. Initial limits are 900 MiB RAM and 0.85 CPU. Secrets live only in `/opt/qeoindex/env/eod-worker.env` with mode 0600.

## Scheduler cutover
The old `qeoindex-eod-pipeline-1515-ict` pg_cron definition is retained but made inactive for rollback. Cutover order is: install/build/smoke UpCloud worker; install timer disabled; deactivate old Supabase owner and verify inactive; enable UpCloud timer and verify exactly one owner. Rollback reverses that order.

## Safe verification
Saturday/non-trading manual smoke must create a durable skipped EOD run and exit successfully without publish. Production acceptance remains the first trading-day run: same-session readiness, canonical universe, history, Wyckoff, validation, publish, AI Council, Market Synthesis, retention, Notion summary, resource usage, and no duplicate owner.

## Security
No public ports. Worker runs as non-root in a read-only container with dropped capabilities and `no-new-privileges`. Secrets are never committed or printed. UFW remains unchanged.
