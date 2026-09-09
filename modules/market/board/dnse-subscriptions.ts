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
