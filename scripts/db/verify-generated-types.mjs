import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

const committedPath = "modules/shared/supabase/database.types.ts"
const candidatePath = "artifacts/qeo23/database.types.ts"

const run = spawnSync(
  "supabase",
  ["gen", "types", "typescript", "--local", "--schema", "public"],
  { encoding: "utf8" },
)

if (run.error) {
  console.error(`database type generation failed: ${run.error.message}`)
  process.exit(1)
}

if (run.status !== 0) {
  process.stderr.write(run.stderr || "database type generation failed\n")
  process.exit(run.status ?? 1)
}

mkdirSync(dirname(candidatePath), { recursive: true })
writeFileSync(candidatePath, run.stdout, "utf8")

if (!existsSync(committedPath)) {
  console.error(`generated type drift: ${committedPath} is missing`)
  console.error(`candidate written to ${candidatePath}`)
  process.exit(1)
}

const committed = readFileSync(committedPath, "utf8")
if (committed !== run.stdout) {
  console.error(`generated type drift: ${committedPath} differs from local replay schema`)
  console.error(`candidate written to ${candidatePath}`)
  process.exit(1)
}

console.log("generated Supabase Database types: PASS")
