const API_BASE = "https://apiclient.topi.vn/api-web"

async function postJson(path, body) {
  const response = await fetch(`${API_BASE}/${path}`, {
    method: "POST",
    headers: {
      accept: "application/json, text/plain, */*",
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0 (compatible; QeoIndex-QEO-134-probe/1.0)",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  const json = await response.json()
  return { status: response.status, ok: response.ok, json }
}

function unwrap(payload) {
  let value = payload
  for (let depth = 0; depth < 4; depth += 1) {
    if (!value || typeof value !== "object") break
    if (Object.prototype.hasOwnProperty.call(value, "Data")) return value.Data
    if (Object.prototype.hasOwnProperty.call(value, "data")) {
      value = value.data
      continue
    }
    break
  }
  return null
}

const current = await postJson("GetFGIndex", { Target: 0 })
const history30 = await postJson("GetFGChart", { Target: 0, Days: 30 })
const historyAll = await postJson("GetFGChart", { Target: 0, Days: 0 })

function summarize(result) {
  const data = unwrap(result.json)
  return {
    status: result.status,
    ok: result.ok,
    outerKeys: result.json && typeof result.json === "object" ? Object.keys(result.json) : [],
    dataType: Array.isArray(data) ? "array" : typeof data,
    count: Array.isArray(data) ? data.length : null,
    first: Array.isArray(data) ? data[0] ?? null : data,
    last: Array.isArray(data) ? data.at(-1) ?? null : null,
  }
}

console.log(JSON.stringify({
  canonicalFilters: [
    { label: "1M", days: 30 },
    { label: "3M", days: 90 },
    { label: "6M", days: 180 },
    { label: "12M", days: 360 },
    { label: "All", days: 0 },
  ],
  current: summarize(current),
  history30: summarize(history30),
  historyAll: summarize(historyAll),
}, null, 2))
