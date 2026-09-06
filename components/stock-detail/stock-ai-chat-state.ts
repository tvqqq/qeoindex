export const STOCK_AI_CHAT_LIMITS = {
  historyTurns: 6,
  historyTurnChars: 1_200,
} as const

export type StockAiChatTurn = {
  role: "user" | "assistant"
  content: string
}

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

export function boundTickerChatHistory(turns: readonly StockAiChatTurn[]): StockAiChatTurn[] {
  return turns
    .flatMap((turn) => {
      if (!turn || (turn.role !== "user" && turn.role !== "assistant") || typeof turn.content !== "string") return []
      const content = normalize(turn.content)
      if (!content) return []
      return [{
        role: turn.role,
        content: content.slice(0, STOCK_AI_CHAT_LIMITS.historyTurnChars),
      }]
    })
    .slice(-STOCK_AI_CHAT_LIMITS.historyTurns)
}
