import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const home = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8")

test("QEO-160 gives every homepage workspace its own accent theme", () => {
  for (const field of [
    "miniIconAccentClassName",
    "mainIconGradientClassName",
    "mainIconBorderClassName",
    "mainIconShadowClassName",
  ]) {
    assert.ok(home.includes(field), `homepage menu items should carry ${field}`)
  }

  const expectedThemes = [
    ["/board", "text-[#b7f64d]", "from-[#e3f7a6]", "to-[#7bc20c]", "rgba(132,204,22,0.65)"],
    ["/portfolio", "text-[#c084fc]", "from-[#f3e8ff]", "to-[#8b5cf6]", "rgba(168,85,247,0.62)"],
    ["/insights", "text-[#67e8f9]", "from-[#cffafe]", "to-[#06b6d4]", "rgba(6,182,212,0.62)"],
    ["/reports", "text-[#fbbf24]", "from-[#fef3c7]", "to-[#f59e0b]", "rgba(245,158,11,0.62)"],
  ] as const

  for (const [href, miniAccent, gradientFrom, gradientTo, shadow] of expectedThemes) {
    assert.ok(home.includes(`href: "${href}"`), `homepage should still expose ${href}`)
    assert.ok(home.includes(miniAccent), `${href} should use its own satellite accent`)
    assert.ok(home.includes(gradientFrom), `${href} should use its own main-tile gradient start`)
    assert.ok(home.includes(gradientTo), `${href} should use its own main-tile gradient end`)
    assert.ok(home.includes(shadow), `${href} should use its own hover glow`)
  }

  assert.match(home, /className=\{`\$\{MINI_ICON_CLASS\} \$\{item\.miniIconAccentClassName\}/)
  assert.match(home, /item\.mainIconGradientClassName/)
  assert.match(home, /item\.mainIconBorderClassName/)
  assert.match(home, /item\.mainIconShadowClassName/)
  assert.doesNotMatch(
    home,
    /const MINI_ICON_CLASS =[\s\S]*text-\[#b7f64d\][\s\S]*transition-\[opacity,transform\]/,
    "shared satellite base class must not force the board lime accent onto every card",
  )
})
