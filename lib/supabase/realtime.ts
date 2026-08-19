export interface RealtimeMarketTick {
  symbol: string
  price: number
  reference: number
  ceiling?: number
  floor?: number
  change?: number
  changePercent?: number
  volume?: number
  updatedAt?: string
}

export type RealtimeCallback = (tick: RealtimeMarketTick) => void

/**
 * Legacy compatibility shim.
 *
 * The Market Board uses DNSE as its single live market source. Keeping a
 * second Supabase realtime subscription doubles websocket traffic and causes
 * duplicate React updates on every market tick. The public API remains for
 * compatibility with older callers, but the board no longer opens a second
 * realtime connection.
 */
export function subscribeMarketRealtime(
  _channelName: string = "market:top100",
  _onTick: RealtimeCallback
): (() => void) | null {
  return null
}
