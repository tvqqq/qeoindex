export type IoBudgetResult<T> =
  | { status: "completed"; value: T }
  | { status: "failed"; error: unknown }
  | { status: "timed-out" }

/**
 * Bounds the total time spent awaiting cache I/O. Callers decide whether a
 * failed or timed-out operation should fall through to an authoritative load.
 */
export function createIoBudget(ioBudgetMs?: number) {
  const limitMs = typeof ioBudgetMs === "number" && Number.isFinite(ioBudgetMs)
    ? Math.max(0, ioBudgetMs)
    : undefined
  let spentMs = 0

  return {
    remainingMs() {
      return limitMs === undefined ? undefined : Math.max(0, limitMs - spentMs)
    },

    async run<T>(operation: () => T | PromiseLike<T>): Promise<IoBudgetResult<T>> {
      const remainingMs = limitMs === undefined ? undefined : Math.max(0, limitMs - spentMs)
      if (remainingMs !== undefined && remainingMs <= 0) return { status: "timed-out" }

      if (remainingMs === undefined) {
        try {
          return { status: "completed", value: await operation() }
        } catch (error) {
          return { status: "failed", error }
        }
      }

      const startedAt = Date.now()
      return new Promise((resolve) => {
        let settled = false
        const timeout = setTimeout(() => {
          if (settled) return
          settled = true
          spentMs += remainingMs
          resolve({ status: "timed-out" })
        }, remainingMs)

        Promise.resolve()
          .then(operation)
          .then((value) => {
            if (settled) return
            settled = true
            clearTimeout(timeout)
            spentMs += Math.min(Date.now() - startedAt, remainingMs)
            resolve({ status: "completed", value })
          }, (error: unknown) => {
            if (settled) return
            settled = true
            clearTimeout(timeout)
            spentMs += Math.min(Date.now() - startedAt, remainingMs)
            resolve({ status: "failed", error })
          })
      })
    },
  }
}

export type CacheReadCandidate<T> = {
  read: () => unknown | PromiseLike<unknown>
  validate: (value: unknown) => value is T
}

/** Reads cache layers in order and stops immediately when a read exhausts the budget. */
export async function readFirstValidCacheValue<T>(
  candidates: readonly CacheReadCandidate<T>[],
  ioBudgetMs?: number,
): Promise<T | null> {
  const budget = createIoBudget(ioBudgetMs)
  for (const candidate of candidates) {
    const result = await budget.run(candidate.read)
    if (result.status === "timed-out") return null
    if (result.status === "failed") continue
    if (candidate.validate(result.value)) return result.value
  }
  return null
}
