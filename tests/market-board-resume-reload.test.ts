import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createBoundedFrameQueue } from "../modules/market/board/bounded-frame-queue.ts"
import { attachBoardResumeReload, BOARD_HIDDEN_RELOAD_MS, BOARD_RELOAD_REQUIRED_EVENT } from "../modules/market/board/resume-reload.ts"

function fixture() {
  let time = 1_000_000
  let visibilityState: DocumentVisibilityState = "visible"
  let online = true
  let reloads = 0
  let tick: (() => void) | null = null
  const winTarget = new EventTarget()
  const docTarget = new EventTarget()
  const win = Object.assign(winTarget, {
    navigator: { get onLine() { return online } },
    location: { reload() { reloads++ } },
    setInterval(callback: () => void) { tick = callback; return 1 },
    clearInterval() { tick = null },
  })
  const doc = docTarget as EventTarget & { visibilityState: DocumentVisibilityState }
  Object.defineProperty(doc, "visibilityState", { get: () => visibilityState })
  const dispose = attachBoardResumeReload(win as unknown as Window, doc as unknown as Document, () => time)
  return {
    win, doc, dispose,
    advance(ms: number) { time += ms },
    hidden() { visibilityState = "hidden"; doc.dispatchEvent(new Event("visibilitychange")) },
    visible() { visibilityState = "visible"; doc.dispatchEvent(new Event("visibilitychange")) },
    offline() { online = false },
    online() { online = true; win.dispatchEvent(new Event("online")) },
    tick() { tick?.() },
    get reloads() { return reloads },
  }
}

test("board resumes after long hidden interval exactly once, while short switches stay in place", () => {
  const f = fixture()
  f.win.dispatchEvent(new Event("pageshow"))
  assert.equal(f.reloads, 0)
  f.hidden(); f.advance(BOARD_HIDDEN_RELOAD_MS - 1); f.visible()
  assert.equal(f.reloads, 0)
  f.hidden(); f.advance(BOARD_HIDDEN_RELOAD_MS); f.visible()
  f.win.dispatchEvent(new Event("pageshow"))
  f.win.dispatchEvent(new Event("focus"))
  assert.equal(f.reloads, 1)
  f.dispose()
})

test("pagehide/bfcache resume and offline deferred overflow share one reload", () => {
  const f = fixture()
  f.offline()
  f.win.dispatchEvent(new Event("pagehide"))
  f.advance(BOARD_HIDDEN_RELOAD_MS)
  f.win.dispatchEvent(new Event("pageshow"))
  f.win.dispatchEvent(new Event(BOARD_RELOAD_REQUIRED_EVENT))
  assert.equal(f.reloads, 0)
  f.online()
  assert.equal(f.reloads, 1)
  f.dispose()
})

test("watchdog reloads only after an actual visible execution gap", () => {
  const f = fixture()
  f.advance(15_000); f.tick()
  assert.equal(f.reloads, 0)
  f.advance(BOARD_HIDDEN_RELOAD_MS); f.tick()
  assert.equal(f.reloads, 1)
  f.dispose()
})

test("regular visible watchdog ticks across a trading session never reload", () => {
  const f = fixture()
  for (let i = 0; i < 80; i++) { f.advance(15_000); f.tick() }
  assert.equal(f.reloads, 0)
  f.dispose()
})

test("focus after device sleep catches the execution gap before watchdog runs", () => {
  const f = fixture()
  f.advance(BOARD_HIDDEN_RELOAD_MS)
  f.win.dispatchEvent(new Event("focus"))
  assert.equal(f.reloads, 1)
  f.dispose()
})

test("hidden heartbeat does not erase elapsed tab absence", () => {
  const f = fixture()
  f.hidden()
  for (let i = 0; i < 40; i++) { f.advance(15_000); f.tick() }
  f.visible()
  assert.equal(f.reloads, 1)
  f.dispose()
})

test("offline long-hidden resume reloads on network return", () => {
  const f = fixture()
  f.hidden(); f.offline(); f.advance(BOARD_HIDDEN_RELOAD_MS); f.visible()
  assert.equal(f.reloads, 0)
  f.online()
  assert.equal(f.reloads, 1)
  f.dispose()
})

test("frame overflow while hidden waits for visibility and shares one-shot guard", () => {
  const f = fixture()
  f.hidden()
  f.win.dispatchEvent(new Event(BOARD_RELOAD_REQUIRED_EVENT))
  assert.equal(f.reloads, 0)
  f.visible()
  f.win.dispatchEvent(new Event(BOARD_RELOAD_REQUIRED_EVENT))
  assert.equal(f.reloads, 1)
  f.dispose()
})

test("disposed controller removes callbacks and fresh installation has no stale reload", () => {
  const f = fixture()
  f.hidden()
  f.win.dispatchEvent(new Event(BOARD_RELOAD_REQUIRED_EVENT))
  f.dispose()
  f.visible(); f.online(); f.tick()
  assert.equal(f.reloads, 0)
  const fresh = attachBoardResumeReload(f.win as unknown as Window, f.doc as unknown as Document, () => 1_000_000)
  f.win.dispatchEvent(new Event("pageshow"))
  assert.equal(f.reloads, 0)
  fresh()
})

test("bounded FIFO preserves normal frames and rejects overflow without replaying partial state", () => {
  const q = createBoundedFrameQueue<number>(3)
  assert.deepEqual([q.push(1), q.push(2), q.push(3)], [true, true, true])
  assert.deepEqual(q.drain(), [1, 2, 3])
  q.push(4); q.push(5); q.push(6)
  assert.equal(q.push(7), false)
  assert.equal(q.overflowed, true)
  assert.deepEqual(q.drain(), [])
  assert.equal(q.push(8), false)
})

test("market burst cannot accumulate beyond production queue bound", () => {
  const q = createBoundedFrameQueue<number>()
  for (let i = 0; i < 10_000; i++) q.push(i)
  assert.equal(q.overflowed, true)
  assert.equal(q.length, 0)
})

test("resume controller is mounted at board page scope above filter remounts", () => {
  const page = readFileSync(new URL("../app/board/page.tsx", import.meta.url), "utf8")
  assert.ok(page.indexOf("<BoardResumeReload />") < page.indexOf("<MarketBoardFilterShell"))
  const board = readFileSync(new URL("../components/live-market-board.tsx", import.meta.url), "utf8")
  assert.match(board, /createBoundedFrameQueue<string>\(\)/)
  assert.match(board, /window\.cancelAnimationFrame\(messageFrame\)/)
  assert.match(board, /window\.dispatchEvent\(new Event\(BOARD_RELOAD_REQUIRED_EVENT\)\)/)
})
