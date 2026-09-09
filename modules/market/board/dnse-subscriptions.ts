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

const INDEX_CHANNELS = ["VNINDEX", "VN30", "HNX", "UPCOM"]

export function countDnseChannelSubscriptions(channels: DnseSubscriptionChannel[]) {
  return channels.reduce((total, channel) => total + (channel.symbols?.length ?? 1), 0)
}

export function buildDnseBoardSubscriptionPlan(symbols: string[]): DnseBoardSubscriptionPlan {
  const uniqueSymbols = [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))]
  const channels: DnseSubscriptionChannel[] = [
    { name: "tick.G1.json", symbols: uniqueSymbols },
    { name: "top_price.G1.json", symbols: uniqueSymbols },
    { name: "ohlc.1.json", symbols: [...uniqueSymbols, "VN30F1M"] },
    { name: "foreign.G1.json", symbols: uniqueSymbols },
    ...INDEX_CHANNELS.map((name) => ({ name: `market_index.${name}.json` })),
  ]

  return {
    channels,
    realtimeSymbols: uniqueSymbols,
    overflowSymbols: [],
    subscriptionCount: countDnseChannelSubscriptions(channels),
  }
}
