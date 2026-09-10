import { readFileSync, writeFileSync } from "node:fs"

const target = "tests/market-insight-ui-performance.test.ts"
let source = readFileSync(target, "utf8")
if (source.includes("fails closed when same-direction contributor evidence is absent")) process.exit(0)

const anchor = 'test("QEO-186 renders contributors after market health and before deep-dive charts", () => {'
const testBlock = `test("QEO-186 fails closed when same-direction contributor evidence is absent", async () => {
  const modulePath = path.resolve("modules/research/market-insight/vnindex-contributors.ts")
  const { buildVnindexContributorsContext } = await import(modulePath)

  for (const input of [
    { vnindexChange: 2, leaders: [{ category: "index_down", ticker: "DOWN", estimatedIndexPoints: -1, rank: 1 }] },
    { vnindexChange: -2, leaders: [{ category: "index_up", ticker: "UP", estimatedIndexPoints: 1, rank: 1 }] },
    { vnindexChange: 2, leaders: [] },
  ]) {
    const context = buildVnindexContributorsContext(input)
    assert.equal(context.top5ContributionPct, null)
    assert.equal(context.top10ContributionPct, null)
    assert.equal(context.concentrationState, "unknown")
  }
})

`
if (!source.includes(anchor)) throw new Error("QEO-186 placement anchor not found")
source = source.replace(anchor, testBlock + anchor)
writeFileSync(target, source)
