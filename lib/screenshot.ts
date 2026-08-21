import { toCanvas } from "html-to-image"

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number | number[]
) {
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath()
    ctx.roundRect(x, y, width, height, radius)
    return
  }
  const r = typeof radius === "number" ? radius : radius[0] || 0
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + width - r, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + r)
  ctx.lineTo(x + width, y + height - r)
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  ctx.lineTo(x + r, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function loadSvgImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve(null)
      return
    }
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

async function drawNavbarWatermark(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  boardWidth: number
) {
  ctx.save()

  const scale = Math.max(0.8, boardWidth / 1600)
  const iconSize = Math.round(54 * scale)
  const badgeSize = Math.round(78 * scale)
  const badgeRadius = Math.round(20 * scale)

  // Watermark opacity
  ctx.globalAlpha = 0.15

  // 1. Draw rounded badge container
  const badgeX = centerX - badgeSize / 2
  const badgeY = centerY - Math.round(92 * scale)

  const badgeGrad = ctx.createLinearGradient(badgeX, badgeY, badgeX + badgeSize, badgeY + badgeSize)
  badgeGrad.addColorStop(0, "rgba(34, 201, 138, 0.45)")
  badgeGrad.addColorStop(0.5, "rgba(168, 85, 247, 0.45)")
  badgeGrad.addColorStop(1, "rgba(34, 201, 138, 0.35)")

  ctx.fillStyle = badgeGrad
  ctx.shadowColor = "rgba(34, 201, 138, 0.6)"
  ctx.shadowBlur = Math.round(24 * scale)
  roundRect(ctx, badgeX, badgeY, badgeSize, badgeSize, badgeRadius)
  ctx.fill()

  ctx.strokeStyle = "rgba(255, 255, 255, 0.45)"
  ctx.lineWidth = Math.round(1.5 * scale)
  roundRect(ctx, badgeX, badgeY, badgeSize, badgeSize, badgeRadius)
  ctx.stroke()

  // 2. Draw logo icon
  const logo = await loadSvgImage("/brand/stockos-mark.svg")
  if (logo) {
    ctx.drawImage(
      logo,
      centerX - iconSize / 2,
      badgeY + (badgeSize - iconSize) / 2,
      iconSize,
      iconSize
    )
  }

  // 3. Draw Title "QeoIndex"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  const titleY = badgeY + badgeSize + Math.round(36 * scale)

  ctx.font = `italic 800 ${Math.round(44 * scale)}px "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif`
  ctx.fillStyle = "#ffffff"
  ctx.shadowColor = "rgba(34, 201, 138, 0.7)"
  ctx.shadowBlur = Math.round(24 * scale)

  const qeoWidth = ctx.measureText("Qeo").width
  const indexWidth = ctx.measureText("Index").width
  const totalTitleWidth = qeoWidth + indexWidth

  ctx.textAlign = "left"
  const titleStartX = centerX - totalTitleWidth / 2
  ctx.fillStyle = "rgba(255, 255, 255, 0.95)"
  ctx.fillText("Qeo", titleStartX, titleY)

  const indexGrad = ctx.createLinearGradient(titleStartX + qeoWidth, titleY, titleStartX + totalTitleWidth, titleY)
  indexGrad.addColorStop(0, "#34d399")
  indexGrad.addColorStop(0.5, "#67e8f9")
  indexGrad.addColorStop(1, "#34d399")
  ctx.fillStyle = indexGrad
  ctx.fillText("Index", titleStartX + qeoWidth, titleY)

  // 4. Draw Slogan "Đọc thị trường. Giữ kỷ luật"
  ctx.textAlign = "center"
  ctx.font = `500 ${Math.round(18 * scale)}px "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif`
  ctx.fillStyle = "rgba(203, 213, 225, 0.9)"
  ctx.shadowBlur = 0
  const sloganY = titleY + Math.round(32 * scale)
  ctx.fillText("Đọc thị trường. Giữ kỷ luật", centerX, sloganY)

  ctx.restore()
}

export async function captureMarketBoardScreenshot(
  element: HTMLElement,
  options?: {
    pixelRatio?: number
  }
): Promise<Blob | null> {
  const pixelRatio = options?.pixelRatio ?? 2

  // 1. Capture DOM to raw canvas
  const boardCanvas = await toCanvas(element, {
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

  // 2. Setup high-res framed composition canvas
  const paddingX = Math.round(boardCanvas.width * 0.045)
  const paddingY = Math.round(boardCanvas.height * 0.055)
  const footerHeight = Math.round(36 * (boardCanvas.width / 1600))

  const finalCanvas = document.createElement("canvas")
  finalCanvas.width = boardCanvas.width + paddingX * 2
  finalCanvas.height = boardCanvas.height + paddingY * 2 + footerHeight

  const ctx = finalCanvas.getContext("2d")
  if (!ctx) return null

  ctx.save()

  // 3. Draw Outer Purple / Violet Mesh Gradient Background
  const bgGrad = ctx.createLinearGradient(0, 0, finalCanvas.width, finalCanvas.height)
  bgGrad.addColorStop(0, "#190e2b")
  bgGrad.addColorStop(0.35, "#2d134d")
  bgGrad.addColorStop(0.7, "#1a0f30")
  bgGrad.addColorStop(1, "#0d0718")
  ctx.fillStyle = bgGrad
  ctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height)

  // Radial purple ambient glow
  const purpleGlow = ctx.createRadialGradient(
    finalCanvas.width * 0.3,
    finalCanvas.height * 0.25,
    50,
    finalCanvas.width * 0.3,
    finalCanvas.height * 0.25,
    finalCanvas.width * 0.7
  )
  purpleGlow.addColorStop(0, "rgba(168, 85, 247, 0.25)")
  purpleGlow.addColorStop(0.6, "rgba(147, 51, 234, 0.08)")
  purpleGlow.addColorStop(1, "rgba(147, 51, 234, 0)")
  ctx.fillStyle = purpleGlow
  ctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height)

  // Radial emerald glow
  const emeraldGlow = ctx.createRadialGradient(
    finalCanvas.width * 0.75,
    finalCanvas.height * 0.8,
    40,
    finalCanvas.width * 0.75,
    finalCanvas.height * 0.8,
    finalCanvas.width * 0.6
  )
  emeraldGlow.addColorStop(0, "rgba(34, 201, 138, 0.15)")
  emeraldGlow.addColorStop(1, "rgba(34, 201, 138, 0)")
  ctx.fillStyle = emeraldGlow
  ctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height)

  // Outer frame outline with rounded corners
  const outerBorderRadius = Math.round(28 * (boardCanvas.width / 1600))
  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)"
  ctx.lineWidth = Math.round(2 * (boardCanvas.width / 1600))
  roundRect(ctx, 12, 12, finalCanvas.width - 24, finalCanvas.height - 24, outerBorderRadius)
  ctx.stroke()

  // 4. Draw Inner Window (Board Screenshot) with Multi-layer Shadow and Rounded Corners
  const boardX = paddingX
  const boardY = paddingY
  const boardW = boardCanvas.width
  const boardH = boardCanvas.height
  const innerRadius = Math.round(20 * (boardCanvas.width / 1600))

  // Deep Drop Shadow
  ctx.save()
  ctx.shadowColor = "rgba(0, 0, 0, 0.85)"
  ctx.shadowBlur = Math.round(48 * (boardCanvas.width / 1600))
  ctx.shadowOffsetY = Math.round(22 * (boardCanvas.width / 1600))
  ctx.fillStyle = "#06080a"
  roundRect(ctx, boardX, boardY, boardW, boardH, innerRadius)
  ctx.fill()
  ctx.restore()

  // Purple Neon Ambient Glow around board window
  ctx.save()
  ctx.shadowColor = "rgba(168, 85, 247, 0.35)"
  ctx.shadowBlur = Math.round(36 * (boardCanvas.width / 1600))
  ctx.fillStyle = "#06080a"
  roundRect(ctx, boardX, boardY, boardW, boardH, innerRadius)
  ctx.fill()
  ctx.restore()

  // Clip and Draw the board screenshot
  ctx.save()
  roundRect(ctx, boardX, boardY, boardW, boardH, innerRadius)
  ctx.clip()
  ctx.drawImage(boardCanvas, boardX, boardY, boardW, boardH)

  // Draw Centered Navbar-style Watermark directly over the board screenshot
  await drawNavbarWatermark(ctx, boardX + boardW / 2, boardY + boardH / 2, boardW)
  ctx.restore()

  // Inner Window Outer Stroke Border
  ctx.save()
  ctx.strokeStyle = "rgba(255, 255, 255, 0.16)"
  ctx.lineWidth = Math.round(1.5 * (boardCanvas.width / 1600))
  roundRect(ctx, boardX, boardY, boardW, boardH, innerRadius)
  ctx.stroke()
  ctx.restore()

  // 5. Outer Footer Branding: qeoindex.qeoqeo.com · DD/MM/YYYY HH:MM:SS
  ctx.save()
  ctx.textAlign = "right"
  ctx.textBaseline = "middle"
  ctx.font = `600 ${Math.max(13, Math.round(finalCanvas.width * 0.0105))}px "Plus Jakarta Sans", sans-serif`
  ctx.fillStyle = "rgba(255, 255, 255, 0.6)"
  ctx.shadowColor = "rgba(0, 0, 0, 0.7)"
  ctx.shadowBlur = 8

  const now = new Date()
  const timeStr = now.toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false })
  const dateStr = now.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })
  const stamp = `qeoindex.qeoqeo.com · ${dateStr} ${timeStr}`

  ctx.fillText(stamp, finalCanvas.width - paddingX, finalCanvas.height - paddingY / 2)
  ctx.restore()

  return new Promise<Blob | null>((resolve) => {
    finalCanvas.toBlob((blob) => {
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
