import { build } from "esbuild"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const serviceDir = dirname(fileURLToPath(import.meta.url))
const root = resolve(serviceDir, "../..")

await build({
  absWorkingDir: root,
  entryPoints: [resolve(serviceDir, "entrypoint.ts")],
  outfile: resolve(serviceDir, "dist/eod-worker.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  tsconfig: resolve(root, "tsconfig.json"),
  alias: { "server-only": resolve(serviceDir, "server-only.ts") },
  sourcemap: false,
  minify: false,
  logLevel: "info",
})
