# QEO-201 Beszel UpCloud Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy a version-pinned, private-only Beszel monitoring stack on `qeoindex-sg` with historical host/container telemetry, Telegram alerts, Tailscale-only browser access, and measured overhead on the existing 1 CPU / 2 GB VPS.

**Architecture:** Run Beszel Hub and Agent as a dedicated Docker Compose service under `services/beszel/`. The Hub binds only to loopback and is exposed to authorized tailnet devices through Tailscale Serve at `/beszel`; the Agent uses the approved same-host Unix socket and host networking for host NIC metrics. To satisfy the approved requirement that Beszel must not have writable Docker control, container discovery is mediated by a read-only Docker socket proxy instead of handing the Agent the raw Docker socket API directly.

**Tech Stack:** Beszel `0.19.0`, Docker Compose, LinuxServer Docker Socket Proxy `3.4.3-r0-ls93`, systemd, Tailscale Serve, Telegram/Shoutrrr, Node `node:test` source-contract tests.

**Spec:** `docs/superpowers/specs/2026-09-13-qeo-201-beszel-upcloud-monitoring-design.md`

## Global Constraints

- Production host budget is 1 CPU / 2 GB RAM.
- Browser ingress is private tailnet HTTPS only: `https://qeoindex-sg.tail426fe8.ts.net/beszel`.
- Do not add public UFW ingress for Beszel.
- Do not enable Tailscale Funnel, Tailscale SSH, an exit node, or a subnet router for this work.
- Do not expose Hub port `8090` or Agent port `45876` publicly.
- Hub-to-Agent connectivity uses `/beszel_socket/beszel.sock`; do not switch to an exposed Agent TCP listener.
- Keep Beszel built-in authentication enabled. Do not configure `AUTO_LOGIN` or `TRUSTED_AUTH_HEADER`.
- Pin exact production images. Do not use floating `latest` tags.
- Telegram bot/chat credentials and Beszel Agent `KEY`/`TOKEN` remain server-side secrets outside Git.
- Do not mount QeoIndex app directories, SSH material, Supabase secrets, or unrelated operational state into Beszel.
- Monitoring failure must never block EOD, realtime ingestion, Hermes, or public QeoIndex traffic.
- Target idle Hub + Agent RAM is `<=150 MB`; `>150 MB` and `<=200 MB` is MARGINAL if workloads remain healthy; `>200 MB` idle or material CPU/swap/workload interference is FAIL.
- The Docker socket proxy is a defense-in-depth implementation of the approved “no writable Docker control” requirement; the Agent must not mount `/var/run/docker.sock` directly.
- Do not add D-Bus/systemd control mounts to the Agent in QEO-201. Service/business health belongs to QEO-203.
- Source implementation in ChatGPT Web is inline-only. Shell, Docker, build, local tests, UpCloud commands, and production deployment require an explicitly authorized execution environment. GitHub Actions is the preferred automated verification environment.
- Any task marked **Runtime authorization required** must not be executed on UpCloud until the user explicitly authorizes remote/runtime work for QEO-201.

---

## File map

### New runtime files

- `services/beszel/deploy/upcloud/docker-compose.upcloud.yml` — pinned Hub, Agent, and Docker socket proxy topology; loopback-only ports; resource/security limits; persistent/runtime mounts.
- `services/beszel/deploy/upcloud/qeo-beszel.service` — systemd owner for starting/stopping the Compose stack.
- `services/beszel/deploy/upcloud/beszel-agent.env.example` — secret-free key-name template for the host-only Agent environment file.
- `services/beszel/README.md` — operator-facing bootstrap, smoke, upgrade, rollback, and resource-measurement commands.

### New/updated documentation

- `docs/operations/beszel.md` — active Beszel topology/security/alert contract and acceptance evidence location.
- `docs/README.md` — index the active operations document.
- `docs/HANDOVER.md` — update only after production acceptance so it records actual live architecture rather than planned state.

### Tests

- `tests/qeo201-beszel-upcloud.test.ts` — deterministic source guardrails for image pinning, private bindings, Unix socket use, Docker API mediation, secret handling, and systemd ownership.
- `tests/test-contracts.json` — register the QEO-201 contract in the canonical `fast` suite.

---

### Task 1: Lock the QEO-201 deployment contract RED-first

**Files:**
- Create: `tests/qeo201-beszel-upcloud.test.ts`
- Modify: `tests/test-contracts.json`

**Interfaces:**
- Consumes: approved design spec and existing source-test pattern used by `tests/qeo197-upcloud-eod-worker.test.ts`.
- Produces: a deterministic repository contract that later runtime/config tasks must satisfy.

- [ ] **Step 1: Add the failing source-contract test**

Create `tests/qeo201-beszel-upcloud.test.ts` with these concrete assertions:

```ts
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

const composePath = "services/beszel/deploy/upcloud/docker-compose.upcloud.yml"
const servicePath = "services/beszel/deploy/upcloud/qeo-beszel.service"
const envExamplePath = "services/beszel/deploy/upcloud/beszel-agent.env.example"
const readmePath = "services/beszel/README.md"
const opsDocPath = "docs/operations/beszel.md"

test("QEO-201 Beszel deployment is version-pinned and private-only", () => {
  for (const path of [composePath, servicePath, envExamplePath, readmePath, opsDocPath]) {
    assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), true, `${path} must exist`)
  }

  const compose = source(composePath)
  assert.match(compose, /henrygd\/beszel:0\.19\.0/)
  assert.match(compose, /henrygd\/beszel-agent:0\.19\.0/)
  assert.match(compose, /ghcr\.io\/linuxserver\/socket-proxy:3\.4\.3-r0-ls93/)
  assert.doesNotMatch(compose, /:latest(?:\s|$)/m)
  assert.match(compose, /127\.0\.0\.1:8090:8090/)
  assert.match(compose, /127\.0\.0\.1:2375:2375/)
  assert.doesNotMatch(compose, /0\.0\.0\.0:/)
  assert.doesNotMatch(compose, /45876/)
  assert.match(compose, /APP_URL:\s*https:\/\/qeoindex-sg\.tail426fe8\.ts\.net\/beszel/)
})

test("QEO-201 Agent uses local Unix socket and mediated Docker read access", () => {
  const compose = source(composePath)
  assert.match(compose, /LISTEN:\s*\/beszel_socket\/beszel\.sock/)
  assert.match(compose, /DOCKER_HOST:\s*http:\/\/127\.0\.0\.1:2375/)
  assert.match(compose, /\/var\/run\/docker\.sock:\/var\/run\/docker\.sock:ro/)

  const agentBlock = compose.slice(compose.indexOf("beszel-agent:"))
  assert.doesNotMatch(agentBlock, /\/var\/run\/docker\.sock:/)
  assert.match(compose, /CONTAINERS:\s*["']?1["']?/)
  assert.match(compose, /POST:\s*["']?0["']?/)
})

test("QEO-201 keeps authentication and secrets server-side", () => {
  const compose = source(composePath)
  const envExample = source(envExamplePath)
  assert.doesNotMatch(compose, /AUTO_LOGIN|TRUSTED_AUTH_HEADER/)
  assert.match(compose, /\/opt\/qeoindex\/env\/beszel-agent\.env/)
  assert.match(envExample, /^KEY=$/m)
  assert.match(envExample, /^TOKEN=$/m)
  assert.match(envExample, /^HUB_URL=http:\/\/127\.0\.0\.1:8090$/m)
  assert.doesNotMatch(envExample, /telegram:\/\//)
})

test("QEO-201 stack is bounded and systemd-owned", () => {
  const compose = source(composePath)
  const service = source(servicePath)
  assert.match(compose, /mem_limit:/)
  assert.match(compose, /cpus:/)
  assert.match(compose, /no-new-privileges:true/)
  assert.match(service, /WorkingDirectory=\/opt\/qeoindex\/repo\/services\/beszel/)
  assert.match(service, /docker compose -f deploy\/upcloud\/docker-compose\.upcloud\.yml up -d/)
  assert.match(service, /docker compose -f deploy\/upcloud\/docker-compose\.upcloud\.yml down --timeout 20/)
})

test("QEO-201 runbook preserves Tailscale-only ingress", () => {
  const readme = source(readmePath)
  const ops = source(opsDocPath)
  for (const text of [readme, ops]) {
    assert.match(text, /tailscale serve --bg --https=443 --set-path=\/beszel http:\/\/127\.0\.0\.1:8090/)
    assert.match(text, /Funnel/i)
    assert.match(text, /UFW/i)
  }
})
```

- [ ] **Step 2: Register the test contract**

Add this exact entry to `tests/test-contracts.json`, preserving the file's existing ordering rules:

```json
{
  "path": "tests/qeo201-beszel-upcloud.test.ts",
  "owner": "tooling",
  "invariant": "QEO-201 keeps Beszel version-pinned, private-only, Unix-socket connected, Docker-write-isolated, and bounded on the UpCloud host.",
  "bucket": "canonical",
  "suites": ["fast"]
}
```

- [ ] **Step 3: Verify RED in an authorized verification environment**

Run:

```bash
node --test tests/qeo201-beszel-upcloud.test.ts
pnpm test:manifest
```

Expected before Task 2/3: the QEO-201 test fails because the Beszel runtime/docs files do not exist; the manifest itself should remain structurally valid after the entry is added.

Under ChatGPT Web inline-only policy, do not run these commands locally or on UpCloud unless explicitly authorized. GitHub Actions may perform them after a PR is opened.

- [ ] **Step 4: Commit the RED contract**

```bash
git add tests/qeo201-beszel-upcloud.test.ts tests/test-contracts.json
git commit -m "test(QEO-201): lock private Beszel deployment contract"
```

---

### Task 2: Add the version-pinned hardened Beszel runtime

**Files:**
- Create: `services/beszel/deploy/upcloud/docker-compose.upcloud.yml`
- Create: `services/beszel/deploy/upcloud/qeo-beszel.service`
- Create: `services/beszel/deploy/upcloud/beszel-agent.env.example`

**Interfaces:**
- Consumes: Task 1 source contract.
- Produces: one continuously running `qeo-beszel` service stack with Hub loopback HTTP, local Agent Unix socket, and mediated read-only container discovery.

- [ ] **Step 1: Add the exact Compose topology**

Create `services/beszel/deploy/upcloud/docker-compose.upcloud.yml` with this structure:

```yaml
services:
  beszel-hub:
    image: henrygd/beszel:0.19.0
    container_name: qeo-beszel-hub
    restart: unless-stopped
    environment:
      TZ: Asia/Ho_Chi_Minh
      APP_URL: https://qeoindex-sg.tail426fe8.ts.net/beszel
      CHECK_UPDATES: "false"
      CONTAINER_DETAILS: "false"
      USER_CREATION: "false"
    ports:
      - "127.0.0.1:8090:8090"
    volumes:
      - /opt/qeoindex/state/beszel/hub:/beszel_data
      - beszel_socket:/beszel_socket
    mem_limit: 192m
    cpus: "0.15"
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL

  docker-socket-proxy:
    image: ghcr.io/linuxserver/socket-proxy:3.4.3-r0-ls93
    container_name: qeo-beszel-socket-proxy
    restart: unless-stopped
    environment:
      CONTAINERS: "1"
      EVENTS: "1"
      INFO: "1"
      VERSION: "1"
      POST: "0"
    ports:
      - "127.0.0.1:2375:2375"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    mem_limit: 32m
    cpus: "0.05"
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL

  beszel-agent:
    image: henrygd/beszel-agent:0.19.0
    container_name: qeo-beszel-agent
    restart: unless-stopped
    network_mode: host
    depends_on:
      - beszel-hub
      - docker-socket-proxy
    env_file:
      - /opt/qeoindex/env/beszel-agent.env
    environment:
      TZ: Asia/Ho_Chi_Minh
      LISTEN: /beszel_socket/beszel.sock
      DOCKER_HOST: http://127.0.0.1:2375
    volumes:
      - /opt/qeoindex/state/beszel/agent:/var/lib/beszel-agent
      - beszel_socket:/beszel_socket
    mem_limit: 96m
    cpus: "0.15"
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL

volumes:
  beszel_socket:
```

Implementation notes:

- `127.0.0.1:8090` is the only Hub bind; Tailscale Serve is the browser ingress owner.
- The Agent must not receive `/var/run/docker.sock` directly. The proxy is the only container with the socket mount.
- `POST=0` prevents Docker write-method access through the proxy. Only the read endpoints needed by Beszel are enabled.
- `CONTAINER_DETAILS=false` keeps the Hub focused on monitoring and avoids exposing container shell/log-detail features that QEO-201 does not need.
- `network_mode: host` is retained only for Agent host-network statistics; Agent service ingress remains the Unix socket.
- Hard memory caps are safety ceilings, not acceptance targets. Actual idle usage must still satisfy the approved `<=150 MB` Hub+Agent target or be classified MARGINAL/FAIL from measured evidence.
- If an upstream image genuinely cannot run with a listed hardening control, stop and document the exact failure before relaxing it; do not silently remove hardening.

- [ ] **Step 2: Add the host-only Agent env template**

Create `services/beszel/deploy/upcloud/beszel-agent.env.example`:

```dotenv
KEY=
TOKEN=
HUB_URL=http://127.0.0.1:8090
```

The real host file is `/opt/qeoindex/env/beszel-agent.env`, mode `0600`, and is never committed.

- [ ] **Step 3: Add the systemd owner**

Create `services/beszel/deploy/upcloud/qeo-beszel.service`:

```ini
[Unit]
Description=QeoIndex Beszel private monitoring
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
User=qeo
Group=qeo
WorkingDirectory=/opt/qeoindex/repo/services/beszel
ExecStart=/usr/bin/docker compose -f deploy/upcloud/docker-compose.upcloud.yml up -d --remove-orphans
ExecStop=/usr/bin/docker compose -f deploy/upcloud/docker-compose.upcloud.yml down --timeout 20
TimeoutStartSec=120
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 4: Re-run the focused source contract in an authorized verification environment**

Run:

```bash
node --test tests/qeo201-beszel-upcloud.test.ts
```

Expected after Task 2 but before Task 3: runtime-oriented assertions pass; runbook/doc assertions still fail until their files exist.

- [ ] **Step 5: Commit the runtime contract**

```bash
git add services/beszel/deploy/upcloud
git commit -m "feat(QEO-201): add hardened Beszel UpCloud runtime"
```

---

### Task 3: Add the active Beszel operations runbook

**Files:**
- Create: `services/beszel/README.md`
- Create: `docs/operations/beszel.md`
- Modify: `docs/README.md`

**Interfaces:**
- Consumes: Task 2 Compose/systemd names and paths.
- Produces: one canonical operator runbook and one active architecture contract that QEO-203/QEO-211 can reference without duplicating mutable details.

- [ ] **Step 1: Write `services/beszel/README.md` with executable bootstrap/rollback commands**

The README must include these exact operational phases and commands.

**Prepare host paths:**

```bash
sudo install -d -o qeo -g qeo -m 0750 /opt/qeoindex/state/beszel/hub
sudo install -d -o qeo -g qeo -m 0750 /opt/qeoindex/state/beszel/agent
sudo install -d -o qeo -g qeo -m 0750 /opt/qeoindex/env
```

**Validate Compose before deployment:**

```bash
cd /opt/qeoindex/repo/services/beszel
docker compose -f deploy/upcloud/docker-compose.upcloud.yml config
```

**Bootstrap Hub and socket proxy first:**

```bash
docker compose -f deploy/upcloud/docker-compose.upcloud.yml up -d beszel-hub docker-socket-proxy
```

Then visit the private Hub, create the primary Beszel admin account, create the `qeoindex-sg` system in Beszel, and use `/beszel_socket/beszel.sock` as Host / IP. Copy the generated Agent public `KEY` and `TOKEN` into `/opt/qeoindex/env/beszel-agent.env` without printing them to logs/chat, and set mode `0600`.

**Start full stack:**

```bash
sudo install -m 0644 deploy/upcloud/qeo-beszel.service /etc/systemd/system/qeo-beszel.service
sudo systemctl daemon-reload
sudo systemctl enable --now qeo-beszel.service
```

**Configure private Serve path:**

```bash
sudo tailscale serve --bg --https=443 --set-path=/beszel http://127.0.0.1:8090
sudo tailscale serve status
```

The runbook must explicitly state that `tailscale funnel` must remain disabled and UFW must receive no new Beszel ingress rule.

**Rollback:**

```bash
sudo tailscale serve --https=443 --set-path=/beszel off
sudo systemctl disable --now qeo-beszel.service
```

Rollback keeps `/opt/qeoindex/state/beszel/hub` intact unless a separately reviewed data restore is required.

- [ ] **Step 2: Document Telegram and initial alert policy without embedding credentials**

Document the Telegram notification URL form only as a placeholder-free format example with redacted symbolic components:

```text
telegram://<BOT_TOKEN>@telegram?chats=<CHAT_ID>
```

Document the approved starting thresholds exactly:

| Signal | Warning | Critical |
| --- | --- | --- |
| CPU | >80% sustained 10 min | >95% sustained 5 min |
| RAM | >80% sustained 10 min | >90% sustained 5 min |
| Swap | >50% | >75% |
| Disk | >80% | >90% |
| Container | stopped/unhealthy >2 checks | stopped/unhealthy >5 min |
| Agent/host | transient unavailable warning | unavailable >5 min |

Document the safe test method: temporarily lower one non-dangerous threshold, verify Telegram warning and recovery, then restore the approved threshold. Do not deliberately exhaust RAM, CPU, swap, or disk.

- [ ] **Step 3: Create `docs/operations/beszel.md` as active architecture documentation**

The active doc must record:

- ownership: Beszel = host/container resource history; QEO-203 = service/business health; QEO-211 = aggregation UI;
- ingress: Tailscale Serve `/beszel` -> `127.0.0.1:8090`;
- Agent: `/beszel_socket/beszel.sock`;
- container discovery: loopback Docker socket proxy, Agent has no raw socket mount;
- persistent paths: `/opt/qeoindex/state/beszel/hub` and `/opt/qeoindex/state/beszel/agent`;
- secrets: `/opt/qeoindex/env/beszel-agent.env` plus Telegram config stored server-side in Beszel;
- auth: built-in Beszel login retained; future QEO-211 adapter uses a read-only Beszel account server-side;
- backup boundary: QEO-202 should review only persistent state, not runtime Unix socket;
- failure behavior: Beszel failure never blocks QeoIndex workloads and colocated monitoring is not independent host-down monitoring;
- upgrade sequence: backup/protect state -> pin new version -> deploy -> verify metrics/history -> rollback to prior pin if needed;
- acceptance evidence table with rows for private access, public-port denial, UFW/Funnel invariants, historical metrics, Telegram alert/recovery, idle resources, market-session baseline, EOD baseline, final PASS/MARGINAL/FAIL. Keep evidence cells explicitly marked `Pending runtime acceptance` until actually measured; do not claim success in source-only work.

- [ ] **Step 4: Add the active doc to `docs/README.md`**

Add `operations/beszel.md` to the active core/operations documentation index with role text equivalent to:

```text
Private Beszel host/container monitoring topology, security boundary, alert policy, resource budget and acceptance evidence.
```

Do not update `docs/HANDOVER.md` yet; it must only claim Beszel is live after Task 6 production acceptance.

- [ ] **Step 5: Verify the source contract in an authorized verification environment**

Run:

```bash
node --test tests/qeo201-beszel-upcloud.test.ts
pnpm test:manifest
```

Expected: PASS.

- [ ] **Step 6: Commit the runbook/docs**

```bash
git add services/beszel/README.md docs/operations/beszel.md docs/README.md
git commit -m "docs(QEO-201): add Beszel operations runbook"
```

---

### Task 4: Source review, PR, and GitHub Actions verification

**Files:**
- No new implementation files unless review finds a concrete defect.

**Interfaces:**
- Consumes: Tasks 1-3 exact source head.
- Produces: reviewable PR and CI evidence; does not deploy UpCloud.

- [ ] **Step 1: Perform static security review before PR**

Review the branch and confirm all of these from source:

```text
Hub image == henrygd/beszel:0.19.0
Agent image == henrygd/beszel-agent:0.19.0
Socket proxy == ghcr.io/linuxserver/socket-proxy:3.4.3-r0-ls93
Hub bind == 127.0.0.1:8090
Proxy bind == 127.0.0.1:2375
Agent LISTEN == /beszel_socket/beszel.sock
Agent has no /var/run/docker.sock mount
Proxy has /var/run/docker.sock:ro and POST=0
No :latest tags
No 45876 mapping
No 0.0.0.0 bind
No AUTO_LOGIN
No TRUSTED_AUTH_HEADER
No Telegram token/chat id
No Agent KEY/TOKEN value
No UFW/Funnel enabling command
```

- [ ] **Step 2: Open a PR to `main`**

Use title:

```text
QEO-201 Deploy private Beszel monitoring on UpCloud
```

PR body must distinguish:

```text
Source-level implementation: included
UpCloud deployment: not executed yet
Mac/iPhone /beszel smoke: pending runtime authorization
Telegram alert/recovery test: pending runtime authorization
Market-session + EOD resource baseline: pending runtime evidence
```

- [ ] **Step 3: Use GitHub Actions as the automated verification environment**

Required CI is the repository's existing `Verify / verify` job. It runs secret scans, current contracts, touched lint, TypeScript validation, and production Next.js build.

Additionally, the focused commands an authorized environment should run are:

```bash
node --test tests/qeo201-beszel-upcloud.test.ts
pnpm test:manifest
pnpm verify:pr
docker compose -f services/beszel/deploy/upcloud/docker-compose.upcloud.yml config
```

Do not report these as passed unless the commands actually execute or GitHub Actions provides equivalent successful evidence.

- [ ] **Step 4: Review exact PR head after CI**

Confirm the CI SHA is the current PR head. If any source/config issue is fixed, wait for CI on the new exact head before approval.

- [ ] **Step 5: Record source-level status in Linear**

Record commit/PR/CI evidence and state clearly that production runtime acceptance remains pending. Do not mark QEO-201 Done at this stage.

---

### Task 5: Bootstrap Beszel on UpCloud and configure private Tailscale ingress

**Runtime authorization required.** Do not execute this task unless the user explicitly authorizes UpCloud/Remote Desktop/SSH work for QEO-201 in the current task.

**Files:**
- Host state only; no repository file changes unless runtime evidence exposes a source defect.

**Interfaces:**
- Consumes: reviewed exact source commit from Task 4.
- Produces: live private Beszel Hub/Agent, systemd ownership, Tailscale `/beszel` route, and verified network/security invariants.

- [ ] **Step 1: Capture pre-deploy security/resource baseline**

Record, without exposing secrets:

```bash
free -m
swapon --show
sudo ufw status verbose
sudo tailscale serve status
sudo tailscale funnel status
docker ps --format '{{.Names}}\t{{.Status}}'
```

Also record currently listening public/private sockets with a standard socket-inspection command. The acceptance comparison must prove no new public `8090`, `45876`, or `2375` listener was introduced.

- [ ] **Step 2: Pin UpCloud checkout to the reviewed source commit**

Use `/opt/qeoindex/repo` and verify the exact commit SHA before touching services. Do not deploy an unreviewed working tree.

- [ ] **Step 3: Provision state paths and start only Hub + socket proxy**

Run the exact path-creation and Compose bootstrap commands documented in `services/beszel/README.md`.

Verify locally:

```bash
curl --fail --silent --show-error http://127.0.0.1:8090/ >/dev/null
```

Do not add an UFW rule.

- [ ] **Step 4: Create Beszel admin and local system configuration**

From an authorized tailnet browser path, create the primary Beszel admin account. Add system `qeoindex-sg` and set Host / IP to:

```text
/beszel_socket/beszel.sock
```

Obtain the generated Agent `KEY` and `TOKEN`, place them only in `/opt/qeoindex/env/beszel-agent.env`, and apply mode `0600`. Do not print or copy their values into Linear, GitHub, logs, screenshots, or chat.

- [ ] **Step 5: Install/start `qeo-beszel.service`**

Install the reviewed unit, daemon-reload, enable/start it, and verify Hub, proxy, and Agent are running. Verify Agent telemetry becomes fresh and host CPU/RAM/swap/disk/network/uptime metrics appear.

- [ ] **Step 6: Add Tailscale Serve `/beszel` without disturbing other future paths**

Run:

```bash
sudo tailscale serve --bg --https=443 --set-path=/beszel http://127.0.0.1:8090
sudo tailscale serve status
```

Verify Serve resumes in background configuration and Funnel remains disabled.

- [ ] **Step 7: Verify private access and public denial**

Acceptance evidence must show:

```text
Mac -> https://qeoindex-sg.tail426fe8.ts.net/beszel : reachable/login page
Authorized iPhone -> same HTTPS path over Tailscale : reachable/login page
Public IP:8090 : unreachable
Public IP:45876 : unreachable
Public IP:2375 : unreachable
UFW : unchanged from pre-deploy public ingress
Funnel : disabled
```

Do not claim browser-level acceptance for iPhone until an actual iPhone request succeeds.

- [ ] **Step 8: Verify failure isolation and restart behavior safely**

Restart only the Beszel service stack, not a critical QeoIndex workload. Confirm Beszel recovers, historical data persists, and EOD/realtime/Hermes containers are not restarted or blocked.

---

### Task 6: Configure alerts, collect baseline evidence, and close QEO-201

**Runtime authorization required.** Task 6 follows Task 5 and requires continued explicit permission for runtime work.

**Files:**
- Modify after evidence exists: `docs/operations/beszel.md`
- Modify after production acceptance: `docs/HANDOVER.md`

**Interfaces:**
- Consumes: live QEO-201 stack from Task 5.
- Produces: tested Telegram alert/recovery path, measured resource baseline, final PASS/MARGINAL/FAIL judgment, and canonical production documentation.

- [ ] **Step 1: Configure Telegram inside Beszel without recording credentials in Git**

Use Beszel's Shoutrrr Telegram integration with the secret-bearing URL stored only in Beszel's server-side configuration. No real token/chat identifier may appear in repository files, PR comments, Linear comments, screenshots, or chat.

- [ ] **Step 2: Configure the approved starting alert thresholds**

Set the CPU/RAM/swap/disk/container/agent thresholds from `docs/operations/beszel.md`. If Beszel's UI/API does not expose an exact separate Warning/Critical representation for one metric, record the actual supported mapping rather than pretending both levels exist.

- [ ] **Step 3: Perform a safe alert + recovery smoke**

Temporarily lower one non-dangerous threshold enough to trigger an alert from normal activity. Verify Telegram receives the alert. Restore the approved threshold and verify a recovery notification. Do not intentionally exhaust production CPU, memory, swap, or disk.

- [ ] **Step 4: Measure stabilized idle overhead**

Capture at least Hub and Agent separately, plus socket proxy so the full monitoring-stack overhead is visible. Use container stats and host memory/swap evidence. Classify against:

```text
PASS      Hub + Agent idle <= 150 MB and no material CPU/swap/workload impact
MARGINAL  Hub + Agent idle >150 MB and <=200 MB, or measurable but non-disruptive overhead
FAIL      Hub + Agent idle >200 MB, material sustained CPU, worsened swap pressure, or workload interference
```

Also report socket-proxy overhead separately so the user sees total monitoring cost rather than hiding the helper process.

- [ ] **Step 5: Observe one representative market session**

Verify Beszel retains history for host CPU/RAM/swap/disk/network and critical containers while `qeo-market-realtime` is operating. Record peak monitoring overhead and whether the market worker retains headroom.

- [ ] **Step 6: Observe one representative EOD execution**

Verify `qeo-worker`/EOD telemetry appears, history is retained, and monitoring does not cause resource contention or failure. Short legitimate EOD CPU spikes are evidence for threshold tuning rather than automatic alert-policy failure.

- [ ] **Step 7: Tune thresholds only from evidence**

If normal market/EOD behavior causes repeated noise, adjust only the affected threshold/duration and record old value, observed normal behavior, new value, and rationale in the QEO-201 acceptance section. Do not broadly loosen every alert.

- [ ] **Step 8: Update production docs with actual evidence**

Update `docs/operations/beszel.md` acceptance table with actual observations and final judgment. Update `docs/HANDOVER.md` to state Beszel is a live private host/container monitoring dependency only after all runtime acceptance gates pass.

- [ ] **Step 9: Verify final source changes through GitHub Actions**

Push the evidence-doc update to the QEO-201 PR/branch and require the exact final head to satisfy `Verify / verify` before merge/closure.

- [ ] **Step 10: Close QEO-201 only when acceptance is real**

Linear completion comment must include:

```text
private Mac /beszel smoke: PASS/FAIL
private iPhone /beszel smoke: PASS/FAIL
public 8090/45876/2375 exposure: denied/not denied
UFW unchanged: yes/no
Funnel disabled: yes/no
historical host metrics: PASS/FAIL
critical container history: PASS/FAIL
Telegram alert + recovery: PASS/FAIL
idle Hub+Agent RAM: measured value
socket proxy RAM: measured value
market-session evidence: completed/not completed
EOD evidence: completed/not completed
final 2 GB host assessment: PASS/MARGINAL/FAIL
```

Do not mark QEO-201 Done if either representative market-session or EOD evidence is still pending.

---

## Plan self-review checklist

Before implementation begins, confirm:

- Every approved spec section maps to a task above: topology/security (Tasks 1-5), metrics/history (Tasks 5-6), alerts (Task 6), resource budget (Task 6), persistence/rollback (Tasks 2-3/5), QEO-211 read-only downstream boundary (Task 3), failure isolation (Tasks 2/5), and acceptance evidence (Tasks 5-6).
- No source step requires a real credential value.
- No task exposes Hub/Agent/proxy publicly.
- No task enables Funnel or broadens Tailscale grants.
- No task adds D-Bus/systemd control into the Agent.
- No task claims Beszel provides independent external host-down monitoring.
- Production docs are not updated to “live” status before runtime acceptance.
- Commands in this plan are execution instructions, not evidence that they have already run.
