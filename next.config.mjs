import { execSync } from "node:child_process"
import { withWorkflow } from "workflow/next"

let commitHash =
  process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
  ""
let commitDate = ""

try {
  if (!commitHash) {
    commitHash = execSync("git rev-parse --short HEAD").toString().trim()
  }
  commitDate = execSync("git log -1 --format=%cd --date=format:'%d/%m/%Y %H:%M'").toString().trim()
} catch {
  // Fallback if git is not available in current runtime.
}

const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  // QeoIndex runs the TypeScript 7 native CLI as an explicit build gate.
  // Next 16.3 still has an open compatibility bug when its CLI backend sees the
  // official TS6/TS7 side-by-side alias layout, so keep Next on the TS6 API
  // bridge and skip its duplicate checker. CI and `pnpm build` both run TS7
  // before `next build`, preserving type safety while avoiding the JS checker.
  experimental: {
    useTypeScriptCli: false,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  env: {
    NEXT_PUBLIC_GIT_COMMIT_SHA: commitHash || "",
    NEXT_PUBLIC_GIT_COMMIT_DATE: commitDate || "",
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ]
  },
}

export default withWorkflow(nextConfig)
