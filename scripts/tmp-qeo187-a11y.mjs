import fs from "node:fs"
import { execFileSync } from "node:child_process"

const path = "components/insights/market-close-charts.tsx"
let source = fs.readFileSync(path, "utf8")
const before = 'aria-label="Institutional flow persistence Today 5D 20D"'
const after = 'aria-label="Institutional flow persistence · Khối ngoại · Tự doanh · Khác · Today · 5D · 20D"'
if (!source.includes(after)) {
  if (!source.includes(before)) throw new Error("QEO-187 accessibility anchor not found")
  source = source.replace(before, after)
  fs.writeFileSync(path, source)
}

execFileSync("git", ["config", "user.name", "github-actions[bot]"])
execFileSync("git", ["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"])
execFileSync("git", ["add", path])
try {
  execFileSync("git", ["commit", "-m", "fix(QEO-187): describe institutional flow groups accessibly"], { stdio: "inherit" })
  execFileSync("git", ["push", "origin", "HEAD"], { stdio: "inherit" })
} catch {
  console.log("No accessibility changes to commit")
}
