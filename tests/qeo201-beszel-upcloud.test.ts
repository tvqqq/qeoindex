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
  assert.match(compose, /DOCKER_HOST:\s*tcp:\/\/127\.0\.0\.1:2375/)
  assert.match(compose, /\/var\/run\/docker\.sock:\/var\/run\/docker\.sock:ro/)

  const agentBlock = compose.slice(compose.indexOf("beszel-agent:"))
  assert.doesNotMatch(agentBlock, /\/var\/run\/docker\.sock:/)
  assert.match(compose, /CONTAINERS:\s*["']?1["']?/)
  assert.match(compose, /POST:\s*["']?0["']?/)
})

test("QEO-201 bootstrap does not require Agent credentials before Hub setup", () => {
  const compose = source(composePath)
  assert.match(
    compose,
    /env_file:\s*\n\s*-\s*path:\s*\/opt\/qeoindex\/env\/beszel-agent\.env\s*\n\s*required:\s*false/,
  )
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