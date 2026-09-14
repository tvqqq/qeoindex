# Beszel private host/container monitoring

Status: source contract implemented; production runtime acceptance pending.

QEO-201 owns lightweight historical host/container resource monitoring for `qeoindex-sg`. Beszel is observability only: its failure must never block QeoIndex EOD, realtime ingestion, Hermes, or public application traffic.

## Ownership boundary

- **Beszel / QEO-201:** host and container resource history, resource-pressure alerts, and recoveries.
- **Gatus / QEO-203:** application, API, data-freshness, and business-health probes.
- **Ops dashboard / QEO-211:** read-only aggregation UI over monitoring sources; it must not become another collector.

Because Beszel Hub and Agent are colocated on the monitored VPS, QEO-201 does not claim independent host-down detection.

## Runtime topology

```text
Authorized Mac / iPhone
        |
        | Tailscale HTTPS :443
        v
qeoindex-sg.tail426fe8.ts.net
        |
        +-- /beszel --> 127.0.0.1:8090 (Beszel Hub)
                              |
                              | /beszel_socket/beszel.sock
                              v
                         Beszel Agent
                              |
                              +-- host metrics
                              +-- 127.0.0.1:2375 Docker read proxy
                                      |
                                      +-- /var/run/docker.sock:ro
```

The exact private Serve command is:

```bash
sudo tailscale serve --bg --https=443 --set-path=/beszel http://127.0.0.1:8090
```

Tailscale Funnel must remain disabled. No UFW rule may expose Beszel Hub, Agent, or Docker proxy. Public `8090`, `45876`, and `2375` are forbidden.

## Agent and Docker boundary

Hub-to-Agent communication uses:

```text
/beszel_socket/beszel.sock
```

The Agent has no raw Docker socket mount. Container discovery goes through the loopback-only Docker socket proxy at `tcp://127.0.0.1:2375`; the proxy alone mounts `/var/run/docker.sock:ro`, exposes only the reviewed read surface, and keeps `POST=0`.

The Agent uses host networking only for host network-interface statistics. Its Beszel listener remains the Unix socket rather than TCP `45876`.

## Persistence and secrets

Persistent paths:

```text
/opt/qeoindex/state/beszel/hub
/opt/qeoindex/state/beszel/agent
```

Runtime Unix socket state is not backup material.

Agent secrets live only in:

```text
/opt/qeoindex/env/beszel-agent.env
```

The real `KEY` and `TOKEN`, Telegram bot token/chat identifier, SSH material, Supabase credentials, and unrelated QeoIndex secrets must not be committed or exposed to browsers.

QEO-202 should review Beszel persistent state for backup coverage. It should not back up the runtime Unix socket.

## Authentication and downstream contract

Beszel built-in authentication stays enabled. Do not enable `AUTO_LOGIN` or `TRUSTED_AUTH_HEADER` for convenience.

The future QEO-211 adapter must use a dedicated read-only Beszel account server-side. Browser clients never receive Beszel credentials and never access the Docker proxy or Agent directly.

## Alert policy

Initial thresholds are intentionally conservative and should be tuned only from measured normal market/EOD behavior.

| Signal | Warning | Critical |
| --- | --- | --- |
| CPU | >80% sustained 10 min | >95% sustained 5 min |
| RAM | >80% sustained 10 min | >90% sustained 5 min |
| Swap | >50% | >75% |
| Disk | >80% | >90% |
| Container | stopped/unhealthy >2 checks | stopped/unhealthy >5 min |
| Agent/host | transient unavailable warning | unavailable >5 min |

Telegram/Shoutrrr is the alert channel. Test it by temporarily lowering a safe threshold, observing alert + recovery, then restoring the approved threshold. Do not deliberately exhaust production resources.

## Resource budget

- Target Hub + Agent idle RAM: `<=150 MB`.
- `>150 MB` and `<=200 MB`: `MARGINAL` if QeoIndex remains healthy.
- `>200 MB`, material sustained CPU, worsening swap pressure, or workload interference: `FAIL`.

Socket-proxy overhead is reported separately in addition to Hub + Agent so total monitoring cost remains visible.

## Upgrade and rollback

Production images are explicit version pins, never floating `latest`.

Upgrade sequence:

1. protect current Hub persistent state;
2. review and pin the new image versions;
3. deploy the new pins;
4. verify private `/beszel` access and Agent freshness;
5. verify historical records remain readable;
6. keep the previous pins available until acceptance completes;
7. rollback to previous pins if validation fails.

Rollback must affect only Beszel/Tailscale Serve `/beszel`; it must not alter public UFW rules or unrelated QeoIndex workloads.

## Failure behavior

Monitoring failure is explicit, never green-by-default. Downstream consumers must distinguish unavailable/stale/unknown telemetry rather than replay old metrics as fresh.

Beszel is not an execution dependency for EOD, realtime, Hermes, Vercel traffic, or Gatus. Restart testing must target the Beszel stack only and must not intentionally restart a critical production workload.

## Acceptance evidence

Source configuration is not runtime evidence. Keep every row pending until it is actually verified on the authorized production environment.

| Gate | Evidence | Status |
| --- | --- | --- |
| Mac private `/beszel` HTTPS | Pending runtime acceptance | Pending runtime acceptance |
| iPhone private `/beszel` HTTPS | Pending runtime acceptance | Pending runtime acceptance |
| Public `8090` denied | Pending runtime acceptance | Pending runtime acceptance |
| Public `45876` denied | Pending runtime acceptance | Pending runtime acceptance |
| Public `2375` denied | Pending runtime acceptance | Pending runtime acceptance |
| UFW unchanged | Pending runtime acceptance | Pending runtime acceptance |
| Tailscale Funnel disabled | Pending runtime acceptance | Pending runtime acceptance |
| Fresh host CPU/RAM/swap/disk/network/uptime | Pending runtime acceptance | Pending runtime acceptance |
| Critical container history | Pending runtime acceptance | Pending runtime acceptance |
| Telegram alert received | Pending runtime acceptance | Pending runtime acceptance |
| Telegram recovery received | Pending runtime acceptance | Pending runtime acceptance |
| Stabilized idle Hub + Agent RAM | Pending runtime acceptance | Pending runtime acceptance |
| Socket proxy RAM | Pending runtime acceptance | Pending runtime acceptance |
| Representative market-session baseline | Pending runtime acceptance | Pending runtime acceptance |
| Representative EOD baseline | Pending runtime acceptance | Pending runtime acceptance |
| Final 2 GB host assessment | Pending runtime acceptance | Pending runtime acceptance |

Do not mark QEO-201 Done or update `docs/HANDOVER.md` to describe Beszel as live until all required runtime gates, including market-session and EOD evidence, are real.
