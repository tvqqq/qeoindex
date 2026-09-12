import { readFileSync, writeFileSync } from "node:fs"

const path = "components/live-market-board.tsx"
let source = readFileSync(path, "utf8")

function replaceOnce(oldText, newText, label) {
  const first = source.indexOf(oldText)
  const last = source.lastIndexOf(oldText)
  if (first < 0 || first !== last) {
    throw new Error(`${label}: expected exactly one source anchor, found ${first < 0 ? 0 : "multiple"}`)
  }
  source = source.slice(0, first) + newText + source.slice(first + oldText.length)
}

replaceOnce(
  'import { publishDnseMarketFrame } from "@/modules/market/providers/dnse/market-stream"',
  `import {
  restartDnseMarketStream,
  subscribeDnseMarketFrames,
  subscribeDnseMarketStreamState,
} from "@/modules/market/providers/dnse/market-stream"`,
  "market stream import",
)

replaceOnce(
  'type DnseAuthPayload = { action: string; api_key: string; signature: string; timestamp: number; nonce: string }\ntype DnseAuthResponse = { ok: boolean; url?: string; auth?: DnseAuthPayload; message?: string }\n',
  "",
  "obsolete browser DNSE auth types",
)
replaceOnce('const INDEX_CHANNELS = ["VNINDEX", "VN30", "HNX", "UPCOM"]\n', "", "browser index channels")
replaceOnce('const STREAM_STALE_MS = 60_000\n', "", "browser DNSE watchdog constant")
replaceOnce('  const lastFrameAt = useRef(0)\n', "", "browser DNSE last-frame ref")

const effectStart = `  useEffect(() => {
    let disposed = false
    let socket: WebSocket | null = null`
const effectEnd = `  }, [symbolKey, reconnectKey, pushFiveMinuteClose, symbolList, trackedSymbols, sessionOpen, triggerWhaleAlert, updateLiveQuote])`
const startIndex = source.indexOf(effectStart)
const endIndex = source.indexOf(effectEnd, startIndex)
if (startIndex < 0 || endIndex < 0) {
  throw new Error("direct DNSE effect anchors not found")
}
if (source.indexOf(effectStart, startIndex + 1) >= 0) {
  throw new Error("direct DNSE effect start anchor is ambiguous")
}

const oldEffect = source.slice(startIndex, endIndex + effectEnd.length)
const handlerStart = oldEffect.indexOf("        const now = new Date()")
const handlerEnd = oldEffect.indexOf("    const scheduleMessage = (raw: string) => {")
if (handlerStart < 0 || handlerEnd < 0 || handlerEnd <= handlerStart) {
  throw new Error("market frame parser anchors not found")
}
let frameParser = oldEffect.slice(handlerStart, handlerEnd)
if (!frameParser.includes("publishDnseMarketFrame(data)")) {
  throw new Error("expected legacy local frame publisher in parser")
}
frameParser = frameParser.replace("        publishDnseMarketFrame(data)\n", "")

const nextEffect = `  useEffect(() => {
    if (!sessionOpen) {
      setStreamState("CLOSED")
      setStreamError("")
      return
    }

    let disposed = false
    let messageQueue: string[] = []
    let messageFrame: number | null = null

    const flushMessageQueue = () => {
      messageFrame = null
      const queued = messageQueue
      messageQueue = []
      for (const raw of queued) {
        if (disposed) return
        let data: Record<string, unknown>
        try { data = JSON.parse(raw) as Record<string, unknown> } catch { continue }

${frameParser}      }
    }

    const scheduleMessage = (raw: string) => {
      messageQueue.push(raw)
      if (messageFrame === null) messageFrame = window.requestAnimationFrame(flushMessageQueue)
    }

    const clearMessageQueue = () => {
      if (messageFrame !== null) window.cancelAnimationFrame(messageFrame)
      messageFrame = null
      messageQueue = []
    }

    const unsubscribeFrames = subscribeDnseMarketFrames((frame) => {
      if (disposed) return
      scheduleMessage(JSON.stringify(frame))
    })
    const unsubscribeState = subscribeDnseMarketStreamState((state) => {
      if (disposed) return
      setStreamState(state.status)
      setStreamError(state.error)
      if (state.lastMessageAt) {
        lastMessageAtRef.current = state.lastMessageAt
        setLastMessageAt((previous) => previous === state.lastMessageAt ? previous : state.lastMessageAt)
      }
    })

    return () => {
      disposed = true
      clearMessageQueue()
      unsubscribeFrames()
      unsubscribeState()
    }
  }, [reconnectKey, pushFiveMinuteClose, trackedSymbols, sessionOpen, triggerWhaleAlert, updateLiveQuote])`

source = source.slice(0, startIndex) + nextEffect + source.slice(endIndex + effectEnd.length)

replaceOnce(
  '  const reconnect = useCallback(() => setReconnectKey((key) => key + 1), [])',
  `  const reconnect = useCallback(() => {
    void restartDnseMarketStream()
    setReconnectKey((key) => key + 1)
  }, [])`,
  "manual reconnect callback",
)

source = source
  .replace("Kết nối lại DNSE Feed", "Kết nối lại Realtime Feed")
  .replace("WS Feed live:", "Realtime relay:")
  .replace("Yahoo 5m + DNSE", "Yahoo 5m + DNSE via Supabase")

if (source.includes("new WebSocket(authJson.url)")) throw new Error("browser DNSE constructor remains after cutover")
if (source.includes("/api/market/stream-auth")) throw new Error("browser DNSE auth fetch remains after cutover")
if (!source.includes("subscribeDnseMarketFrames")) throw new Error("Supabase frame subscription missing after cutover")
if (!source.includes("subscribeDnseMarketStreamState")) throw new Error("Supabase stream-state subscription missing after cutover")
if (!source.includes("restartDnseMarketStream")) throw new Error("manual relay reconnect missing after cutover")

writeFileSync(path, source)
