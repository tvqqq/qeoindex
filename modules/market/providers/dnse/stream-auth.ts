import "server-only"
import { createHmac } from "node:crypto"

function credentials() {
  return {
    apiKey: process.env.DNSE_API_KEY ?? "",
    apiSecret: process.env.DNSE_API_SECRET ?? "",
  }
}

export function createDnseStreamAuth() {
  const { apiKey, apiSecret } = credentials()
  if (!apiKey || !apiSecret) throw new Error("DNSE server credentials are not configured")

  const timestamp = Math.floor(Date.now() / 1000)
  const nonce = String(Date.now() * 1000 + Math.floor(Math.random() * 1000))
  const message = `${apiKey}:${timestamp}:${nonce}`
  const signature = createHmac("sha256", apiSecret).update(message, "utf8").digest("hex")

  return {
    url: process.env.DNSE_WS_URL ?? "wss://ws-openapi.dnse.com.vn/v1/stream?encoding=json",
    auth: {
      action: "auth",
      api_key: apiKey,
      signature,
      timestamp,
      nonce,
    },
    expiresAt: Date.now() + 20_000,
  }
}
