import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const route = readFileSync(new URL("../app/api/me/market-board-industry-order/route.ts", import.meta.url), "utf8")
const priceboard = readFileSync(new URL("../components/market-board/industry-priceboard.tsx", import.meta.url), "utf8")

test("industry order API requires the authenticated user and bounds incoming writes", () => {
  assert.match(route, /requireApiUser\(\)/)
  assert.match(route, /\.from\("user_preferences"\)/)
  assert.match(route, /\.eq\("user_id", context\.user\.id\)/)
  assert.match(route, /normalizeSavedIndustryOrder\(candidate\)/)
  assert.match(route, /MAX_BODY_BYTES = 8 \* 1024/)
  assert.match(route, /MAX_SETTINGS_BYTES = 16 \* 1024/)
  assert.match(route, /mergeIndustryOrderIntoSettings\(current\?\.settings, order\)/)
  assert.match(route, /\.eq\("updated_at", current\.updated_at\)/)
  assert.match(route, /MAX_CONFLICT_RETRIES = 3/)
  assert.match(route, /"Cache-Control": "private, no-store, max-age=0"/)
})

test("remote order wins on another device without hydration-triggered uploads", () => {
  assert.match(priceboard, /fetch\("\/api\/me\/market-board-industry-order", \{/)
  assert.match(priceboard, /method: "PUT"/)
  assert.match(priceboard, /credentials: "same-origin"/)
  assert.match(priceboard, /cache: "no-store"/)
  assert.match(priceboard, /if \(remoteLoaded && remoteOrder !== null\)/)
  assert.match(priceboard, /reconcileIndustryColumnOrder\(remoteOrder, industries\)/)
  assert.match(priceboard, /const customized = validCache !== null && cachedOrder\.some/)
  assert.match(priceboard, /if \(remoteLoaded && remoteOrder === null && customized\)/)
  assert.match(priceboard, /const commitIndustryOrder = useCallback/)
  assert.match(priceboard, /commitIndustryOrder\(\(previous\) => moveIndustryColumn\(previous, drag\.source, destination\)\)/)
  assert.match(priceboard, /commitIndustryOrder\(\(previous\) => moveIndustryColumnBy\(previous, industry, offset\)\)/)
  assert.match(priceboard, /resetOrder = useCallback\(\(\) => commitIndustryOrder/)
  assert.match(priceboard, /saveQueueRef\.current = saveQueueRef\.current\.catch/)
  assert.match(priceboard, /Chưa đồng bộ · Thử lại/)
  assert.match(priceboard, /INDUSTRY_ORDER_KEY/)
})
