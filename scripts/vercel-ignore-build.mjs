import { execFileSync } from "node:child_process"
import { needsVercelBuild } from "./build-impact.mjs"

function changedFilesBetween(baseSha, headSha) {
  const output = execFileSync("git", ["diff", "--name-only", baseSha, headSha], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}

function main() {
  const baseSha = process.env.VERCEL_GIT_PREVIOUS_SHA
  const headSha = process.env.VERCEL_GIT_COMMIT_SHA || "HEAD"

  if (!baseSha) {
    console.log("No previous successful Vercel SHA is available; build conservatively.")
    process.exit(1)
  }

  try {
    const files = changedFilesBetween(baseSha, headSha)
    const shouldBuild = needsVercelBuild(files)
    console.log(`${shouldBuild ? "Build" : "Skip"}: ${files.length} changed file(s) since ${baseSha.slice(0, 7)}.`)
    process.exit(shouldBuild ? 1 : 0)
  } catch (error) {
    console.error("Unable to determine Vercel build impact; build conservatively.")
    if (error instanceof Error && error.message) console.error(error.message)
    process.exit(1)
  }
}

main()
