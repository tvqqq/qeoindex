const NON_RUNTIME_PREFIXES = [
  ".github/",
  "docs/",
  "tests/",
  "supabase/migrations/",
]

const NON_RUNTIME_FILES = new Set([
  ".env.example",
  ".gitignore",
  "AGENTS.md",
  "README.md",
])

function normalizePath(path) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "")
}

export function isRuntimeBuildRelevant(path) {
  const normalized = normalizePath(path)
  if (!normalized) return true
  if (NON_RUNTIME_FILES.has(normalized)) return false
  if (normalized.endsWith(".md")) return false
  return !NON_RUNTIME_PREFIXES.some((prefix) => normalized.startsWith(prefix))
}

export function needsVercelBuild(paths) {
  if (!Array.isArray(paths) || paths.length === 0) return true
  return paths.some(isRuntimeBuildRelevant)
}
