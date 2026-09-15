import "server-only"

import { createHmac } from "node:crypto"

export const MARKET_REALTIME_TOKEN_AUDIENCE = "qeo-market-realtime"
export const MARKET_REALTIME_TOKEN_VERSION = 1
export const MARKET_REALTIME_TOKEN_TTL_SECONDS = 60

export type MarketRealtimeTokenClaims = {
  v: 1
  sub: string
  aud: typeof MARKET_REALTIME_TOKEN_AUDIENCE
  iat: number
  exp: number
}

function encodeBase64Url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url")
}

export function mintMarketRealtimeToken(userId: string, secret: string, nowMs = Date.now()) {
  const subject = userId.trim()
  const signingSecret = secret.trim()
  if (!subject) throw new Error("Realtime token subject is required.")
  if (!signingSecret) throw new Error("Realtime signing secret is required.")

  const issuedAt = Math.floor(nowMs / 1000)
  const claims: MarketRealtimeTokenClaims = {
    v: MARKET_REALTIME_TOKEN_VERSION,
    sub: subject,
    aud: MARKET_REALTIME_TOKEN_AUDIENCE,
    iat: issuedAt,
    exp: issuedAt + MARKET_REALTIME_TOKEN_TTL_SECONDS,
  }
  const claimsPart = encodeBase64Url(JSON.stringify(claims))
  const signature = createHmac("sha256", signingSecret).update(claimsPart).digest("base64url")
  return {
    token: `${claimsPart}.${signature}`,
    expiresAt: new Date(claims.exp * 1000).toISOString(),
  }
}
