export interface TelegramResult {
  sent: boolean
  detail: string
}

export function telegramConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID)
}

export async function sendTelegramMessage(text: string): Promise<TelegramResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? ""
  const chatId = process.env.TELEGRAM_CHAT_ID ?? ""
  if (!token || !chatId) return { sent: false, detail: "TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not configured" }
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      cache: "no-store",
    })
    const payload = await response.json()
    if (!response.ok || !payload?.ok) return { sent: false, detail: `Telegram ${response.status}: ${payload?.description ?? "sendMessage failed"}` }
    return { sent: true, detail: "sent" }
  } catch (error) {
    return { sent: false, detail: error instanceof Error ? error.message : String(error) }
  }
}
