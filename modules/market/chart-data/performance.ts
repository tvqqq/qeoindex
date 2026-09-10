export type ChartPerfStage =
  | "daily-db"
  | "hot-db"
  | "derived-cache"
  | "cold-object"
  | "provider-fetch"
  | "aggregation"

export interface ChartPerfMeasurement {
  durationMs: number
  count: number
}

export type ChartPerfSnapshot = Record<ChartPerfStage, ChartPerfMeasurement>

export interface ChartPerformanceRecorder {
  measure<T>(stage: ChartPerfStage, work: () => Promise<T>): Promise<T>
  measureSync<T>(stage: ChartPerfStage, work: () => T): T
  snapshot(): ChartPerfSnapshot
}

const STAGES: ChartPerfStage[] = [
  "daily-db",
  "hot-db",
  "derived-cache",
  "cold-object",
  "provider-fetch",
  "aggregation",
]

export function createChartPerformanceRecorder(
  now: () => number = () => performance.now(),
): ChartPerformanceRecorder {
  const values = new Map<ChartPerfStage, ChartPerfMeasurement>(
    STAGES.map((stage) => [stage, { durationMs: 0, count: 0 }]),
  )

  function add(stage: ChartPerfStage, durationMs: number) {
    const current = values.get(stage) ?? { durationMs: 0, count: 0 }
    values.set(stage, {
      durationMs: current.durationMs + Math.max(0, durationMs),
      count: current.count + 1,
    })
  }

  return {
    async measure(stage, work) {
      const startedAt = now()
      try {
        return await work()
      } finally {
        add(stage, now() - startedAt)
      }
    },
    measureSync(stage, work) {
      const startedAt = now()
      try {
        return work()
      } finally {
        add(stage, now() - startedAt)
      }
    },
    snapshot() {
      return Object.fromEntries(
        STAGES.map((stage) => [stage, { ...(values.get(stage) ?? { durationMs: 0, count: 0 }) }]),
      ) as ChartPerfSnapshot
    },
  }
}
