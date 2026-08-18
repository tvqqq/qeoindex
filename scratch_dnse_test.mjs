import crypto from "node:crypto"

const apiKey = process.env.DNSE_API_KEY ?? ""
const apiSecret = process.env.DNSE_API_SECRET ?? ""
console.log("DNSE credentials configured:", Boolean(apiKey && apiSecret))

function formatDateHeader(date) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  const pad = (value) => String(value).padStart(2, "0")
  return `${days[date.getUTCDay()]}, ${pad(date.getUTCDate())} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} +0000`
}

function signatureHeaders(method, path, apiKey, apiSecret) {
  const dateValue = formatDateHeader(new Date())
  const nonce = crypto.randomUUID().replaceAll("-", "")
  const signingString = `(request-target): ${method.toLowerCase()} ${path}\ndate: ${dateValue}\nnonce: ${nonce}`
  const raw = crypto.createHmac("sha256", Buffer.from(apiSecret, "utf8")).update(signingString, "utf8").digest("base64")
  const signature = encodeURIComponent(raw)
  return {
    Date: dateValue,
    "X-Signature": `Signature keyId="${apiKey}",algorithm="hmac-sha256",headers="(request-target) date",signature="${signature}",nonce="${nonce}"`,
    "x-api-key": apiKey,
  }
}

async function signedGet(path, params) {
  const baseUrl = "https://openapi.dnse.com.vn"
  const url = new URL(`${baseUrl}${path}`)
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }
  try {
    const response = await fetch(url, {
      headers: signatureHeaders("GET", path, apiKey, apiSecret),
    })
    const text = await response.text()
    console.log(`Response for ${path} (${response.status}):`)
    try {
      const json = JSON.parse(text)
      console.log(JSON.stringify(json, null, 2).slice(0, 1500))
    } catch {
      console.log(text.slice(0, 500))
    }
  } catch (err) {
    console.error(`Fetch error for ${path}:`, err.message)
  }
}

async function run() {
  console.log("=== Testing DNSE STB quotes/latest ===")
  await signedGet("/price/STB/quotes/latest", { boardId: "G1" })
  console.log("=== Testing DNSE STB quotes (limit 1) ===")
  await signedGet("/price/STB/quotes", { boardId: "G1", limit: 1 })
  console.log("=== Testing DNSE STB trades ===")
  await signedGet("/price/STB/trades", { boardId: "G1", limit: 3 })
}

run()
