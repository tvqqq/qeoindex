# QeoIndex Beszel private monitoring

QEO-201 deploys Beszel Hub + Agent on the existing UpCloud host as a private monitoring stack. The browser path is tailnet-only through Tailscale Serve; Beszel must not add public UFW ingress or enable Funnel.

## Security boundary

- Hub HTTP binds only to `127.0.0.1:8090`.
- Docker socket proxy binds only to `127.0.0.1:2375` and permits the reviewed read surface with `POST=0`.
- Agent listens to the Hub through `/beszel_socket/beszel.sock`; do not expose `45876`.
- The Agent has no raw `/var/run/docker.sock` mount.
- Built-in Beszel login stays enabled. Do not configure `AUTO_LOGIN` or `TRUSTED_AUTH_HEADER`.
- Real Agent `KEY` / `TOKEN` and Telegram credentials stay on the host and must never be committed or pasted into logs, GitHub, Linear, screenshots, or chat.

## Prepare host paths

These commands are runtime instructions. They are not evidence that deployment has already occurred.

```bash
sudo install -d -o root -g root -m 0750 /opt/qeoindex/state/beszel/hub
sudo install -d -o root -g root -m 0750 /opt/qeoindex/state/beszel/agent
sudo install -d -o qeo -g qeo -m 0750 /opt/qeoindex/env
```

The Hub and Agent images run as UID 0 while the Compose hardening drops all Linux capabilities. Their bind-mounted persistent state therefore stays `root:root 0750`, so the processes can write as the directory owner without restoring `CAP_DAC_OVERRIDE` or widening permissions. The environment directory remains owned by `qeo` because the systemd Compose client runs as `qeo` and must read the Agent env file.

Create `/opt/qeoindex/env/beszel-agent.env` from `deploy/upcloud/beszel-agent.env.example` only after the Hub provides the Agent credentials. Keep the real file mode `0600`.

## Validate Compose

```bash
cd /opt/qeoindex/repo/services/beszel
docker compose -f deploy/upcloud/docker-compose.upcloud.yml config
```

Do not continue if Compose expands a public bind, exposes Agent TCP `45876`, or requires an unreviewed privilege relaxation.

## Bootstrap Hub and Docker read proxy

```bash
docker compose -f deploy/upcloud/docker-compose.upcloud.yml up -d beszel-hub docker-socket-proxy
```

After the Hub is reachable locally, configure the private Tailscale path:

```bash
sudo tailscale serve --bg --https=443 --set-path=/beszel http://127.0.0.1:8090
sudo tailscale serve status
```

Open `https://qeoindex-sg.tail426fe8.ts.net/beszel` from an authorized tailnet device, create the primary Beszel admin account, and add the system `qeoindex-sg`. For Host / IP use:

```text
/beszel_socket/beszel.sock
```

Copy the generated public `KEY` and `TOKEN` into `/opt/qeoindex/env/beszel-agent.env` without printing their values. The expected file shape is:

```dotenv
KEY=<server-side value>
TOKEN=<server-side value>
HUB_URL=http://127.0.0.1:8090
```

Then apply mode `0600`.

## Start the complete stack under systemd

```bash
sudo install -m 0644 deploy/upcloud/qeo-beszel.service /etc/systemd/system/qeo-beszel.service
sudo systemctl daemon-reload
sudo systemctl enable --now qeo-beszel.service
```

Verify the Hub, Agent, and socket proxy independently. Beszel failure must never be allowed to block or restart QeoIndex EOD, realtime ingestion, Hermes, or public application traffic.

## Network invariants

Tailscale Serve is the only intended browser ingress. **Tailscale Funnel must remain disabled.** Do not add a UFW allow rule for `8090`, `45876`, or `2375`.

Acceptance must prove:

- Mac and authorized iPhone can reach `/beszel` through Tailscale HTTPS `443`.
- public `:8090`, `:45876`, and `:2375` are unreachable;
- UFW public ingress is unchanged;
- Funnel remains disabled.

## Telegram notifications

Configure Telegram inside Beszel using its Shoutrrr integration. The syntax below is illustrative only and contains no credential:

```text
telegram://<BOT_TOKEN>@telegram?chats=<CHAT_ID>
```

Never put the real URL in this repository.

Initial alert policy:

| Signal | Warning | Critical |
| --- | --- | --- |
| CPU | >80% sustained 10 min | >95% sustained 5 min |
| RAM | >80% sustained 10 min | >90% sustained 5 min |
| Swap | >50% | >75% |
| Disk | >80% | >90% |
| Container | stopped/unhealthy >2 checks | stopped/unhealthy >5 min |
| Agent/host | transient unavailable warning | unavailable >5 min |

For the alert smoke, temporarily lower one non-dangerous threshold until normal activity triggers it, confirm Telegram receives the alert, restore the approved threshold, and confirm recovery. Never deliberately exhaust production CPU, RAM, swap, or disk.

## Resource acceptance

Measure Hub and Agent separately after stabilization, and report the socket proxy separately so helper overhead is visible.

- `PASS`: Hub + Agent idle RAM `<=150 MB`, no material sustained CPU/swap pressure, and QeoIndex workloads retain headroom.
- `MARGINAL`: Hub + Agent idle RAM `>150 MB` and `<=200 MB`, or measurable but non-disruptive overhead.
- `FAIL`: Hub + Agent idle RAM `>200 MB`, material sustained CPU, worsened swap pressure, or interference with critical QeoIndex workloads.

Final QEO-201 acceptance additionally requires one representative market session and one EOD run. Short legitimate workload spikes are evidence for alert tuning, not automatic failure.

## Upgrade

Pin exact Hub, Agent, and socket-proxy image versions. Never deploy floating `latest` in production.

Before a Beszel upgrade: protect the Hub persistent state, change only reviewed pins, deploy, verify private access + fresh Agent metrics + historical data, and retain the prior pin until acceptance completes. Do not combine a Beszel upgrade with unrelated EOD/realtime production changes.

## Rollback

Disable only the Beszel Serve path and monitoring stack:

```bash
sudo tailscale serve --https=443 --set-path=/beszel off
sudo systemctl disable --now qeo-beszel.service
```

Keep `/opt/qeoindex/state/beszel/hub` intact unless a separately reviewed data restore is required. Rollback must not modify public UFW policy or unrelated Tailscale paths.