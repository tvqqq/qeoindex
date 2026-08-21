import { toCanvas } from "html-to-image"

export async function captureMarketBoardScreenshot(
  element: HTMLElement,
  options?: {
    pixelRatio?: number
  }
): Promise<Blob | null> {
  const pixelRatio = options?.pixelRatio ?? 2

  // Capture element to high-res canvas
  const canvas = await toCanvas(element, {
    pixelRatio,
    backgroundColor: "#06080a",
    cacheBust: true,
    filter: (node) => {
      if (node instanceof HTMLElement && node.dataset.screenshotExclude === "true") {
        return false
      }
      return true
    },
  })

  // Draw watermark on canvas
  const ctx = canvas.getContext("2d")
  if (ctx) {
    ctx.save()
    const width = canvas.width
    const height = canvas.height
    const centerX = width / 2
    const centerY = height / 2

    // Centered subtle glowing QeoIndex watermark
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"

    // 1. Primary centered brand name
    ctx.font = `italic 800 ${Math.max(48, Math.round(width * 0.055))}px "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif`
    ctx.fillStyle = "rgba(255, 255, 255, 0.08)"
    ctx.shadowColor = "rgba(34, 201, 138, 0.4)"
    ctx.shadowBlur = 24
    ctx.fillText("QeoIndex", centerX, centerY - Math.round(width * 0.015))

    // 2. Subtitle / Copyright
    ctx.font = `600 ${Math.max(15, Math.round(width * 0.016))}px "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif`
    ctx.fillStyle = "rgba(34, 201, 138, 0.22)"
    ctx.shadowBlur = 0
    ctx.fillText("© QeoIndex · Realtime Market Intelligence", centerX, centerY + Math.round(width * 0.025))

    // 3. Bottom right footer stamp
    ctx.textAlign = "right"
    ctx.textBaseline = "bottom"
    ctx.font = `500 ${Math.max(12, Math.round(width * 0.011))}px "Geist Mono", monospace`
    ctx.fillStyle = "rgba(255, 255, 255, 0.35)"
    const timeStamp = new Date().toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false })
    const dateStamp = new Date().toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })
    ctx.fillText(`qeoindex.com · ${dateStamp} ${timeStamp}`, width - 24, height - 16)

    ctx.restore()
  }

  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => {
      resolve(blob)
    }, "image/png")
  })
}

export async function copyBlobToClipboard(blob: Blob): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && typeof ClipboardItem !== "undefined") {
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ])
      return true
    }
  } catch (err) {
    console.warn("Clipboard write failed, downloading fallback:", err)
  }

  // Fallback download if clipboard is blocked
  try {
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `qeoindex-market-board-${new Date().toISOString().slice(0, 10)}.png`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    return true
  } catch {
    return false
  }
}
