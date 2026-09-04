import { readFileSync, writeFileSync } from "node:fs"

function replaceRequired(path, from, to, label) {
  const source = readFileSync(path, "utf8")
  if (!source.includes(from)) throw new Error(`Missing ${label} in ${path}`)
  writeFileSync(path, source.replace(from, to))
}

replaceRequired(
  "components/index-chart/index-chart-modal.tsx",
  `  const firstSizeRef = useRef(initialSize())\n  const [size, setSize] = useState(firstSizeRef.current)\n  const [pos, setPos] = useState(() => initialPosition(firstSizeRef.current))`,
  `  const [initialLayout] = useState(() => {\n    const firstSize = initialSize()\n    return { size: firstSize, pos: initialPosition(firstSize) }\n  })\n  const [size, setSize] = useState(initialLayout.size)\n  const [pos, setPos] = useState(initialLayout.pos)`,
  "initial chart layout",
)

replaceRequired(
  "components/index-chart/index-chart-modal.tsx",
  `  const panelRef = useRef<HTMLDivElement>(null)\n\n  const isLive = lastLiveAt > 0 && Date.now() - lastLiveAt < 20_000\n  const hasAnyData = candles.VNINDEX.length > 0 || candles.VN30F1M.length > 0\n\n  useEffect(() => {`,
  `  const panelRef = useRef<HTMLDivElement>(null)\n  const [liveClock, setLiveClock] = useState(lastLiveAt)\n\n  const isLive = lastLiveAt > 0 && liveClock >= lastLiveAt && liveClock - lastLiveAt < 20_000\n  const hasAnyData = candles.VNINDEX.length > 0 || candles.VN30F1M.length > 0\n\n  useEffect(() => {\n    if (!open) return\n    const updateClock = () => setLiveClock(Date.now())\n    const initialTimer = window.setTimeout(updateClock, 0)\n    const interval = window.setInterval(updateClock, 5_000)\n    return () => {\n      window.clearTimeout(initialTimer)\n      window.clearInterval(interval)\n    }\n  }, [open, lastLiveAt])\n\n  useEffect(() => {`,
  "live chart clock",
)

replaceRequired(
  "components/insights/sector-map-panel.tsx",
  `function SectorLabel({ name, compact = false }: { name: string; compact?: boolean }) {\n  const Icon = getSectorIcon(name)\n  return (\n    <span className={cn(\n      "inline-flex max-w-full items-center gap-1.5 rounded-md border border-cyan-400/25 bg-cyan-400/10 px-1.5 py-0.5 font-sans font-bold text-cyan-300",\n      compact ? "text-[10px]" : "text-xs",\n    )}>\n      <Icon className={cn(compact ? "size-3" : "size-3.5", "shrink-0")} />\n      <span className="truncate">{name}</span>\n    </span>\n  )\n}`,
  `function SectorGlyph({ name, className }: { name: string; className?: string }) {\n  const normalized = (name || "").toLowerCase()\n  if (normalized.includes("ngân hàng") || normalized.includes("bank")) return <Landmark className={className} />\n  if (normalized.includes("chứng khoán") || normalized.includes("tài chính")) return <LineChart className={className} />\n  if (normalized.includes("bất động sản") || normalized.includes("xây dựng") || normalized.includes("đầu tư xây dựng")) return <Building2 className={className} />\n  if (normalized.includes("công nghệ") || normalized.includes("it") || normalized.includes("viễn thông")) return <Cpu className={className} />\n  if (normalized.includes("bán lẻ") || normalized.includes("tiêu dùng") || normalized.includes("sản xuất kinh doanh")) return <ShoppingBag className={className} />\n  if (normalized.includes("dầu khí") || normalized.includes("năng lượng") || normalized.includes("tiện ích") || normalized.includes("điện")) return <Flame className={className} />\n  if (normalized.includes("thực phẩm") || normalized.includes("đồ uống") || normalized.includes("nông nghiệp") || normalized.includes("nông - lâm - ngư")) return <Utensils className={className} />\n  if (normalized.includes("y tế") || normalized.includes("dược")) return <HeartPulse className={className} />\n  if (normalized.includes("hóa chất") || normalized.includes("phân bón")) return <FlaskConical className={className} />\n  if (normalized.includes("vận tải") || normalized.includes("logistics") || normalized.includes("cảng") || normalized.includes("hàng không")) return <Truck className={className} />\n  if (normalized.includes("bảo hiểm")) return <ShieldCheck className={className} />\n  if (normalized.includes("du lịch") || normalized.includes("dịch vụ")) return <Compass className={className} />\n  return <Layers3 className={className} />\n}\n\nfunction SectorLabel({ name, compact = false }: { name: string; compact?: boolean }) {\n  return (\n    <span className={cn(\n      "inline-flex max-w-full items-center gap-1.5 rounded-md border border-cyan-400/25 bg-cyan-400/10 px-1.5 py-0.5 font-sans font-bold text-cyan-300",\n      compact ? "text-[10px]" : "text-xs",\n    )}>\n      <SectorGlyph name={name} className={cn(compact ? "size-3" : "size-3.5", "shrink-0")} />\n      <span className="truncate">{name}</span>\n    </span>\n  )\n}`,
  "static sector glyph",
)

replaceRequired(
  "components/orderbook/live-orderbook-panel.tsx",
  `  let rawPrice = explicitPrice`,
  `  const rawPrice = explicitPrice`,
  "orderbook rawPrice const",
)

console.log("QEO-67 lint cleanup applied")