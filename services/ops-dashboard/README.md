# QeoIndex private operations dashboard

QEO-211 is a lightweight read-only PWA and server-side health aggregator for authorized QeoIndex operators. It is intentionally separate from the public Next.js/Vercel app.

## Source boundary

- `src/server.ts` — private HTTP/static server.
- `src/providers/beszel.ts` — Beszel read-only PocketBase adapter.
- `src/providers/jobs.ts` — canonical QeoIndex job/EOD adapter via `modules/admin/job-health.ts`.
- `src/providers/gatus.ts` — explicit `Unknown / Not configured` fallback until QEO-203 ships.
- `public/` — static installable PWA shell. Operational API responses are never cached by the service worker.
- `deploy/upcloud/` — loopback-only Docker Compose + systemd source contract.

## Source validation

```bash
pnpm test:build-impact
pnpm ops-dashboard:build
pnpm verify:pr
```

`ops-dashboard:build` writes `services/ops-dashboard/dist/ops-dashboard.mjs`.

## Host-only environment

Create `/opt/qeoindex/env/ops-dashboard.env` from `ops-dashboard.env.example` and fill secrets only on the authorized host.

Required for Jobs/EOD data:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Required for Beszel data:

- `QEO_OPS_BESZEL_URL` — normally the Hub's private/loopback URL.
- `QEO_OPS_BESZEL_EMAIL` — dedicated read-only Beszel account.
- `QEO_OPS_BESZEL_PASSWORD`
- `QEO_OPS_BESZEL_SYSTEM_NAME` — defaults to `qeoindex-sg`.

Do not put real values in Git or browser-visible files.

## Private deployment contract

The Compose file publishes only:

```text
127.0.0.1:8787 -> ops-dashboard:8787
```

After the source is deployed and runtime work is explicitly authorized, the intended private route is:

```bash
sudo tailscale serve --bg --https=443 --set-path=/ops http://127.0.0.1:8787
```

Do not enable Tailscale Funnel. Do not add a public UFW rule for 8787. Do not publish the service on a public host interface.

The service accepts `/ops/...` as well as root-relative paths so it remains safe across reverse-proxy prefix behavior. A direct `/ops` request redirects to `/ops/` so relative PWA assets stay under the private route.

## Runtime smoke checklist

Runtime steps are **not** part of source-only implementation. When explicitly authorized, verify:

1. `http://127.0.0.1:8787/healthz` succeeds on the host.
2. Public `:8787` is unreachable.
3. `https://qeoindex-sg.tail426fe8.ts.net/ops/` works from authorized Mac/iPhone.
4. PWA installs and launches standalone on iPhone.
5. Wi-Fi and cellular work while Tailscale is connected.
6. Beszel host/container data is real and fresh.
7. EOD/job state matches canonical QeoIndex admin evidence.
8. Gatus remains explicitly Unknown until QEO-203 is deployed.
9. Offline mode clearly marks old data stale; `/api/*` is never served from service-worker cache.
10. Idle CPU/RAM overhead remains acceptable on the 2 GB host.

## Security non-goals

Phase 1 has no SSH terminal, deploy controls, Docker controls, service restart buttons, database mutation, or public status page.
