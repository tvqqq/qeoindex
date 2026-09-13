# QeoIndex private operations dashboard

Status: source implementation under QEO-211; production runtime acceptance is pending.

QEO-211 owns the lightweight read-only operations cockpit exposed privately through Tailscale. It aggregates existing monitoring and operational evidence; it does not become another monitoring collector.

## Ownership boundary

- **Beszel / QEO-201:** host/container resource history and infrastructure health.
- **Gatus / QEO-203:** application/API/business-data freshness and synthetic checks.
- **QeoIndex canonical job telemetry:** EOD/cron execution state, phases, errors and AI usage already exposed by the admin job model.
- **QEO-211:** normalized read-only aggregation and mobile-first PWA presentation.

## Repository and deployment

The service lives at `services/ops-dashboard/`. It is not part of the public Next.js `app/` tree and must not be exposed through the public Vercel application.

Production target:

```text
Authorized Mac / iPhone
        |
        | Tailscale private HTTPS
        v
qeoindex-sg.tail426fe8.ts.net
        |
        +-- /ops --> 127.0.0.1:8787 --> qeoindex-ops-dashboard container
```

The Docker host publication must remain exactly loopback-only. Tailscale Funnel and new public UFW ingress are forbidden.

## API contract

The service exposes:

- `GET /healthz` — process liveness only.
- `GET /api/snapshot` — normalized current operations state.
- static PWA assets.

The snapshot uses four health states:

- `healthy`
- `degraded`
- `critical`
- `unknown`

Aggregate severity is `critical > degraded > unknown > healthy`. Missing evidence must stay `unknown`; it must never be rendered as green by default.

Operational API responses are `Cache-Control: no-store`. The service worker caches only the static shell and always uses the network for `/api/*` and `/healthz`.

## Beszel integration

QEO-211 authenticates server-side to Beszel using a dedicated read-only user. Credentials stay in `/opt/qeoindex/env/ops-dashboard.env` and are never returned to the browser.

The adapter reads the configured `systems` record plus recent system/container evidence through Beszel's PocketBase REST API. Parsing is defensive because Beszel's API schema may change between minor versions. Authentication, API, schema, or freshness failures become `unknown`/`degraded` rather than invented metric values.

## Jobs / EOD integration

QEO-211 reuses `modules/admin/job-health.ts` and `loadAdminJobsSnapshot()` as the canonical operational abstraction. It must not introduce duplicate Supabase queries or a second EOD health model merely for the PWA.

The current PWA surfaces the EOD job status, latest start/finish/duration, sanitized error evidence, aggregate job counts, and existing AI model/token usage when present.

## Gatus integration

Until QEO-203 is actually deployed, the Gatus provider intentionally returns:

```text
Unknown / Not configured
```

This is expected behavior and must not block the PWA foundation, Beszel view, or Jobs/EOD view.

## PWA and UI policy

The UI targets iPhone Safari first and provides Home, Host, Services, Jobs and More views with a compact bottom navigation.

It must preserve the repository UI performance rules:

- no large persistent backdrop blur/filter surfaces;
- no `transition-all`;
- no continuous decorative animation;
- stale/offline state remains explicit;
- operational payloads are not stored in localStorage/sessionStorage;
- static-shell caching must never make health data look current while offline.

## Failure behavior

Providers are independent. One failed upstream provider must not crash the aggregate endpoint.

- Beszel unavailable → Host = `unknown`.
- QeoIndex job evidence unavailable → Jobs = `unknown`.
- Gatus absent → Services/Gatus = `unknown` and `Not configured`.
- Browser offline → last visible data is marked offline/stale; no cached API response is substituted.

## Source verification

QEO-211 source should pass:

```text
pnpm test:build-impact
pnpm ops-dashboard:build
pnpm verify:pr
pnpm build
```

The private service path is intentionally excluded from the **public Vercel runtime-impact classifier**. Changes to root package/configuration remain runtime-relevant and still trigger the normal public build gates.

## Production acceptance

Do not mark QEO-211 production-complete from source evidence alone. Runtime acceptance requires explicit authorization and evidence for:

- private `/ops/` Tailscale access;
- no public `8787` exposure and no UFW/Funnel regression;
- real Beszel and job telemetry;
- iPhone Add to Home Screen / standalone launch;
- Wi-Fi and cellular Tailscale smoke;
- offline/stale behavior;
- resource overhead on the 2 GB host;
- Gatus integration when QEO-203 is available.
