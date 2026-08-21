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

  // Increased by +15% from previous version for optimal presence
  const scale = Math.max(1.0, (boardWidth / 1600) * 1.32)
  const iconSize = Math.round(66 * scale)
  const badgeSize = Math.round(96 * scale)
  const badgeRadius = Math.round(25 * scale)

  // Subtle submerged opacity (~11%)
  ctx.globalAlpha = 0.11

  // 1. Draw rounded badge container
  const badgeX = centerX - badgeSize / 2
  const badgeY = centerY - Math.round(96 * scale)

  const badgeGrad = ctx.createLinearGradient(badgeX, badgeY, badgeX + badgeSize, badgeY + badgeSize)
  badgeGrad.addColorStop(0, "rgba(34, 201, 138, 0.45)")
  badgeGrad.addColorStop(0.5, "rgba(168, 85, 247, 0.45)")
  badgeGrad.addColorStop(1, "rgba(34, 201, 138, 0.35)")

  ctx.fillStyle = badgeGrad
  ctx.shadowColor = "rgba(34, 201, 138, 0.5)"
  ctx.shadowBlur = Math.round(20 * scale)
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
  const titleY = badgeY + badgeSize + Math.round(38 * scale)

  ctx.font = `italic 800 ${Math.round(48 * scale)}px "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif`
  ctx.fillStyle = "#ffffff"
  ctx.shadowColor = "rgba(34, 201, 138, 0.6)"
  ctx.shadowBlur = Math.round(20 * scale)

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
  ctx.font = `600 ${Math.round(18.5 * scale)}px "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif`
  ctx.fillStyle = "rgba(203, 213, 225, 0.9)"
  ctx.shadowBlur = 0
  const sloganY = titleY + Math.round(32 * scale)
  ctx.fillText("Đọc thị trường. Giữ kỷ luật", centerX, sloganY)

  ctx.restore()
}

// Canonical fixed high-res screenshot dimensions across all screen sizes
const CANONICAL_CANVAS_WIDTH = 2400
const CANONICAL_CANVAS_HEIGHT = 1860

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

  // 2. Setup unified canonical canvas dimensions (standardized across all devices)
  const finalCanvas = document.createElement("canvas")
  finalCanvas.width = CANONICAL_CANVAS_WIDTH
  finalCanvas.height = CANONICAL_CANVAS_HEIGHT

  const ctx = finalCanvas.getContext("2d")
  if (!ctx) return null

  ctx.save()

  // 3. Draw Bright Purple / Lilac / White Gradient Background
  const bgGrad = ctx.createLinearGradient(0, 0, finalCanvas.width, finalCanvas.height)
  bgGrad.addColorStop(0, "#3e1b6b")
  bgGrad.addColorStop(0.18, "#581c87")
  bgGrad.addColorStop(0.48, "#7e22ce")
  bgGrad.addColorStop(0.78, "#c084fc")
  bgGrad.addColorStop(0.92, "#e9d5ff")
  bgGrad.addColorStop(1, "#f5f3ff")
  ctx.fillStyle = bgGrad
  ctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height)

  // Luminous radial center ambient glow
  const centerGlow = ctx.createRadialGradient(
    finalCanvas.width * 0.5,
    finalCanvas.height * 0.55,
    120,
    finalCanvas.width * 0.5,
    finalCanvas.height * 0.55,
    finalCanvas.width * 0.75
  )
  centerGlow.addColorStop(0, "rgba(255, 255, 255, 0.45)")
  centerGlow.addColorStop(0.5, "rgba(243, 232, 255, 0.2)")
  centerGlow.addColorStop(1, "rgba(243, 232, 255, 0)")
  ctx.fillStyle = centerGlow
  ctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height)

  // Top violet vignette
  const topVignette = ctx.createLinearGradient(0, 0, 0, finalCanvas.height * 0.35)
  topVignette.addColorStop(0, "rgba(46, 16, 101, 0.45)")
  topVignette.addColorStop(1, "rgba(46, 16, 101, 0)")
  ctx.fillStyle = topVignette
  ctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height * 0.35)

  // 4. Outer Translucent Glass Rim (Border trong suốt bao quanh board)
  const paddingX = 110
  const paddingY = 85
  const glassRimPadding = 22
  const innerRadius = 26

  const boardX = paddingX
  const boardY = paddingY
  const boardW = CANONICAL_CANVAS_WIDTH - paddingX * 2 // 2180px
  const boardH = CANONICAL_CANVAS_HEIGHT - paddingY * 2 - 50 // 1640px

  const rimX = boardX - glassRimPadding
  const rimY = boardY - glassRimPadding
  const rimW = boardW + glassRimPadding * 2
  const rimH = boardH + glassRimPadding * 2
  const rimRadius = innerRadius + glassRimPadding

  // Translucent Glass Rim Shadow
  ctx.save()
  ctx.shadowColor = "rgba(46, 16, 101, 0.4)"
  ctx.shadowBlur = 48
  ctx.shadowOffsetY = 20

  // Frosted Translucent Glass Fill
  const glassFill = ctx.createLinearGradient(rimX, rimY, rimX, rimY + rimH)
  glassFill.addColorStop(0, "rgba(255, 255, 255, 0.32)")
  glassFill.addColorStop(0.5, "rgba(255, 255, 255, 0.18)")
  glassFill.addColorStop(1, "rgba(255, 255, 255, 0.28)")
  ctx.fillStyle = glassFill
  roundRect(ctx, rimX, rimY, rimW, rimH, rimRadius)
  ctx.fill()
  ctx.restore()

  // Translucent Glass Rim Stroke Outline
  ctx.save()
  ctx.strokeStyle = "rgba(255, 255, 255, 0.55)"
  ctx.lineWidth = 2.5
  roundRect(ctx, rimX, rimY, rimW, rimH, rimRadius)
  ctx.stroke()
  ctx.restore()

  // 5. Draw Inner Window (Board Screenshot) with Multi-layer Shadow and Rounded Corners
  // Deep Drop Shadow
  ctx.save()
  ctx.shadowColor = "rgba(0, 0, 0, 0.88)"
  ctx.shadowBlur = 54
  ctx.shadowOffsetY = 24
  ctx.fillStyle = "#06080a"
  roundRect(ctx, boardX, boardY, boardW, boardH, innerRadius)
  ctx.fill()
  ctx.restore()

  // Neon Ambient Glow around inner board window
  ctx.save()
  ctx.shadowColor = "rgba(168, 85, 247, 0.45)"
  ctx.shadowBlur = 40
  ctx.fillStyle = "#06080a"
  roundRect(ctx, boardX, boardY, boardW, boardH, innerRadius)
  ctx.fill()
  ctx.restore()

  // Clip and Draw the board screenshot smoothly scaled into canonical bounds
  ctx.save()
  roundRect(ctx, boardX, boardY, boardW, boardH, innerRadius)
  ctx.clip()
  ctx.drawImage(boardCanvas, 0, 0, boardCanvas.width, boardCanvas.height, boardX, boardY, boardW, boardH)

  // Draw Centered Navbar-style Watermark directly over the board screenshot (+15% larger)
  await drawNavbarWatermark(ctx, boardX + boardW / 2, boardY + boardH / 2, boardW)
  ctx.restore()

  // Inner Window Outer Stroke Border
  ctx.save()
  ctx.strokeStyle = "rgba(255, 255, 255, 0.22)"
  ctx.lineWidth = 1.5
  roundRect(ctx, boardX, boardY, boardW, boardH, innerRadius)
  ctx.stroke()
  ctx.restore()

  // 6. Outer Footer Copyright Stamp: © qeoindex.qeoqeo.com · DD/MM/YYYY HH:MM:SS
  ctx.save()
  ctx.textAlign = "right"
  ctx.textBaseline = "middle"
  ctx.font = `700 19px "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif`
  ctx.fillStyle = "#3b0764"
  ctx.shadowColor = "rgba(255, 255, 255, 0.75)"
  ctx.shadowBlur = 6

  const now = new Date()
  const timeStr = now.toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false })
  const dateStr = now.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })
  const stamp = `© qeoindex.qeoqeo.com · ${dateStr} ${timeStr}`

  ctx.fillText(stamp, finalCanvas.width - paddingX, finalCanvas.height - paddingY / 2 + 5)
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
