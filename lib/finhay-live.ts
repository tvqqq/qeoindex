import { createHash, randomBytes } from "node:crypto"

export const FINHAY_MCP_URL = process.env.FINHAY_MCP_URL ?? "https://mcp.fhsc.com.vn/mcp"
const MCP_PROTOCOL_VERSION = "2025-06-18"

export interface FinhayOAuthMetadata {
  resource: string
  authorizationServer: string
  authorizationEndpoint: string
  tokenEndpoint: string
  registrationEndpoint?: string
  scopesSupported: string[]
}

export interface FinhayRegisteredClient {
  clientId: string
  clientSecret?: string
}

export interface FinhayTokenSet {
  accessToken: string
  refreshToken?: string
  expiresIn?: number
  scope?: string
  tokenType?: string
}

export interface FinhayStockQuote {
  symbol: string
  name?: string
  exchange?: string
  currency?: string
  price: number
  open?: number
  high?: number
  low?: number
  reference?: number
  ceiling?: number
  floor?: number
  change?: number
  changePercent: number
  volume?: number
  updatedAt: string
}

export interface FinhayIndexQuote {
  symbol: string
  value: number
  change?: number
  changePercent: number
  updatedAt: string
}

function bearerResourceMetadata(header: string | null) {
  if (!header) return ""
  const match = header.match(/resource_metadata="([^"]+)"/i)
  return match?.[1] ?? ""
}

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, cache: "no-store" })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Finhay OAuth discovery failed (${response.status}): ${text.slice(0, 300)}`)
  }
  return response.json()
}

function authorizationMetadataUrl(server: string) {
  const issuer = new URL(server)
  const path = issuer.pathname === "/" ? "" : issuer.pathname.replace(/\/$/, "")
  return `${issuer.origin}/.well-known/oauth-authorization-server${path}`
}

export async function discoverFinhayOAuth(): Promise<FinhayOAuthMetadata> {
  let resourceMetadataUrl = new URL("/.well-known/oauth-protected-resource", FINHAY_MCP_URL).toString()

  try {
    const probe = await fetch(FINHAY_MCP_URL, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "stockos-discovery",
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "StockOS", version: "1.0.0" },
        },
      }),
      cache: "no-store",
      redirect: "manual",
    })
    if (probe.status === 401) {
      resourceMetadataUrl = bearerResourceMetadata(probe.headers.get("www-authenticate")) || resourceMetadataUrl
    }
  } catch {
    // Continue with RFC 9728 well-known fallback.
  }

  const resourceMetadata = await fetchJson(resourceMetadataUrl)
  const authorizationServer = resourceMetadata.authorization_servers?.[0] ?? new URL(FINHAY_MCP_URL).origin
  const authMetadata = await fetchJson(authorizationMetadataUrl(authorizationServer))

  if (!authMetadata.authorization_endpoint || !authMetadata.token_endpoint) {
    throw new Error("Finhay OAuth metadata is missing authorization_endpoint/token_endpoint")
  }

  return {
    resource: resourceMetadata.resource ?? FINHAY_MCP_URL,
    authorizationServer,
    authorizationEndpoint: authMetadata.authorization_endpoint,
    tokenEndpoint: authMetadata.token_endpoint,
    registrationEndpoint: authMetadata.registration_endpoint,
    scopesSupported: authMetadata.scopes_supported ?? [],
  }
}

export function createPkce() {
  const verifier = randomBytes(48).toString("base64url")
  const challenge = createHash("sha256").update(verifier).digest("base64url")
  return { verifier, challenge, state: randomBytes(24).toString("base64url") }
}

export async function registerFinhayClient(metadata: FinhayOAuthMetadata, redirectUri: string): Promise<FinhayRegisteredClient> {
  const configuredClientId = process.env.FINHAY_OAUTH_CLIENT_ID
  if (configuredClientId) {
    return { clientId: configuredClientId, clientSecret: process.env.FINHAY_OAUTH_CLIENT_SECRET || undefined }
  }
  if (!metadata.registrationEndpoint) {
    throw new Error("Finhay OAuth server does not advertise dynamic client registration. Configure FINHAY_OAUTH_CLIENT_ID.")
  }

  const response = await fetch(metadata.registrationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_name: "StockOS",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      application_type: "web",
    }),
    cache: "no-store",
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Finhay dynamic client registration failed (${response.status}): ${text.slice(0, 300)}`)
  }
  const payload = await response.json()
  if (!payload.client_id) throw new Error("Finhay registration response did not include client_id")
  return { clientId: payload.client_id, clientSecret: payload.client_secret || undefined }
}

export async function exchangeFinhayCode(args: {
  metadata: FinhayOAuthMetadata
  code: string
  redirectUri: string
  verifier: string
  clientId: string
  clientSecret?: string
}): Promise<FinhayTokenSet> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: args.code,
    redirect_uri: args.redirectUri,
    client_id: args.clientId,
    code_verifier: args.verifier,
    resource: args.metadata.resource,
  })
  if (args.clientSecret) body.set("client_secret", args.clientSecret)

  const response = await fetch(args.metadata.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
    cache: "no-store",
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Finhay token exchange failed (${response.status}): ${text.slice(0, 300)}`)
  }
  const payload = await response.json()
  if (!payload.access_token) throw new Error("Finhay token response did not include access_token")
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresIn: payload.expires_in,
    scope: payload.scope,
    tokenType: payload.token_type,
  }
}

export async function refreshFinhayToken(args: {
  metadata: FinhayOAuthMetadata
  refreshToken: string
  clientId: string
  clientSecret?: string
}): Promise<FinhayTokenSet> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: args.refreshToken,
    client_id: args.clientId,
    resource: args.metadata.resource,
  })
  if (args.clientSecret) body.set("client_secret", args.clientSecret)

  const response = await fetch(args.metadata.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
    cache: "no-store",
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Finhay token refresh failed (${response.status}): ${text.slice(0, 300)}`)
  }
  const payload = await response.json()
  if (!payload.access_token) throw new Error("Finhay refresh response did not include access_token")
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || args.refreshToken,
    expiresIn: payload.expires_in,
    scope: payload.scope,
    tokenType: payload.token_type,
  }
}

function parseMcpPayload(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return null
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return JSON.parse(trimmed)

  const messages = trimmed
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line) } catch { return null }
    })
    .filter(Boolean)
  return messages.at(-1) ?? null
}

async function mcpPost(accessToken: string, body: unknown, sessionId?: string) {
  const response = await fetch(FINHAY_MCP_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
      ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
    },
    body: JSON.stringify(body),
    cache: "no-store",
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`Finhay MCP request failed (${response.status}): ${text.slice(0, 350)}`)
  return { payload: parseMcpPayload(text), sessionId: response.headers.get("mcp-session-id") ?? sessionId }
}

function unwrapToolResult(payload: any) {
  if (!payload) throw new Error("Finhay MCP returned an empty response")
  if (payload.error) throw new Error(payload.error?.message ?? "Finhay MCP tool error")
  const result = payload.result ?? payload
  if (result.structuredContent) return result.structuredContent
  if (result.content) {
    for (const item of result.content) {
      if (item?.type !== "text" || typeof item.text !== "string") continue
      const text = item.text.trim()
      try { return JSON.parse(text) } catch { if (text) return { text } }
    }
  }
  return result
}

export async function callFinhayTool(accessToken: string, name: string, args: Record<string, unknown>) {
  const initialized = await mcpPost(accessToken, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "StockOS", version: "1.0.0" },
    },
  })

  const sessionId = initialized.sessionId
  await mcpPost(accessToken, { jsonrpc: "2.0", method: "notifications/initialized", params: {} }, sessionId)
  const called = await mcpPost(accessToken, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name, arguments: args },
  }, sessionId)
  return unwrapToolResult(called.payload)
}

function asNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

export async function getFinhayStockQuote(accessToken: string, symbol: string): Promise<FinhayStockQuote> {
  const payload: any = await callFinhayTool(accessToken, "get_stock_quote", { symbol })
  return {
    symbol: String(payload.symbol ?? symbol).toUpperCase(),
    name: payload.name,
    exchange: payload.exchange,
    currency: payload.currency,
    price: asNumber(payload.price),
    open: typeof payload.open === "number" ? payload.open : undefined,
    high: typeof payload.high === "number" ? payload.high : undefined,
    low: typeof payload.low === "number" ? payload.low : undefined,
    reference: typeof payload.reference === "number" ? payload.reference : undefined,
    ceiling: typeof payload.ceiling === "number" ? payload.ceiling : undefined,
    floor: typeof payload.floor === "number" ? payload.floor : undefined,
    change: typeof payload.change === "number" ? payload.change : undefined,
    changePercent: asNumber(payload.change_percent ?? payload.changePercent),
    volume: typeof payload.volume === "number" ? payload.volume : undefined,
    updatedAt: String(payload.updated_at ?? payload.updatedAt ?? new Date().toISOString()),
  }
}

export async function getFinhayIndexQuote(accessToken: string, symbol: string): Promise<FinhayIndexQuote> {
  const raw: any = await callFinhayTool(accessToken, "get_index_quote", { index: [symbol] })
  const payload = Array.isArray(raw) ? raw[0] : Array.isArray(raw?.data) ? raw.data[0] : raw
  return {
    symbol: String(payload?.symbol ?? payload?.index ?? symbol).toUpperCase(),
    value: asNumber(payload?.value ?? payload?.price ?? payload?.index_value),
    change: typeof payload?.change === "number" ? payload.change : undefined,
    changePercent: asNumber(payload?.change_percent ?? payload?.changePercent),
    updatedAt: String(payload?.updated_at ?? payload?.updatedAt ?? new Date().toISOString()),
  }
}

export async function getFinhayMarketSession(accessToken: string, exchange = "HOSE") {
  return callFinhayTool(accessToken, "get_market_session", { exchange })
}
