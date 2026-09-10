import { readFileSync, writeFileSync } from "node:fs"

const path = "components/orderbook/live-orderbook-panel.tsx"
let source = readFileSync(path, "utf8")

function replaceOnce(label, before, after) {
  const first = source.indexOf(before)
  if (first < 0) throw new Error(`${label}: source pattern not found`)
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`${label}: source pattern is not unique`)
  source = source.replace(before, after)
}

replaceOnce(
  "connection generation state",
  `    let watchdogTimer: number | null = null\n    let attempts = 0\n`,
  `    let watchdogTimer: number | null = null\n    let attempts = 0\n    let connectionGeneration = 0\n    let fallbackLiveTradeSequence = 0\n`,
)

replaceOnce(
  "generation-safe force reconnect",
  `    const forceReconnect = (reason: string) => {\n      if (disposed) return\n      clearConnectionTimers()\n      if (socket && socket.readyState < WebSocket.CLOSING) {\n        try {\n          socket.close(4000, reason.slice(0, 120))\n        } catch {\n          scheduleReconnect()\n        }\n      } else {\n        scheduleReconnect()\n      }\n    }\n`,
  `    const forceReconnect = (reason: string) => {\n      if (disposed) return\n      connectionGeneration += 1\n      clearConnectionTimers()\n      const currentSocket = socket\n      socket = null\n      if (currentSocket && currentSocket.readyState < WebSocket.CLOSING) {\n        try {\n          currentSocket.close(4000, reason.slice(0, 120))\n        } catch {\n          // Reconnect below even if closing the stale socket throws.\n        }\n      }\n      scheduleReconnect()\n    }\n`,
)

replaceOnce(
  "connect generation token",
  `    const connect = async () => {\n      clearReconnectTimer()\n      clearConnectionTimers()\n      if (disposed) return\n      setState("CONNECTING")\n`,
  `    const connect = async () => {\n      clearReconnectTimer()\n      clearConnectionTimers()\n      if (disposed) return\n      const generation = ++connectionGeneration\n      setState("CONNECTING")\n`,
)

replaceOnce(
  "stale auth response guard",
  `        if (!authResponse.ok || !authJson.ok || !authJson.url || !authJson.auth) throw new Error(authJson.message ?? \`Stream auth \${authResponse.status}\`)\n        if (disposed) return\n\n        let lastPongAt = Date.now()\n\n        socket = new WebSocket(authJson.url)\n        socket.onopen = () => {\n          lastFrameAt.current = Date.now()\n`,
  `        if (!authResponse.ok || !authJson.ok || !authJson.url || !authJson.auth) throw new Error(authJson.message ?? \`Stream auth \${authResponse.status}\`)\n        if (disposed || generation !== connectionGeneration) return\n\n        let lastPongAt = Date.now()\n\n        const nextSocket = new WebSocket(authJson.url)\n        socket = nextSocket\n        nextSocket.onopen = () => {\n          if (disposed || generation !== connectionGeneration || socket !== nextSocket) return\n          lastFrameAt.current = Date.now()\n`,
)

replaceOnce(
  "stale message callback guard",
  `        socket.onmessage = (event) => {\n          if (disposed || typeof event.data !== "string") return\n`,
  `        nextSocket.onmessage = (event) => {\n          if (disposed || generation !== connectionGeneration || socket !== nextSocket || typeof event.data !== "string") return\n`,
)

source = source.replaceAll(
  `if (socket?.readyState === WebSocket.OPEN) socket.send(`,
  `if (nextSocket.readyState === WebSocket.OPEN) nextSocket.send(`,
)
source = source.replaceAll(`socket?.send(JSON.stringify(authJson.auth))`, `nextSocket.send(JSON.stringify(authJson.auth))`)
source = source.replaceAll(`            socket?.send(\n`, `            nextSocket.send(\n`)

replaceOnce(
  "stable live trade identity",
  `            const time = normalizeTime(data?.time)\n            const trade: StreamTrade = {\n              id: \`live-\${time}-\${price}-\${volume}-\${String(data?.side ?? "")}-\${Math.random().toString(36).slice(2, 7)}\`,\n`,
  `            const time = normalizeTime(data?.time)\n            const providerTradeId = [data?.transId, data?.tradeId, data?.sequence, data?.seqNo, data?.id]\n              .map((value) => String(value ?? "").trim())\n              .find((value) => value && value !== "3220")\n            const tradeId = providerTradeId\n              ? \`live-\${symbol}-\${providerTradeId}\`\n              : \`live-fallback-\${symbol}-\${time}-\${price}-\${volume}-\${String(data?.side ?? "")}-\${++fallbackLiveTradeSequence}\`\n            const trade: StreamTrade = {\n              id: tradeId,\n`,
)

replaceOnce(
  "stale socket error and close guards",
  `        socket.onerror = () => {\n          if (!disposed) {\n            setState("ERROR")\n            setError("DNSE WebSocket kết nối lỗi; đang tự kết nối lại.")\n            forceReconnect("orderbook websocket error")\n          }\n        }\n        socket.onclose = () => {\n          clearConnectionTimers()\n          if (disposed) return\n          setState("CLOSED")\n          scheduleReconnect()\n        }\n      } catch (nextError) {\n        if (disposed) return\n`,
  `        nextSocket.onerror = () => {\n          if (disposed || generation !== connectionGeneration || socket !== nextSocket) return\n          setState("ERROR")\n          setError("DNSE WebSocket kết nối lỗi; đang tự kết nối lại.")\n          forceReconnect("orderbook websocket error")\n        }\n        nextSocket.onclose = () => {\n          if (disposed || generation !== connectionGeneration || socket !== nextSocket) return\n          socket = null\n          clearConnectionTimers()\n          setState("CLOSED")\n          scheduleReconnect()\n        }\n      } catch (nextError) {\n        if (disposed || generation !== connectionGeneration) return\n`,
)

replaceOnce(
  "cleanup generation invalidation",
  `    return () => {\n      disposed = true\n      clearReconnectTimer()\n      clearConnectionTimers()\n      document.removeEventListener("visibilitychange", onVisibilityChange)\n      window.removeEventListener("online", onOnline)\n      if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "popup closed")\n    }\n`,
  `    return () => {\n      disposed = true\n      connectionGeneration += 1\n      clearReconnectTimer()\n      clearConnectionTimers()\n      document.removeEventListener("visibilitychange", onVisibilityChange)\n      window.removeEventListener("online", onOnline)\n      const currentSocket = socket\n      socket = null\n      if (currentSocket && currentSocket.readyState < WebSocket.CLOSING) currentSocket.close(1000, "popup closed")\n    }\n`,
)

writeFileSync(path, source)
