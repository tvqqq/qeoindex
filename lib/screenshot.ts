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

  // Sized +15% for balanced elegance
  const scale = Math.max(0.9, (boardWidth / 1400) * 1.28)
  const iconSize = Math.round(64 * scale)
  const badgeSize = Math.round(92 * scale)
  const badgeRadius = Math.round(24 * scale)

  // Subtle submerged opacity (~11%)
  ctx.globalAlpha = 0.11

  // 1. Draw rounded badge container
  const badgeX = centerX - badgeSize / 2
  const badgeY = centerY - Math.round(92 * scale)

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
  const titleY = badgeY + badgeSize + Math.round(36 * scale)

  ctx.font = `italic 800 ${Math.round(46 * scale)}px "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif`
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
  ctx.font = `600 ${Math.round(18 * scale)}px "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif`
  ctx.fillStyle = "rgba(203, 213, 225, 0.9)"
  ctx.shadowBlur = 0
  const sloganY = titleY + Math.round(30 * scale)
  ctx.fillText("Đọc thị trường. Giữ kỷ luật", centerX, sloganY)

  ctx.restore()
}

// Canonical compact desktop width for 6-column presentation
const TARGET_BOARD_WIDTH = 1380

export async function captureMarketBoardScreenshot(
  element: HTMLElement,
  options?: {
    pixelRatio?: number
  }
): Promise<Blob | null> {
  const pixelRatio = options?.pixelRatio ?? 2

  // 1. Create a compact, standardized 6-column clone inside an offscreen container
  const container = document.createElement("div")
  container.style.position = "fixed"
  container.style.top = "-99999px"
  container.style.left = "-99999px"
  container.style.width = `${TARGET_BOARD_WIDTH}px`
  container.style.height = "100px"
  container.style.overflow = "hidden"
  container.style.zIndex = "-9999"
  container.style.pointerEvents = "none"

  const clone = element.cloneNode(true) as HTMLElement
  clone.style.position = "relative"
  clone.style.top = "0"
  clone.style.left = "0"
  clone.style.margin = "0"
  clone.style.width = `${TARGET_BOARD_WIDTH}px`
  clone.style.minWidth = `${TARGET_BOARD_WIDTH}px`
  clone.style.maxWidth = `${TARGET_BOARD_WIDTH}px`
  clone.style.height = "auto"
  clone.style.minHeight = "auto"
  clone.style.maxHeight = "none"
  clone.style.overflow = "visible"
  clone.style.opacity = "1"
  clone.style.backgroundColor = "#06080a"

  // Unroll all scrollable inner containers
  const scrollContainers = clone.querySelectorAll<HTMLElement>(
    ".overflow-auto, .overflow-y-auto, .overflow-hidden, .min-h-0, .flex-1"
  )
  scrollContainers.forEach((el) => {
    el.style.overflow = "visible"
    el.style.height = "auto"
    el.style.maxHeight = "none"
    el.style.flex = "none"
  })

  // Force exact 6-column grid with clean gap
  const grids = clone.querySelectorAll<HTMLElement>(".grid")
  grids.forEach((grid) => {
    if (grid.querySelectorAll("section").length >= 6) {
      grid.style.display = "grid"
      grid.style.gridTemplateColumns = "repeat(6, minmax(0, 1fr))"
      grid.style.gap = "6px"
      grid.style.width = "100%"
    }
  })

  const sections = clone.querySelectorAll<HTMLElement>("section")
  sections.forEach((sec) => {
    sec.style.height = "auto"
    sec.style.minHeight = "auto"
    sec.style.overflow = "visible"
  })

  // Remove screenshot-excluded elements from clone
  const excluded = clone.querySelectorAll<HTMLElement>('[data-screenshot-exclude="true"]')
  excluded.forEach((el) => el.remove())

  container.appendChild(clone)
  document.body.appendChild(container)

  let boardCanvas: HTMLCanvasElement
  try {
    // Allow browser reflow
    await new Promise((r) => setTimeout(r, 60))
    const cloneHeight = clone.scrollHeight || clone.offsetHeight || 1100

    boardCanvas = await toCanvas(clone, {
      pixelRatio,
      width: TARGET_BOARD_WIDTH,
      height: cloneHeight,
      backgroundColor: "#06080a",
      cacheBust: false,
      skipFonts: true,
    })
  } finally {
    document.body.removeChild(container)
  }

  // 2. Setup high-res framed composition canvas
  const scale = boardCanvas.width / (TARGET_BOARD_WIDTH * pixelRatio)
  const paddingX = Math.round(boardCanvas.width * 0.05)
  const paddingY = Math.round(boardCanvas.height * 0.045)
  const glassRimPadding = Math.round(18 * pixelRatio * scale)
  const footerExtra = Math.round(48 * pixelRatio * scale)

  const finalCanvas = document.createElement("canvas")
  finalCanvas.width = boardCanvas.width + paddingX * 2
  finalCanvas.height = boardCanvas.height + paddingY * 2 + footerExtra

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
  const boardX = paddingX
  const boardY = paddingY
  const boardW = boardCanvas.width
  const boardH = boardCanvas.height
  const innerRadius = Math.round(22 * pixelRatio * scale)

  const rimX = boardX - glassRimPadding
  const rimY = boardY - glassRimPadding
  const rimW = boardW + glassRimPadding * 2
  const rimH = boardH + glassRimPadding * 2
  const rimRadius = innerRadius + glassRimPadding

  // Translucent Glass Rim Shadow
  ctx.save()
  ctx.shadowColor = "rgba(46, 16, 101, 0.4)"
  ctx.shadowBlur = Math.round(44 * pixelRatio * scale)
  ctx.shadowOffsetY = Math.round(18 * pixelRatio * scale)

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
  ctx.lineWidth = Math.max(1.5, Math.round(2 * pixelRatio * scale))
  roundRect(ctx, rimX, rimY, rimW, rimH, rimRadius)
  ctx.stroke()
  ctx.restore()

  // 5. Draw Inner Window (Board Screenshot) with Multi-layer Shadow and Rounded Corners
  // Deep Drop Shadow
  ctx.save()
  ctx.shadowColor = "rgba(0, 0, 0, 0.88)"
  ctx.shadowBlur = Math.round(50 * pixelRatio * scale)
  ctx.shadowOffsetY = Math.round(24 * pixelRatio * scale)
  ctx.fillStyle = "#06080a"
  roundRect(ctx, boardX, boardY, boardW, boardH, innerRadius)
  ctx.fill()
  ctx.restore()

  // Neon Ambient Glow around inner board window
  ctx.save()
  ctx.shadowColor = "rgba(168, 85, 247, 0.45)"
  ctx.shadowBlur = Math.round(38 * pixelRatio * scale)
  ctx.fillStyle = "#06080a"
  roundRect(ctx, boardX, boardY, boardW, boardH, innerRadius)
  ctx.fill()
  ctx.restore()

  // Clip and Draw the board screenshot
  ctx.save()
  roundRect(ctx, boardX, boardY, boardW, boardH, innerRadius)
  ctx.clip()
  ctx.drawImage(boardCanvas, boardX, boardY, boardW, boardH)

  // Draw Centered Navbar-style Watermark directly over the board screenshot (+15% larger)
  await drawNavbarWatermark(ctx, boardX + boardW / 2, boardY + boardH / 2, boardW)
  ctx.restore()

  // Inner Window Outer Stroke Border
  ctx.save()
  ctx.strokeStyle = "rgba(255, 255, 255, 0.22)"
  ctx.lineWidth = Math.max(1, Math.round(1.5 * pixelRatio * scale))
  roundRect(ctx, boardX, boardY, boardW, boardH, innerRadius)
  ctx.stroke()
  ctx.restore()

  // 6. Outer Footer Copyright Stamp: © qeoindex.qeoqeo.com · DD/MM/YYYY HH:MM:SS
  ctx.save()
  ctx.textAlign = "right"
  ctx.textBaseline = "middle"
  ctx.font = `700 ${Math.max(14, Math.round(finalCanvas.width * 0.012))}px "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif`
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
