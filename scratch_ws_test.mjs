import crypto from "node:crypto"

const apiKey = process.env.DNSE_API_KEY ?? ""
const apiSecret = process.env.DNSE_API_SECRET ?? ""
const wsUrl = process.env.DNSE_WS_URL ?? "wss://ws-openapi.dnse.com.vn/v1/stream?encoding=json"

console.log("Connecting to DNSE WS with key:", apiKey.slice(0, 4) + "...")

const timestamp = Math.floor(Date.now() / 1000)
const nonce = String(Date.now() * 1000)
const message = `${apiKey}:${timestamp}:${nonce}`
const signature = crypto.createHmac("sha256", apiSecret).update(message, "utf8").digest("hex")

const authPayload = {
  action: "auth",
  api_key: apiKey,
  signature,
  timestamp,
  nonce,
}

const ws = new WebSocket(wsUrl)

ws.onopen = () => {
  console.log("WS Opened")
}

ws.onmessage = (event) => {
  const data = JSON.parse(event.data)
  console.log("WS Msg:", JSON.stringify(data))

  if (data.action === "welcome") {
    console.log("Sending auth...")
    ws.send(JSON.stringify(authPayload))
  }

  if (data.action === "auth_success") {
    console.log("Auth success! Subscribing...")
    ws.send(JSON.stringify({
      action: "subscribe",
      channels: [
        { name: "foreign.G1.json", symbols: ["STB", "SSI", "HPG"] },
        { name: "top_price.G1.json", symbols: ["STB"] },
        { name: "tick_extra.G1.json", symbols: ["STB"] },
      ]
    }))

    // Keep open for 5 seconds to capture frames
    setTimeout(() => {
      console.log("Test finished, closing WS")
      ws.close()
      process.exit(0)
    }, 5000)
  }
}

ws.onerror = (err) => {
  console.error("WS Error:", err)
}

ws.onclose = () => {
  console.log("WS Closed")
}
