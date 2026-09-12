# QeoIndex EOD worker

Standalone Node runtime for the canonical EOD v4 graph. The UpCloud systemd timer fires at 15:01 ICT Monday-Friday; readiness gates decide when same-session data is actually safe to publish.

Build with `pnpm eod:worker:build` or Docker Compose under `deploy/upcloud`. Production secrets live in `/opt/qeoindex/env/eod-worker.env` and must never be committed or printed. The service exposes no ports and runs as a transient one-shot container.

Cutover order: install timer disabled, smoke the worker, deactivate the legacy Supabase 15:15 owner, verify it is inactive, then enable `qeo-eod.timer`.
