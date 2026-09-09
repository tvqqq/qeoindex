import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("QEO-154 homepage hover interaction stacks mini icons behind the active icon and dims sibling cards", () => {
  const home = source("app/page.tsx")
  const interactionUrl = new URL("../components/home/home-workspace-grid.tsx", import.meta.url)

  assert.match(home, /HomeWorkspaceGrid/, "authenticated homepage should delegate card interactions to a client boundary")
  assert.equal(existsSync(interactionUrl), true, "homepage should provide a client interaction component")
  if (!existsSync(interactionUrl)) return

  const interaction = readFileSync(interactionUrl, "utf8")

  assert.match(interaction, /^"use client"/, "hover coordination requires a small client component")
  assert.match(interaction, /useState<string \| null>\(null\)/, "one active card should coordinate sibling focus")
  assert.match(interaction, /onMouseEnter=/)
  assert.match(interaction, /onMouseLeave=/)
  assert.match(interaction, /blur-\[2px\]/, "non-active siblings should receive only a light transient blur")
  assert.match(interaction, /opacity-40/, "non-active siblings should dim while another card is active")
  assert.match(interaction, /scale-\[1\.12\]/, "the active main icon should visibly zoom")
  assert.match(interaction, /data-home-mini-icon/, "mini icons should have an explicit interaction hook")
  assert.match(interaction, /data-home-main-icon/, "main icon should have an explicit interaction hook")
  assert.match(interaction, /z-0/, "mini icons should stay on the back layer")
  assert.match(interaction, /z-10/, "main icon should stay above mini icons")
  assert.match(interaction, /transition-\[opacity,transform\]/, "mini icons should animate only opacity and transform")
  assert.doesNotMatch(interaction, /transition-all|backdrop-blur|backdrop-filter/, "homepage interaction should preserve bounded transition and blur rules")
})
