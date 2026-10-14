# QeoIndex EOD worker

Standalone Node runtime for the canonical EOD v4 graph. The production systemd timer fires at 15:01 ICT Monday-Friday; readiness gates decide when same-session data is actually safe to publish.

Build with `pnpm eod:worker:build` or Docker Compose under `deploy/upcloud`. Production secrets live in `/opt/qeoindex/env/eod-worker.env` and must never be committed or printed. The service exposes no ports and runs as a transient one-shot container.

Cutover order: install timer disabled, smoke the worker, deactivate the legacy Supabase 15:15 owner, verify it is inactive, then enable `qeo-eod.timer`.

## Releasing EOD changes

The production EOD timer runs a separately built Docker image. A Vercel Git deployment does not update this image. When the shared EOD orchestrator, runtime steps or data contracts change, update the clean worker checkout to the CI-approved main revision and rebuild the canonical Compose service with `--build-arg VCS_REF=<approved-main-sha>`. Retain the prior image as a rollback tag. Read back `org.opencontainers.image.revision` and the worker bundle before accepting the release; do not start another full EOD run merely to verify an image update.

The service rejects pipeline collection without a valid explicit `ratingSyncRunId`. An accepted ID still needs a completed same-session source and all source-quality gates. Recovery must use original persisted session inputs and the guarded publisher RPC rather than fetching current provider data for older dates.
