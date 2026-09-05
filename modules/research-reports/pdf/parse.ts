import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs"
import * as pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs"

import type { ParsedReportPage, ParsedResearchReportPdf } from "../types.ts"

const pdfJsGlobal = globalThis as typeof globalThis & {
  pdfjsWorker?: typeof pdfjsWorker
}
pdfJsGlobal.pdfjsWorker ??= pdfjsWorker

const MIN_USABLE_TEXT_CHARS = 80

function normalizeExtractedText(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function itemText(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const str = (value as { str?: unknown }).str
  return typeof str === "string" ? str : null
}

function looksUnsupported(error: unknown) {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase()
  return message.includes("password") || message.includes("encrypted")
}

export async function parseResearchReportPdf(bytes: Uint8Array): Promise<ParsedResearchReportPdf> {
  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
  })

  try {
    const document = await loadingTask.promise
    const pages: ParsedReportPage[] = []

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const textContent = await page.getTextContent()
      const text = normalizeExtractedText(
        textContent.items
          .map(itemText)
          .filter((value): value is string => value !== null)
          .join(" "),
      )
      pages.push({ pageNumber, text })
      page.cleanup()
    }

    const totalUsableChars = pages.reduce((sum, page) => sum + page.text.length, 0)
    const hasAnyText = pages.some((page) => page.text.length > 0)
    return {
      status: hasAnyText && totalUsableChars >= MIN_USABLE_TEXT_CHARS ? "parsed" : "needs_ocr",
      pages,
      pageCount: document.numPages,
    }
  } catch (error) {
    if (looksUnsupported(error)) {
      return { status: "unsupported", pages: [], pageCount: 0 }
    }
    throw error
  } finally {
    await loadingTask.destroy()
  }
}
