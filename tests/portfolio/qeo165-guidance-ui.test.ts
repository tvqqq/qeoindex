import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("QEO-165 guidance becomes a readable field manual without universal trading defaults", () => {
  const dialog = source("components/portfolio/portfolio-guidance-dialog.tsx")

  assert.match(dialog, /max-w-(?:4xl|5xl)/)
  assert.match(dialog, /Field Manual|Cẩm nang/i)
  assert.match(dialog, /text-(?:sm|base)/)
  assert.match(dialog, /Money Management Plan|kế hoạch quản trị vốn/i)
  assert.match(dialog, /portfolioId|planned-trade|giao dịch dự kiến|planned trade/i)

  assert.doesNotMatch(dialog, /text-\[11px\]/)
  assert.doesNotMatch(dialog, /Tối thiểu R:R = 1:2\.5/i)
  assert.doesNotMatch(dialog, /bắt buộc.*1-2%|Vi phạm là bán ngay/i)
  assert.doesNotMatch(dialog, /tối đa 5%\s*-\s*7%/i)
})
