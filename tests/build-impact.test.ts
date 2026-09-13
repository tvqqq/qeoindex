import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { isRuntimeBuildRelevant, needsVercelBuild } from "../scripts/build-impact.mjs"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const repoFile = (path: string) => resolve(repoRoot, path)
const source = (path: string) => readFileSync(repoFile(path), "utf8")

test("documentation and verification-only changes do not require a Vercel runtime build", () => {
  const files = [
    "docs/HANDOVER.md",
    "README.md",
    "AGENTS.md",
    ".github/workflows/security.yml",
    "tests/navigation-prefetch.test.ts",
    "supabase/migrations/202608180001_example.sql",
  ]

  assert.equal(needsVercelBuild(files), false)
  for (const file of files) assert.equal(isRuntimeBuildRelevant(file), false, file)
})

test("runtime, build configuration, and operational script changes still build", () => {
  const files = [
    "app/page.tsx",
    "components/live-market-board.tsx",
    "modules/shared/cache/ui-data-cache.ts",
    "workflows/daily-signal-workflow.ts",
    "scripts/scan-secrets.sh",
    "package.json",
    "pnpm-lock.yaml",
    "next.config.mjs",
    "vercel.json",
    "tsconfig.json",
  ]

  for (const file of files) assert.equal(isRuntimeBuildRelevant(file), true, file)
})

test("mixed commits build when any runtime-relevant file changes", () => {
  assert.equal(needsVercelBuild(["docs/HANDOVER.md", "modules/signals/scanner/data.ts"]), true)
})

test("unknown or empty diffs build conservatively", () => {
  assert.equal(needsVercelBuild([]), true)
})

test("QEO-211 private ops dashboard changes do not trigger the public Vercel app build", () => {
  const files = [
    "services/ops-dashboard/src/server.ts",
    "services/ops-dashboard/src/providers/beszel.ts",
    "services/ops-dashboard/public/app.js",
    "services/ops-dashboard/deploy/upcloud/docker-compose.upcloud.yml",
  ]

  assert.equal(needsVercelBuild(files), false)
  for (const file of files) assert.equal(isRuntimeBuildRelevant(file), false, file)
})

test("QEO-211 private ops dashboard source package is complete", () => {
  const required = [
    "services/ops-dashboard/src/health.ts",
    "services/ops-dashboard/src/providers/beszel.ts",
    "services/ops-dashboard/src/providers/jobs.ts",
    "services/ops-dashboard/src/providers/gatus.ts",
    "services/ops-dashboard/src/snapshot.ts",
    "services/ops-dashboard/src/server.ts",
    "services/ops-dashboard/public/index.html",
    "services/ops-dashboard/public/app.js",
    "services/ops-dashboard/public/styles.css",
    "services/ops-dashboard/public/manifest.webmanifest",
    "services/ops-dashboard/public/sw.js",
    "services/ops-dashboard/public/icon.svg",
    "services/ops-dashboard/build.mjs",
    "services/ops-dashboard/Dockerfile",
    "services/ops-dashboard/deploy/upcloud/docker-compose.upcloud.yml",
    "services/ops-dashboard/deploy/upcloud/qeo-ops-dashboard.service",
    "services/ops-dashboard/ops-dashboard.env.example",
    "services/ops-dashboard/README.md",
    "docs/operations/ops-dashboard.md",
  ]

  for (const path of required) assert.equal(existsSync(repoFile(path)), true, `${path} must exist`)
})

test("QEO-211 health aggregation fails closed and preserves unknown state", async () => {
  const path = "services/ops-dashboard/src/health.ts"
  if (!existsSync(repoFile(path))) {
    assert.fail(`${path} must exist before health semantics can be verified`)
    return
  }

  const health = await import("../services/ops-dashboard/src/health.ts")
  assert.equal(health.overallHealthState(["healthy", "healthy"]), "healthy")
  assert.equal(health.overallHealthState(["healthy", "unknown"]), "unknown")
  assert.equal(health.overallHealthState(["unknown", "degraded"]), "degraded")
  assert.equal(health.overallHealthState(["degraded", "critical", "unknown"]), "critical")
  assert.equal(health.overallHealthState([]), "unknown")
})

test("QEO-211 unconfigured Gatus provider is explicit unknown, never fake healthy", async () => {
  const path = "services/ops-dashboard/src/providers/gatus.ts"
  if (!existsSync(repoFile(path))) {
    assert.fail(`${path} must exist before Gatus fallback semantics can be verified`)
    return
  }

  const { loadGatusSnapshot } = await import("../services/ops-dashboard/src/providers/gatus.ts")
  const result = await loadGatusSnapshot({})
  assert.equal(result.source, "gatus")
  assert.equal(result.status, "unknown")
  assert.equal(result.data, null)
  assert.match(result.message ?? "", /not configured/i)
})

test("QEO-211 Beszel adapter follows current PocketBase telemetry schema", async () => {
  const path = "services/ops-dashboard/src/providers/beszel.ts"
  if (!existsSync(repoFile(path))) {
    assert.fail(`${path} must exist before Beszel schema semantics can be verified`)
    return
  }

  const { loadBeszelSnapshot } = await import("../services/ops-dashboard/src/providers/beszel.ts")
  const originalFetch = globalThis.fetch
  const observedAt = new Date().toISOString()

  globalThis.fetch = async (input) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url

    if (url.includes("/api/collections/users/auth-with-password")) {
      return Response.json({ token: "test-token" })
    }
    if (url.includes("/api/collections/systems/records")) {
      return Response.json({
        items: [{
          id: "system-1",
          name: "qeoindex-sg",
          status: "up",
          updated: observedAt,
          info: { cpu: 12, mp: 50, dp: 25, la: [0.7, 0.5, 0.3], u: 3600 },
        }],
      })
    }
    if (url.includes("/api/collections/system_stats/records")) {
      return Response.json({
        items: [{
          created: observedAt,
          stats: {
            cpu: 12,
            m: 2,
            mu: 1,
            mp: 50,
            s: 1,
            su: 0.2,
            d: 40,
            du: 10,
            dp: 25,
            la: [0.7, 0.5, 0.3],
          },
        }],
      })
    }
    if (url.includes("/api/collections/containers/records")) {
      return Response.json({
        items: [{ name: "qeo-worker", status: "running", cpu: 7.5, memory: 128 }],
      })
    }
    return new Response("not found", { status: 404 })
  }

  try {
    const result = await loadBeszelSnapshot({
      QEO_OPS_BESZEL_URL: "http://beszel.test:8090",
      QEO_OPS_BESZEL_EMAIL: "ops@example.test",
      QEO_OPS_BESZEL_PASSWORD: "test-password",
      QEO_OPS_BESZEL_SYSTEM_NAME: "qeoindex-sg",
    })

    assert.equal(result.status, "healthy")
    assert.equal(result.data?.load1, 0.7)
    assert.equal(result.data?.load5, 0.5)
    assert.equal(result.data?.load15, 0.3)
    assert.equal(result.data?.containers[0]?.cpuPercent, 7.5)
    assert.equal(result.data?.containers[0]?.memoryMb, 128)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("QEO-211 deployment and PWA contracts keep operations data private and network-fresh", () => {
  const required = [
    "services/ops-dashboard/deploy/upcloud/docker-compose.upcloud.yml",
    "services/ops-dashboard/public/app.js",
    "services/ops-dashboard/public/sw.js",
    "services/ops-dashboard/ops-dashboard.env.example",
  ]
  if (required.some((path) => !existsSync(repoFile(path)))) {
    assert.fail("QEO-211 deployment and PWA files must exist before privacy contracts can be verified")
    return
  }

  const compose = source(required[0])
  const client = source(required[1])
  const worker = source(required[2])
  const envExample = source(required[3])

  assert.match(compose, /127\.0\.0\.1:8787:8787/)
  assert.doesNotMatch(compose, /\/var\/run\/docker\.sock/)
  assert.doesNotMatch(compose, /network_mode:\s*host/)

  for (const secret of ["SUPABASE_SERVICE_ROLE_KEY", "QEO_OPS_BESZEL_PASSWORD", "QEO_OPS_BESZEL_EMAIL"]) {
    assert.doesNotMatch(client, new RegExp(secret))
    assert.doesNotMatch(worker, new RegExp(secret))
  }
  assert.doesNotMatch(client, /localStorage|sessionStorage/)
  assert.match(worker, /\/api\//)
  assert.match(worker, /fetch\(request\)/)

  assert.match(envExample, /^SUPABASE_URL=$/m)
  assert.match(envExample, /^SUPABASE_SERVICE_ROLE_KEY=$/m)
  assert.match(envExample, /^QEO_OPS_BESZEL_EMAIL=$/m)
  assert.match(envExample, /^QEO_OPS_BESZEL_PASSWORD=$/m)
})
