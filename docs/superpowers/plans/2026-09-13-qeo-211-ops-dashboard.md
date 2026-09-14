# QEO-211 Private Operations Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a lightweight private mobile-first PWA operations cockpit under `services/ops-dashboard/` that aggregates Beszel, QeoIndex job/EOD state, and an explicit unconfigured Gatus provider without shipping admin UI in the public Vercel app.

**Architecture:** A small Node HTTP service serves static PWA assets and a read-only `/api/snapshot` endpoint. Server-side providers normalize Beszel, canonical admin job health, and Gatus state into one fail-closed health model; Docker publishes the service only on host loopback and Tailscale Serve exposes `/ops` privately.

**Tech Stack:** Node 22+, TypeScript, esbuild, existing `@supabase/supabase-js`, Docker Compose, systemd, Tailscale Serve, Node `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-13-qeo-211-ops-dashboard-design.md`

## Global Constraints

- Same repository, separate deployable service under `services/ops-dashboard/`.
- Do not add QEO-211 under public Next.js `app/`.
- No new runtime dependency.
- No browser-visible Beszel, Gatus, Supabase service-role, SSH, or infrastructure credentials.
- Phase 1 is read-only.
- Operational API responses use `Cache-Control: no-store` and are never service-worker cached.
- Gatus is `unknown / Not configured` until QEO-203 exists.
- Host publication is loopback-only; no Funnel and no new public UFW ingress.
- UI obeys `docs/UI_LESSONS_LEARNED.md`: no persistent large blur/filter surfaces, no `transition-all`, no continuous decorative animation.
- Runtime/UpCloud deployment and real-device smoke are not executed without explicit runtime authorization.

---

### Task 1: RED contract and Vercel isolation

**Files:**
- Modify: `tests/build-impact.test.ts`
- Modify later in GREEN: `scripts/build-impact.mjs`

**Interfaces:**
- Consumes: existing `isRuntimeBuildRelevant(path)` and `needsVercelBuild(paths)`.
- Produces: deterministic source contract covering QEO-211 file presence, private deployment boundary, health-state semantics and Vercel isolation.

- [ ] **Step 1: Add failing QEO-211 tests before production code**

Add tests that require `services/ops-dashboard/` source/deploy/PWA files, require service-only paths to be excluded from public Vercel build impact, and dynamically verify the future health-state helpers.

- [ ] **Step 2: Verify RED in GitHub Actions**

Expected failure reasons before implementation:

```text
services/ops-dashboard/... must exist
services/ops-dashboard/src/server.ts must not require public Vercel build
```

The RED run must fail because QEO-211 source and build-impact exclusion do not exist yet, not because of syntax or manifest errors.

- [ ] **Step 3: Commit RED evidence**

```text
test(qeo-211): add failing ops dashboard contract
```

### Task 2: Core health model and server-side providers

**Files:**
- Create: `services/ops-dashboard/src/health.ts`
- Create: `services/ops-dashboard/src/providers/beszel.ts`
- Create: `services/ops-dashboard/src/providers/jobs.ts`
- Create: `services/ops-dashboard/src/providers/gatus.ts`
- Create: `services/ops-dashboard/src/snapshot.ts`
- Create: `services/ops-dashboard/server-only.ts`

**Interfaces:**
- Produces `HealthState`, `ProviderSnapshot<T>`, `overallHealthState()`, `loadOperationsSnapshot()`.
- Beszel returns host metrics and container status or fail-closed `unknown`.
- Jobs reuses `loadAdminJobsSnapshot()` from `modules/admin/job-health.ts`.
- Gatus returns explicit `unknown / Not configured` until QEO-203.

- [ ] **Step 1: Implement minimal health model required by RED tests**

```ts
export type HealthState = "healthy" | "degraded" | "critical" | "unknown"

export function overallHealthState(states: HealthState[]): HealthState {
  if (states.includes("critical")) return "critical"
  if (states.includes("degraded")) return "degraded"
  if (states.includes("unknown")) return "unknown"
  return "healthy"
}
```

- [ ] **Step 2: Implement Gatus fail-closed provider**

Return a `ProviderSnapshot` with `status: "unknown"`, `data: null`, and `message: "Not configured"` when no Gatus endpoint exists.

- [ ] **Step 3: Implement Jobs provider using canonical admin health**

Call `loadAdminJobsSnapshot()`, select `qeoindex.eod_pipeline`, sanitize the response to the fields needed by QEO-211, and map existing admin states to QEO-211 health states. Provider errors return `unknown`, never stale green data.

- [ ] **Step 4: Implement Beszel read-only REST adapter**

Use a private base URL plus dedicated read-only user credentials from server environment. Authenticate through PocketBase, read the configured system, latest `system_stats` and container records with bounded timeouts, parse defensively, and return `unknown` on authentication/API/schema failures.

- [ ] **Step 5: Aggregate providers independently**

Use `Promise.allSettled` so one provider failure cannot crash `/api/snapshot`. Compute overall state with `critical > degraded > unknown > healthy`.

### Task 3: Lightweight HTTP service and PWA shell

**Files:**
- Create: `services/ops-dashboard/src/server.ts`
- Create: `services/ops-dashboard/public/index.html`
- Create: `services/ops-dashboard/public/app.js`
- Create: `services/ops-dashboard/public/styles.css`
- Create: `services/ops-dashboard/public/manifest.webmanifest`
- Create: `services/ops-dashboard/public/sw.js`
- Create: `services/ops-dashboard/public/icon.svg`

**Interfaces:**
- `GET /healthz` returns process liveness only.
- `GET /api/snapshot` returns current normalized provider state with `Cache-Control: no-store`.
- Static PWA assets are served from the service root.

- [ ] **Step 1: Implement read-only server routes**

Use Node built-in `http`, explicit content types, `GET`/`HEAD` only, request timeout protection, no mutation endpoints, and no secrets in error bodies.

- [ ] **Step 2: Implement mobile-first cockpit**

Home renders overall state, alerts/attention items, Host summary, service-health state and latest EOD. Bottom navigation switches Home / Host / Services / Jobs / More without framework runtime overhead.

- [ ] **Step 3: Implement freshness/offline behavior**

Client refreshes on demand and periodically while visible. Failed fetch marks the visible snapshot offline/stale; it does not convert old data to healthy or persist operational payloads in storage.

- [ ] **Step 4: Implement conservative service worker**

Cache only static shell assets. Bypass `/api/` and `/healthz` entirely so operational data is always network-derived.

### Task 4: Build, private deployment contract and docs

**Files:**
- Create: `services/ops-dashboard/build.mjs`
- Create: `services/ops-dashboard/Dockerfile`
- Create: `services/ops-dashboard/deploy/upcloud/docker-compose.upcloud.yml`
- Create: `services/ops-dashboard/deploy/upcloud/qeo-ops-dashboard.service`
- Create: `services/ops-dashboard/ops-dashboard.env.example`
- Create: `services/ops-dashboard/README.md`
- Create: `docs/operations/ops-dashboard.md`
- Modify: `package.json`
- Modify: `scripts/build-impact.mjs`
- Modify: `docs/README.md`

**Interfaces:**
- `pnpm ops-dashboard:build` bundles the Node server with esbuild.
- Host publishes only `127.0.0.1:8787:8787`.
- Operator runbook exposes `/ops` using Tailscale Serve and explicitly forbids Funnel/public ingress.

- [ ] **Step 1: Add esbuild bundle command**

Mirror the existing EOD worker bundling pattern, including the `server-only` alias needed by shared Supabase code.

- [ ] **Step 2: Add hardened container/deployment files**

Use non-root runtime, `read_only`, bounded tmpfs, `no-new-privileges`, dropped capabilities and resource limits. Docker may listen on all interfaces inside its private container network, but the host publish must be loopback-only.

- [ ] **Step 3: Exclude QEO-211 service-only files from Vercel runtime impact**

Add `services/ops-dashboard/` to the public Vercel build-impact exclusion while keeping root package/config changes runtime-relevant.

- [ ] **Step 4: Document secrets and Tailscale path**

The committed env example contains variable names/placeholders only. Document `/ops -> http://127.0.0.1:8787`, no Funnel, no public UFW rule, and real-device/runtime acceptance as pending.

### Task 5: GREEN verification, review and PR

**Files:**
- Review all QEO-211 changed files.

- [ ] **Step 1: Run GitHub Actions verification on exact branch head**

Required source-level evidence:

```text
Verify / verify
QEO-211 contract tests
TypeScript
lint
Next.js public build
ops-dashboard esbuild bundle
secret scan
```

- [ ] **Step 2: Review diff for security and scope**

Confirm there is no QEO-211 route under public `app/`, no browser credential material, no Docker socket mount, no public host port, no Funnel, no mutation endpoint and no service-worker API cache.

- [ ] **Step 3: Keep runtime acceptance explicit**

Source completion must not be reported as UpCloud/iPhone production acceptance. Real deployment remains a separate explicitly authorized step.

- [ ] **Step 4: Open draft PR and update Linear**

PR should remain draft until source CI is green. QEO-211 remains In Progress until runtime acceptance gates are completed.
