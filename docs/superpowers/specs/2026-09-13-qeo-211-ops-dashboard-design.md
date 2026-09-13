# QEO-211 Private Operations Dashboard Design

**Status:** Approved architecture, source implementation in progress  
**Date:** 2026-09-13  
**Linear:** QEO-211

## Goal

Build a lightweight, installable, mobile-first private PWA that answers one operational question quickly: **is QeoIndex healthy right now, what is degraded, and what needs attention?**

The dashboard aggregates high-signal read-only state from Beszel, QeoIndex job/EOD telemetry, and later Gatus. It is an operations cockpit, not another monitoring collector or Grafana replacement.

## Repository and deployment boundary

QEO-211 stays in the existing `tvqqq/qeoindex` repository, but runs as a separate private service under `services/ops-dashboard/`.

It must not be implemented under the public Next.js `app/` tree and must not rely on the public Vercel deployment for access.

Target topology:

```text
Authorized Mac / iPhone
        |
        | Tailscale private HTTPS
        v
qeoindex-sg.tail426fe8.ts.net
        |
        +-- /ops     -> loopback-published QEO-211 service
        +-- /beszel  -> Beszel
        +-- /gatus   -> Gatus when QEO-203 ships
```

The service is containerized, published only to host loopback, and exposed to authorized tailnet devices through Tailscale Serve. No Funnel and no new public UFW ingress are allowed.

## Runtime choice

Use a small Node HTTP service with static PWA assets instead of a second Next.js runtime.

Reasons:

- keeps idle memory small on the 2 GB / 1 CPU UpCloud host;
- avoids shipping private admin UI in the public Vercel application;
- avoids a second frontend framework/build system;
- keeps server-side adapters and credentials in one small process;
- reuses the repository's TypeScript, esbuild, Supabase modules, CI, docs and security conventions.

No new runtime dependency is required. The service uses Node built-ins plus code already present in the repository.

## Provider model

All upstream integrations normalize to one provider result shape:

```ts
export type HealthState = "healthy" | "degraded" | "critical" | "unknown"

export interface ProviderSnapshot<T> {
  source: "beszel" | "jobs" | "gatus"
  status: HealthState
  observedAt: string
  stale: boolean
  message: string | null
  data: T | null
}
```

The aggregate snapshot exposes provider states plus an overall status. Severity order is:

`critical > degraded > unknown > healthy`.

`unknown` is never promoted to healthy. Missing or unavailable providers stay explicit.

## Beszel adapter

Beszel remains the source of truth for host/container resource monitoring.

The adapter:

- connects only from the server process to the private Beszel Hub URL;
- authenticates with a dedicated read-only Beszel user through the PocketBase API;
- reads the configured QeoIndex system plus recent `system_stats` and container records;
- returns CPU, memory, swap, disk, load, uptime, system reachability and critical-container status when available;
- uses bounded timeouts and fail-closed `unknown` state on API/auth/schema failures;
- never sends Beszel credentials or auth tokens to the browser.

Beszel 0.19.0 API structures are not treated as permanently stable. Parsing is defensive and unknown fields/schema changes degrade to `unknown` rather than inventing values.

## Jobs / EOD adapter

Reuse the existing canonical `modules/admin/job-health.ts` logic rather than creating new telemetry queries.

The adapter calls `loadAdminJobsSnapshot()` server-side and selects high-signal operational state, including:

- QeoIndex EOD pipeline status;
- latest run timestamps and duration;
- current/last execution information;
- sanitized latest error;
- failed/degraded/stale job counts;
- AI model/token usage only when already exposed by the existing admin job model.

No new database schema or telemetry stack is introduced.

## Gatus adapter

QEO-203 is not a prerequisite for the PWA foundation.

Until Gatus is actually available, its provider returns:

- `status = "unknown"`;
- `data = null`;
- message `Not configured`.

The UI must never display fake green state for an unavailable monitoring source.

## HTTP surface

The service exposes only read-only endpoints:

- `GET /healthz` — process liveness; no secrets or upstream data.
- `GET /api/snapshot` — normalized operations snapshot.
- static PWA shell and assets under the service root.

All API responses use `Cache-Control: no-store`. Static shell assets may use conservative cache headers. Operational payloads are never persisted in browser storage.

## PWA behavior

The PWA is optimized for modern iPhone Safari first, then Mac/iPad.

Required UX:

- installable manifest and icon;
- standalone display mode;
- safe-area support;
- compact bottom navigation;
- Home, Host, Services, Jobs and More views;
- explicit Healthy / Degraded / Critical / Unknown states;
- always-visible last-updated/freshness state;
- pull/refresh action;
- clear offline and stale states;
- dark mode;
- no large backdrop blur/filter surfaces, `transition-all`, or continuous decorative animation.

The service worker caches only the static shell. `/api/*` requests are network-only and never served from cache.

## Security

- Private tailnet access is a network boundary, not unlimited authorization.
- Phase 1 is read-only.
- No Docker socket access from QEO-211.
- No Beszel/Gatus/Supabase credentials in client JavaScript, manifest, service worker, HTML, browser storage or cache.
- Server credentials come from a host-only env file.
- Production container drops Linux capabilities, uses `no-new-privileges`, runs as non-root and publishes only to `127.0.0.1` on the host.
- No Tailscale Funnel and no new public UFW ports.

## Deployment

Use a dedicated Docker Compose service with a systemd owner, consistent with existing QeoIndex UpCloud service patterns.

Host-side target:

```text
127.0.0.1:8787 -> ops-dashboard container:8787
```

Tailscale Serve target:

```text
/ops -> http://127.0.0.1:8787
```

The exact production command belongs in the operator runbook and is not executed as part of source-only implementation.

## Failure semantics

- Beszel unavailable: Host provider becomes `unknown`; Jobs and Gatus remain independently evaluated.
- Supabase/job snapshot unavailable: Jobs provider becomes `unknown`; no stale prior result is replayed as current.
- Gatus absent: explicit `Not configured` / `unknown`.
- Client loses network: existing screen stays visible only as visibly offline/stale UI; operational API responses are never returned from service-worker cache.
- One provider failure must not crash the whole snapshot endpoint.

## Testing and acceptance

Source-level gates:

- deterministic contract/unit tests for status aggregation and fail-closed provider semantics;
- guard that `services/ops-dashboard/` changes do not trigger the public Vercel Next.js build by themselves;
- static checks for private loopback publication, no Funnel, no public port and no client-side credentials;
- existing `test:current`, lint, typecheck and build gates;
- dedicated ops-dashboard bundle build.

Runtime acceptance remains separate and requires explicit authorization:

- private `/ops` access over Tailscale;
- iPhone install/add-to-home-screen smoke;
- Wi-Fi and cellular + Tailscale smoke;
- offline/stale behavior;
- Beszel and Jobs real-data checks;
- Gatus integration after QEO-203;
- idle/resource overhead measurement on the 2 GB host.

## Non-goals

- public status page;
- SSH terminal;
- container restart/start/stop controls;
- deployment controls;
- database mutation/admin actions;
- full Beszel/Gatus UI replacement;
- Prometheus/Grafana stack;
- push notifications in Phase 1.
