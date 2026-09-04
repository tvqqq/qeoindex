import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"

const repo = process.cwd()
const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean)
const oldFiles = new Set(tracked)
const moves = new Map()

function moveTree(oldPrefix, newPrefix) {
  for (const file of tracked) {
    if (file.startsWith(oldPrefix)) moves.set(file, newPrefix + file.slice(oldPrefix.length))
  }
}

moveTree("lib/admin/", "modules/admin/")
moveTree("lib/auth/", "modules/auth/")
moveTree("lib/notion/", "modules/notion/")
moveTree("lib/portfolio/", "modules/portfolio/")

function rootTarget(file) {
  if (!file.startsWith("lib/") || file.slice(4).includes("/")) return null
  const name = file.slice(4)
  const ext = path.extname(name)
  const stem = name.slice(0, -ext.length)
  if (!new Set([".ts", ".tsx"]).has(ext)) return null

  const rules = [
    [/^ai-council-(.+)$/, (_, rest) => `modules/ai-council/${rest}${ext}`],
    [/^wyckoff-v2-(.+)$/, (_, rest) => `modules/wyckoff/${rest}${ext}`],
    [/^wyckoff-(.+)$/, (_, rest) => `modules/wyckoff/${rest}${ext}`],
    [/^qeoindex-eod-(.+)$/, (_, rest) => `modules/eod/${rest}${ext}`],
    [/^eod-(.+)$/, (_, rest) => `modules/eod/${rest}${ext}`],
    [/^kfsp-(.+)$/, (_, rest) => `modules/kfsp/${rest}${ext}`],
    [/^scanner-(.+)$/, (_, rest) => `modules/signals/scanner/${rest}${ext}`],
    [/^signals-(.+)$/, (_, rest) => `modules/signals/${rest}${ext}`],
    [/^signal-(.+)$/, (_, rest) => `modules/signals/${rest}${ext}`],
    [/^research-(.+)$/, (_, rest) => `modules/research/${rest}${ext}`],
    [/^insights-(.+)$/, (_, rest) => `modules/research/insights/${rest}${ext}`],
    [/^market-insight-(.+)$/, (_, rest) => `modules/research/market-insight/${rest}${ext}`],
    [/^market-universe(?:-(.+))?$/, (_, rest) => `modules/market/universe/${rest || "index"}${ext}`],
    [/^market-history(?:-(.+))?$/, (_, rest) => `modules/market/history/${rest || "index"}${ext}`],
    [/^dnse-(.+)$/, (_, rest) => `modules/market/providers/dnse/${rest}${ext}`],
    [/^finhay-(.+)$/, (_, rest) => `modules/market/providers/finhay/${rest}${ext}`],
    [/^intraday-(.+)$/, (_, rest) => `modules/market/realtime/intraday-${rest}${ext}`],
  ]
  for (const [re, target] of rules) {
    const match = re.exec(stem)
    if (match) return target(...match)
  }

  const exact = new Map([
    ["broker-live-quotes", `modules/market/realtime/broker-live-quotes${ext}`],
    ["index-candles", `modules/market/realtime/index-candles${ext}`],
    ["ohlcv-history-store", `modules/market/history/ohlcv-store${ext}`],
    ["yahoo-history", `modules/market/providers/yahoo/history${ext}`],
    ["fa-screen-data", `modules/research/fa-screen-data${ext}`],
    ["ui-data-cache", `modules/shared/cache/ui-data-cache${ext}`],
    ["request-cache", `modules/shared/cache/request-cache${ext}`],
    ["lightweight-charts-runtime", `modules/shared/charts/lightweight-charts-runtime${ext}`],
    ["vn-market-calendar", `modules/market/calendar${ext}`],
  ])
  return exact.get(stem) || null
}

for (const file of tracked) {
  const target = rootTarget(file)
  if (target) moves.set(file, target)
}

const targets = new Map()
for (const [oldPath, newPath] of moves) {
  if (targets.has(newPath)) throw new Error(`Move collision: ${oldPath} and ${targets.get(newPath)} -> ${newPath}`)
  targets.set(newPath, oldPath)
}

function stripCodeExt(p) {
  return p.replace(/\.(?:tsx?|jsx?|mjs|cjs)$/, "")
}

const reverse = new Map([...moves].map(([oldPath, newPath]) => [newPath, oldPath]))

for (const [oldPath, newPath] of moves) {
  mkdirSync(path.dirname(newPath), { recursive: true })
  renameSync(oldPath, newPath)
}

const textRoots = ["app", "components", "lib", "modules", "workflows", "tests", "scripts", "docs"]
const textFiles = []
function walk(p) {
  if (!existsSync(p)) return
  const s = statSync(p)
  if (s.isDirectory()) {
    for (const child of readdirSync(p)) walk(path.join(p, child))
    return
  }
  if (/\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|yml|yaml)$/.test(p)) textFiles.push(p.replaceAll("\\", "/"))
}
for (const root of textRoots) walk(root)
for (const p of ["package.json", "tsconfig.json", "AGENTS.md", "README.md"]) if (existsSync(p)) textFiles.push(p)

const replacements = []
for (const [oldPath, newPath] of moves) {
  replacements.push([oldPath, newPath])
  replacements.push([stripCodeExt(oldPath), stripCodeExt(newPath)])
  replacements.push([`@/${stripCodeExt(oldPath)}`, `@/${stripCodeExt(newPath)}`])
}
replacements.sort((a, b) => b[0].length - a[0].length)

function resolveOldRelative(originFile, specifier) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(originFile), specifier))
  const candidates = [
    base,
    `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}.mjs`, `${base}.cjs`,
    `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.js`,
  ]
  return candidates.find((candidate) => oldFiles.has(candidate)) || null
}

function toSpecifier(fromFile, targetFile, originalSpecifier) {
  let target = stripCodeExt(targetFile)
  if (/\/index$/.test(target) && !/\/index$/.test(originalSpecifier)) target = target.slice(0, -6)
  let rel = path.posix.relative(path.posix.dirname(fromFile), target)
  if (!rel.startsWith(".")) rel = `./${rel}`
  return rel
}

for (const file of [...new Set(textFiles)]) {
  let content = readFileSync(file, "utf8")
  for (const [from, to] of replacements) content = content.split(from).join(to)

  if (/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(file)) {
    const origin = reverse.get(file) || file
    content = content.replace(/((?:from\s+|import\s*\(\s*|require\s*\(\s*)["'])(\.[^"']+)(["'])/g, (full, prefix, specifier, quote) => {
      const oldTarget = resolveOldRelative(origin, specifier)
      if (!oldTarget) return full
      const newTarget = moves.get(oldTarget) || oldTarget
      return `${prefix}${toSpecifier(file, newTarget, specifier)}${quote}`
    })
    content = content.replace(/(export\s+[^"']*?from\s+["'])(\.[^"']+)(["'])/g, (full, prefix, specifier, quote) => {
      const oldTarget = resolveOldRelative(origin, specifier)
      if (!oldTarget) return full
      const newTarget = moves.get(oldTarget) || oldTarget
      return `${prefix}${toSpecifier(file, newTarget, specifier)}${quote}`
    })
  }
  writeFileSync(file, content)
}

const packagePath = "package.json"
const pkg = JSON.parse(readFileSync(packagePath, "utf8"))
pkg.scripts["lint:touched"] = "eslint --cache --cache-strategy content --cache-location .next/cache/eslint/.eslintcache app components modules workflows lib --ignore-pattern lib/supabase/database.types.ts"
writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`)

const contracts = {
  admin: ["Admin job/catalog/settings/telemetry ownership", "Routes/UI are adapters; domain does not import app/**"],
  auth: ["Authentication/session/root-admin ownership", "Server/client entrypoints remain explicit"],
  portfolio: ["Portfolio/watchlist/PnL ownership", "Depends on market read APIs; not EOD internals"],
  notion: ["Downstream Notion integration only", "Must not become operational EOD source of truth"],
  market: ["Universe, realtime, history and provider ownership", "Does not depend on EOD orchestration"],
  kfsp: ["KFSP rating/TTAI/provider ownership", "Does not depend on EOD orchestration"],
  signals: ["Scanner/signal policy, data and monitoring ownership", "Consumes market/domain APIs"],
  research: ["Research/FA/insights read-model ownership", "UI/routes remain adapters"],
  wyckoff: ["Current Wyckoff analysis/build/publish ownership", "Active storage contract is 1D + 1W"],
  "ai-council": ["AI Council deterministic/LLM/evidence ownership", "Consumes published market/KFSP/Wyckoff evidence"],
  eod: ["EOD runtime step/recovery/retention orchestration support", "EOD is a consumer/orchestrator, never a dependency of lower-level domains"],
  shared: ["Truly cross-domain primitives only", "No business-domain dumping ground"],
}
for (const [domain, lines] of Object.entries(contracts)) {
  const dir = `modules/${domain}`
  if (!existsSync(dir)) continue
  const body = `# ${domain} module\n\n## Contract\n\n${lines.map((line) => `- ${line}`).join("\n")}\n\nCross-domain callers should prefer the narrowest stable module entrypoint. Internal files are not a compatibility layer; Git history is the archive for removed paths.\n`
  writeFileSync(`${dir}/README.md`, body)
}

const movedByDomain = {}
for (const [oldPath, newPath] of moves) {
  const domain = newPath.split("/")[1]
  movedByDomain[domain] ||= []
  movedByDomain[domain].push({ oldPath, newPath })
}
console.log(JSON.stringify({ moved: moves.size, byDomain: Object.fromEntries(Object.entries(movedByDomain).map(([k, v]) => [k, v.length])) }, null, 2))
