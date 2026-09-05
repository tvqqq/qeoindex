export type ReportChatTurn = {
  role: "user" | "assistant"
  content: string
}

export function boundChatHistory(turns: readonly ReportChatTurn[]): ReportChatTurn[] {
  return turns
    .map((turn) => ({
      ...turn,
      content: turn.content.replace(/\s+/g, " ").trim().slice(0, 1_200),
    }))
    .filter((turn) => turn.content.length > 0)
    .slice(-6)
}
