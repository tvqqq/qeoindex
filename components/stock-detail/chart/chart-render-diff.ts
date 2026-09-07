import type { OhlcvBar } from "@/modules/shared/technical/indicators"

export interface RenderedBarSnapshot {
  actualLength: number
  firstTime: number
  latestTime: number
  fingerprint: string
}

/**
 * Keep the incremental update path truthful when a provider corrects any
 * previously rendered candle. The timestamp endpoints alone are insufficient:
 * OHLCV values in the middle of a fetched range may change in place.
 */
export function fingerprintOhlcvPrefix(bars: ReadonlyArray<OhlcvBar>): string {
  return bars
    .slice(0, -1)
    .map((bar) => [bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume].join(":"))
    .join("|")
}

export function canIncrementallyUpdateLatest(
  previous: RenderedBarSnapshot | null,
  bars: ReadonlyArray<OhlcvBar>,
): boolean {
  const latest = bars.at(-1)
  return Boolean(
    previous
    && latest
    && previous.actualLength === bars.length
    && previous.firstTime === bars[0]?.time
    && previous.latestTime === latest.time
    && previous.fingerprint === fingerprintOhlcvPrefix(bars),
  )
}
