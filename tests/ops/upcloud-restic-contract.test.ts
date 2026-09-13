import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const root = new URL("../../", import.meta.url)
const read = (path: string) => readFile(new URL(path, root), "utf8")

test("QEO-202 Restic package files exist", async () => {
  const source = await read("ops/upcloud/restic/common.sh")
  assert.match(source, /source_restic_runtime/)
})
