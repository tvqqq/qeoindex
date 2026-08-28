import assert from "node:assert/strict"
import test from "node:test"

import { normalizeSectorBreadthPayload } from "../supabase/functions/_shared/sector-breadth-normalizer.ts"

test("sector breadth normalizer preserves row-oriented KFSP payloads", () => {
  assert.deepEqual(
    normalizeSectorBreadthPayload([
      { nganh: "Ngân hàng", count_advances: 10, count_declines: 5, count_nochange: 2 },
      { nganh: "Bất động sản", count_advances: 8, count_declines: 7, count_nochange: 1 },
    ]),
    [
      { name: "Ngân hàng", advances: 10, declines: 5, unchanged: 2 },
      { name: "Bất động sản", advances: 8, declines: 7, unchanged: 1 },
    ],
  )
})

test("sector breadth normalizer accepts KFSP column-oriented payload wrapped in one array item", () => {
  assert.deepEqual(
    normalizeSectorBreadthPayload([
      {
        nganh: ["Ngân hàng", "Bất động sản"],
        count_advances: [10, 8],
        count_declines: [5, 7],
        count_nochange: [2, 1],
      },
    ]),
    [
      { name: "Ngân hàng", advances: 10, declines: 5, unchanged: 2 },
      { name: "Bất động sản", advances: 8, declines: 7, unchanged: 1 },
    ],
  )
})

test("sector breadth normalizer fails closed on mismatched lengths, duplicates, or negative counts", () => {
  assert.deepEqual(
    normalizeSectorBreadthPayload([
      {
        nganh: ["Ngân hàng", "Bất động sản"],
        count_advances: [10],
        count_declines: [5, 7],
        count_nochange: [2, 1],
      },
    ]),
    [],
  )

  assert.deepEqual(
    normalizeSectorBreadthPayload([
      { nganh: "Ngân hàng", count_advances: 10, count_declines: 5, count_nochange: 2 },
      { nganh: "Ngân hàng", count_advances: 8, count_declines: 7, count_nochange: 1 },
    ]),
    [],
  )

  assert.deepEqual(
    normalizeSectorBreadthPayload([
      { nganh: "Ngân hàng", count_advances: -1, count_declines: 5, count_nochange: 2 },
    ]),
    [],
  )
})
