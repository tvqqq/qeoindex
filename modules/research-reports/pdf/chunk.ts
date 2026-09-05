import { createHash } from "node:crypto"

import type { ParsedReportPage, ResearchReportChunk } from "../types.ts"

export const REPORT_CHUNK_VERSION = "report-chunk-v1"
const MAX_CHUNK_CHARS = 4_000

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function splitPageText(text: string): string[] {
  const normalized = normalizeWhitespace(text)
  if (!normalized) return []

  const chunks: string[] = []
  let remaining = normalized
  while (remaining.length > MAX_CHUNK_CHARS) {
    const window = remaining.slice(0, MAX_CHUNK_CHARS + 1)
    const preferredBoundary = Math.max(
      window.lastIndexOf(". ", MAX_CHUNK_CHARS),
      window.lastIndexOf("; ", MAX_CHUNK_CHARS),
      window.lastIndexOf(" ", MAX_CHUNK_CHARS),
    )
    const cutAt = preferredBoundary >= Math.floor(MAX_CHUNK_CHARS * 0.5)
      ? preferredBoundary + 1
      : MAX_CHUNK_CHARS
    chunks.push(remaining.slice(0, cutAt).trim())
    remaining = remaining.slice(cutAt).trim()
  }
  if (remaining) chunks.push(remaining)
  return chunks
}

export function chunkResearchReportPages(
  pages: readonly ParsedReportPage[],
): ResearchReportChunk[] {
  const chunks: ResearchReportChunk[] = []

  for (const page of pages) {
    const pageChunks = splitPageText(page.text)
    pageChunks.forEach((content, chunkIndex) => {
      const identity = `${REPORT_CHUNK_VERSION}\n${page.pageNumber}\n${chunkIndex}\n${content}`
      chunks.push({
        pageNumber: page.pageNumber,
        chunkIndex,
        content,
        chunkHash: createHash("sha256").update(identity).digest("hex"),
        chunkVersion: REPORT_CHUNK_VERSION,
      })
    })
  }

  return chunks
}
