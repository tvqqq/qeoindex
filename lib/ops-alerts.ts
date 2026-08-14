import "server-only"

import { getToken } from "@vercel/connect"

const DEFAULT_CONNECTOR = "slack/stockos"
const DEDUPE_MS = 5 * 60 * 1000
const recentAlerts = new Map<string, number>()

interface SlackChannel {
  id: string
  name: string
  is_archived?: boolean
}

interface SlackApiResponse {
  ok: boolean
  error?: string
  channels?: SlackChannel[]
  team?: string
  team_id?: string
  user?: string
  user_id?: string
}

export interface OpsErrorInput {
  source: string
  message: string
  stack?: string
  path?: string
  method?: string
  status?: number
  metadata?: Record<string, string | number | boolean | null | undefined>
}

function connectorId() {
  return process.env.SLACK_CONNECTOR?.trim() || DEFAULT_CONNECTOR
}

function channelCandidates() {
  const configured = process.env.SLACK_ALERT_CHANNEL?.trim()
  const names = [configured, "stockos-alerts", "stockos", "alerts", "general"]
  return [...new Set(names.filter(Boolean).map((name) => String(name).replace(/^#/, "").toLowerCase()))]
}

async function slackToken() {
  return getToken(connectorId(), {
    subject: { type: "app" },
    scopes: ["chat:write", "chat:write.public", "channels:read"],
  })
}

async function slackApi<T extends SlackApiResponse>(token: string, method: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`https://slack.com/api/${method}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  })
  const payload = await response.json() as T
  if (!response.ok || !payload.ok) throw new Error(`Slack ${method} failed: ${payload.error ?? response.status}`)
  return payload
}

async function resolveChannel(token: string) {
  const explicitId = process.env.SLACK_ALERT_CHANNEL_ID?.trim()
  if (explicitId) return { id: explicitId, name: process.env.SLACK_ALERT_CHANNEL?.replace(/^#/, "") || explicitId }

  const query = new URLSearchParams({ exclude_archived: "true", limit: "200", types: "public_channel" })
  const payload = await slackApi<SlackApiResponse>(token, `conversations.list?${query.toString()}`)
  const channels = payload.channels ?? []
  for (const candidate of channelCandidates()) {
    const channel = channels.find((item) => item.name?.toLowerCase() === candidate && !item.is_archived)
    if (channel) return { id: channel.id, name: channel.name }
  }
  return null
}

function compactMetadata(metadata?: OpsErrorInput["metadata"]) {
  if (!metadata) return ""
  const entries = Object.entries(metadata).filter(([, value]) => value !== undefined && value !== null)
  if (!entries.length) return ""
  return entries.map(([key, value]) => `${key}=${String(value)}`).join(" · ")
}

function alertKey(input: OpsErrorInput) {
  return `${input.source}|${input.path ?? ""}|${input.message}`.slice(0, 500)
}

function shouldSend(input: OpsErrorInput) {
  const key = alertKey(input)
  const now = Date.now()
  const previous = recentAlerts.get(key) ?? 0
  if (now - previous < DEDUPE_MS) return false
  recentAlerts.set(key, now)
  for (const [storedKey, sentAt] of recentAlerts) {
    if (now - sentAt > DEDUPE_MS * 3) recentAlerts.delete(storedKey)
  }
  return true
}

export async function getSlackOpsHealth() {
  const token = await slackToken()
  const auth = await slackApi<SlackApiResponse>(token, "auth.test")
  const channel = await resolveChannel(token)
  return {
    ok: Boolean(channel),
    connector: connectorId(),
    workspace: auth.team ?? auth.team_id ?? "connected",
    bot: auth.user ?? auth.user_id ?? "connected",
    channel,
    message: channel
      ? `Slack connector sẵn sàng gửi StockOS ops alerts vào #${channel.name}.`
      : `Slack connector hoạt động nhưng chưa tìm thấy channel: ${channelCandidates().map((name) => `#${name}`).join(", ")}.`,
  }
}

export async function notifyOpsError(input: OpsErrorInput) {
  if (process.env.VERCEL_ENV !== "production" && process.env.NODE_ENV === "production") return { sent: false, reason: "non-production" }
  if (!shouldSend(input)) return { sent: false, reason: "deduped" }

  try {
    const token = await slackToken()
    const channel = await resolveChannel(token)
    if (!channel) {
      console.warn("[ops-alert] Slack connected but no StockOS alert channel could be resolved")
      return { sent: false, reason: "channel-not-found" }
    }

    const deployment = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : ""
    const metadata = compactMetadata(input.metadata)
    const location = [input.method, input.path].filter(Boolean).join(" ")
    const details = [location, input.status ? `HTTP ${input.status}` : "", metadata].filter(Boolean).join(" · ")
    const stack = input.stack?.trim().slice(0, 1600)
    const text = [
      `:rotating_light: *StockOS production error*`,
      `*Source:* ${input.source}`,
      details ? `*Context:* ${details}` : "",
      `*Error:* ${input.message.slice(0, 1800)}`,
      deployment ? `*Deployment:* ${deployment}` : "",
      stack ? `\n\`\`\`${stack}\`\`\`` : "",
    ].filter(Boolean).join("\n")

    await slackApi(token, "chat.postMessage", {
      method: "POST",
      body: JSON.stringify({
        channel: channel.id,
        text: text.replace(/[*`]/g, ""),
        mrkdwn: true,
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: text.slice(0, 2950) },
          },
        ],
      }),
    })
    return { sent: true, channel: channel.name }
  } catch (error) {
    console.error("[ops-alert] Slack delivery failed", error instanceof Error ? error.message : String(error))
    return { sent: false, reason: error instanceof Error ? error.message : String(error) }
  }
}
