import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("QEO-155 homepage icon cluster matches the approved reference geometry and palette", () => {
  const home = source("app/page.tsx")

  assert.match(home, /data-home-mini-anchor/, "all satellites should share one exact center anchor")
  assert.match(home, /group-hover\/card:-translate-x-\[3\.625rem\]/, "left satellite should move 58px from the shared center")
  assert.match(home, /group-hover\/card:translate-x-\[3\.625rem\]/, "right satellite should move 58px from the shared center")
  assert.match(home, /group-hover\/card:-translate-y-\[1\.5rem\]/, "left and right satellites should share the same 24px upward offset")
  assert.match(home, /group-hover\/card:-translate-y-\[4\.375rem\]/, "top satellite should move 70px straight upward")
  assert.match(home, /group-hover\/card:-rotate-\[12deg\]/, "left satellite should tilt outward")
  assert.match(home, /group-hover\/card:rotate-\[12deg\]/, "right satellite should tilt outward symmetrically")

  assert.match(home, /h-10 w-10/, "satellite tiles should remain 40px square")
  assert.match(home, /bg-\[#1b1e24\]/, "satellite tiles should use the reference dark surface")
  assert.match(home, /border-\[#363b44\]/, "satellite tiles should use the reference subtle border")
  assert.match(home, /text-\[#b7f64d\]/, "satellite glyphs should use the reference lime accent")

  assert.match(home, /h-\[86px\] w-\[86px\]/, "main tile should be about 86px before hover zoom")
  assert.match(home, /group-hover\/card:scale-\[1\.12\]/, "main tile should zoom to roughly the 96px reference size")
  assert.match(home, /from-\[#e3f7a6\]/)
  assert.match(home, /via-\[#b7e54d\]/)
  assert.match(home, /to-\[#7bc20c\]/)
  assert.match(home, /text-\[#111317\]/, "main glyph should use the dark reference foreground")
  assert.match(home, /rounded-\[24px\]/, "main tile should keep the reference-like rounded silhouette while scaled")

  assert.match(home, /z-0/, "satellites must remain behind the main tile")
  assert.match(home, /z-10/, "main tile must remain above satellites")
  assert.match(home, /duration-\[420ms\]/, "satellite fan-out should use the approved smooth timing")
  assert.match(home, /ease-\[cubic-bezier\(0\.22,1,0\.36,1\)\]/, "zoom and fan-out should use the approved easing")
  assert.doesNotMatch(home, /transition-all|backdrop-blur|backdrop-filter/, "reference matching must preserve the homepage performance contract")
})
