# QEO-201 — Private Beszel monitoring on UpCloud

Date: 2026-09-13
Status: Approved design
Linear: QEO-201

## Purpose

Deploy lightweight historical host and container monitoring for `qeoindex-sg` without widening the public attack surface or materially reducing headroom on the existing 1 CPU / 2 GB UpCloud host.

Beszel owns host/container resource history and resource-pressure alerts. It is not an independent external uptime monitor and must not become a runtime dependency of QeoIndex EOD, realtime ingestion, Hermes, or future operations UI.

## Decisions

The approved topology is:

- Beszel Hub and Beszel Agent run on the same UpCloud host.
- Both are deployed as a dedicated Docker Compose stack following existing QeoIndex UpCloud hardening patterns.
- Hub-to-Agent monitoring uses a shared Unix socket, not the default agent TCP port.
- Beszel UI is private-only behind Tailscale Serve at `/beszel` on the existing tailnet HTTPS origin.
- No Tailscale Funnel, no new public UFW ingress, and no public `8090` or `45876` listener.
- Beszel keeps its own normal login flow.
- A future QEO-211 integration uses a Beszel read-only account server-side; browser clients never receive Beszel credentials.
- Telegram is the notification channel for actionable Beszel alerts and recoveries.

## Target topology

```text
Authorized Mac / iPhone
        |
        | Tailscale HTTPS :443
        v
qeoindex-sg.tail426fe8.ts.net
        |
        | Tailscale Serve path routing
        +---- /beszel ----> Beszel Hub
                              |
                              | shared Unix socket
                              v
                         Beszel Agent
                              |
                              +---- host metrics
                              +---- Docker socket (read-only)
                              +---- container metrics
```

The expected external path is:

```text
https://qeoindex-sg.tail426fe8.ts.net/beszel
```

The Hub must not be directly reachable from the public Internet. Tailscale Serve is the only intended browser ingress path.

## Hub and Agent deployment

### Beszel Hub

The Hub runs as a dedicated container with persistent application data. It is exposed only to the local/private routing boundary required by Tailscale Serve.

`APP_URL` must match the private subpath origin:

```text
https://qeoindex-sg.tail426fe8.ts.net/beszel
```

The deployment must pin an explicit reviewed Beszel version. Floating `latest` tags are not accepted for production operation.

### Beszel Agent

The Agent runs on the same host and listens on a shared Unix socket such as:

```text
/beszel_socket/beszel.sock
```

This follows Beszel's recommended same-host Docker pattern and avoids exposing the default agent TCP listener.

The Agent may mount the Docker socket only read-only:

```text
/var/run/docker.sock:/var/run/docker.sock:ro
```

No direct writable Docker control is required or permitted.

Host network access may be used where Beszel requires it for host network statistics, but the Agent listener remains the Unix socket rather than a TCP port.

## Container hardening

The Beszel stack should follow the existing QeoIndex UpCloud deployment posture where compatible with the upstream images:

- explicit image versions;
- restart policy scoped to the monitoring stack;
- memory and CPU limits;
- `no-new-privileges` where supported;
- minimal capabilities;
- read-only mounts except explicitly required persistent/runtime paths;
- secrets supplied at deploy time rather than committed to the repository.

Any upstream requirement that prevents one of these controls must be documented in the implementation PR rather than silently weakening the stack.

Beszel must not receive writable access to QeoIndex application directories, Supabase credentials, SSH material, or other unrelated operational secrets.

## Network and access-control boundary

The existing Tailscale least-privilege policy is the network authorization boundary for private web access.

Required invariants:

- authorized Mac retains private TCP 22 and TCP 443 access to UpCloud;
- authorized iPhone retains TCP 443 only;
- no broad tailnet allow-all rule is reintroduced;
- no new public UFW rule is created for Beszel;
- no Tailscale Funnel;
- no Tailscale SSH requirement;
- no subnet-router or exit-node requirement.

Tailscale Serve routes the `/beszel` path to the local Hub. Direct public access to the Hub or Agent must fail.

## Beszel authentication

Tailscale membership is not treated as unlimited application authorization. Beszel retains its built-in user authentication.

The primary operator account may administer Beszel. The future QEO-211 PWA integration must use a dedicated Beszel read-only account and perform Beszel API access only from the ops-dashboard server process.

Do not enable automatic login or trusted-header bypass solely for convenience.

## Metrics scope

QEO-201 collects only high-value infrastructure telemetry:

### Host

- CPU utilization;
- RAM usage and available memory;
- swap usage;
- disk usage;
- load;
- network activity;
- uptime.

### Containers/services

Where present, monitor the critical UpCloud workloads, including:

- `qeo-worker` / EOD worker;
- `qeo-market-realtime` / realtime worker;
- Hermes;
- other explicitly reviewed critical containers.

For containers, retain CPU, RAM, running/health state, restart behavior, and available history exposed by Beszel.

QEO-201 does not add Prometheus, Grafana, another exporter fleet, or a duplicate metrics collector.

## Alert policy

Initial alert thresholds are deliberately conservative and must be tuned after observing at least one normal market session and one EOD run.

| Signal | Warning | Critical |
| --- | --- | --- |
| CPU | >80% sustained 10 min | >95% sustained 5 min |
| RAM | >80% sustained 10 min | >90% sustained 5 min |
| Swap | >50% | >75% |
| Disk | >80% | >90% |
| Container | stopped/unhealthy for >2 checks | stopped/unhealthy for >5 min |
| Agent/host telemetry | unavailable/transient warning | unavailable for >5 min |

These are starting operational thresholds, not immutable limits. Short legitimate EOD spikes must not create persistent alert noise.

After baseline measurement, thresholds should be adjusted only with evidence and documented in the QEO-201 acceptance record.

## Telegram notifications

Beszel sends actionable alerts and recovery notifications through its Telegram/Shoutrrr integration.

Notification goals:

- warning/critical events only;
- explicit recovery events;
- no routine metric digests;
- avoid duplicate noisy alerts for the same condition.

Bot tokens, chat identifiers, and other notification credentials are server-side secrets. They must not be committed to Git, included in browser payloads, or cached by the future PWA.

Because Hub and Agent live on the monitored VPS, a complete host/network outage can prevent Beszel itself from sending the outage notification. QEO-201 therefore does not claim independent host-down detection. Independent service/business monitoring is owned by QEO-203 and may still share this limitation when colocated; true external uptime monitoring would require a separate future design.

## Resource budget

Beszel must remain lightweight relative to the 2 GB host.

Acceptance budget:

- target idle Hub + Agent RAM: <=150 MB total;
- idle CPU: effectively near zero / no sustained material load;
- no meaningful new swap pressure;
- no observable interference with EOD or realtime workers.

Assessment bands:

- `PASS`: idle resource use stays within the target and normal QeoIndex workloads retain headroom.
- `MARGINAL`: idle RAM exceeds 150 MB but remains <=200 MB, or measurable overhead exists without disrupting QeoIndex; requires explicit review before continuing.
- `FAIL`: idle RAM exceeds 200 MB, sustained CPU is material, swap pressure materially worsens, or monitoring interferes with critical QeoIndex workloads.

Peak measurements during a market session and EOD are evidence, not automatic failure if the monitoring stack itself remains small and QeoIndex workloads stay healthy.

## Persistence and backup boundary

Persistent Hub data/config is stored in a dedicated Beszel volume or bind path. The Unix socket is runtime-only and is not backed up.

QEO-201 does not invent a separate backup framework. When QEO-202 Restic is implemented, Beszel persistent state should be reviewed for inclusion in that backup scope.

Secrets must not be stored in repository-tracked compose files or documentation.

## Upgrade and rollback

Production Beszel images are version-pinned.

Upgrade sequence:

1. identify and review the target Hub/Agent versions;
2. protect/backup persistent Hub state as appropriate;
3. deploy the new pinned versions;
4. verify `/beszel` access through Tailscale;
5. verify Agent reconnection and fresh metrics;
6. verify historical data remains readable;
7. retain the previous image version until acceptance completes.

If validation fails, restore the prior pinned images and, only when required, the protected persistent state.

Do not combine a Beszel upgrade with unrelated EOD/realtime production changes unless there is a strong operational reason and explicit review.

## QEO-211 integration contract

The future private PWA under `services/ops-dashboard/` must not read the Docker socket, scrape the host directly, or communicate with the Beszel Agent.

It consumes Beszel through a server-side adapter using a read-only Beszel account and normalizes only the fields the PWA requires.

Representative normalized contract:

```ts
type HostHealth = {
  status: "healthy" | "degraded" | "critical" | "unavailable"
  cpuPct: number | null
  memoryPct: number | null
  swapPct: number | null
  diskPct: number | null
  load: number | null
  uptimeSeconds: number | null
  observedAt: string | null
  freshness: "fresh" | "stale" | "unknown"
}
```

The implementation must bind to the API contract of the actual pinned Beszel version. Internal PocketBase details are not treated as a stable cross-version contract unless verified.

Browser clients never receive Beszel credentials.

## Failure behavior

Monitoring failure must never look healthy.

If the Hub is unavailable, authentication fails, the upstream API shape changes, or telemetry becomes stale, the future PWA reports `Unavailable`, `Stale`, or `Unknown` rather than replaying old values as fresh health data.

Beszel failure must not block:

- EOD execution;
- realtime ingestion;
- Hermes;
- public QeoIndex application traffic;
- other critical workers.

Tailscale Serve path failure affects the Beszel presentation path only and must not alter public UFW rules or the critical application runtime.

## Safe acceptance tests

Production acceptance requires evidence for all of the following:

1. Mac can reach `/beszel` through the private Tailscale HTTPS origin.
2. Authorized iPhone can reach `/beszel` through Tailscale TCP 443.
3. Beszel login succeeds and the dashboard shows fresh host metrics.
4. Historical CPU/RAM/swap/disk data is visible.
5. Critical container metrics/history are visible where those workloads are running.
6. Direct public access to Hub/Agent ports is not available.
7. No new public UFW ingress rule was added.
8. Tailscale Funnel remains disabled.
9. At least one safe alert and its recovery are received through Telegram.
10. Alert testing does not deliberately exhaust production RAM, disk, or CPU; use temporary threshold reduction or a non-critical condition instead.
11. Idle resource usage is measured after stabilization.
12. Resource usage is measured across at least one representative market session and one EOD execution before final PASS/MARGINAL/FAIL assessment.
13. Restart/recovery behavior is verified without intentionally disrupting a critical production workload.

## Non-goals

QEO-201 does not provide:

- public monitoring UI;
- external independent VPS uptime monitoring;
- Grafana/Prometheus replacement;
- container lifecycle controls;
- SSH or deployment controls;
- public status pages;
- PWA implementation;
- Gatus service/business-health checks;
- Restic backup implementation.

## Follow-on dependency contract

QEO-201 produces a private, stable host/container monitoring source for QEO-211.

QEO-203 remains responsible for application/service/business-health checks such as web/API availability, market-data freshness, EOD freshness, and other synthetic probes. QEO-211 aggregates high-signal Beszel and Gatus results rather than duplicating their collectors.
