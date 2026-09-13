export type HealthState = "healthy" | "degraded" | "critical" | "unknown"
export type ProviderSource = "beszel" | "jobs" | "gatus"

export interface ProviderSnapshot<T> {
  source: ProviderSource
  status: HealthState
  observedAt: string
  stale: boolean
  message: string | null
  data: T | null
}

export interface AttentionItem {
  source: ProviderSource
  status: Exclude<HealthState, "healthy">
  message: string
}

const HEALTH_PRIORITY: Record<HealthState, number> = {
  healthy: 0,
  unknown: 1,
  degraded: 2,
  critical: 3,
}

export function overallHealthState(states: HealthState[]): HealthState {
  if (states.length === 0) return "unknown"
  return states.reduce<HealthState>((worst, state) => (
    HEALTH_PRIORITY[state] > HEALTH_PRIORITY[worst] ? state : worst
  ), "healthy")
}

export function unknownProvider<T>(source: ProviderSource, message: string, observedAt = new Date().toISOString()): ProviderSnapshot<T> {
  return {
    source,
    status: "unknown",
    observedAt,
    stale: false,
    message,
    data: null,
  }
}

export function isSnapshotStale(observedAt: string | null | undefined, maxAgeMs: number, now = Date.now()): boolean {
  if (!observedAt) return true
  const observed = Date.parse(observedAt)
  if (!Number.isFinite(observed)) return true
  return now - observed > maxAgeMs
}

export function attentionFromProviders(providers: ProviderSnapshot<unknown>[]): AttentionItem[] {
  return providers
    .filter((provider): provider is ProviderSnapshot<unknown> & { status: Exclude<HealthState, "healthy"> } => provider.status !== "healthy")
    .map((provider) => ({
      source: provider.source,
      status: provider.status,
      message: provider.message || `${provider.source} is ${provider.status}`,
    }))
    .sort((a, b) => HEALTH_PRIORITY[b.status] - HEALTH_PRIORITY[a.status])
}
