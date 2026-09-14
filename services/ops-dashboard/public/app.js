const byId = (id) => document.getElementById(id)
const basePath = location.pathname === "/ops" || location.pathname.startsWith("/ops/") ? "/ops" : ""
const refreshButton = byId("refresh-button")
const offlineBanner = byId("offline-banner")
let lastSnapshot = null
let refreshInFlight = false

const STATUS_LABELS = {
  healthy: "Healthy",
  degraded: "Degraded",
  critical: "Critical",
  unknown: "Unknown",
}

function statusLabel(status) {
  return STATUS_LABELS[status] || "Unknown"
}

function setText(id, value) {
  const node = byId(id)
  if (node) node.textContent = value ?? "—"
}

function setStatusBadge(id, status) {
  const node = byId(id)
  if (!node) return
  const normalized = STATUS_LABELS[status] ? status : "unknown"
  node.className = `status-badge status-${normalized}`
  node.textContent = statusLabel(normalized)
}

function number(value, digits = 0) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : "—"
}

function percent(value) {
  return Number.isFinite(value) ? `${number(value, 1)}%` : "—"
}

function megabytes(value) {
  if (!Number.isFinite(value)) return "—"
  return `${number(value, Number(value) >= 100 ? 0 : 1)} MB`
}

function gigabytes(used, total) {
  if (!Number.isFinite(used) && !Number.isFinite(total)) return "—"
  if (Number.isFinite(used) && Number.isFinite(total)) return `${number(used, 1)} / ${number(total, 1)} GB`
  return `${number(Number.isFinite(used) ? used : total, 1)} GB`
}

function formatDate(value) {
  if (!value) return "—"
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return "—"
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date)
}

function formatDuration(ms) {
  if (!Number.isFinite(ms)) return "—"
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`
}

function formatUptime(seconds) {
  if (!Number.isFinite(seconds)) return "—"
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  if (days > 0) return `${days}d ${hours}h`
  return `${hours}h`
}

function renderAttention(items) {
  const list = byId("attention-list")
  if (!list) return
  list.replaceChildren()
  setText("attention-count", String(items.length))
  if (items.length === 0) {
    const item = document.createElement("li")
    item.className = "empty-state"
    item.textContent = "No active attention items."
    list.append(item)
    return
  }
  for (const attention of items) {
    const item = document.createElement("li")
    item.dataset.status = attention.status || "unknown"
    const source = document.createElement("strong")
    source.textContent = `${attention.source || "source"}: `
    item.append(source, document.createTextNode(attention.message || "Health requires attention"))
    list.append(item)
  }
}

function renderContainers(containers) {
  const list = byId("container-list")
  if (!list) return
  list.replaceChildren()
  setText("container-count", String(containers.length))
  if (containers.length === 0) {
    const item = document.createElement("li")
    item.className = "empty-state"
    item.textContent = "No container evidence."
    list.append(item)
    return
  }
  for (const container of containers) {
    const item = document.createElement("li")
    const name = document.createElement("strong")
    const detail = document.createElement("span")
    name.textContent = container.name || "unknown"
    detail.className = "muted"
    detail.textContent = `${container.status || "unknown"} · CPU ${percent(container.cpuPercent)} · RAM ${megabytes(container.memoryMb)}`
    item.append(name, detail)
    list.append(item)
  }
}

function renderJobCounts(counts) {
  const container = byId("job-counts")
  if (!container) return
  container.replaceChildren()
  const items = [
    ["Healthy", counts?.healthy],
    ["Degraded", counts?.degraded],
    ["Failing", counts?.failing],
    ["Stale", counts?.stale],
    ["Running", counts?.inProgress],
    ["Unknown", counts?.unknown],
  ]
  for (const [label, value] of items) {
    const card = document.createElement("div")
    const strong = document.createElement("strong")
    const span = document.createElement("span")
    strong.textContent = String(Number.isFinite(value) ? value : 0)
    span.textContent = label
    card.append(strong, span)
    container.append(card)
  }
}

function renderAiUsage(aiUsage) {
  if (!aiUsage || typeof aiUsage !== "object") return "—"
  const tokens = Number(aiUsage.totalTokens)
  const models = Array.isArray(aiUsage.models) ? aiUsage.models.filter(Boolean).join(", ") : ""
  if (!Number.isFinite(tokens) && !models) return "—"
  const tokenText = Number.isFinite(tokens) ? `${Math.round(tokens).toLocaleString()} tokens` : ""
  return [tokenText, models].filter(Boolean).join(" · ")
}

function render(snapshot) {
  lastSnapshot = snapshot
  const overall = snapshot?.status || "unknown"
  setText("overall-status", statusLabel(overall))
  setStatusBadge("overall-badge", overall)
  setText("last-updated", `Updated ${formatDate(snapshot?.observedAt)}`)
  renderAttention(Array.isArray(snapshot?.attention) ? snapshot.attention : [])

  const beszel = snapshot?.providers?.beszel || { status: "unknown", data: null, message: "Not loaded" }
  const gatus = snapshot?.providers?.gatus || { status: "unknown", data: null, message: "Not configured" }
  const jobs = snapshot?.providers?.jobs || { status: "unknown", data: null, message: "Not loaded" }

  setText("home-host-status", statusLabel(beszel.status))
  setText("home-host-detail", beszel.data
    ? `CPU ${percent(beszel.data.cpuPercent)} · RAM ${percent(beszel.data.memoryPercent)}`
    : beszel.message || "Beszel unavailable")
  setText("home-services-status", statusLabel(gatus.status))
  setText("home-services-detail", gatus.message || "Service health loaded")

  const eod = jobs.data?.eod || null
  setText("home-eod-status", eod ? statusLabel(jobs.status) : "Unknown")
  setText("home-eod-detail", eod?.lastFinishedAt
    ? `${eod.status} · ${formatDate(eod.lastFinishedAt)}`
    : jobs.message || "No EOD evidence")

  setStatusBadge("host-status-badge", beszel.status)
  setText("host-cpu", percent(beszel.data?.cpuPercent))
  setText("host-memory", gigabytes(beszel.data?.memoryUsedGb, beszel.data?.memoryTotalGb))
  setText("host-swap", gigabytes(beszel.data?.swapUsedGb, beszel.data?.swapTotalGb))
  setText("host-disk", gigabytes(beszel.data?.diskUsedGb, beszel.data?.diskTotalGb))
  setText("host-load", number(beszel.data?.load1, 2))
  setText("host-uptime", formatUptime(beszel.data?.uptimeSeconds))
  renderContainers(Array.isArray(beszel.data?.containers) ? beszel.data.containers : [])

  setText("service-beszel-title", statusLabel(beszel.status))
  setStatusBadge("service-beszel-badge", beszel.status)
  setText("service-beszel-message", beszel.message || `Observed ${formatDate(beszel.observedAt)}`)
  setText("service-gatus-title", statusLabel(gatus.status))
  setStatusBadge("service-gatus-badge", gatus.status)
  setText("service-gatus-message", gatus.message || `Observed ${formatDate(gatus.observedAt)}`)

  setStatusBadge("jobs-status-badge", jobs.status)
  setText("jobs-eod-status", eod?.status || "Unknown")
  setText("jobs-eod-started", formatDate(eod?.lastStartedAt))
  setText("jobs-eod-finished", formatDate(eod?.lastFinishedAt))
  setText("jobs-eod-duration", formatDuration(eod?.lastDurationMs))
  setText("jobs-ai-usage", renderAiUsage(eod?.aiUsage))
  setText("jobs-eod-error", eod?.lastErrorMessage || eod?.lastErrorCode || "—")
  renderJobCounts(jobs.data?.counts)
}

function updateOfflineState() {
  const offline = !navigator.onLine
  if (offlineBanner) offlineBanner.hidden = !offline
  if (offline && lastSnapshot) setText("last-updated", `Offline · last data ${formatDate(lastSnapshot.observedAt)}`)
}

async function refresh() {
  if (refreshInFlight) return
  refreshInFlight = true
  refreshButton?.classList.add("is-loading")
  refreshButton?.setAttribute("aria-busy", "true")
  try {
    const response = await fetch(`${basePath}/api/snapshot`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    render(await response.json())
  } catch {
    if (lastSnapshot) {
      setText("last-updated", `Unavailable · last data ${formatDate(lastSnapshot.observedAt)}`)
    } else {
      render({
        status: "unknown",
        observedAt: new Date().toISOString(),
        attention: [{ source: "jobs", status: "unknown", message: "Operations API unavailable" }],
        providers: {},
      })
    }
  } finally {
    refreshInFlight = false
    refreshButton?.classList.remove("is-loading")
    refreshButton?.removeAttribute("aria-busy")
    updateOfflineState()
  }
}

for (const button of document.querySelectorAll("[data-target]")) {
  button.addEventListener("click", () => {
    const target = button.dataset.target
    for (const view of document.querySelectorAll("[data-view]")) {
      const active = view.dataset.view === target
      view.hidden = !active
      view.classList.toggle("is-active", active)
    }
    for (const item of document.querySelectorAll(".nav-item")) {
      item.classList.toggle("is-active", item === button)
    }
    window.scrollTo({ top: 0, behavior: "smooth" })
  })
}

refreshButton?.addEventListener("click", () => void refresh())
window.addEventListener("online", () => { updateOfflineState(); void refresh() })
window.addEventListener("offline", updateOfflineState)
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void refresh()
})

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${basePath}/sw.js`, { scope: `${basePath || ""}/` }).catch(() => {})
  })
}

updateOfflineState()
void refresh()
setInterval(() => {
  if (document.visibilityState === "visible" && navigator.onLine) void refresh()
}, 30_000)
