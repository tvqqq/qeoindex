import { isSnapshotStale, unknownProvider, type HealthState, type ProviderSnapshot } from "../health.ts"

export interface BeszelContainerHealth {
  name: string
  status: string
  cpuPercent: number | null
  memoryMb: number | null
}

export interface BeszelHealthData {
  systemId: string
  name: string
  systemStatus: string
  cpuPercent: number | null
  memoryPercent: number | null
  memoryUsedGb: number | null
  memoryTotalGb: number | null
  swapUsedGb: number | null
  swapTotalGb: number | null
  diskPercent: number | null
  diskUsedGb: number | null
  diskTotalGb: number | null
  load1: number | null
  load5: number | null
  load15: number | null
  uptimeSeconds: number | null
  containers: BeszelContainerHealth[]
}

type JsonRecord = Record<string, unknown>
type PocketBaseList = { items?: unknown[] }

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}
}

function parseJsonRecord(value: unknown): JsonRecord {
  if (typeof value === "string") {
    try {
      return record(JSON.parse(value))
    } catch {
      return {}
    }
  }
  return record(value)
}

function finiteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function numericTuple(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback
}

function firstListItem(value: unknown): JsonRecord | null {
  const items = Array.isArray(record(value).items) ? record(value).items as unknown[] : []
  return items.length > 0 ? record(items[0]) : null
}

function authHeaders(token: string): Record<string, string> {
  return token ? { Authorization: token } : {}
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    if (!response.ok) throw new Error(`Beszel HTTP ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timeout)
  }
}

function safeBaseUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    return url.toString().replace(/\/$/, "")
  } catch {
    return null
  }
}

function systemMetrics(system: JsonRecord, statsRecord: JsonRecord | null) {
  const info = parseJsonRecord(system.info)
  const stats = parseJsonRecord(statsRecord?.stats)
  const statsLoad = numericTuple(stats.la)
  const infoLoad = numericTuple(info.la)

  return {
    cpuPercent: finiteNumber(stats.cpu, info.cpu, info.cpuPercent),
    memoryPercent: finiteNumber(stats.mp, info.mp, info.memoryPercent),
    memoryUsedGb: finiteNumber(stats.mu, info.mu, info.memoryUsed),
    memoryTotalGb: finiteNumber(stats.m, info.m, info.memoryTotal),
    swapUsedGb: finiteNumber(stats.su, stats.swu, info.su, info.swapUsed),
    swapTotalGb: finiteNumber(stats.s, info.s, info.swapTotal),
    diskPercent: finiteNumber(stats.dp, info.dp, info.diskPercent),
    diskUsedGb: finiteNumber(stats.du, info.du, info.diskUsed),
    diskTotalGb: finiteNumber(stats.d, info.d, info.diskTotal),
    load1: finiteNumber(statsLoad[0], infoLoad[0], stats.l1, info.l1, info.load1),
    load5: finiteNumber(statsLoad[1], infoLoad[1], stats.l5, info.l5, info.load5),
    load15: finiteNumber(statsLoad[2], infoLoad[2], stats.l15, info.l15, info.load15),
    uptimeSeconds: finiteNumber(info.u, info.uptime, stats.u, stats.uptime),
  }
}

function containerHealth(item: JsonRecord): BeszelContainerHealth {
  const info = parseJsonRecord(item.info)
  const stats = parseJsonRecord(item.stats)
  return {
    name: text(item.name, text(info.name, "unknown")),
    status: text(item.status, text(info.status, "unknown")),
    cpuPercent: finiteNumber(item.cpu, stats.cpu, info.cpu),
    memoryMb: finiteNumber(item.memory, item.mem, stats.m, info.m),
  }
}

function deriveStatus(systemStatus: string, stale: boolean, containers: BeszelContainerHealth[]): HealthState {
  const normalized = systemStatus.toLowerCase()
  if (["down", "offline", "failed", "unreachable"].includes(normalized)) return "critical"
  if (!normalized || normalized === "unknown") return "unknown"

  const unhealthyContainer = containers.some((container) => {
    const status = container.status.toLowerCase()
    return status && !["running", "up", "healthy", "unknown"].includes(status)
  })
  if (stale || unhealthyContainer) return "degraded"
  return "healthy"
}

export async function loadBeszelSnapshot(env: Partial<NodeJS.ProcessEnv> = process.env): Promise<ProviderSnapshot<BeszelHealthData>> {
  const observedAt = new Date().toISOString()
  const configuredUrl = env.QEO_OPS_BESZEL_URL?.trim()
  const baseUrl = configuredUrl ? safeBaseUrl(configuredUrl) : null
  const email = env.QEO_OPS_BESZEL_EMAIL?.trim()
  const password = env.QEO_OPS_BESZEL_PASSWORD
  const systemName = env.QEO_OPS_BESZEL_SYSTEM_NAME?.trim() || "qeoindex-sg"
  const timeoutCandidate = Number(env.QEO_OPS_BESZEL_TIMEOUT_MS || 3_500)
  const timeoutMs = Number.isFinite(timeoutCandidate)
    ? Math.min(10_000, Math.max(500, timeoutCandidate))
    : 3_500

  if (!baseUrl || !email || !password) {
    return unknownProvider<BeszelHealthData>("beszel", "Beszel read-only access not configured", observedAt)
  }

  try {
    const auth = record(await fetchJson(`${baseUrl}/api/collections/users/auth-with-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity: email, password }),
    }, timeoutMs))
    const token = text(auth.token)
    if (!token) return unknownProvider<BeszelHealthData>("beszel", "Beszel authentication unavailable", observedAt)

    const systems = record(await fetchJson(`${baseUrl}/api/collections/systems/records?page=1&perPage=50&skipTotal=1`, {
      method: "GET",
      headers: authHeaders(token),
    }, timeoutMs)) as PocketBaseList
    const system = (Array.isArray(systems.items) ? systems.items : [])
      .map(record)
      .find((item) => text(item.name) === systemName) ?? null
    if (!system) return unknownProvider<BeszelHealthData>("beszel", `Beszel system ${systemName} not found`, observedAt)

    const systemId = text(system.id)
    if (!systemId) return unknownProvider<BeszelHealthData>("beszel", "Beszel system identity unavailable", observedAt)

    const statsFilter = encodeURIComponent(`system = "${systemId}" && type = "1m"`)
    const containerFilter = encodeURIComponent(`system = "${systemId}"`)
    const [statsValue, containersValue] = await Promise.all([
      fetchJson(`${baseUrl}/api/collections/system_stats/records?page=1&perPage=1&skipTotal=1&sort=-created&filter=${statsFilter}`, {
        method: "GET",
        headers: authHeaders(token),
      }, timeoutMs),
      fetchJson(`${baseUrl}/api/collections/containers/records?page=1&perPage=100&skipTotal=1&filter=${containerFilter}`, {
        method: "GET",
        headers: authHeaders(token),
      }, timeoutMs),
    ])

    const statsRecord = firstListItem(statsValue)
    const containersList = record(containersValue)
    const containers = (Array.isArray(containersList.items) ? containersList.items : [])
      .map((item) => containerHealth(record(item)))
    const metrics = systemMetrics(system, statsRecord)
    const statsObservedAt = text(statsRecord?.created, text(system.updated, observedAt))
    const stale = isSnapshotStale(statsObservedAt, 3 * 60 * 1000)
    const systemStatus = text(system.status, "unknown")
    const status = deriveStatus(systemStatus, stale, containers)

    return {
      source: "beszel",
      status,
      observedAt: statsObservedAt,
      stale,
      message: status === "healthy"
        ? null
        : stale
          ? "Beszel telemetry is stale"
          : `Beszel system is ${systemStatus}`,
      data: {
        systemId,
        name: text(system.name, systemName),
        systemStatus,
        ...metrics,
        containers,
      },
    }
  } catch {
    return unknownProvider<BeszelHealthData>("beszel", "Beszel health unavailable", observedAt)
  }
}
