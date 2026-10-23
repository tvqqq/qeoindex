export async function raceHistoryTransports<T>(
  primary: (signal: AbortSignal) => Promise<T>,
  hedge: (signal: AbortSignal) => Promise<T>,
  hedgeDelayMs: number,
): Promise<T> {
  const controller = new AbortController()
  let hedgeTimer: ReturnType<typeof setTimeout> | undefined
  const hedged = new Promise<T>((resolve, reject) => {
    hedgeTimer = setTimeout(() => {
      if (controller.signal.aborted) return
      void Promise.resolve().then(() => hedge(controller.signal)).then(resolve, reject)
    }, hedgeDelayMs)
  })
  const primaryResult = Promise.resolve().then(() => primary(controller.signal))

  try {
    return await Promise.any([primaryResult, hedged])
  } finally {
    if (hedgeTimer !== undefined) clearTimeout(hedgeTimer)
    controller.abort()
  }
}
