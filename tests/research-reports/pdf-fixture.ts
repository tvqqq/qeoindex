function escapePdfLiteral(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)")
}

export function buildSyntheticTextPdf(pageTexts: readonly string[]): Uint8Array {
  if (pageTexts.length === 0) throw new Error("Synthetic PDF requires at least one page")

  const objects: string[] = []
  const pageObjectNumbers = pageTexts.map((_, index) => 4 + index * 2)
  const contentObjectNumbers = pageTexts.map((_, index) => 5 + index * 2)
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>"
  objects[2] = `<< /Type /Pages /Kids [${pageObjectNumbers.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageTexts.length} >>`
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"

  pageTexts.forEach((text, index) => {
    const pageId = pageObjectNumbers[index]
    const contentId = contentObjectNumbers[index]
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`
    const stream = text.trim()
      ? `BT /F1 12 Tf 72 720 Td (${escapePdfLiteral(text)}) Tj ET`
      : ""
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`
  })

  let pdf = "%PDF-1.4\n%QEO81\n"
  const offsets: number[] = [0]
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(pdf, "latin1")
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`
  }

  const xrefOffset = Buffer.byteLength(pdf, "latin1")
  pdf += `xref\n0 ${objects.length}\n`
  pdf += "0000000000 65535 f \n"
  for (let id = 1; id < objects.length; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return new Uint8Array(Buffer.from(pdf, "latin1"))
}
