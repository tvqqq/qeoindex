import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean)
const oldFiles = new Set(tracked)
const moves = new Map([
  ["modules/shared/brand.ts", "modules/shared/brand.ts"],
  ["modules/research/market-insight/ai-conclusion-loader.ts", "modules/research/market-insight/ai-conclusion-loader.ts"],
  ["modules/research/market-insight/ai-conclusion.ts", "modules/research/market-insight/ai-conclusion.ts"],
  ["modules/market/realtime/baseline-cache.ts", "modules/market/realtime/baseline-cache.ts"],
  ["modules/market/data-contract.ts", "modules/market/data-contract.ts"],
  ["modules/market/data.ts", "modules/market/data.ts"],
  ["modules/market/history/ohlcv-grouped.ts", "modules/market/history/ohlcv-grouped.ts"],
  ["modules/market/sectors.ts", "modules/market/sectors.ts"],
  ["modules/market/realtime/session-ui.ts", "modules/market/realtime/session-ui.ts"],
  ["modules/market/universe/sync.ts", "modules/market/universe/sync.ts"],
  ["modules/market/tone.ts", "modules/market/tone.ts"],
  ["modules/research/multi-timeframe.ts", "modules/research/multi-timeframe.ts"],
  ["modules/notion/promote.ts", "modules/notion/promote.ts"],
  ["modules/admin/ops-alerts.ts", "modules/admin/ops-alerts.ts"],
  ["modules/shared/media/screenshot.ts", "modules/shared/media/screenshot.ts"],
  ["modules/market/realtime/session-countdown.ts", "modules/market/realtime/session-countdown.ts"],
  ["modules/shared/ui/sound-engine.ts", "modules/shared/ui/sound-engine.ts"],
  ["modules/market/stock-logo-url.ts", "modules/market/stock-logo-url.ts"],
  ["modules/shared/technical/indicators.ts", "modules/shared/technical/indicators.ts"],
  ["modules/market/realtime/trade-clustering.ts", "modules/market/realtime/trade-clustering.ts"],
  ["modules/market/providers/tradingview/index.ts", "modules/market/providers/tradingview/index.ts"],
  ["modules/shared/ui/use-flash-animation.ts", "modules/shared/ui/use-flash-animation.ts"],
  ["modules/market/realtime/use-market.ts", "modules/market/realtime/use-market.ts"],
  ["modules/shared/ui/cn.ts", "modules/shared/ui/cn.ts"],
  ["modules/market/providers/vndirect/history.ts", "modules/market/providers/vndirect/history.ts"],
])

const treeMoves = [
  ["modules/market/board/", "modules/market/board/"],
  ["modules/shared/supabase/", "modules/shared/supabase/"],
]
for (const [oldPrefix, newPrefix] of treeMoves) {
  for (const file of tracked) {
    if (file.startsWith(oldPrefix)) moves.set(file, newPrefix + file.slice(oldPrefix.length))
  }
}

for (const oldPath of [...moves.keys()]) {
  if (!oldFiles.has(oldPath)) moves.delete(oldPath)
}

const targets = new Map()
for (const [oldPath, newPath] of moves) {
  if (targets.has(newPath)) throw new Error(`Move collision: ${oldPath} -> ${newPath}`)
  targets.set(newPath, oldPath)
}

function stripCodeExt(value) {
  return value.replace(/\.(?:tsx?|jsx?|mjs|cjs)$/, "")
}
function codeExt(value) {
  return value.match(/\.(?:tsx?|jsx?|mjs|cjs)$/)?.[0] || ""
}

const reverse = new Map([...moves].map(([oldPath, newPath]) => [newPath, oldPath]))
for (const [oldPath, newPath] of moves) {
  mkdirSync(path.dirname(newPath), { recursive: true })
  renameSync(oldPath, newPath)
}

const textRoots = ["app", "components", "lib", "modules", "workflows", "tests", "scripts", "docs", "supabase"]
const textFiles = []
function walk(current) {
  if (!existsSync(current)) return
  const info = statSync(current)
  if (info.isDirectory()) {
    for (const child of readdirSync(current)) walk(path.join(current, child))
    return
  }
  if (/\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|yml|yaml|sh)$/.test(current)) textFiles.push(current.replaceAll("\\", "/"))
}
for (const root of textRoots) walk(root)
for (const file of ["package.json", "tsconfig.json", "AGENTS.md", "README.md", "instrumentation.ts", "next.config.mjs"]) if (existsSync(file)) textFiles.push(file)

const replacements = []
function addReplacement(from, to) {
  replacements.push([from, to], [from.replaceAll("/", "\\/"), to.replaceAll("/", "\\/")])
}
for (const [oldPath, newPath] of moves) {
  addReplacement(oldPath, newPath)
  addReplacement(stripCodeExt(oldPath), stripCodeExt(newPath))
  addReplacement(`@/${stripCodeExt(oldPath)}`, `@/${stripCodeExt(newPath)}`)
}
for (const [oldPrefix, newPrefix] of treeMoves) {
  addReplacement(oldPrefix, newPrefix)
  addReplacement(`@/${oldPrefix}`, `@/${newPrefix}`)
}
replacements.sort((a, b) => b[0].length - a[0].length)

function resolveOldRelative(originFile, specifier) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(originFile), specifier))
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}.mjs`, `${base}.cjs`, `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.js`]
  return candidates.find((candidate) => oldFiles.has(candidate)) || null
}
function toSpecifier(fromFile, targetFile, originalSpecifier) {
  const explicitExt = codeExt(originalSpecifier)
  let target = explicitExt ? targetFile : stripCodeExt(targetFile)
  if (!explicitExt && /\/index$/.test(target) && !/\/index$/.test(originalSpecifier)) target = target.slice(0, -6)
  let relative = path.posix.relative(path.posix.dirname(fromFile), target)
  if (!relative.startsWith(".")) relative = `./${relative}`
  return relative
}
function rewriteRelative(full, prefix, specifier, quote, file) {
  const origin = reverse.get(file) || file
  const oldTarget = resolveOldRelative(origin, specifier)
  if (!oldTarget) return full
  if (origin === file && !moves.has(oldTarget)) return full
  return `${prefix}${toSpecifier(file, moves.get(oldTarget) || oldTarget, specifier)}${quote}`
}

for (const file of [...new Set(textFiles)]) {
  let content = readFileSync(file, "utf8")
  for (const [from, to] of replacements) content = content.split(from).join(to)
  if (/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(file)) {
    content = content.replace(/((?:from\s+|import\s*\(\s*|require\s*\(\s*)["'])(\.[^"']+)(["'])/g, (full, prefix, specifier, quote) => rewriteRelative(full, prefix, specifier, quote, file))
    content = content.replace(/(export\s+[^"']*?from\s+["'])(\.[^"']+)(["'])/g, (full, prefix, specifier, quote) => rewriteRelative(full, prefix, specifier, quote, file))
  }
  writeFileSync(file, content)
}

const packagePath = "package.json"
const pkg = JSON.parse(readFileSync(packagePath, "utf8"))
pkg.scripts["lint:touched"] = "eslint --cache --cache-strategy content --cache-location .next/cache/eslint/.eslintcache app components modules workflows --ignore-pattern modules/shared/supabase/database.types.ts"
writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`)

console.log(JSON.stringify({ moved: moves.size, remainingLibSourceFiles: existsSync("lib") ? readdirSync("lib").filter((name) => /\.(?:ts|tsx)$/.test(name)) : [] }, null, 2))