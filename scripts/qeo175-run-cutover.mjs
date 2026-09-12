import { readFileSync } from "node:fs"

const boardPath = "components/live-market-board.tsx"
const testPath = "tests/market-board-visual-contract.test.ts"

const board = readFileSync(boardPath, "utf8")
if (board.includes("new WebSocket(authJson.url)")) {
  await import("./qeo175-cutover.mjs")
} else if (!board.includes("subscribeDnseMarketFrames") || !board.includes("subscribeDnseMarketStreamState")) {
  throw new Error("Market Board is neither legacy DNSE transport nor the expected QEO-175 Supabase transport")
} else {
  console.log("QEO-175 Market Board cutover already applied")
}

await import("./qeo175-fix-generated.mjs")

const tests = readFileSync(testPath, "utf8")
if (tests.includes('test("DNSE websocket messages use animation-frame buffering without retaining closures"')) {
  await import("./qeo175-update-tests.mjs")
} else if (!tests.includes('test("Supabase realtime frames use animation-frame buffering without retaining closures"')) {
  throw new Error("Market Board realtime test contract is in an unexpected state")
} else {
  console.log("QEO-175 realtime test contracts already updated")
}
