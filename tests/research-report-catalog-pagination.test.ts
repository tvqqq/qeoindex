import assert from "node:assert/strict"
import test from "node:test"

import { RESEARCH_REPORT_CATALOG_PAGE_SIZE } from "../modules/research-reports/catalog.ts"

test("QEO-83 catalog pagination fills both 2-column and 3-column responsive grids", () => {
  assert.equal(RESEARCH_REPORT_CATALOG_PAGE_SIZE, 24)
  assert.equal(RESEARCH_REPORT_CATALOG_PAGE_SIZE % 2, 0)
  assert.equal(RESEARCH_REPORT_CATALOG_PAGE_SIZE % 3, 0)
})
