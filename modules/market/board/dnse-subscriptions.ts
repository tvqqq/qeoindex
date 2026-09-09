export const DNSE_NORMAL_USER_CHANNEL_LIMIT = 200

export type DnseSubscriptionChannel = {
  name: string
  symbols?: string[]
}

export type DnseBoardSubscriptionPlan = {
  channels: DnseSubscriptionChannel[]
  realtimeSymbols: string[]
  overflowSymbols: string[]
  subscriptionCount: number
}

type DnseChannelRow = { name: string; symbols?: unknown[] }
type DnseSubscribePayload = { action?: unknown; channels?: unknown }

const LEGACY_BOARD_STOCK_CHANNELS = ["tick.G1.json", "top_price.G1.json", "ohlc.1.json", "foreign.G1.json"] as const

export function countDnseChannelSubscriptions(channels: DnseSubscriptionChannel[]) {
  return channels.reduce((total, channel) => total + (channel.symbols?.length ?? 1), 0)
}

export function buildDnseBoardSubscriptionPlan(
  symbols: string[],
  channelLimit = DNSE_NORMAL_USER_CHANNEL_LIMIT,
): DnseBoardSubscriptionPlan {
  const uniqueSymbols = [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))]
  const normalizedLimit = Number.isFinite(channelLimit)
    ? Math.max(0, Math.floor(channelLimit))
    : DNSE_NORMAL_USER_CHANNEL_LIMIT
  const realtimeSymbols = uniqueSymbols.slice(0, normalizedLimit)
  const overflowSymbols = uniqueSymbols.slice(normalizedLimit)
  const channels: DnseSubscriptionChannel[] = realtimeSymbols.length > 0
    ? [{ name: "tick.G1.json", symbols: realtimeSymbols }]
    : []
  const subscriptionCount = countDnseChannelSubscriptions(channels)

  if (subscriptionCount > normalizedLimit) {
    throw new Error(`DNSE board subscription plan exceeds channel budget: ${subscriptionCount}/${normalizedLimit}`)
  }

  return {
    channels,
    realtimeSymbols,
    overflowSymbols,
    subscriptionCount,
  }
}

function channelRows(value: unknown): DnseChannelRow[] {
  if (!Array.isArray(value)) return []
  return value.filter((row): row is DnseChannelRow => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return false
    return typeof (row as Record<string, unknown>).name === "string"
  })
}

export function rewriteDnseBoardSubscriptionMessage(data: unknown): unknown {
  if (typeof data !== "string") return data

  try {
    const payload = JSON.parse(data) as DnseSubscribePayload
    if (payload.action !== "subscribe") return data

    const rows = channelRows(payload.channels)
    const names = new Set(rows.map((row) => row.name))
    if (!LEGACY_BOARD_STOCK_CHANNELS.every((name) => names.has(name))) return data

    const tick = rows.find((row) => row.name === "tick.G1.json")
    if (!tick || !Array.isArray(tick.symbols)) return data

    const symbols = tick.symbols.map((symbol) => String(symbol ?? ""))
    const plan = buildDnseBoardSubscriptionPlan(symbols)
    return JSON.stringify({ ...payload, channels: plan.channels })
  } catch {
    return data
  }
}

export function synthesizeDnseOhlcFromTickMessage(data: unknown): string | null {
  if (typeof data !== "string") return null

  try {
    const frame = JSON.parse(data) as Record<string, unknown>
    if (String(frame.T ?? "") !== "t" || !frame.symbol) return null
    const rawPrice = frame.matchPrice ?? frame.price ?? frame.lastPrice
    const price = typeof rawPrice === "number" ? rawPrice : Number(rawPrice)
    if (!Number.isFinite(price) || price <= 0) return null
    return JSON.stringify({ ...frame, T: "b", close: price })
  } catch {
    return null
  }
}
