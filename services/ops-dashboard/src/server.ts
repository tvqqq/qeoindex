import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { readFile } from "node:fs/promises"
import { dirname, extname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { loadOperationsSnapshot } from "./snapshot.ts"

const moduleDir = dirname(fileURLToPath(import.meta.url))
const publicDir = process.env.QEO_OPS_PUBLIC_DIR || resolve(moduleDir, "../public")
const host = process.env.QEO_OPS_HOST || "127.0.0.1"
const port = Math.min(65_535, Math.max(1, Number(process.env.QEO_OPS_PORT || 8787)))

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
}

function securityHeaders(response: ServerResponse) {
  response.setHeader("X-Content-Type-Options", "nosniff")
  response.setHeader("Referrer-Policy", "no-referrer")
  response.setHeader("X-Frame-Options", "DENY")
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self'; img-src 'self' data:; manifest-src 'self'; script-src 'self'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  )
}

function normalizedPath(request: IncomingMessage): string {
  const requestUrl = new URL(request.url || "/", "http://localhost")
  let path = decodeURIComponent(requestUrl.pathname)
  if (path === "/ops") return "/"
  if (path.startsWith("/ops/")) path = path.slice(4)
  return path || "/"
}

function json(response: ServerResponse, status: number, payload: unknown, headOnly = false) {
  const body = JSON.stringify(payload)
  response.statusCode = status
  response.setHeader("Content-Type", "application/json; charset=utf-8")
  response.setHeader("Cache-Control", "no-store")
  response.end(headOnly ? undefined : body)
}

async function serveStatic(path: string, response: ServerResponse, headOnly: boolean) {
  const requested = path === "/" ? "index.html" : path.replace(/^\/+/, "")
  if (!/^[a-zA-Z0-9._/-]+$/.test(requested) || requested.includes("..")) {
    json(response, 404, { error: "Not found" }, headOnly)
    return
  }

  const absolute = resolve(publicDir, requested)
  if (!absolute.startsWith(resolve(publicDir))) {
    json(response, 404, { error: "Not found" }, headOnly)
    return
  }

  try {
    const content = await readFile(absolute)
    response.statusCode = 200
    response.setHeader("Content-Type", CONTENT_TYPES[extname(absolute)] || "application/octet-stream")
    response.setHeader(
      "Cache-Control",
      requested === "index.html" || requested === "sw.js"
        ? "no-cache"
        : "public, max-age=3600",
    )
    response.end(headOnly ? undefined : content)
  } catch {
    json(response, 404, { error: "Not found" }, headOnly)
  }
}

async function handleRequest(request: IncomingMessage, response: ServerResponse) {
  securityHeaders(response)
  const method = request.method || "GET"
  const headOnly = method === "HEAD"
  if (method !== "GET" && !headOnly) {
    response.setHeader("Allow", "GET, HEAD")
    json(response, 405, { error: "Method not allowed" })
    return
  }

  let path: string
  try {
    path = normalizedPath(request)
  } catch {
    json(response, 400, { error: "Bad request" }, headOnly)
    return
  }

  if (path === "/healthz") {
    json(response, 200, { status: "ok", service: "qeo-ops-dashboard" }, headOnly)
    return
  }

  if (path === "/api/snapshot") {
    try {
      const snapshot = await loadOperationsSnapshot()
      json(response, 200, snapshot, headOnly)
    } catch {
      json(response, 503, {
        status: "unknown",
        observedAt: new Date().toISOString(),
        message: "Operations health unavailable",
      }, headOnly)
    }
    return
  }

  await serveStatic(path, response, headOnly)
}

const server = createServer((request, response) => {
  void handleRequest(request, response).catch(() => {
    if (!response.headersSent) securityHeaders(response)
    json(response, 500, { error: "Internal server error" })
  })
})

server.requestTimeout = 10_000
server.headersTimeout = 12_000
server.keepAliveTimeout = 5_000

server.listen(port, host, () => {
  console.log(`qeo-ops-dashboard listening on ${host}:${port}`)
})

function shutdown() {
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 5_000).unref()
}

process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)
